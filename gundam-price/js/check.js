// check.js ｜ 检查台（Day 20 新增）
// ---------------------------------------------------------------------------
// 【这个页面是干什么的】
//   第 3 周把「数据库 → 云函数 → 公网接口」这条链路修通了，但修通了不等于
//   以后一直通。检查台是一个「一眼看出链路哪一节断了」的入口，三块内容：
//     ① 后端健康状态 —— 不依赖数据库，它红了说明服务器本身没起来
//     ② 核心表真实数据 —— 直接读数据库，页面上看到什么，库里就是什么
//     ③ 写入测试 —— 只在本机开（公网关掉），因为写接口要密钥
//
// 【余力加练：最后更新时间】
//   页顶那行显示「本次检查于 年-月-日 时:分:秒」，每次刷新都变；
//   数据块里还额外显示「数据库数据更新于」（来自 meta.updatedAt）——
//   两个时间是不同的东西：一个是「我什么时候去看的」，一个是「数据本身是哪天的」。
//
// 【为什么 ③ 在公网要关掉】
//   写接口靠请求头 X-API-KEY 认人，而前端代码是公开的 ——
//   一旦把密钥写进 js，等于把钥匙挂在大门上。所以：
//   公网版本不含任何密钥真值，本机版本由使用者当场粘贴密钥。
// ---------------------------------------------------------------------------

const KEY_STORE = "gundam.write-key"; // 只在本机浏览器里记，不进代码、不进 Git

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function pad2(n) { return String(n).padStart(2, "0"); }

// 统一的时间显示：2026-10-08 22:15:03（不用 toLocaleString，
// 因为它的格式随系统语言变，截图给别人看时对不上）
function timeText(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function todayText() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// 接口数据要插进 innerHTML，先转义，避免数据里带 < > 把页面结构弄坏
function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[c]));
}

// 本机判断：这三种 hostname 都算本机
function isLocal() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
}

function statusLine(kind, text) {
  const cls = kind === "ok" ? "dot-ok" : kind === "bad" ? "dot-bad" : "dot-wait";
  return '<div class="status-line"><span class="dot ' + cls + '"></span><span>' + esc(text) + "</span></div>";
}

function metrics(items) {
  return '<div class="check-grid">' + items.map((it) =>
    '<div class="metric"><div class="metric-label">' + esc(it[0]) + '</div>' +
    '<div class="metric-value">' + esc(it[1]) + "</div></div>").join("") + "</div>";
}

