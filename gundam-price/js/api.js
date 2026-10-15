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
//
// 【Day 23 改动：错误文案交给 js/error-message.js 统一翻译】
//   改成之前：这里自己拼文案，会把浏览器原话漏给用户 ——
//              "连不上服务器（Failed to fetch）"、"服务器返回的不是合法 JSON（HTTP 502）"
//   改成之后：这里只负责「判定失败原因 + 挂上 status/code」，
//             至于「该对用户说什么」，一律问 Errs（三类错误的唯一裁判）。
//   依赖顺序：html 里 error-message.js 必须排在 api.js 前面，否则 Errs 还是 undefined。
// ---------------------------------------------------------------------------

// 统一把「HTTP 失败」做成一个带状态码和错误码的 Error。
// 为什么要带 status / code：
//   ① 检查台要靠它们区分 401（密钥不对）还是 400（密钥对、参数被拦下）；
//   ② Day 23 起，Errs 也靠这两个字段判定这属于「输入错 / 网络错 / 服务端错」。
// 【注意】message 存的是**技术原文**（可能含英文），不是给用户看的话 ——
//   给用户看的那句由 Errs.toUserMessage() 现算，技术原文则作为排查线索留在 Error 上。
//
// 【踩坑记录】没消息时必须传 undefined，不能传 null。
//   new Error(null) 会把 null 转成**字符串 "null"**，于是 e.message === "null"，
//   翻译层一看「有 message」就把它当人话显示出来，用户就会看到 "null"（实测踩到）。
//   传 undefined 才会让 message 保持空 —— 这里用三目把它显式转成 undefined。
function apiError(message, status, code) {
  const e = new Error(message === null || message === undefined ? undefined : String(message));
  e.status = status;  // HTTP 状态码，如 401 / 400 / 409；网络失败时是 0
  e.code = code;      // 后端的 error.code，如 UNAUTHORIZED
  return e;
}

// 拿错误翻译器。写成函数而不是顶部直接取，是为了防「引入顺序被写错」时整页报错：
//   万一 error-message.js 没加载，这里返回 null，下面的兜底逻辑仍能让页面正常报错。
function errs() {
  return (typeof Errs !== 'undefined') ? Errs : null;
}

// 把「可能待翻译的错误」变成一句能给用户看的中文。
// 三层兜底，任何一层都不依赖下一层：
//   ① Errs 在 → 交给它按三类规则翻译（正常路径）
//   ② Errs 不在 → 退回 err.message 原文（至少不是空白）
//   ③ 连 message 都没有 → 给一句通用的话
function toHuman(err) {
  const E = errs();
  if (E) return E.toUserMessage(err);
  if (err && err.message) return String(err.message);
  return '操作失败，请稍后重试';
}

