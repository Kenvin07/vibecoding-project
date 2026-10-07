// services/pricesService.js ｜ 业务层：GET /api/prices（列表） + POST /api/prices（新增）
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构
//   【这段代码从哪搬来的】原来就是 index.js 里的 fetchPrices() 和 createPrice()，
//                          整体搬来，逻辑一字未改。
//   【唯一的变化】三处数据库调用换成了数据访问层的方法：
//     原来 gwGet('/kits')            → kitsRepository.findKitById(kitId)
//     原来 gwGet('/kit_prices')（两处）→ kitPricesRepository.listPrices()
//     原来 gwPost('/kit_prices', ...) → kitPricesRepository.insertPrice(...)
//     网关调用次数、先后顺序完全不变。
//
// 【写接口 POST /api/prices 的八个步骤】（与 Day 18 一模一样）
//   ① 验密钥 → ② 读 JSON 体 → ③ 校验必填/格式 → ④ 查 kitId 真的存在
//   → ⑤ 查重 → ⑥ 生成 id → ⑦ 写库 → ⑧ 组装好交给外层回 201
//   任何一步不通过就提前返回，错误信息全中文、说清原因。
//
// 【今天防的两件事（Day 18 的主题，原样保留）】
//   ① 重复提交：同 机体+渠道+类型+日期 已存在 → 409。
//      两道防线：先查一遍给「人话」提示；数据库唯一约束 kit_prices_unique_channel 兜底。
//   ② 错误输入：缺字段 / 渠道名拼错 / price 是负数或小数 / 日期是 2026-02-30 → 400，
//      并且指明【缺的是哪个字段】。
//
// 【写接口的钥匙】请求头 X-API-KEY，值放云函数环境变量 WRITE_API_KEY ——
//   不进代码、不进 Git、不出现在任何响应里。读接口保持匿名可访问。
// ---------------------------------------------------------------------------

const { HttpError, ConfigError } = require('../lib/errors');
const { readBody } = require('../lib/http');
const { readText, readEnum, readInt, readDate, isRealDate, nextPriceId } = require('../lib/validators');
const { PLATFORMS, MARKET_TYPES, MAX_LIMIT, WRITE_KEY_HEADER } = require('../lib/constants');
const kitsRepository = require('../repositories/kitsRepository');
const kitPricesRepository = require('../repositories/kitPricesRepository');

// ---------------------------------------------------------------------------
// 一、GET /api/prices（列表）
// ---------------------------------------------------------------------------
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

  const rows = await kitPricesRepository.listPrices();

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
// 二、POST /api/prices（新增一条价格记录）
// ---------------------------------------------------------------------------
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
  const kit = await kitsRepository.findKitById(kitId);
  if (kit === null) {
    throw new HttpError(404, 'KIT_NOT_FOUND', '没有找到这台机体：' + kitId);
  }

  // ⑤ 查重（防重复提交的第一道防线）。
  //    唯一性 = 机体 + 渠道 + 类型 + 日期 四个一起，与数据库的
  //    kit_prices_unique_channel 约束逐字对齐 —— 两边口径必须一致，
  //    不然会出现「接口放过了、数据库拒绝」的尴尬。
  const priceRows = await kitPricesRepository.listPrices();
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
      const inserted = await kitPricesRepository.insertPrice({
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

module.exports = { fetchPrices, createPrice };
