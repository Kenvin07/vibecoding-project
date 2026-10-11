// services/checkinsService.js ｜ 业务层：checkins 表的增删改查
// ---------------------------------------------------------------------------
// 产出：Day 22（第 4 周）· 板块① PATCH / DELETE 实现（连带 GET / POST 一起补齐，
//       让「增删改查」四类操作落在同一张表上，闭环才成立）
//
// 四个接口：
//   GET    /api/checkins          打卡列表（默认跳过已软删除的行）
//   POST   /api/checkins          新增一条打卡
//   PATCH  /api/checkins/{id}     修改一条打卡（兼容 PUT）
//   DELETE /api/checkins/{id}     删除一条打卡（★软删除：只打标记，不真删）
//
// 【今天的主线：删除为什么比新增更容易出事】
//   新增时只有一条路径：校验 → 写库。删除看着更简单，其实要回答三个问题，
//   少回答一个都出事：
//     ① 删的是哪一条？—— 所以必须先校验 id 存在（不存在的 id 给中文提示，
//        而不是让数据库回一句没人看得懂的报错）。
//     ② 删完之后「查不到」是不是就完了？—— 所以查接口必须跟着改：
//        GET 要跳过 isDeleted = true 的行，否则「删了还在」。
//     ③ 删错了怎么办？—— 所以本期用软删除：行还在库里，只是打了标记。
//   这三条下面逐条都有对应代码。
//
// 【改接口的两个原则】
//   ① 只允许改「该改的」：白名单 status / note，其余字段（id / "kitId" /
//      "checkinDate" / "isDeleted" / "createdAt"）一律拒绝并说明原因。
//      理由：kitId / "checkinDate" 一变，这条记录的含义就变了（等于删旧的建新的），
//      而且会去撞 checkins_unique_active_day 那条唯一索引；本期不给这个口子。
//   ② 空修改不算修改：一个可改字段都没带，回 400 而不是「成功但什么都没变」——
//      后者会让人误以为改动生效了。
//
// 【写接口的钥匙】与 POST /api/prices 同一把：请求头 X-API-KEY，值取自云函数
//   环境变量 WRITE_API_KEY。读接口（GET）保持匿名可访问。
// ---------------------------------------------------------------------------

const { HttpError, ConfigError } = require('../lib/errors');
const { readBody } = require('../lib/http');
const {
  readText,
  readEnum,
  readInt,
  readDate,
  readFlag,
  isRealDate,
  nextCheckinId,
} = require('../lib/validators');
const { CHECKIN_STATUSES, MAX_LIMIT, MAX_NOTE, WRITE_KEY_HEADER } = require('../lib/constants');
const kitsRepository = require('../repositories/kitsRepository');
const checkinsRepository = require('../repositories/checkinsRepository');

// 改接口的白名单：只让这两个字段过。
// 这张清单同时是「可改字段按契约」的落点 —— 契约 4.13 登记的就是它。
const PATCHABLE_FIELDS = ['status', 'note'];

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

// 写接口的锁：没钥匙不开门。密钥错了、没带，都回同一句话 ——
// 不告诉对方「你少了几个字符」，不给试探的人任何额外信息。
function ensureWriteKey(req) {
  const expected = process.env.WRITE_API_KEY;
  if (!expected) throw new ConfigError('WRITE_API_KEY');
  const got = req.headers[WRITE_KEY_HEADER];
  if (!got || got !== expected) {
    throw new HttpError(401, 'UNAUTHORIZED', '写接口需要密钥：请在请求头带上 X-API-KEY');
  }
}

// 把库里的一行，修成「回给调用方」的形状。
// 显式逐列列出（而不是整行丢回去）：万一以后库里加了内部列，也不会顺着接口漏出去。
function itemOf(row) {
  return {
    id: row.id,
    kitId: row.kitId !== undefined && row.kitId !== null ? row.kitId : null,
    checkinDate: row.checkinDate !== undefined && row.checkinDate !== null ? row.checkinDate : null,
    status: row.status !== undefined && row.status !== null ? row.status : null,
    note: row.note !== undefined && row.note !== null ? row.note : '',
    isDeleted: row.isDeleted === true,
    createdAt: row.createdAt !== undefined ? row.createdAt : null,
  };
}

// 读请求体，转成 JSON 对象；不是对象就抛 400。
// 与 POST /api/prices 的三步一模一样：空体、坏 JSON、不是对象，各给一句中文。
async function readJsonObject(req) {
  const raw = await readBody(req);
  if (raw.trim() === '') {
    throw new HttpError(400, 'INVALID_PARAM', '请求体不能为空，需要 JSON 对象');
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    throw new HttpError(400, 'INVALID_PARAM', '请求体不是合法的 JSON');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'INVALID_PARAM', '请求体必须是一个 JSON 对象');
  }
  return payload;
}

