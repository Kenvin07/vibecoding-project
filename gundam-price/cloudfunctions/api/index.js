// index.js ｜ Day 17 读接口 + Day 18 写接口云函数（第 3 周）
// ---------------------------------------------------------------------------
// 类型：HTTP 云函数 —— 和 Day 15 的 health 同款：scf_bootstrap 启动 node，
//       常驻监听 9000 端口，一个「真的小网站服务器」。
//
// 今天实现契约里的两条【只读】接口：
//   GET /api/kits    机体列表（首页用）  ← 核心表 kits + 记录表 kit_prices
//   GET /api/prices  渠道价格记录列表    ← 记录表 kit_prices
//
// 统一响应形状（api-contract.md 第 1 节）：
//   成功 { "ok": true,  "data": { ... }, "error": null }
//   失败 { "ok": false, "data": null,    "error": { "code": "...", "message": "..." } }
//
// 【数据怎么拿 · Day 17 定稿】
//   走 CloudBase 官方「数据网关」REST API（PostgREST 风格）：
//     https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/<表名>
//   为什么不直连数据库：控制台目前不展示直连用的「连接信息」（社区已确认是功能缺口，
//   免费档还可能没有网络入口）；网关是官方长期支持的正路，用 API Key 开门，
//   不需要数据库密码 —— 凭证面更小，也不用装任何驱动（Node 自带 fetch）。
//
// 【防注入 · 今天的教学点】
//   直连方案里防注入靠 $1 $2 参数化；网关方案里用户输入【根本不进查询语句】——
//   全部经过 URLSearchParams 编码或干脆在服务端内存里过滤（本期数据量极小，
//   契约原文：「本期数据量极小（5 台机体）」）。效果一样：用户输入和查询逻辑永远分离。
//
// 【凭证 · 环境变量，不进代码不进 Git】
//   CLOUDBASE_ENV_ID    环境 ID（控制台 → 环境管理 → API 密钥 同页可见）
//   CLOUDBASE_API_KEY   API Key（=service_role 管理员身份，只放云函数环境变量，
//                       严禁写进前端代码，严禁出现在响应里）
//
// 【Day 17 当时不做】写接口（POST/PUT/DELETE）、收藏表、跨域配置。
//
// ===========================================================================
// 【Day 18 新增：写接口 POST /api/prices】
// ===========================================================================
// 给核心记录表 kit_prices 新增一行（「录入一次某渠道的价格」= 一行）。
// 走的是和读接口同一个数据网关，写法对称：
//
//   POST https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/kit_prices
//   Prefer: return=representation   ← 让网关把「插入后的完整记录」回给我们，
//                                     否则默认只回状态码和受影响行数，
//                                     云端生成的 createdAt 就拿不到了
//
// 【今天防了两件事（这是今天的主题）】
//   ① 重复提交（防重复录入）
//      同 机体 + 渠道 + 类型 + 日期 已经有一条 → 409 DUPLICATE_RECORD。
//      两道防线：先查一遍给「人话」提示；数据库那条唯一约束
//      kit_prices_unique_channel 兜底 —— 万一两个请求同时进来，
//      数据库一定拦得住（接口自己判断是会有时间差的）。
//   ② 错误输入（防脏数据）
//      缺必填字段 / 渠道名拼错 / price 是负数或小数 / 日期是 2026-02-30
//      → 400，提示全中文，而且指明【缺的是哪个字段】，不只回一句「参数错误」。
//
// 【写接口的钥匙 · Day 18 拍板 A 方案】
//   光有网址谁都能往库里写太危险，加一把固定密钥：请求头 X-API-KEY。
//   密钥只放在云函数环境变量 WRITE_API_KEY 里 ——
//   不进代码、不进 Git、不出现在任何响应里。
//   读接口（GET）保持匿名可访问：前端要用，不能加锁。
//   没带 / 带错 → 401 UNAUTHORIZED。
//
// 【Day 18 仍然不做】PUT / DELETE、批量写入、收藏表、跨域。
// ---------------------------------------------------------------------------

const http = require('http');

// 监听端口：云函数固定 9000（控制台「监听端口」配置项要跟它一致）；
// 本机自测时可以用 PORT=9100 换个口，避免和别的东西打架。
const PORT = Number(process.env.PORT || 9000);

// ---------------------------------------------------------------------------
// 一、数据网关客户端（Day 17 定稿：官方 REST 网关，替代 pg 直连）
// ---------------------------------------------------------------------------

