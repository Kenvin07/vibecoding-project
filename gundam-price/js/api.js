// api.js ｜ 前端与后端之间的「唯一一道门」（Day 20 新增）
// ---------------------------------------------------------------------------
// 【今天为什么要新开这个文件】
//   Day 20 之前，首页 / 详情页 / 计算器各自去读本地文件 data/data.json，
//   也就是说 "data/data.json" 这个地址在三个文件里各写了一遍。
//   今天数据源换成公网接口，如果还是各写一遍，将来换域名要改三处，漏一处就出错。
//   所以把「接口地址」和「怎么跟接口说话」收进这一个文件：
//   别的文件只喊 API.getKits()，根本不知道网址长什么样。
//
// 【这个文件管两件事】
//   ① 基址 API.BASE —— 全站唯一的接口域名，换域名只改这一行
//   ② 拆外壳 —— 后端所有接口都回同一个形状（api-contract.md 第 1 节）：
//        成功 { "ok": true,  "data": { ... }, "error": null }
//        失败 { "ok": false, "data": null,    "error": { code, message } }
//      调用方只想要里面的 data，不想到处写 body.data —— 这个差事归这里。
//      失败时统一抛一个 Error（消息用后端给的中文文案），
//      调用方原来的 try/catch 写法一行都不用改。
//
// 【安全底线】这里**不放任何密钥**。
//   读接口是匿名可访问的；写接口要的 X-API-KEY 属于服务端机密（只存在云函数环境变量里），
//   一旦写进前端就等于把钥匙贴在大门上 —— 所以公网页面里不做写入测试入口。
//   检查台（check.html）的写入测试是**本机专用**：密钥由使用者当场粘贴，
//   这个文件里从头到尾没有出现过密钥的任何真值。
// ---------------------------------------------------------------------------

// 统一把「HTTP 失败」做成一个带状态码和错误码的 Error。
// 为什么要带 status / code：检查台要靠它们区分
//   401（密钥不对）还是 400（密钥对、参数被拦下）—— 光有中文消息分不出来。
function apiError(message, status, code) {
  const e = new Error(message);
  e.status = status;  // HTTP 状态码，如 401 / 400 / 409
  e.code = code;      // 后端的 error.code，如 UNAUTHORIZED
  return e;
}

const API = {

  // 后端基址（api-contract.md 第 0 节）：CloudBase 环境 gundam-market 的默认域名。
  // 前端域名（静态托管）和它是两个不同的域名，所以浏览器会做跨域校验 ——
  // 能通，是因为这个前端域名已在控制台「安全来源」白名单里。
  BASE: "https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com",

  // 唯一真正发请求的地方（GET / POST 都走这里）。
  // 成功 → 返回外壳里的 data；失败 → 抛 apiError（消息取后端的中文说明）
  async request(path, init) {
    let res;
    try {
      res = await fetch(this.BASE + path, init);
    } catch (e) {
      // 走到这里通常是断网、域名解析失败，或跨域被浏览器直接拦下
      throw apiError("连不上服务器（" + e.message + "）", 0, "NETWORK_ERROR");
    }

    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      // 状态码 200 也可能拿到坏 JSON（例如被网关换成了错误页）
      throw apiError("服务器返回的不是合法 JSON（HTTP " + res.status + "）", res.status, "BAD_JSON");
    }

    // 双保险：状态码不对，或 ok 不是 true，都算失败
    if (!res.ok || !body || body.ok !== true) {
      const err = (body && body.error) || {};
      throw apiError(err.message || ("HTTP " + res.status), res.status, err.code || null);
    }
    return body.data;
  },

  // 只读接口的快捷写法
  get(path) {
    return this.request(path);
  },

  // GET /api/kits —— 机体列表（首页、详情页、计算器都用这一条）
  // 返回 { meta: { updatedAt, exchangeRate }, total, kits: [...] }
  // 这个形状与原来的 data/data.json 完全一致，所以调用方不用改别的。
  getKits() {
    return this.get("/api/kits");
  },

  // GET /api/prices —— 渠道价格记录（检查台用）
  // 返回 { total, limit, offset, items: [...] }
  getPrices() {
    return this.get("/api/prices");
  },

  // GET /api/health —— 健康检查。
  // ⚠️ 这条接口的外壳跟别的不一样：它是 Day 15 的旧函数，直接回
  //    { "ok": true, "service": "Gundam market situation" }，没有 data 字段，
  //    所以不能走上面的 this.get()，单独发一趟。
  async health() {
    const res = await fetch(this.BASE + "/api/health");
    if (!res.ok) throw apiError("健康检查失败：HTTP " + res.status, res.status, null);
    const body = await res.json();
    if (!body || body.ok !== true) throw apiError("健康检查未通过", res.status, null);
    return body;
  },

  // -------------------------------------------------------------------------
  // POST /api/prices —— 写接口（契约 4.5，需请求头 X-API-KEY）
  // 【只在检查台的本机模式下被调用】密钥由使用者当场输入，作为参数传进来，
  //   不写在代码里、不存文件里。成功返回新增记录（{ id, kitId, ... }）。
  // -------------------------------------------------------------------------
  createPrice(payload, key) {
    return this.request("/api/prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key
      },
      body: JSON.stringify(payload)
    }).then((data) => data.item);
  },

  // 「只验密钥」——**不写任何数据**的安全试探。
  //   原理：后端校验顺序是 ① 验密钥 → ② 读体 → ③ 校字段（platform 合法吗）→ ④ 查机体是否存在。
  //   这里故意送一个非法的 platform，如果密钥是对的，请求会在第 ③ 步被拦下回 400，
  //   永远走不到第 ⑦ 步写库 —— 于是「400 = 钥匙对、校验也生效」，
  //   「401 = 钥匙不对」，而数据库一个字节都没变。
  async probeKey(key) {
    try {
      await this.createPrice({
        kitId: "probe-not-a-kit",
        platform: "probe-not-a-platform",
        marketType: "水货",
        price: 0,
        updatedDate: "1970-01-01"
      }, key);
      // 能走到这里说明参数校验没拦住 —— 这本身就是要报出来的异常情况
      return { verdict: "unexpected-ok" };
    } catch (e) {
      if (e.status === 401) return { verdict: "bad-key", message: e.message };
      if (e.status === 400) return { verdict: "ok", message: e.message };
      return { verdict: "other", status: e.status, message: e.message };
    }
  }
};