// 校验一个 status 值是否合法
function assertStatus(value) {
  if (!CHECKIN_STATUSES.includes(value)) {
    throw new HttpError(400, 'INVALID_PARAM', 'status 只能是 ' + CHECKIN_STATUSES.join(' / '));
  }
}

// 校验并规整一个 note 值（选填）。
// 返回 undefined 表示「这次请求没提 note 这个字段」（PATCH 时就不动它）；
// 返回字符串表示「有值，用这个值」。
function normalizeNote(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_PARAM', 'note 必须是字符串');
  }
  const v = value.trim();
  if (v.length > MAX_NOTE) {
    throw new HttpError(400, 'INVALID_PARAM', 'note 最长 ' + MAX_NOTE + ' 个字符');
  }
  return v;
}

// 按 id 找一条「还算存在」的打卡。找不到、或已经被软删除，都算「没有这条」。
// 【为什么已软删除的也算找不到】因为 GET 默认已经不返回它了 ——
//   如果 DELETE / PATCH 还认它，就会出现「查不到、但能改」的错位状态。
//   两边口径一致：对外的世界里，它已经不存在了。
function findActiveRecord(rows, id) {
  for (const row of rows) {
    if (row.id === id) {
      if (row.isDeleted === true) break; // 找到但已删除 → 当作不存在
      return row;
    }
  }
  throw new HttpError(404, 'RECORD_NOT_FOUND', '没有找到这条打卡记录：' + id);
}

// ---------------------------------------------------------------------------
// 一、GET /api/checkins（列表）
// ---------------------------------------------------------------------------
// 筛选（全部可选）：kitId / status / dateFrom / dateTo → 内存过滤
//                 includeDeleted → 是否把软删除的行也列出来（默认否）
//                 limit（默认 100）/ offset → 内存截断
// 排序：checkinDate 倒序（新的在前），同日期按 id 升序（结果稳定可复现）
async function fetchCheckins(sp) {
  const kitId = readText(sp, 'kitId');
  const status = readEnum(sp, 'status', CHECKIN_STATUSES);
  const dateFrom = readDate(sp, 'dateFrom');
  const dateTo = readDate(sp, 'dateTo');
  const includeDeleted = readFlag(sp, 'includeDeleted', false);
  const limit = readInt(sp, 'limit', 100, 1, MAX_LIMIT);
  const offset = readInt(sp, 'offset', 0, 0, 1000000);

  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new HttpError(400, 'INVALID_PARAM', 'dateFrom 不能晚于 dateTo');
  }

  const rows = await checkinsRepository.listCheckins();

  const items = [];
  for (const row of rows) {
    // ★软删除的第一道体现：默认把打了删除标记的行挡在结果之外。
    //   没有这一行，「DELETE 后 GET 不再返回」就不成立。
    if (!includeDeleted && row.isDeleted === true) continue;
    if (kitId !== null && row.kitId !== kitId) continue;
    if (status !== null && row.status !== status) continue;
    if (dateFrom !== null && row.checkinDate < dateFrom) continue;
    if (dateTo !== null && row.checkinDate > dateTo) continue;
    items.push(itemOf(row));
  }

  items.sort((a, b) =>
    a.checkinDate !== b.checkinDate
      ? a.checkinDate < b.checkinDate ? 1 : -1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  return {
    total: items.length, // 符合条件的总条数（不受 limit 影响），与 /api/prices 口径一致
    limit: limit,
    offset: offset,
    items: items.slice(offset, offset + limit),
  };
}

