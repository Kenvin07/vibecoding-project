// main.js ｜ 首页逻辑（Day 8 · mock 数据版）
// 四种页面状态：① 加载中 ② 成功（卡片列表）③ 空 ④ 错误，互斥切换
// 数据来自 data/data.json（每天手动编辑），卡片点击进入详情页

// 平台代号 → 中文名（与 detail.js 保持同一套）
const PLATFORM_NAMES = {
  pdd: "拼多多",
  taobao: "淘宝",
  xianyu: "闲鱼"
};

// ---------- 工具函数 ----------

// 读取数据文件；HTTP 出错时抛异常，交给调用方进「错误」状态
async function loadData() {
  const res = await fetch("data/data.json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

// 五算基准价 = 官方日元价 × 汇率（与 detail.js 同一公式，Day 7 拍板版）
function fiveK基准(officialJPY, rate) {
  return Math.round(officialJPY * rate);
}

// 行情档位：最低现价 < 五算 → 捡漏；五算 ~ 1.2 倍 → 合理；> 1.2 倍 → 溢价
function tierOf(minPrice, base) {
  if (minPrice < base) return { label: "捡漏", cls: "bargain" };
  if (minPrice <= base * 1.2) return { label: "合理", cls: "fair" };
  return { label: "溢价", cls: "high" };
}

// 最低现价区间：取所有非空价格的最小/最大值
function priceRange(prices) {
  if (prices.length === 0) return "暂无报价";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? "¥" + min : "¥" + min + " ~ ¥" + max;
}

// ---------- 四种页面状态 ----------

// ① 加载中：骨架屏（数据没到之前先占位，避免白屏和布局跳变）
function renderLoading(listEl) {
  listEl.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement("div");
    sk.className = "card skeleton";
    sk.innerHTML =
      '<div class="sk-line sk-tag"></div>' +
      '<div class="sk-line sk-title"></div>' +
      '<div class="sk-line sk-price"></div>' +
      '<div class="sk-line sk-bar"></div>';
    listEl.appendChild(sk);
  }
}

// ③ 空：数据读到了，但一台机体都没收录
function renderEmpty(listEl) {
  listEl.innerHTML =
    '<div class="state-box">' +
      '<div class="state-emoji">📭</div>' +
      '<div class="state-title">本期还没有收录任何机体</div>' +
      '<div class="state-desc">数据由作者手动录入，第一台机体上架后这里就会显示行情。</div>' +
    '</div>';
}

// ④ 错误：读不到数据 / JSON 格式坏了（如多逗号、漏引号）
function renderError(listEl) {
  listEl.innerHTML =
    '<div class="state-box state-error">' +
      '<div class="state-title">数据加载失败，请刷新重试</div>' +
      '<div class="state-desc">若你刚手动改过 data.json，请检查是否多逗号或漏引号；也要确认本地服务器还开着。</div>' +
    '</div>';
}

// ② 成功：渲染机体卡片（系列、行情档位、名称、价格区间、销量对比）
function renderList(listEl, data) {
  const rate = data.meta.exchangeRate;

  // 销量对比：找出本期销量最高的机体，其余按比例画条；再排个名
  const maxSales = Math.max(...data.kits.map(k => k.salesVolume || 0));
  const sorted = [...data.kits].sort((a, b) => (b.salesVolume || 0) - (a.salesVolume || 0));

  listEl.innerHTML = "";
  for (const kit of data.kits) {
    const prices = (kit.channels || [])
      .map(c => c.price)
      .filter(p => typeof p === "number" && p !== null);
    const base = fiveK基准(kit.officialPriceJPY, rate);
    const tier = prices.length ? tierOf(Math.min(...prices), base) : null;

    // 销量条宽度 = 自己销量 ÷ 销量王 × 100%
    const pct = maxSales ? Math.round((kit.salesVolume || 0) / maxSales * 100) : 0;
    const rank = sorted.findIndex(k => k.id === kit.id) + 1;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="card-top">' +
        '<span class="series">' + kit.series + '</span>' +
        (tier ? '<span class="tier tier-small ' + tier.cls + '">' + tier.label + '</span>' : "") +
      '</div>' +
      '<h2>' + kit.name + '</h2>' +
      '<div class="price">' + priceRange(prices) + '</div>' +
      '<div class="sales">' +
        '<div class="sales-label">销量对比<span class="sales-rank">No.' + rank + '</span></div>' +
        '<div class="sales-bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="sales-num">本期收录机型对比 · 月销约 ' + (kit.salesVolume || 0) + ' 台</div>' +
      '</div>';

    // 点击卡片进入详情页
    card.addEventListener("click", () => {
      location.href = "detail.html?id=" + kit.id;
    });
    listEl.appendChild(card);
  }
}

// ---------- 主流程：按 加载中 → 成功/空/错误 顺序推进 ----------

async function render() {
  const updatedEl = document.getElementById("updated-at");
  const listEl = document.getElementById("kit-list");

  renderLoading(listEl); // ① 先进加载中状态
  try {
    const data = await loadData();
    updatedEl.textContent = "数据更新于 " + data.meta.updatedAt + "（手动录入快照，非实时报价）";
    if (!Array.isArray(data.kits) || data.kits.length === 0) {
      renderEmpty(listEl); // ③ 空
      return;
    }
    renderList(listEl, data); // ② 成功
  } catch (err) {
    updatedEl.textContent = "";
    renderError(listEl); // ④ 错误
    console.error(err);
  }
}

render();