const API = {

  // 后端基址（api-contract.md 第 0 节）：CloudBase 环境 gundam-market 的默认域名。
  // 前端域名（静态托管）和它是两个不同的域名，所以浏览器会做跨域校验 ——
  // 能通，是因为这个前端域名已在控制台「安全来源」白名单里。
  BASE: "https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com",

  // 唯一真正发请求的地方（GET / POST 都走这里）。
  // 成功 → 返回外壳里的 data；失败 → 抛一个错误（含 status/code 用于判定类别）
  //
  // 【Day 23 改造要点】这里**不再拼给用户看的文案**。
  //   三个失败点都只做一件事：造出带 status/code 的错误，原始技术信息挂在 message 上。
  //   至于「用户该看到哪句话」，由 toHuman() 按三类规则算 —— 好处是
  //   同一个错误在首页、详情页、计算器里显示的措辞**必然一致**，
  //   以前是三处各写各的，还可能只改了一处。
  //
  // 【Day 23 调试开关】地址栏加 ?err=network / server / input 时，
  //   直接在这里抛一个伪造错误，用来给「网络错」「服务端错」这类
  //   平时难以自然复现的情况做演示和截图验收。不带参数时完全不生效。
  async request(path, init) {
    const E = errs();
    if (E) {
      const forced = E.forcedErrorKind();
      if (forced) throw E.makeForcedError(forced);
    }

    let res;
    try {
      res = await fetch(this.BASE + path, init);
    } catch (e) {
      // 走到这里通常是断网、域名解析失败，或跨域被浏览器直接拦下。
      // message 保留浏览器的英文原话（如 Failed to fetch）作为排查线索，
      // 用户看到的是「连不上服务器，请检查网络后重试」——由 toHuman 翻译。
      throw apiError(e && e.message ? e.message : 'network request failed', 0, 'NETWORK_ERROR');
    }

    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      // 状态码 200 也可能拿到坏 JSON（例如被网关换成了错误页）→ 归为服务端错
      throw apiError('response is not valid JSON', res.status, 'BAD_JSON');
    }

    // 双保险：状态码不对，或 ok 不是 true，都算失败
    if (!res.ok || !body || body.ok !== true) {
      const err = (body && body.error) || {};
      // 后端给的 message 是中文人话（4xx 时直接可用）；没给时留 null，
      // 交给 toHuman 按状态码决定说什么，而不是把裸状态码（HTTP 500）甩给用户。
      throw apiError(err.message || null, res.status, err.code || null);
    }
    return body.data;
  },

  // 【Day 23 新增】把错误翻成人话 —— 供各页面 catch 后调用。
  // 页面只需要：catch (err) { showError(err) }，不用各自记「哪类错误该说什么」。
  humanMessage(err) {
    return toHuman(err);
  },

  // 【Day 23 新增】翻译 + 记录原始细节（细节进 F12 控制台，人话返回给页面）。
  // 各页面的 catch 里调这一个即可，省掉自己写 console.error。
  describe(err) {
    const E = errs();
    if (E) return E.report(err);
    console.error('[错误]', err);
    return toHuman(err);
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
  // Day 23：失败原因也交给 toHuman 翻译（检查台里显示的是中文人话，细节进控制台）。
  async health() {
    const res = await fetch(this.BASE + "/api/health");
    if (!res.ok) throw apiError('health check HTTP ' + res.status, res.status, null);
    const body = await res.json();
    if (!body || body.ok !== true) throw apiError('health check not ok', res.status, null);
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
  },

  // -------------------------------------------------------------------------
  // checkins 巡查打卡表（Day 22 新增）
  //   GET    /api/checkins         读列表（匿名可访问）
  //   PATCH  /api/checkins/{id}    改 status / note（需 X-API-KEY）
  //   DELETE /api/checkins/{id}    删（★软删除，需 X-API-KEY）
  //
  // 【为什么 id 要 encodeURIComponent】
  //   id 会被拼进网址路径里。现在的 id 都是 ck_0001 这种安全写法，
  //   但把「用户可控的东西」直接拼进 URL 是坏习惯 —— 万一以后 id 里出现
  //   斜杠或中文，不转义就会把路径拼坏（/api/checkins/a/b）。
  //   这里多一道，以后不用回头补。
  // -------------------------------------------------------------------------

  // GET /api/checkins —— 返回 { total, limit, offset, items: [...] }
  // includeDeleted=true 时把已软删除的也列出来（用来证实「删了但数据还在」）。
  getCheckins(includeDeleted) {
    return this.get("/api/checkins" + (includeDeleted ? "?includeDeleted=true" : ""));
  },

  // PATCH /api/checkins/{id} —— payload 只认 { status } / { note } / 两者都有。
  // 传白名单以外的字段后端会回 400 并说明，前端不拦，让后端当唯一裁判。
  updateCheckin(id, payload, key) {
    return this.request("/api/checkins/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key
      },
      body: JSON.stringify(payload)
    }).then((data) => data.item);
  },

  // DELETE /api/checkins/{id} —— 软删除。
  // 成功返回被标记的那条记录（isDeleted: true），行本身还在库里。
  deleteCheckin(id, key) {
    return this.request("/api/checkins/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "X-API-KEY": key }
    }).then((data) => data.item);
  }
};
