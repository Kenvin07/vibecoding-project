// index.js ｜ 接入层（第 3 周 · Day 17 读接口 + Day 18 写接口 + Day 19 分层重构
//            + Day 22：checkins 四接口落地，带 id 的路径开始分流）
// ===========================================================================
// 【Day 19 做了什么】分层重构 —— 代码行为一个字没变，只把代码搬了家。
//   以前这个文件 731 行，一个人干了 6 件事；现在它只剩一件事：
//   「接请求 → 调函数 → 返响应」。
//
//   「查数据库」那段代码搬到哪去了（今天的核心问题）：
//     ① 原来第 74–175 行的 gwGet / gwPost（真正发请求去 CloudBase 的代码）
//        → 搬到 db/gateway.js（现在叫 get / post）
//     ② 原来散在 fetchKits / fetchPrices / createPrice 里的 5 处查询调用
//        → 搬到 repositories/kitsRepository.js 和 repositories/kitPricesRepository.js
//
//   现在这个文件里，再也看不到网址、表名、API Key、SQL 相关的东西。
//
//   四层结构（自上而下）：
//     index.js          接入层     收请求、认路由、套响应外壳、兜错误
//     services/         业务层     读参数、校验、筛选排序、组装数据
//     repositories/     数据访问层 只认表：kits / kit_prices
//     db/gateway.js     网关层     带钥匙发 HTTPS，跟 CloudBase 讲话
//     lib/              通用层     常量、错误类型、响应工具、校验工具
// ===========================================================================
// 类型：HTTP 云函数 —— 和 Day 15 的 health 同款：scf_bootstrap 启动 node，
//       常驻监听 9000 端口，一个「真的小网站服务器」。
//
// 路由表（一函数多接口）：
//   GET    /api/health          健康检查（不依赖数据库，永远成功）
//   GET    /api/kits            机体列表（首页用）
//   GET    /api/prices          渠道价格记录列表
//   POST   /api/prices          新增一条价格记录（写接口，需请求头 X-API-KEY）
//   GET    /api/checkins        巡查打卡列表（Day 22 新增，默认跳过已软删除的行）
//   POST   /api/checkins        新增一条打卡（Day 22 新增，写接口）
//   PATCH  /api/checkins/{id}   修改一条打卡（Day 22 新增，写接口，兼容 PUT）
//   DELETE /api/checkins/{id}   删除一条打卡（Day 22 新增，写接口，软删除）
//
// 统一响应形状（api-contract.md 第 1 节）由 lib/http.js 的四个 send* 提供：
//   成功 { "ok": true,  "data": { ... }, "error": null }
//   失败 { "ok": false, "data": null,    "error": { "code": "...", "message": "..." } }
//
// 环境变量（只放云函数配置里，不进代码不进 Git）：
//   CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY   数据网关的身份
//   WRITE_API_KEY                          写接口的钥匙
// ===========================================================================

const http = require('http');

const { ConfigError, HttpError } = require('./lib/errors');
const { sendJson, sendOk, sendCreated, sendFail } = require('./lib/http');
const kitsService = require('./services/kitsService');
const pricesService = require('./services/pricesService');
const checkinsService = require('./services/checkinsService');

// 监听端口：云函数固定 9000（控制台「监听端口」配置项要跟它一致）；
// 本机自测时可以用 PORT=9100 换个口，避免和别的东西打架。
const PORT = Number(process.env.PORT || 9000);