function gwBase() {
  const envId = process.env.CLOUDBASE_ENV_ID;
  if (!envId) throw new ConfigError();
  return 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest';
}

// 环境变量没配齐时的专属报错（日志里说得明明白白，公网上只说"服务异常"）
// 参数 missing 用来指认【缺哪一个】，部署时一眼就知道去补什么
class ConfigError extends Error {
  constructor(missing) {
    super('缺少环境变量 ' + (missing || 'CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY'));
  }
}

// GET 一张表：返回解析好的 JSON 数组
// url 里【永远没有】API Key —— 它只出现在请求头 Authorization 里
async function gwGet(table) {
  const envId = process.env.CLOUDBASE_ENV_ID;
  const key = process.env.CLOUDBASE_API_KEY;
  if (!envId || !key) throw new ConfigError();

  // 表名不带前导斜杠（防 /rest//kits 这种双斜杠，网关会当 404）
  const tablePath = table.replace(/^\/+/, '');
  const url = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest/' + tablePath;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000), // 8 秒没回话就放弃，别让调用方干等
    });
  } catch (err) {
    // 网络层错误（超时 / 连不上）：只记日志，不把内部细节回给公网
    console.error('[api] 网关请求失败（网络层）：', url, err && err.message);
    throw new Error('gateway network error');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[api] 网关返回异常：', res.status, url, body.slice(0, 500));
    throw new Error('gateway http ' + res.status);
  }
  return res.json();
}

// 把网关返回的行里，驼峰列名稳妥地取出来（列在库里就是小驼峰，原样取）
function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row[k] !== undefined ? row[k] : null;
  return out;
}

// 【Day 18 新增】POST 写一张表：插一行，返回「插入后的完整记录」
// 与 gwGet 同款的规矩：API Key 只走请求头；出错细节只写日志，不回公网。
// 为什么另写一个、不把 gwGet 改成通用函数：读路径是 Day 17 已验收通过的代码，
// 今天不动它，少一处「改坏了原来好的东西」的风险。两边多几行重复，认了。
async function gwPost(table, row) {
  const envId = process.env.CLOUDBASE_ENV_ID;
  const key = process.env.CLOUDBASE_API_KEY;
  if (!envId || !key) throw new ConfigError();

  const tablePath = table.replace(/^\/+/, '');
  const url = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest/' + tablePath;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        // 让网关把插入的数据回给我们（不写这行 = 只回状态码，拿不到 id/createdAt）
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[api] 网关写入失败（网络层）：', url, err && err.message);
    throw new Error('gateway network error');
  }
  if (!res.ok) {
    // ⚠️ 读写最大的差别就在这：写失败的响应体里带着「数据库为什么拒绝」，
    //    必须读出来 —— 数据库的约束错误码（SQLSTATE，如 23505）就藏在这里面，
    //    靠它才能把「重复录入」和「机体不存在」两种 409 分开。
    const body = await res.text().catch(() => '');
    console.error('[api] 网关写入被拒：', res.status, url, body.slice(0, 500));
    const e = new Error('gateway http ' + res.status);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  // return=representation 时响应体是 JSON（数组或对象），空体则没有
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 二、常量（改这里就能改行为，不用翻逻辑）
// ---------------------------------------------------------------------------
// 汇率：全站一份，五算计算用。契约 2.4 的 app_meta 表今天还没建
//（今天不做改表结构），所以先放代码常量，值与 data/data.json 一致。
// 等 app_meta 建好后，改成从库里读 —— 契约第 6 节待定项已登记。
const EXCHANGE_RATE = 0.048;

// 枚举值：与建表时的 CHECK 约束保持一致（契约 2.2）
const PLATFORMS = ['pdd', 'taobao', 'xianyu'];
const MARKET_TYPES = ['行货', '水货'];

// 列表接口的 limit 上限：现在总共十几行数据，纯防呆用
const MAX_LIMIT = 500;

// keyword 最长长度（防呆，不是防注入——输入根本不进查询语句）
const MAX_KEYWORD = 30;

// 【Day 18】写接口密钥的请求头名字。
// 代码里只有「头叫什么」，密钥的值来自环境变量 WRITE_API_KEY —— 值和代码分离，
// 这样密钥永远进不了代码库，也不会被截图/日志带出去。
const WRITE_KEY_HEADER = 'x-api-key';

// 【Day 18】请求体大小上限：一条价格记录就几百字节，64KB 纯属防呆
const MAX_BODY = 64 * 1024;

// ---------------------------------------------------------------------------
// 三、小工具：统一响应 / 参数校验
// ---------------------------------------------------------------------------

// 参数不合法时抛它，外层统一转成 400
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(text);
}

