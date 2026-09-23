// main.js ｜ 首页逻辑（Day 8 · mock 数据版）
// 四种页面状态：① 加载中 ② 成功（卡片列表）③ 空 ④ 错误，互斥切换
// 卡片长什么样、价格怎么算，都交给组件 js/components/kit-card.js（加练项抽出）

// 读取数据文件；HTTP 出错时抛异常，交给调用方进「错误」状态
async function loadData() {
  const res = await fetch("data/data.json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

// ---------- 四种页面状态 ----------

// ① 加载中：骨架屏（占位卡片由组件负责）
function renderLoading(listEl) {
  KitCard.renderSkeleton(listEl, 3);
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
    // ② 成功：交给组件渲染卡片列表（销量条自动按最高销量等比）
    KitCard.renderList(listEl, data.kits, { rate: data.meta.exchangeRate });
  } catch (err) {
    updatedEl.textContent = "";
    renderError(listEl); // ④ 错误
    console.error(err);
  }
}

render();
