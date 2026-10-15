// main.js ｜ 首页逻辑（Day 8 建立 · Day 20 数据源切到公网接口）
// 四种页面状态：① 加载中 ② 成功（卡片列表）③ 空 ④ 错误，互斥切换
// 卡片长什么样、价格怎么算，都交给组件 js/components/kit-card.js（加练项抽出）

// 取数据。Day 20 改动：原来是 fetch("data/data.json") 读本地文件，
// 现在交给 js/api.js 去读公网接口（按 api-contract.md 第 5 节的约定）。
// 接口回的 data 形状（meta + kits）与原来的 data.json 一模一样，
// 所以这个函数以外的代码一个字都没改 —— 这就是当初把「数据源」和「页面逻辑」分开的好处。
async function loadData() {
  return await API.getKits();
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
// 【Day 23 改动】标题改成由三类翻译器给出的**具体**原因，
//   而不是一律「数据加载失败」——
//   现在「网络错」会说「连不上服务器，请检查网络后重试」，
//   「服务端错」会说「服务器暂时无法处理请求，请稍后重试」。
//   detail 参数由 render() 的 catch 里算好传进来；不传时退回通用文案（保持兼容）。
function renderError(listEl, detail) {
  const title = detail || "数据加载失败，请刷新重试";
  listEl.innerHTML =
    '<div class="state-box state-error">' +
      '<div class="state-title">' + escText(title) + '</div>' +
      '<div class="state-desc">数据来自云端接口：先确认网络正常；若一直失败，多半是接口故障或跨域被拦，按 F12 看控制台的红字。</div>' +
    '</div>';
}

// 【Day 23 新增】把文本转义后再插进 innerHTML。
// 为什么要加：错误文案里可能带上用户输入或后端回显的内容（如 id、字段名），
// 直接拼进 HTML 有被注入的风险。这里统一转义，成本极低、收益明确。
function escText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- 主流程：按 加载中 → 成功/空/错误 顺序推进 ----------

async function render() {
  const updatedEl = document.getElementById("updated-at");
  const listEl = document.getElementById("kit-list");

  // Day 13：状态预览开关 —— 地址栏加 ?state=loading / empty / error 直接进入对应状态。
  // 用途：本地 fetch 太快，「加载中」一闪而过拍不到截图；也是四态的肉眼自检入口。
  // 只画状态、不真正读数据，截完图把参数删掉就恢复正常。
  const preview = new URLSearchParams(location.search).get("state");
  if (preview === "loading") { renderLoading(listEl); return; }
  if (preview === "empty")   { updatedEl.textContent = ""; renderEmpty(listEl); return; }
  if (preview === "error")   { updatedEl.textContent = ""; renderError(listEl); return; }

  renderLoading(listEl); // ① 先进加载中状态
  try {
    const data = await loadData();
    updatedEl.textContent = "数据更新于 " + data.meta.updatedAt + "（手动录入快照，非实时报价）";
    if (!Array.isArray(data.kits) || data.kits.length === 0) {
      renderEmpty(listEl); // ③ 空
      return;
    }
    // ② 成功：Day 12 起先交给筛选模块（它内部会调组件渲染卡片）；
    //    Filter.init 里会立刻 apply 一次，此时没有任何筛选条件 = 完整列表。
    Filter.init({
      data: data,
      listEl: listEl,
      countEl: document.getElementById("filter-count")
    });

    // Day 12：清空按钮 —— 一键把关键词和平台都复位，恢复完整列表
    const clearBtn = document.getElementById("filter-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        Filter.clear();
        document.getElementById("filter-keyword").focus(); // 清空后把光标送回输入框，方便接着搜
      });
    }
  } catch (err) {
    updatedEl.textContent = "";
    // Day 23：交给 API.describe —— 它同时做两件事：
    //   ① 把错误翻成三类中文人话（返回给我们显示）
    //   ② 把原始技术细节写进 F12 控制台（排查用）
    renderError(listEl, API.describe(err)); // ④ 错误
  }
}

render();

// Day 11 修复：点卡片会先进入「翻转中」状态（转到 90°）再跳详情页；
// 从详情页按返回键时，浏览器把原页面从缓存原样恢复，卡片还卡在翻转姿势（看起来变白消失）。
// 所以页面每次显示时（包括返回键触发的缓存恢复），把所有卡片的翻转状态清掉。
window.addEventListener("pageshow", function () {
  document.querySelectorAll(".card.flipping").forEach(function (c) {
    c.classList.remove("flipping");
  });
});