// 成功：契约统一外壳 { ok, data, error }
function sendOk(res, data) {
  sendJson(res, 200, { ok: true, data: data, error: null });
}

// 成功（创建）：契约规定 POST 成功用 201，外壳跟 200 完全一样，
// 只有「新建了一个东西」和「读到了东西」的状态码区别。
function sendCreated(res, data) {
  sendJson(res, 201, { ok: true, data: data, error: null });
}

// 失败：HTTP 状态码 + { ok:false, data:null, error:{code,message} }
function sendFail(res, status, code, message) {
  sendJson(res, status, {
    ok: false,
    data: null,
    error: { code: code, message: message },
  });
}

// 读一个可选的整数参数（limit / offset 用）
// 不传 → 返回 fallback；传了但不是正整数 / 超范围 → 抛 400
function readInt(sp, name, fallback, min, max) {
  const raw = sp.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 必须是正整数');
  }
  const n = Number(raw);
  if (n < min || n > max) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 的取值范围是 ' + min + ' ~ ' + max);
  }
  return n;
}

// 读一个可选的日期参数（YYYY-MM-DD），格式不对抛 400
function readDate(sp, name) {
  const raw = sp.get(name);
  if (raw === null || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 的格式必须是 YYYY-MM-DD');
  }
  return raw;
}

// 读一个可选字符串参数，顺手把首尾空格去掉
function readText(sp, name) {
  const raw = sp.get(name);
  if (raw === null) return null;
  const v = raw.trim();
  return v === '' ? null : v;
}

// 枚举参数校验（platform / marketType / series 这类）
function readEnum(sp, name, allowed) {
  const v = readText(sp, name);
  if (v === null) return null;
  if (!allowed.includes(v)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 只能是 ' + allowed.join(' / '));
  }
  return v;
}

// ---------------------------------------------------------------------------
// 三之二、【Day 18 新增】写接口用到的三个小工具
// ---------------------------------------------------------------------------

