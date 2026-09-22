// main.js ｜ 首页逻辑：读取 data/data.json，渲染更新时间和 3 张机体卡片
// 第 1 步写死在 HTML 里的价格，从这一步起全部由数据文件驱动

// 平台代号 → 中文名（详情页第 3 步也会用同一套）
const PLATFORM_NAMES = {
  pdd: "拼多多",
  taobao: "淘宝",
  xianyu: "闲鱼"
};

// 读取数据文件，失败时按技术设计第 8 节给出提示，不白屏
async function loadData() {
  const res = await fetch("data/data.json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

// 计算一台机体的最低现价区间：取所有非空价格的最小值和最大值
function priceRange(kit) {
  const prices = (kit.channels || [])
    .map(c => c.price)
    .filter(p => typeof p === "number" && p !== null);
  if (prices.length === 0) return "暂无报价";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max
    ? "¥" + min
    : "¥" + min + " ~ ¥" + max;
}

// 渲染整页
async function render() {
  const updatedEl = document.getElementById("updated-at");
  const listEl = document.getElementById("kit-list");

  try {
    const data = await loadData();

    // 顶部数据更新时间
    updatedEl.textContent = "数据更新于 " + data.meta.updatedAt + "（手动录入快照，非实时报价）";

    // 3 张机体卡片
    listEl.innerHTML = "";
    for (const kit of data.kits) {
      const card = document.createElement("div");
      card.className = "card";

      const name = document.createElement("h2");
      name.textContent = kit.name;

      const series = document.createElement("span");
      series.className = "series";
      series.textContent = kit.series;

      const price = document.createElement("div");
      price.className = "price";
      price.textContent = "当前最低现价区间：" + priceRange(kit);

      card.appendChild(name);
      card.appendChild(series);
      card.appendChild(price);
      // 点击卡片进入详情页（第 3 步新增）
      card.addEventListener("click", () => {
        location.href = "detail.html?id=" + kit.id;
      });
      listEl.appendChild(card);
    }
  } catch (err) {
    // 数据加载失败 / JSON 格式错误 → 显示提示
    updatedEl.textContent = "";
    listEl.innerHTML = '<div class="error">数据加载失败，请刷新重试。<br>（若你刚手动改过 data.json，请检查是否多逗号或漏引号）</div>';
    console.error(err);
  }
}

render();
