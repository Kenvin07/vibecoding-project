// index.js ｜ Day 17 读接口云函数（第 3 周第二个云函数）
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
// 【今天不做】写接口（POST/PUT/DELETE）、收藏表、跨域配置。
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
class ConfigError extends Error {
  constructor() {
    super('缺少环境变量 CLOUDBASE_ENV_ID / CLOUBASE_API_KEY');
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
// 五、路由：一个函数管两条接口（Day 18 加收藏接口继续往这里加）
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

  // 只读接口只收 GET（和 HEAD，浏览器预览有时会发 HEAD）
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return sendFail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只支持 GET，写接口还没开放（Day 18 起）');
  }

  try {
    if (route === 'health') {
      // 与 Day 15 的 health 保持兼容（不依赖数据库，永远成功）
      return sendJson(res, 200, { ok: true, service: 'Gundam market situation' });
    }

    const data = route === 'kits' ? await fetchKits(url.searchParams) : await fetchPrices(url.searchParams);
    return sendOk(res, data);
  } catch (err) {
    // 参数类错误：400，把原因原样告诉调用方（这类消息是给开发者看的，不含敏感信息）
    if (err instanceof HttpError) {
      return sendFail(res, err.status, err.code, err.message);
    }
    // 凭证没配：明确写进日志，方便部署时自查
    if (err instanceof ConfigError) {
      console.error('[api] 环境变量没配齐：CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY');
      return sendFail(res, 500, 'INTERNAL_ERROR', '服务端配置缺失，请联系维护者检查环境变量');
    }
    // 其他一律 500：详细错误只写进后台日志，不回给公网
    console.error('[api] 处理 ' + url.pathname + ' 出错：', err && err.stack ? err.stack : err);
    return sendFail(res, 500, 'INTERNAL_ERROR', '服务异常，请稍后重试');
  }
});

server.listen(PORT, () => {
  console.log('[api] 已启动，监听端口 ' + PORT);
});
