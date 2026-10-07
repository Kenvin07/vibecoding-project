// services/kitsService.js ｜ 业务层：GET /api/kits（机体列表）
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构
//   【这段代码从哪搬来的】原来就是 index.js 里的 fetchKits()，整体搬来，逻辑一字未改。
//   【唯一的变化】原来直接调 gwGet('/kits')、gwGet('/kit_prices')，
//                现在改成调数据访问层的 listKits()、listPrices() ——
//                业务代码里从此看不到表名、网址和钥匙。
//
// 【这一层管什么】参数怎么读、筛选规则、排序规则、结果结构；
// 【不管什么】怎么连数据库（那是 repositories + db/gateway 的事）。
// 【也不管 HTTP】这里收 searchParams、返回普通对象，
//   套 {ok,data,error} 外壳、定状态码是接入层（index.js）的活。
//
// 【为什么两张表整表取回来】本期就 5 台机体 + 十几行价格，
//   契约原文：「本期数据量极小（5 台机体）」—— 筛选、排序、截断都在服务端内存里做。
//   等哪天数据量上去了，再把过滤下放到网关的查询参数里 —— 接口形状不用变。
// ---------------------------------------------------------------------------

const { HttpError } = require('../lib/errors');
const { readText, readEnum, readInt } = require('../lib/validators');
const { EXCHANGE_RATE, PLATFORMS, SERIES_ALLOWED, MAX_LIMIT, MAX_KEYWORD } = require('../lib/constants');
const kitsRepository = require('../repositories/kitsRepository');
const kitPricesRepository = require('../repositories/kitPricesRepository');

// 筛选逻辑（与契约 4.2 一致）：
//   keyword  机体名/系列模糊搜（不分大小写）→ 内存过滤
//   series   只认 MG / MGEX → 校验后内存过滤
//   platform 只返回【有该渠道报价】的机体；机体的 channels 仍返回全部渠道
//   limit    作用在「机体条数」上，不传 = 不限
async function fetchKits(sp) {
  const keyword = readText(sp, 'keyword');
  const series = readEnum(sp, 'series', SERIES_ALLOWED);
  const platform = readEnum(sp, 'platform', PLATFORMS);
  const limit = readInt(sp, 'limit', null, 1, MAX_LIMIT);

  if (keyword !== null && keyword.length > MAX_KEYWORD) {
    throw new HttpError(400, 'INVALID_PARAM', 'keyword 最长 ' + MAX_KEYWORD + ' 个字符');
  }

  // 两张表并行取，谁也不等谁
  //（原来这里是 gwGet('/kits') / gwGet('/kit_prices')，现在换成业务语言的两个方法）
  const [kitRows, priceRows] = await Promise.all([
    kitsRepository.listKits(),
    kitPricesRepository.listPrices(),
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

module.exports = { fetchKits };