// ---------------------------------------------------------------------------
// 二、POST /api/checkins（新增一条打卡）
// ---------------------------------------------------------------------------
// 步骤：① 验密钥 → ② 读 JSON 体 → ③ 校验必填/格式 → ④ 查 kitId 存在
//      → ⑤ 查重（同机体同一天）→ ⑥ 生成 id → ⑦ 写库 → ⑧ 回 201
async function createCheckin(req) {
  ensureWriteKey(req);

  const payload = await readJsonObject(req);

  // ③-a 必填字段：缺哪个报哪个，一次列全
  const filled = (k) =>
    payload[k] !== undefined && payload[k] !== null && String(payload[k]).trim() !== '';
  const missing = [];
  for (const k of ['kitId', 'checkinDate', 'status']) {
    if (!filled(k)) missing.push(k);
  }
  if (missing.length) {
    throw new HttpError(400, 'INVALID_PARAM', '缺少必填字段：' + missing.join('、'));
  }

  const kitId = String(payload.kitId).trim();
  const checkinDate = String(payload.checkinDate).trim();
  const status = String(payload.status).trim();

  // ③-b 格式与取值范围
  assertStatus(status);
  if (!isRealDate(checkinDate)) {
    throw new HttpError(400, 'INVALID_PARAM', 'checkinDate 必须是 YYYY-MM-DD 的真实日期，例如 2026-10-11');
  }
  let note = normalizeNote(payload.note);
  if (note === undefined) note = ''; // 新增时没写备注 → 空串（与建表 DEFAULT '' 一致）

  // ④ kitId 必须真的存在
  const kit = await kitsRepository.findKitById(kitId);
  if (kit === null) {
    throw new HttpError(404, 'KIT_NOT_FOUND', '没有找到这台机体：' + kitId);
  }

  // ⑤ 查重：同一台机体 + 同一天，只允许有一条【还没被删掉】的打卡。
  //    与建表时的部分唯一索引 checkins_unique_active_day 逐字对齐 ——
  //    注意这里判的是 isDeleted !== true，不是「无条件判重」：
  //    昨天删掉的那条不该挡住今天重新打卡。
  const rows = await checkinsRepository.listCheckins();
  const dup = rows.some(
    (r) => r.kitId === kitId && r.checkinDate === checkinDate && r.isDeleted !== true
  );
  if (dup) {
    throw new HttpError(409, 'DUPLICATE_RECORD', '这台机体在这一天已经有打卡记录了，请用 PATCH 修改');
  }

  // ⑥⑦ 生成 id 并写库；撞号（极小概率）就换一个号重试，最多 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = nextCheckinId(rows);
    try {
      const inserted = await checkinsRepository.insertCheckin({
        id: id,
        kitId: kitId,
        checkinDate: checkinDate,
        status: status,
        note: note,
        isDeleted: false,
      });
      const row = (Array.isArray(inserted) ? inserted[0] : inserted) || {};
      const item = itemOf({
        id: row.id !== undefined && row.id !== null ? row.id : id,
        kitId: row.kitId !== undefined && row.kitId !== null ? row.kitId : kitId,
        checkinDate: row.checkinDate !== undefined && row.checkinDate !== null ? row.checkinDate : checkinDate,
        status: row.status !== undefined && row.status !== null ? row.status : status,
        note: row.note !== undefined && row.note !== null ? row.note : note,
        isDeleted: row.isDeleted !== undefined ? row.isDeleted : false,
        createdAt: row.createdAt !== undefined ? row.createdAt : null,
      });
      console.log(
        '[api] POST /api/checkins 写入成功 id=' + item.id +
        ' kitId=' + item.kitId + ' checkinDate=' + item.checkinDate + ' status=' + item.status
      );
      return { item: item };
    } catch (err) {
      const detail = err && err.body ? String(err.body) : '';
      // 唯一索引兜底（第二道防线，正常路径走不到）
      if (detail.indexOf('checkins_unique_active_day') >= 0 || detail.indexOf('23505') >= 0) {
        throw new HttpError(409, 'DUPLICATE_RECORD', '这台机体在这一天已经有打卡记录了，请用 PATCH 修改');
      }
      if (detail.indexOf('23503') >= 0 || detail.indexOf('foreign key') >= 0) {
        throw new HttpError(404, 'KIT_NOT_FOUND', '没有找到这台机体：' + kitId);
      }
      if (detail.indexOf('23514') >= 0 || detail.indexOf('violates check constraint') >= 0) {
        throw new HttpError(400, 'INVALID_PARAM', '数据不符合字段规则，请检查 status 的取值');
      }
      if (detail.indexOf('checkins_pkey') >= 0 || detail.indexOf('duplicate key') >= 0) {
        console.warn('[api] POST /api/checkins 撞号，换个 id 重试：', id);
        rows.push({ id: id });
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(500, 'INTERNAL_ERROR', '服务异常，请稍后重试');
}

// ---------------------------------------------------------------------------
// 三、PATCH /api/checkins/{id}（修改一条打卡，兼容 PUT）
// ---------------------------------------------------------------------------
// 步骤：① 验密钥 → ② 读 JSON 体 → ③ 只留白名单字段（其余一律拒绝）
//      → ④ 校验值 → ⑤ 查这条记录还在不在 → ⑥ 写库 → ⑦ 回改后的完整记录
async function updateCheckin(req, id) {
  ensureWriteKey(req);

  const payload = await readJsonObject(req);

  // ③ 白名单过滤：只允许 status / note。
  //    这里【不】默默忽略多余字段，而是明确报错 —— 因为「我以为改了，其实没改」
  //    比「报错告诉我改不了」危险得多。这正是今天主题里说的：改/删要比新增多留神。
  const keys = Object.keys(payload);
  const bad = keys.filter((k) => !PATCHABLE_FIELDS.includes(k));
  if (bad.length) {
    throw new HttpError(
      400,
      'INVALID_PARAM',
      '只能修改 ' + PATCHABLE_FIELDS.join(' / ') + '；不可修改的字段：' + bad.join('、')
    );
  }

  // ②′ 空修改不算修改：一个可改字段都没带，直接拒绝
  const patchObj = {};
  if (payload.status !== undefined) {
    const status = String(payload.status).trim();
    assertStatus(status);
    patchObj.status = status;
  }
  if (payload.note !== undefined) {
    patchObj.note = normalizeNote(payload.note);
  }
  if (Object.keys(patchObj).length === 0) {
    throw new HttpError(400, 'INVALID_PARAM', '请求体里至少要带一个可改字段：status 或 note');
  }

  // ⑤ 这条记录还在不在？不在（或已软删除）→ 404 + 中文说明
  const rows = await checkinsRepository.listCheckins();
  findActiveRecord(rows, id);

  try {
    const updated = await checkinsRepository.updateCheckin(id, patchObj);
    const row = (Array.isArray(updated) ? updated[0] : updated) || {};
    const item = itemOf({
      id: row.id !== undefined && row.id !== null ? row.id : id,
      kitId: row.kitId,
      checkinDate: row.checkinDate,
      status: row.status !== undefined && row.status !== null ? row.status : patchObj.status,
      note: row.note !== undefined && row.note !== null ? row.note : patchObj.note,
      isDeleted: row.isDeleted,
      createdAt: row.createdAt,
    });
    console.log('[api] PATCH /api/checkins/' + id + ' 修改成功 ' + JSON.stringify(patchObj));
    return { item: item };
  } catch (err) {
    const detail = err && err.body ? String(err.body) : '';
    if (detail.indexOf('23505') >= 0) {
      throw new HttpError(409, 'DUPLICATE_RECORD', '这台机体在这一天已经有打卡记录了');
    }
    if (detail.indexOf('23514') >= 0 || detail.indexOf('violates check constraint') >= 0) {
      throw new HttpError(400, 'INVALID_PARAM', '数据不符合字段规则，请检查 status 的取值');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 四、DELETE /api/checkins/{id}（删除一条打卡 · 软删除）
// ---------------------------------------------------------------------------
// 【本期是软删除，不是真删】清单「余力加练」的要求：不真删数据，只把
// "isDeleted" 置 true，查的时候跳过。好处是删错了还能找回（改回 false 即可）。
// 代价是所有读路径都必须记得过滤 —— 这就是「删除比新增更容易出事」的由来：
// 新增只影响一个地方，删除会让「查不到」这件事散落在每一个查询里。
//
// 步骤：① 验密钥 → ② 查这条记录还在不在 → ③ 打标记 → ④ 回改后的记录（200）
async function deleteCheckin(req, id) {
  ensureWriteKey(req);

  const rows = await checkinsRepository.listCheckins();
  findActiveRecord(rows, id);

  try {
    const updated = await checkinsRepository.updateCheckin(id, { isDeleted: true });
    const row = (Array.isArray(updated) ? updated[0] : updated) || {};
    const item = itemOf({
      id: row.id !== undefined && row.id !== null ? row.id : id,
      kitId: row.kitId,
      checkinDate: row.checkinDate,
      status: row.status,
      note: row.note,
      // 网关若没回整行，就按「我们刚做过什么」来填 —— 这一趟的目的就是把它标成已删
      isDeleted: row.isDeleted !== undefined ? row.isDeleted : true,
      createdAt: row.createdAt,
    });
    console.log('[api] DELETE /api/checkins/' + id + ' 已软删除（isDeleted=true）');
    return { item: item };
  } catch (err) {
    const detail = err && err.body ? String(err.body) : '';
    if (detail.indexOf('22P02') >= 0) {
      throw new HttpError(400, 'INVALID_PARAM', 'id 的格式不对');
    }
    throw err;
  }
}

module.exports = { fetchCheckins, createCheckin, updateCheckin, deleteCheckin };
