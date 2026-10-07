// index.js ｜ 接入层（第 3 周 · Day 17 读接口 + Day 18 写接口 + Day 19 分层重构）
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
//   GET  /api/health   健康检查（不依赖数据库，永远成功）
//   GET  /api/kits     机体列表（首页用）
//   GET  /api/prices   渠道价格记录列表
//   POST /api/prices   新增一条价格记录（写接口，需请求头 X-API-KEY）
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
  // 只有 /api/prices 的 POST 是写接口，其余照旧只读。
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
      // 写接口：业务层自己验密钥、读体、校验、写库
      const data = await pricesService.createPrice(req);
      return sendCreated(res, data); // 201
    }

    const data = route === 'kits'
      ? await kitsService.fetchKits(url.searchParams)
      : await pricesService.fetchPrices(url.searchParams);
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