function table(headers, rows) {
  if (!rows.length) return '<p class="check-note">这一类暂时没有数据。</p>';
  return '<div class="table-wrap"><table><thead><tr>' +
    headers.map((h) => "<th>" + esc(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + r.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
    "</tbody></table></div>";
}

// ---------------------------------------------------------------------------
// ① 后端健康状态
// ---------------------------------------------------------------------------
async function loadHealth() {
  const box = $("health-box");
  box.innerHTML = statusLine("wait", "正在请求 GET /api/health …");
  const t0 = Date.now();
  try {
    const body = await API.health();
    const ms = Date.now() - t0;
    box.innerHTML =
      statusLine("ok", "后端活着 —— 健康接口正常返回") +
      metrics([
        ["服务名", body.service || "(未返回)"],
        ["HTTP 状态", "200"],
        ["响应耗时", ms + " ms"],
        ["本项完成于", timeText()]
      ]);
  } catch (e) {
    box.innerHTML =
      statusLine("bad", "健康检查失败：" + e.message) +
      '<p class="check-note">这一项红了就先别往下看 —— 服务器本身没起来时，后面所有数据都会跟着失败。</p>' +
      '<button type="button" class="check-btn" id="health-retry">重试</button>';
    const b = $("health-retry");
    if (b) b.addEventListener("click", loadHealth);
  }
}

// ---------------------------------------------------------------------------
// ② 核心表真实数据（kits 机体表 + kit_prices 渠道价格表）
// ---------------------------------------------------------------------------
async function loadData() {
  const box = $("data-box");
  box.innerHTML = statusLine("wait", "正在请求 GET /api/kits 与 GET /api/prices …");
  const t0 = Date.now();
  try {
    const kits = await API.getKits();
    const prices = await API.getPrices();
    const ms = Date.now() - t0;

    const noPrice = kits.kits.filter((k) => k.minPrice === null || k.minPrice === undefined).length;

    const head =
      statusLine("ok", "两个核心表都读到了真实数据") +
      metrics([
        ["kits 表机体数", kits.total + " 台"],
        ["kit_prices 记录数", prices.total + " 条"],
        ["汇率 exchangeRate", String(kits.meta.exchangeRate)],
        ["数据库数据更新于", kits.meta.updatedAt],
        ["本次检查于", timeText()],
        ["两个请求总耗时", ms + " ms"]
      ]);

    const kitTable = '<h3 class="check-h3">kits 表（机体）</h3>' + table(
      ["id", "名称", "系列", "官方价（日元）", "最低价（元）", "渠道数"],
      kits.kits.map((k) => [
        k.id, k.name, k.series, k.officialPriceJPY,
        k.minPrice === null || k.minPrice === undefined ? "暂无报价" : k.minPrice,
        (k.channels || []).length
      ])
    );

    const priceTable = '<h3 class="check-h3">kit_prices 表（最近 6 条渠道记录）</h3>' + table(
      ["id", "机体 id", "渠道", "类型", "价格（元）", "更新日期"],
      prices.items.slice(0, 6).map((p) => [
        p.id, p.kitId, p.platform, p.marketType,
        p.price === null || p.price === undefined ? "暂无报价" : p.price,
        p.updatedDate
      ])
    );

    const tail = noPrice
      ? '<p class="check-note">提示：有 ' + noPrice + ' 台机体在库里还没有任何报价（最低价显示「暂无报价」）。这是数据现状，不是页面故障。</p>'
      : "";

    box.innerHTML = head + kitTable + priceTable + tail;
  } catch (e) {
    box.innerHTML =
      statusLine("bad", "读取真实数据失败：" + e.message) +
      '<p class="check-note">如果 ① 是绿的而这里红了，说明问题在读接口或跨域这一层：把这句话连同 F12 控制台里的报错一起记下来。</p>' +
      '<button type="button" class="check-btn" id="data-retry">重试</button>';
    const b = $("data-retry");
    if (b) b.addEventListener("click", loadData);
  }
}

// ---------------------------------------------------------------------------
// ③ 写入测试（只在本机开）
// ---------------------------------------------------------------------------
function renderWrite() {
  const box = $("write-box");

  // 公网版本：整段关掉，并说清为什么 —— 这本身就是「密钥只走环境变量」的体现
  if (!isLocal()) {
    $("write-scope").textContent = "公网已隐藏";
    box.innerHTML =
      statusLine("wait", "写入测试只在 localhost 下开启") +
      '<p class="check-note">原因：写接口要带请求头 <span class="mono">X-API-KEY</span>，这把钥匙是服务端机密。' +
      "把它写进前端代码，等于把钥匙挂在大门上，所以公网版本里这一段是关掉的 —— " +
      "部署上去的这份代码里也不含任何密钥真值。</p>";
    return;
  }

  $("write-scope").textContent = "仅本机";
  box.innerHTML =
    '<div class="calc-field"><label for="w-key">写接口密钥（WRITE_API_KEY，只为本次测试输入）</label>' +
    '<input id="w-key" type="password" autocomplete="off" placeholder="粘贴云函数环境变量里的那一串"></div>' +
    '<label class="check-check"><input type="checkbox" id="w-remember"> 记住密钥（只存本机浏览器，不写进代码、不进 Git）</label>' +
    '<p class="check-note">这个密钥在请求头 <span class="mono">X-API-KEY</span> 里发出去，只在本次请求中使用；' +
    "它等于云函数环境变量 <span class=\"mono\">WRITE_API_KEY</span> 的值。</p>" +
    '<button type="button" class="check-btn" id="w-probe">只验密钥（不写数据）</button>' +
    '<div id="w-probe-result"></div>' +
    '<hr class="check-hr">' +
    '<h3 class="check-h3">真要写一条记录（会在数据库里留下真实数据）</h3>' +
    '<div class="check-form">' +
      '<div class="calc-field"><label for="w-kit">机体</label><select id="w-kit"><option value="">正在读取机体列表…</option></select></div>' +
      '<div class="calc-field"><label for="w-platform">渠道</label><select id="w-platform">' +
        '<option value="pdd">pdd（拼多多）</option><option value="taobao">taobao（淘宝）</option><option value="xianyu">xianyu（闲鱼）</option></select></div>' +
      '<div class="calc-field"><label for="w-market">行货 / 水货</label><select id="w-market">' +
        '<option value="水货">水货</option><option value="行货">行货</option></select></div>' +
      '<div class="calc-field"><label for="w-price">价格（整数，元）</label><input id="w-price" type="number" min="0" step="1" placeholder="例如 380"></div>' +
      '<div class="calc-field"><label for="w-date">更新日期</label><input id="w-date" type="date" value="' + todayText() + '"></div>' +
    '</div>' +
    '<div class="write-warn">这条测试<b>会把一条真实记录写进数据库</b>，不是演练。想删掉它：第 4 周会有 DELETE 接口，' +
    '在那之前只能去 CloudBase 控制台的 SQL 编辑器里删。建议挑一台<b>本来就没有报价的机体</b>，免得弄乱现有行情。</div>' +
    '<label class="check-check"><input type="checkbox" id="w-confirm"> 我确认：上面这条记录会真的写进数据库</label>' +
    '<button type="button" class="check-btn primary" id="w-submit" disabled>写入一条记录</button>' +
    '<div id="w-result"></div>';

  // 密钥：本机记住的那一个，自动回填
  const saved = localStorage.getItem(KEY_STORE);
  if (saved) {
    $("w-key").value = saved;
    $("w-remember").checked = true;
  }

  // 机体下拉：优先列出「还没有报价」的机体，减少对现有行情的干扰
  API.getKits().then((data) => {
    const sel = $("w-kit");
    if (!sel) return;
    const list = data.kits.slice().sort((a, b) => {
      const an = a.minPrice === null || a.minPrice === undefined ? 0 : 1;
      const bn = b.minPrice === null || b.minPrice === undefined ? 0 : 1;
      return an - bn;
    });
    sel.innerHTML = list.map((k) =>
      '<option value="' + esc(k.id) + '">' + esc(k.name) + "（" + esc(k.id) + "）" +
      (k.minPrice === null || k.minPrice === undefined ? " · 暂无报价" : "") + "</option>"
    ).join("");
  }).catch(() => {
    const sel = $("w-kit");
    if (sel) sel.innerHTML = '<option value="">（机体列表读取失败，可先去上面 ② 看原因）</option>';
  });

  $("w-probe").addEventListener("click", doProbe);
  $("w-confirm").addEventListener("change", (e) => {
    $("w-submit").disabled = !e.target.checked;
  });
  $("w-submit").addEventListener("click", doSubmit);
  $("w-remember").addEventListener("change", (e) => {
    if (!e.target.checked) localStorage.removeItem(KEY_STORE);
  });
}

// 「只验密钥」：故意送非法 platform。
// 后端校验顺序是 ① 验密钥 → ② 读体 → ③ 校字段 → … → ⑦ 写库，
// 密钥对的话会在第 ③ 步就被拦下回 400，永远走不到写库那一步。
async function doProbe() {
  const key = $("w-key").value.trim();
  const out = $("w-probe-result");
  const btn = $("w-probe");

  if (!key) {
    out.innerHTML = statusLine("bad", "先在上面输入密钥，再点这一颗。");
    return;
  }
  btn.disabled = true;
  out.innerHTML = statusLine("wait", "正在试探写接口（不会写数据）…");

  const r = await API.probeKey(key);
  btn.disabled = false;

  if (r.verdict === "ok") {
    if ($("w-remember").checked) localStorage.setItem(KEY_STORE, key);
    out.innerHTML =
      statusLine("ok", "密钥有效 —— 写接口认这把钥匙，数据库零变化") +
      metrics([["返回状态", "400 INVALID_PARAM"], ["后端提示", r.message], ["本项完成于", timeText()]]);
  } else if (r.verdict === "bad-key") {
    out.innerHTML =
      statusLine("bad", "密钥不对（401）") +
      '<p class="check-note">后端原话：' + esc(r.message) + "。核对云函数环境变量 <span class=\"mono\">WRITE_API_KEY</span> 与这里粘贴的是否一字不差。</p>";
  } else if (r.verdict === "unexpected-ok") {
    out.innerHTML = statusLine("bad", "异常：非法参数竟然写成功了 —— 这说明参数校验漏了东西，请把这条截图记下来。");
  } else {
    out.innerHTML = statusLine("bad", "意料之外的返回：" + r.message + "（HTTP " + r.status + "）");
  }
}

// 真写一条：走契约 4.5
async function doSubmit() {
  const key = $("w-key").value.trim();
  const out = $("w-result");
  const btn = $("w-submit");
  const payload = {
    kitId: $("w-kit").value,
    platform: $("w-platform").value,
    marketType: $("w-market").value,
    price: $("w-price").value === "" ? null : Number($("w-price").value),
    updatedDate: $("w-date").value,
    url: ""
  };

  if (!key) { out.innerHTML = statusLine("bad", "先在上面输入密钥。"); return; }
  if (!payload.kitId) { out.innerHTML = statusLine("bad", "先选一台机体（列表没加载出来就点上面 ② 重试）。"); return; }
  if (payload.price !== null && (!Number.isInteger(payload.price) || payload.price < 0)) {
    out.innerHTML = statusLine("bad", "价格必须是不小于 0 的整数（也可以留空 = 暂无报价）。");
    return;
  }

  btn.disabled = true;
  out.innerHTML = statusLine("wait", "正在写入…");

  try {
    const item = await API.createPrice(payload, key);
    if ($("w-remember").checked) localStorage.setItem(KEY_STORE, key);
    out.innerHTML =
      statusLine("ok", "写入成功（HTTP 201），数据已在库里") +
      metrics([
        ["新记录 id", item.id],
        ["机体", item.kitId],
        ["渠道 / 类型", item.platform + " / " + item.marketType],
        ["价格", item.price === null ? "暂无报价" : item.price + " 元"],
        ["更新日期", item.updatedDate],
        ["本项完成于", timeText()]
      ]) +
      '<p class="check-note">刷新 ② 上面的「kit_prices 记录数」应该多 1 条。想删掉这条记录：第 4 周会有 DELETE 接口，' +
      "在那之前去 CloudBase 控制台 SQL 编辑器执行 " + '<span class="mono">DELETE FROM kit_prices WHERE id = \'' + esc(item.id) + "';" + "</span></p>";
  } catch (e) {
    // 409 是「同机体+渠道+类型+日期」已有记录 —— 这不是故障，是防重复提交在正常工作
    const isDup = e.code === "DUPLICATE_RECORD";
    out.innerHTML = statusLine(isDup ? "wait" : "bad",
      isDup ? "没写进去：这个「机体 + 渠道 + 类型 + 日期」的组合库里已经有了（409）"
            : "写入失败：" + e.message + (e.status ? "（HTTP " + e.status + "）" : "")) +
      '<p class="check-note">' +
      (isDup
        ? "这是防重复提交在起作用（契约 4.5 的 409）。换个日期、换个渠道，或换一台机体再试。"
        : "把这句话连同下方后端返回的原文记下来，明天（或第 4 周）处理。") +
      (e.code ? ' <span class="mono">error.code = ' + esc(e.code) + "</span>" : "") +
      "</p>";
  } finally {
    btn.disabled = !$("w-confirm").checked;
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
loadHealth();
loadData();
renderWrite();
$("checked-at").textContent = "本次检查于 " + timeText() + "（刷新页面即重新检查）";