// 把请求体（POST 的 body）整个读出来，返回原始字符串。
// 为什么不直接 req.body：这个函数零依赖（连 express 都没装），
// 原生 http 的请求体是一段「流」，得自己一片一片攒起来。
function readBody(req) {
  return new Promise((resolve, reject) => {
    req.setEncoding('utf8'); // 按 utf8 攒 —— 中文（行货/水货）不会被拆成半个字
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // 防呆：体太大直接掐断，别让一个巨型请求把内存吃光
      if (raw.length > MAX_BODY) {
        reject(new HttpError(400, 'INVALID_PARAM', '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', (e) => reject(e));
  });
}

// 这真的是一个存在的日期吗？
// 光看格式（四个数字-两个数字-两个数字）不够：2026-02-30 格式完全正确，
// 但 2 月没有 30 号。办法是交给 Date 解析一次，再把结果转回 YYYY-MM-DD
// 跟原文比一比 —— 对得上才算真日期（2 月 30 号会被自动挪成 3 月 2 号，一比就露馅）。
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// 生成下一个记录 id：沿用库里现有的 pr_0001 风格（契约 2.2 就是这么登记的）。
// 取「所有长得像 pr_数字 的 id 里最大的那个」+1，补足 4 位。
// 库里一条这样的 id 都没有时，从 pr_0001 开始。
function nextPriceId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = /^pr_(\d+)$/.exec(String(r && r.id));
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return 'pr_' + String(max + 1).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// 四、两个接口的数据装配
// ---------------------------------------------------------------------------
// 共同套路：把两张表整表取回来（本期就 5 台机体 + 十几行价格，契约原文
// 「本期数据量极小」），筛选、排序、截断都在服务端内存里做。
// 等哪天数据量上去了，再把过滤下放到网关的查询参数里——接口形状不用变。

// 4.1 GET /api/kits
// 筛选逻辑（与契约 4.2 一致）：
//   keyword  机体名/系列模糊搜（不分大小写）→ 内存过滤
//   series   只认 MG / MGEX → 校验后内存过滤
//   platform 只返回【有该渠道报价】的机体；机体的 channels 仍返回全部渠道
//   limit    作用在「机体条数」上，不传 = 不限
async function fetchKits(sp) {
  const keyword = readText(sp, 'keyword');
  const series = readEnum(sp, 'series', ['MG', 'MGEX']);
  const platform = readEnum(sp, 'platform', PLATFORMS);
  const limit = readInt(sp, 'limit', null, 1, MAX_LIMIT);

  if (keyword !== null && keyword.length > MAX_KEYWORD) {
    throw new HttpError(400, 'INVALID_PARAM', 'keyword 最长 ' + MAX_KEYWORD + ' 个字符');
  }

  // 两张表并行取，谁也不等谁
  const [kitRows, priceRows] = await Promise.all([
    gwGet('/kits'),
    gwGet('/kit_prices'),
  ]);

  // 按 kitId 把价格行分组成 channels
  const channelsByKit = new Map();
  for (const p of priceRows) {
    const kitId = p.kitId;
    if (!channelsByKit.has(kitId)) channelsByKit.set(kitId, []);
    channelsByKit.get(kitId).push({
      platform: p.platform,
      marketType: p.marketType,
      price: p.price,
      updatedDate: p.updatedDate,
      url: p.url,
    });
  }

  // 内存过滤 + 组装（顺序按 id 升序，结果稳定可复现）
  const kw = keyword === null ? null : keyword.toLowerCase();
  const kits = [];
  for (const row of kitRows.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (kw !== null) {
      const hay = ((row.name || '') + ' ' + (row.series || '')).toLowerCase();
      if (!hay.includes(kw)) continue;
    }
    if (series !== null && row.series !== series) continue;
    const channels = (channelsByKit.get(row.id) || [])
      .slice()
      .sort((a, b) =>
        a.updatedDate !== b.updatedDate
          ? a.updatedDate < b.updatedDate ? -1 : 1
          : a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0
      );
    // platform 过滤：这台机体必须【有】该渠道的报价，否则整台跳过
    if (platform !== null && !channels.some((c) => c.platform === platform)) continue;

    // minPrice = 所有「有报价」里的最低值；一条都没有 → null（不是 0）
    const prices = channels.filter((c) => c.price !== null && c.price !== undefined).map((c) => c.price);
    kits.push({
      id: row.id,
      name: row.name,
      series: row.series,
      image: row.image !== undefined ? row.image : null,
      imagePos: row.imagePos !== undefined ? row.imagePos : null,
      officialPriceJPY: row.officialPriceJPY,
      salesVolume: row.salesVolume !== undefined ? row.salesVolume : null,
      minPrice: prices.length ? Math.min.apply(null, prices) : null,
      channels: channels,
    });
    if (limit !== null && kits.length >= limit) break;
  }

  // meta.updatedAt = 库里价格记录的最新录入日期（从真数据里算，不写死）
  let updatedAt = null;
  for (const p of priceRows) {
    if (p.updatedDate && (updatedAt === null || p.updatedDate > updatedAt)) updatedAt = p.updatedDate;
  }

  return {
    meta: { updatedAt: updatedAt, exchangeRate: EXCHANGE_RATE },
    total: kits.length, // = 本次返回的机体条数（limit 生效后是「截断后」的条数）
    kits: kits,
  };
}

// 4.2 GET /api/prices
// 筛选逻辑（与契约 4.4 一致）：
//   kitId / platform / marketType / dateFrom / dateTo → 内存过滤
//   limit（默认 100）/ offset → 内存截断
//   total = 符合条件的总条数（不受 limit 影响）
//   排序 = updatedDate 倒序（新的在前），同日期按 id 升序（结果稳定可复现）
async function fetchPrices(sp) {
  const kitId = readText(sp, 'kitId');
  const platform = readEnum(sp, 'platform', PLATFORMS);
  const marketType = readEnum(sp, 'marketType', MARKET_TYPES);
  const dateFrom = readDate(sp, 'dateFrom');
  const dateTo = readDate(sp, 'dateTo');
  const limit = readInt(sp, 'limit', 100, 1, MAX_LIMIT);
  const offset = readInt(sp, 'offset', 0, 0, 1000000);

  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new HttpError(400, 'INVALID_PARAM', 'dateFrom 不能晚于 dateTo');
  }

  const rows = await gwGet('/kit_prices');

  const items = [];
  for (const row of rows) {
    if (kitId !== null && row.kitId !== kitId) continue;
    if (platform !== null && row.platform !== platform) continue;
    if (marketType !== null && row.marketType !== marketType) continue;
    if (dateFrom !== null && row.updatedDate < dateFrom) continue;
    if (dateTo !== null && row.updatedDate > dateTo) continue;
    items.push({
      id: row.id,
      kitId: row.kitId,
      platform: row.platform,
      marketType: row.marketType,
      price: row.price,
      updatedDate: row.updatedDate,
      url: row.url,
    });
  }

  items.sort((a, b) =>
    a.updatedDate !== b.updatedDate
      ? a.updatedDate < b.updatedDate ? 1 : -1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  return {
    total: items.length, // 符合条件的总条数（不受 limit 影响）
    limit: limit,
    offset: offset,
    items: items.slice(offset, offset + limit),
  };
}

// ---------------------------------------------------------------------------
// 四之二、【Day 18 新增】写接口：POST /api/prices（新增一条价格记录）
// ---------------------------------------------------------------------------
// 八个步骤，任何一步不通过就提前返回，错误信息全中文、说清原因：
//   ① 验密钥 → ② 读 JSON 体 → ③ 校验必填/格式 → ④ 查 kitId 真的存在
//   → ⑤ 查重 → ⑥ 生成 id → ⑦ 写库 → ⑧ 组装好交给外层回 201
async function createPrice(req) {
  // ① 写接口的锁：没钥匙不开门。
  //    密钥错了、没带，都回同一句话 —— 不告诉对方「你少了几个字符」，
  //    不给试探的人任何额外信息。
  const expected = process.env.WRITE_API_KEY;
  if (!expected) throw new ConfigError('WRITE_API_KEY');
  const got = req.headers[WRITE_KEY_HEADER];
  if (!got || got !== expected) {
    console.warn('[api] POST /api/prices 密钥校验未通过');
    throw new HttpError(401, 'UNAUTHORIZED', '写接口需要密钥：请在请求头带上 X-API-KEY');
  }

  // ② 请求体必须是合法的 JSON 对象
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
    throw new HttpError(400, 'INVALID_PARAM', '请求体必须是一个 JSON 对象（本期不做批量写入）');
  }

  // ③-a 必填字段：缺哪个就报哪个，一次把缺的全列出来，
  //     别让人改一个跑一次（这是「提示清楚」的具体含义）
  const filled = (k) =>
    payload[k] !== undefined && payload[k] !== null && String(payload[k]).trim() !== '';
  const missing = [];
  for (const k of ['kitId', 'platform', 'marketType', 'updatedDate']) {
    if (!filled(k)) missing.push(k);
  }
  if (missing.length) {
    throw new HttpError(400, 'INVALID_PARAM', '缺少必填字段：' + missing.join('、'));
  }

  const kitId = String(payload.kitId).trim();
  const platform = String(payload.platform).trim();
  const marketType = String(payload.marketType).trim();
  const updatedDate = String(payload.updatedDate).trim();

  // ③-b 格式与取值范围
  if (!PLATFORMS.includes(platform)) {
    throw new HttpError(400, 'INVALID_PARAM', 'platform 只能是 ' + PLATFORMS.join(' / '));
  }
  if (!MARKET_TYPES.includes(marketType)) {
    throw new HttpError(400, 'INVALID_PARAM', 'marketType 只能是 ' + MARKET_TYPES.join(' / '));
  }
  if (!isRealDate(updatedDate)) {
    throw new HttpError(400, 'INVALID_PARAM', 'updatedDate 必须是 YYYY-MM-DD 的真实日期，例如 2026-10-06');
  }

  // price 可以没有（暂无报价 = null，契约 2.2 的规矩：null 和 0 语义不同），
  // 但给了就必须是不小于 0 的整数。这里挡住三类脏数据：
  // 负数、小数（380.5）、字符串 "380"（宁可让调用方传对数，也不替他猜）。
  let price = null;
  if (payload.price !== undefined && payload.price !== null && payload.price !== '') {
    if (typeof payload.price !== 'number' || !Number.isInteger(payload.price) || payload.price < 0) {
      throw new HttpError(400, 'INVALID_PARAM', 'price 必须是不小于 0 的整数（暂无报价就不传）');
    }
    price = payload.price;
  }

  // url 选填，契约原文：空串 = 暂无链接
  let url = '';
  if (payload.url !== undefined && payload.url !== null) {
    if (typeof payload.url !== 'string') {
      throw new HttpError(400, 'INVALID_PARAM', 'url 必须是字符串');
    }
    url = payload.url.trim();
    if (url.length > 500) throw new HttpError(400, 'INVALID_PARAM', 'url 最长 500 个字符');
  }

  // ④ kitId 必须真的存在（契约 4.5 的 404 KIT_NOT_FOUND）。
  //    数据库的外键其实也会拦，但那会回一个数据库腔的报错；
  //    先查一遍，就能给出「没有找到这台机体：xxx」这种人话。
  const kitRows = await gwGet('/kits');
  if (!kitRows.some((r) => r.id === kitId)) {
    throw new HttpError(404, 'KIT_NOT_FOUND', '没有找到这台机体：' + kitId);
  }

  // ⑤ 查重（今天的第一道题：防重复提交）。
  //    唯一性 = 机体 + 渠道 + 类型 + 日期 四个一起，与数据库的
  //    kit_prices_unique_channel 约束逐字对齐 —— 两边口径必须一致，
  //    不然会出现「接口放过了、数据库拒绝」的尴尬。
  const priceRows = await gwGet('/kit_prices');
  const dup = priceRows.some(
    (r) =>
      r.kitId === kitId &&
      r.platform === platform &&
      r.marketType === marketType &&
      r.updatedDate === updatedDate
  );
  if (dup) {
    throw new HttpError(409, 'DUPLICATE_RECORD', '该渠道今日已有记录，请使用 PUT 修改');
  }

  // ⑥⑦ 生成 id 并写库。
  //    撞号（极小概率：正好有人同时写入）就换一个号重试，最多 3 次。
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = nextPriceId(priceRows);
    try {
      const inserted = await gwPost('/kit_prices', {
        id: id,
        kitId: kitId,
        platform: platform,
        marketType: marketType,
        price: price,
        updatedDate: updatedDate,
        url: url,
      });
      // 网关回的是插入后的完整记录（含云端生成的 createdAt），原样取用；
      // 万一它没回体，就用我们自己知道的字段拼一个，不让响应缺胳膊少腿。
      const row = (Array.isArray(inserted) ? inserted[0] : inserted) || {};
      const item = {
        id: row.id !== undefined && row.id !== null ? row.id : id,
        kitId: row.kitId !== undefined && row.kitId !== null ? row.kitId : kitId,
        platform: row.platform !== undefined && row.platform !== null ? row.platform : platform,
        marketType: row.marketType !== undefined && row.marketType !== null ? row.marketType : marketType,
        price: row.price !== undefined ? row.price : price,
        updatedDate: row.updatedDate !== undefined && row.updatedDate !== null ? row.updatedDate : updatedDate,
        url: row.url !== undefined && row.url !== null ? row.url : url,
        createdAt: row.createdAt !== undefined ? row.createdAt : null,
      };
      // 【余力加练】一条服务端日志：
      // 以后怀疑「那次到底写没写进去」，在云函数日志里搜 id 或 kitId 就有答案。
      console.log(
        '[api] POST /api/prices 写入成功 id=' + item.id +
        ' kitId=' + item.kitId +
        ' platform=' + item.platform +
        ' marketType=' + item.marketType +
        ' price=' + item.price +
        ' updatedDate=' + item.updatedDate
      );
      return { item: item };
    } catch (err) {
      // 数据库拒绝的原因藏在网关响应体里，按约束名 / SQLSTATE 翻译成人话。
      // 这几个分支是「第二道防线」，正常路径根本走不到 —— 走的到就说明
      // 前置校验漏了东西，或者真的发生了并发。
      const detail = err && err.body ? String(err.body) : '';
      if (detail.indexOf('kit_prices_unique_channel') >= 0) {
        throw new HttpError(409, 'DUPLICATE_RECORD', '该渠道今日已有记录，请使用 PUT 修改');
      }
      if (detail.indexOf('23503') >= 0 || detail.indexOf('foreign key') >= 0) {
        throw new HttpError(404, 'KIT_NOT_FOUND', '没有找到这台机体：' + kitId);
      }
      if (detail.indexOf('23514') >= 0 || detail.indexOf('violates check constraint') >= 0) {
        throw new HttpError(400, 'INVALID_PARAM', '数据不符合字段规则，请检查渠道名与价格');
      }
      if (detail.indexOf('kit_prices_pkey') >= 0 || detail.indexOf('duplicate key') >= 0) {
        console.warn('[api] POST /api/prices 撞号，换个 id 重试：', id);
        priceRows.push({ id: id }); // 把这个号也计入「已用」，下一个就跳过它
        continue;
      }
      throw err; // 其他情况：交给外层按 500 处理，细节只进日志
    }
  }
  throw new HttpError(500, 'INTERNAL_ERROR', '服务异常，请稍后重试');
}

