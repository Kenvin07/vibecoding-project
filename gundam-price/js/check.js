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
// ④ 打卡记录 · 改 / 删（Day 22 新增）
// ---------------------------------------------------------------------------
// 【今天的主线就摆在这一段界面上：删除为什么比新增更容易出事】
//   新增只要把表单填对就完事；删除多出两件必须由「人」来做的事：
//     ① 动手之前先被问一句「你确定吗」—— 就是二次确认，专治手滑；
//     ② 删完要让列表自己说话 —— 重新读一遍，那条真的不见了才算数。
//   而今天用的是**软删除**：库里那行没消失，只是打了 "isDeleted" 标记。
//   所以上面特地留了一个「把已删除的也列出来」的开关 —— 一勾就能看见
//   「列表里删掉了」和「数据没了」是两件不同的事。这是软删除的全部意义。
//
// 【改接口的一条规矩这里也照做】空修改不算修改：一个字段都没动就别发请求。
//   后端本来就拦（400），前端提前拦一下，少一次往返、也少一次误导。
// ---------------------------------------------------------------------------

let checkinRows = null;    // 最近一次读到的打卡（null = 还没读到 / 读失败）
let checkinsError = null;  // 读取失败的原因（null = 没出错）
let editId = null;         // 正在改哪一条（null = 没有）
let confirmId = null;      // 正在等二次确认删哪一条（null = 没有）
let lastChange = null;     // 最近一次操作的结果块（改前 → 改后 / 删除回执）
let showDeleted = false;   // 列表是否把已软删除的也列出来
let editBusy = false;      // 有请求在飞 —— 期间不渲染操作按钮，从根上防连点

// 密钥复用 ③ 的输入框：同一页没必要让使用者输两遍。
// ③ 的框里空着，就退回「本机浏览器记住的那一份」（同样是 localStorage，不进代码）。
function writeKeyOf() {
  const el = $("w-key");
  if (el && el.value.trim()) return el.value.trim();
  return (localStorage.getItem(KEY_STORE) || "").trim();
}

function findRow(id) {
  if (!checkinRows) return null;
  for (const r of checkinRows) if (r.id === id) return r;
  return null;
}