// ---------------------------------------------------------------------------
// 路由：一个函数管多条接口
// ---------------------------------------------------------------------------
// 【为什么写成「以 /kits 结尾」而不是写死 "/api/kits"】
//   云接入（HTTP 访问服务）配路由时，函数收到的路径可能是 /api/kits，
//   也可能是被剥掉前缀后的 /kits，取决于控制台怎么配。
//   两种都认，就少一个「明明部署好了却 404」的坑。
//
// 【Day 22 新增：带 id 的路径要分流】
//   以前只认「以 /kits 或 /prices 结尾」，所以 /api/checkins/ck_0001 会被当成
//   没登记的路径直接 404 —— 契约第 6 节待定项 11 登记的就是这件事，今天关掉它。
//   现在多认一种形状：/checkins/{id}，把 id 从路径里抠出来一起返回，
//   交给上层决定这一趟是 PATCH 还是 DELETE。
//  【顺序有讲究】必须先判「以 /checkins 结尾」（列表），再判「/checkins/xxx」（单条）：
//   反过来的话 /api/checkins 会先被单条那条规则吞掉。
function routeOf(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/'; // 去掉末尾斜杠
  if (p === '/' || p.endsWith('/health')) return { name: 'health' };
  if (p.endsWith('/kits')) return { name: 'kits' };
  if (p.endsWith('/prices')) return { name: 'prices' };
  if (p.endsWith('/checkins')) return { name: 'checkins' };

  // 单条打卡：/api/checkins/{id}
  //   id 可能被浏览器编码过（%E2%80%A6 之类），decodeURIComponent 还原成原文；
  //   它随后只作为「列 = 值」的等值条件传给网关，并且会被再编码一次，不构成注入。
  const m = /\/checkins\/([^/]+)$/.exec(p);
  if (m) return { name: 'checkinItem', id: decodeURIComponent(m[1]) };

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

  // 每个路由各自允许哪些方法。
  // 【为什么不能一刀切】这是一个「一函数多接口」的函数：
  //   /api/prices 收 GET + POST，/api/checkins 收 GET + POST，
  //   而 /api/checkins/{id} 只收 PATCH / PUT / DELETE。
  //   方法该不该放行，必须按路由分别判断。
  const METHOD_BY_ROUTE = {
    health: ['GET'],
    kits: ['GET'],
    prices: ['GET', 'POST'],
    checkins: ['GET', 'POST'],
    checkinItem: ['PATCH', 'PUT', 'DELETE'],
  };

  const allowed = METHOD_BY_ROUTE[route.name] || ['GET'];
  // HEAD 是浏览器/预览偶尔会发的「只要响应头」的请求，按 GET 放行
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (!allowed.includes(method)) {
    res.setHeader('Allow', allowed.join(', '));
    return sendFail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只支持 ' + allowed.join(' / '));
  }

  // 这个路由上「非 GET」的都算写接口 —— 写接口一律要在业务层过密钥这一关
  const isWrite = method !== 'GET';

  try {
    if (route.name === 'health') {
      // 与 Day 15 的 health 保持兼容（不依赖数据库，永远成功）
      return sendJson(res, 200, { ok: true, service: 'Gundam market situation' });
    }

    // ---- 写接口：业务层自己验密钥、读体、校验、写库 ----
    if (route.name === 'prices' && method === 'POST') {
      return sendCreated(res, await pricesService.createPrice(req)); // 201
    }
    if (route.name === 'checkins' && method === 'POST') {
      return sendCreated(res, await checkinsService.createCheckin(req)); // 201
    }
    if (route.name === 'checkinItem' && (method === 'PATCH' || method === 'PUT')) {
      // PATCH 与 PUT 走同一个处理函数（契约 4.13 注明「兼容 PUT」）：
      // 本期两者行为完全一致 —— 都只改请求体里带上来的字段。
      return sendOk(res, await checkinsService.updateCheckin(req, route.id)); // 200
    }
    if (route.name === 'checkinItem' && method === 'DELETE') {
      // 软删除，成功用 200 + 统一外壳（不是 204）：全站响应形状只有一套
      return sendOk(res, await checkinsService.deleteCheckin(req, route.id)); // 200
    }

    // ---- 读接口 ----
    const data = route.name === 'kits'
      ? await kitsService.fetchKits(url.searchParams)
      : route.name === 'prices'
        ? await pricesService.fetchPrices(url.searchParams)
        : await checkinsService.fetchCheckins(url.searchParams);
    return sendOk(res, data);
  } catch (err) {
    // 参数类错误：400/401/404/409，把原因原样告诉调用方（这类消息是给开发者看的，不含敏感信息）
    if (err instanceof HttpError) {
      // 写接口的每一次被拒都记一条日志：以后排查「为什么这次没写进去」有迹可循
      if (isWrite) {
        if (route.name === 'prices' && method === 'POST') {
          console.warn('[api] POST /api/prices 被拒：' + err.status + ' ' + err.code + ' - ' + err.message);
        } else {
          console.warn('[api] ' + method + ' ' + url.pathname + ' 被拒：' + err.status + ' ' + err.code + ' - ' + err.message);
        }
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
    '｜读：GET /api/kits、GET /api/prices、GET /api/checkins' +
    '；写：POST /api/prices、POST /api/checkins、PATCH|PUT|DELETE /api/checkins/{id}（需 X-API-KEY）'
  );
  // 只报「配没配」，绝不打印密钥本身 —— 日志也是会被人看到的地方
  console.log('[api] WRITE_API_KEY 已配置：' + (process.env.WRITE_API_KEY ? '是' : '否'));
});