// ---------------------------------------------------------------------------
// 五、路由：一个函数管多条接口（Day 18 起：GET /api/kits、GET /api/prices、
//     POST /api/prices；以后加 PUT / DELETE、收藏接口继续往这里加）
// ---------------------------------------------------------------------------
// 【为什么写成「以 /kits 结尾」而不是写死 "/api/kits"】
//   云接入（HTTP 访问服务）配路由时，函数收到的路径可能是 /api/kits，
//   也可能是被剥掉前缀后的 /kits，取决于控制台怎么配。
//   两种都认，就少一个「明明部署好了却 404」的坑。
function routeOf(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/'; // 去掉末尾斜杠
  if (p === '/' || p.endsWith('/health')) return 'health';
  if (p.endsWith('/kits')) return 'kits';
  if (p.endsWith('/prices')) return 'prices';
  return null;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return sendFail(res, 400, 'INVALID_PARAM', '请求地址不合法');
  }

  const route = routeOf(url.pathname);

  // 未登记的路径：404（契约里所有已登记接口都不是它）
  if (route === null) {
    return sendFail(res, 404, 'NOT_FOUND', '接口不存在：' + url.pathname);
  }

  // 只读接口只收 GET（和 HEAD，浏览器预览有时会发 HEAD）；
  // Day 18 起：只有 /api/prices 的 POST 是写接口，其余照旧只读。
  // 一函数多路由，方法要按路由分别判断，不能一刀切。
  const isWrite = route === 'prices' && req.method === 'POST';
  if (!isWrite && req.method !== 'GET' && req.method !== 'HEAD') {
    const allow = route === 'prices' ? 'GET, POST' : 'GET';
    res.setHeader('Allow', allow);
    return sendFail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只支持 ' + allow);
  }

  try {
    if (route === 'health') {
      // 与 Day 15 的 health 保持兼容（不依赖数据库，永远成功）
      return sendJson(res, 200, { ok: true, service: 'Gundam market situation' });
    }

    if (isWrite) {
      const data = await createPrice(req);
      return sendCreated(res, data); // 201
    }

    const data = route === 'kits' ? await fetchKits(url.searchParams) : await fetchPrices(url.searchParams);
    return sendOk(res, data);
  } catch (err) {
    // 参数类错误：400/401/404/409，把原因原样告诉调用方（这类消息是给开发者看的，不含敏感信息）
    if (err instanceof HttpError) {
      // 写接口的每一次被拒都记一条日志：以后排查「为什么这次没写进去」有迹可循
      if (isWrite) {
        console.warn('[api] POST /api/prices 被拒：' + err.status + ' ' + err.code + ' - ' + err.message);
      }
      return sendFail(res, err.status, err.code, err.message);
    }
    // 凭证没配：明确写进日志，方便部署时自查（说出缺的是哪一条）
    if (err instanceof ConfigError) {
      console.error('[api] 环境变量没配齐：' + err.message);
      return sendFail(res, 500, 'INTERNAL_ERROR', '服务端配置缺失，请联系维护者检查环境变量');
    }
    // 其他一律 500：详细错误只写进后台日志，不回给公网
    console.error('[api] 处理 ' + url.pathname + ' 出错：', err && err.stack ? err.stack : err);
    return sendFail(res, 500, 'INTERNAL_ERROR', '服务异常，请稍后重试');
  }
});

server.listen(PORT, () => {
  console.log(
    '[api] 已启动，监听端口 ' + PORT +
    '｜读：GET /api/kits、GET /api/prices；写：POST /api/prices（需 X-API-KEY）'
  );
  // 只报「配没配」，绝不打印密钥本身 —— 日志也是会被人看到的地方
  console.log('[api] WRITE_API_KEY 已配置：' + (process.env.WRITE_API_KEY ? '是' : '否'));
});