// 改前 → 改后 对比表。今天要交的截图里要有「改之前与之后的值对比」，就是它。
function diffTable(before, after) {
  const rows = [];
  if (before.status !== after.status) rows.push(["完成状态", before.status, after.status]);
  if (before.note !== after.note) rows.push(["备注", before.note, after.note]);
  if (!rows.length) rows.push(["（没有字段发生变化）", "", ""]);
  return '<h3 class="check-h3">改前 → 改后（同一条记录 ' + esc(after.id) + "）</h3>" +
    '<div class="table-wrap"><table><thead><tr><th>字段</th><th>改之前</th><th>改之后</th></tr></thead><tbody>' +
    rows.map((r) => "<tr>" + r.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
    "</tbody></table></div>";
}

// 列表表格：每行右侧两个按钮，靠 data-act / data-id 交给事件委托认领
// 显示层过滤：开关没勾时只列未删除的行（数据层在 loadCheckins 里已整表取回）
function editTable() {
  if (!checkinRows) {
    return '<p class="check-note">当前没有打卡记录。</p>';
  }
  const shown = showDeleted ? checkinRows : checkinRows.filter((r) => r.isDeleted !== true);
  if (!shown.length) {
    return '<p class="check-note">当前没有可显示的打卡记录' +
      (checkinRows.length
        ? "（有 " + checkinRows.length + " 条都打着删除标记 —— 勾上方开关可查看）"
        : "") +
      "。</p>";
  }
  const rows = shown.map((r) => {
    const gone = r.isDeleted === true;
    const actCell = gone
      ? '<span class="mono">已删除</span>'
      : '<button type="button" class="check-btn" data-act="edit" data-id="' + esc(r.id) + '">改</button>' +
        ' <button type="button" class="check-btn" data-act="del" data-id="' + esc(r.id) + '">删</button>';
    return "<tr>" +
      "<td>" + esc(r.id) + "</td>" +
      "<td>" + esc(r.kitId) + "</td>" +
      "<td>" + esc(r.checkinDate) + "</td>" +
      "<td>" + esc(r.status) + "</td>" +
      "<td>" + esc(r.note) + "</td>" +
      "<td>" + actCell + "</td>" +
      "</tr>";
  }).join("");
  return '<div class="table-wrap"><table><thead><tr>' +
    ["id", "机体", "日期", "完成状态", "备注", "操作"].map((h) => "<th>" + esc(h) + "</th>").join("") +
    "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

// 行内编辑区（点「改」之后出现）
function editFormHtml(row) {
  return '<h3 class="check-h3">修改 ' + esc(row.id) + "（" + esc(row.kitId) + " · " + esc(row.checkinDate) + "）</h3>" +
    '<div class="check-form">' +
      '<div class="calc-field"><label for="e-status">完成状态</label><select id="e-status">' +
        ["已完成", "未完成"].map((s) =>
          '<option value="' + esc(s) + '"' + (s === row.status ? " selected" : "") + ">" + esc(s) + "</option>"
        ).join("") +
      "</select></div>" +
      '<div class="calc-field"><label for="e-note">备注</label>' +
        '<input id="e-note" type="text" value="' + esc(row.note) + '" placeholder="例如：拼多多 238，比上周降了 12"></div>' +
    "</div>" +
    '<p class="check-note">可改字段只有这两个 —— 接口白名单里写死的（契约 4.13）。' +
    "机体、日期、删除标记都不给改：前两个一改，这条记录的含义就变了（等于删旧的建新的），" +
    "删除标记只能走「删」按钮。</p>" +
    '<button type="button" class="check-btn primary" data-act="save" data-id="' + esc(row.id) + '">保存修改</button>' +
    ' <button type="button" class="check-btn" data-act="cancel">取消</button>' +
    '<div id="e-result"></div>';
}

// 二次确认区（点「删」之后出现，此刻【还没有】发任何请求）
function deleteConfirmHtml(row) {
  return '<div class="write-warn">' +
    "⚠️ 确认要删除 <b>" + esc(row.id) + "</b>（" + esc(row.kitId) + " · " + esc(row.checkinDate) + "）这条打卡记录吗？" +
    "<br>确认后它就不会再出现在上面的列表里，也不会再出现在 <span class=\"mono\">GET /api/checkins</span> 的返回里。" +
    "<br>本期用的是<b>软删除</b>：库里那行不会消失，只是被打上 " + '<span class="mono">"isDeleted" = true</span> 标记，' +
    "所以在 SQL 编辑器里仍然查得到 —— 「删掉了」和「数据没了」是两件事。" +
    "</div>" +
    '<button type="button" class="check-btn primary" data-act="del-yes" data-id="' + esc(row.id) + '">确认删除（不可撤销）</button>' +
    ' <button type="button" class="check-btn" data-act="cancel">取消</button>';
}

// 整块重画。这是唯一的渲染出口 —— 状态变了就调它，界面永远等于当前状态。
function renderEditBox() {
  const box = $("edit-box");
  if (!box) return;

  // 公网版本：改和删都要密钥，所以这一段整个关掉
  if (!isLocal()) {
    $("edit-scope").textContent = "公网已隐藏";
    box.innerHTML =
      statusLine("wait", "打卡记录的改 / 删只在 localhost 下开启") +
      '<p class="check-note">原因和上面 ③ 一样：改和删都是写操作，要带请求头 <span class="mono">X-API-KEY</span>。' +
      "这把钥匙是服务端机密，不写进前端代码 —— 所以部署在公网上的这一份里，操作入口是关掉的。</p>";
    return;
  }

  $("edit-scope").textContent = "仅本机";

  if (checkinsError) {
    box.innerHTML =
      statusLine("bad", "读取打卡记录失败：" + checkinsError) +
      '<p class="check-note">如果上面 ② 是绿的、这里却红了，问题多半在读接口或跨域这一层，把 F12 控制台里的报错一起记下来。</p>' +
      '<button type="button" class="check-btn" data-act="reload">重试</button>';
    return;
  }

  if (checkinRows === null) {
    box.innerHTML = statusLine("wait", "正在请求 GET /api/checkins …");
    return;
  }

  const alive = checkinRows.filter((r) => r.isDeleted !== true).length;
  const gone = checkinRows.length - alive;

  const head =
    statusLine("ok", "库里共 " + checkinRows.length + " 条打卡记录：未删除 " + alive +
      " 条、已删除 " + gone + " 条" +
      (showDeleted ? "（当前含已删除一起列出）" : "（下方列表只显示未删除的）")) +
    metrics([
      ["未删除", alive + " 条"],
      ["已删除（软删除标记）", gone + " 条"],
      ["本次读取于", timeText()]
    ]);

  const bar =
    '<label class="check-check"><input type="checkbox" id="e-showdel"' + (showDeleted ? " checked" : "") +
    '> 把已删除的也列出来（<span class="mono">includeDeleted=true</span>）—— 用来证实「删除 ≠ 数据没了」</label>' +
    '<button type="button" class="check-btn" data-act="reload">重新读取</button>';

  // 请求在飞时不给操作按钮，避免连点（比如删除按钮被点两次，第二次必然 404）
  let mid = "";
  if (!editBusy) {
    if (editId) {
      const row = findRow(editId);
      if (row) mid = editFormHtml(row);
    } else if (confirmId) {
      const row = findRow(confirmId);
      if (row) mid = deleteConfirmHtml(row);
    }
  }

  box.innerHTML = head + bar + editTable() + mid + (lastChange || "");
}

// 读列表。keepResult=true 表示「这次重读是某次操作后的刷新，别把结果块擦掉」。
async function loadCheckins(keepResult) {
  if (!keepResult) lastChange = null;
  checkinsError = null;
  try {
    // 永远整表取回（含已删除的行）：顶部「未删除 / 已删除」两张统计卡才不会说谎。
    // 「把已删除的也列出来」这个开关只控制【显示层】过滤（见 editTable），不再控制请求参数 ——
    // 之前让它顺带控制请求，结果开关一关，统计里的「已删除」永远是 0，跟库里对不上。
    const data = await API.getCheckins(true);
    checkinRows = data.items;
  } catch (e) {
    checkinRows = null;
    checkinsError = (e.status ? "HTTP " + e.status + "：" : "") + e.message +
      (e.code ? "（error.code = " + e.code + "）" : "");
  }
  renderEditBox();
}

// 事件委托：整块只绑一次，「重画」时按钮跟着 innerHTML 换掉，监听器不用重绑
function bindEditOnce() {
  const box = $("edit-box");
  if (!box || box.__editBound) return;
  box.__editBound = true;
  box.addEventListener("click", onEditClick);
  box.addEventListener("change", onEditChange);
}

function onEditClick(e) {
  const el = e.target;
  if (!el || !el.getAttribute) return;
  const act = el.getAttribute("data-act");
  if (!act) return;
  const id = el.getAttribute("data-id") || "";

  if (act === "edit") { editId = id; confirmId = null; lastChange = null; renderEditBox(); return; }
  if (act === "del") { confirmId = id; editId = null; lastChange = null; renderEditBox(); return; }
  if (act === "cancel") { editId = null; confirmId = null; renderEditBox(); return; }
  if (act === "reload") { loadCheckins(true); return; }
  if (act === "save") { doSave(id); return; }
  if (act === "del-yes") { doDelete(id); return; }
}

function onEditChange(e) {
  const el = e.target;
  if (el && el.id === "e-showdel") {
    showDeleted = !!el.checked;
    loadCheckins(true);
  }
}

// 保存修改 → PATCH /api/checkins/{id}
async function doSave(id) {
  const key = writeKeyOf();
  if (!key) {
    lastChange = statusLine("bad", "还没填写接口密钥 —— 先在上面 ③ 的输入框里粘贴一次（或勾上「记住密钥」下次自动带上）。");
    renderEditBox();
    return;
  }

  const before = findRow(id);
  if (!before) { editId = null; renderEditBox(); return; }

  // 只把「真的变了」的字段发出去。一个都没变就干脆不发 ——
  // 后端也认这条规矩（空修改回 400），前端先拦一道，少一次注定被拒的往返。
  const payload = {};
  const status = $("e-status").value;
  const note = $("e-note").value.trim();
  if (status !== before.status) payload.status = status;
  if (note !== before.note) payload.note = note;
  if (!Object.keys(payload).length) {
    lastChange = statusLine("wait", "没有任何改动 —— 没发请求（空修改不算修改）");
    editId = null;
    renderEditBox();
    return;
  }

  editBusy = true;
  editId = null;
  lastChange = statusLine("wait", "正在提交修改（PATCH /api/checkins/" + id + "）…");
  renderEditBox();

  try {
    const item = await API.updateCheckin(id, payload, key);
    lastChange =
      statusLine("ok", "修改成功（HTTP 200）—— 库里那条已经变了") +
      diffTable(before, item);
    editBusy = false;
    await loadCheckins(true);
  } catch (e) {
    editBusy = false;
    lastChange =
      statusLine("bad", "修改失败：" + e.message + (e.status ? "（HTTP " + e.status + "）" : "")) +
      (e.code ? '<p class="check-note"><span class="mono">error.code = ' + esc(e.code) + "</span></p>" : "");
    await loadCheckins(true);
  }
}

// 确认删除 → DELETE /api/checkins/{id}（软删除）
async function doDelete(id) {
  const key = writeKeyOf();
  if (!key) {
    lastChange = statusLine("bad", "还没填写接口密钥 —— 先在上面 ③ 的输入框里粘贴一次。");
    renderEditBox();
    return;
  }

  editBusy = true;
  confirmId = null;
  lastChange = statusLine("wait", "正在删除（DELETE /api/checkins/" + id + "）…");
  renderEditBox();

  try {
    const item = await API.deleteCheckin(id, key);
    lastChange =
      statusLine("ok", "删除成功（HTTP 200）—— " + item.id + " 已经从列表里消失") +
      '<p class="check-note">它现在 <span class="mono">isDeleted = true</span>：列表默认不返回它。' +
      "勾上上面那个「把已删除的也列出来」的开关，就能看见它还在库里 —— " +
      "这正是软删除的意义：删错了还能找回来（在 SQL 编辑器里把 isDeleted 改回 false 即可）。</p>";
    editBusy = false;
    await loadCheckins(true);
  } catch (e) {
    editBusy = false;
    lastChange =
      statusLine("bad", "删除失败：" + e.message + (e.status ? "（HTTP " + e.status + "）" : "")) +
      (e.code ? '<p class="check-note"><span class="mono">error.code = ' + esc(e.code) + "</span></p>" : "");
    await loadCheckins(true);
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
loadHealth();
loadData();
renderWrite();

// ④ 的逻辑：本机才发请求（公网那份连请求都不发，省掉一次注定被跨域拦下的失败）
bindEditOnce();
renderEditBox();
if (isLocal()) loadCheckins();

$("checked-at").textContent = "本次检查于 " + timeText() + "（刷新页面即重新检查）";
