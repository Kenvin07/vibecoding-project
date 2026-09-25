// calc.js ｜ 五算计算器：官方日元价 → 五算基准 + 三档价格分界；
// 可选填一个现价，用与详情页同一套算法（KitCard.tierOf）判断捡漏 / 合理 / 溢价。
// 汇率与收录机体都读 data/data.json，保证全站只有一个数据源。

const els = {
  kitSelect: document.getElementById("kit-select"),
  jpy: document.getElementById("jpy"),
  market: document.getElementById("market"),
  result: document.getElementById("result-box")
};

// 载入数据：把收录机体填进下拉框，汇率存下来
let rate = null;

async function init() {
  try {
    const res = await fetch("data/data.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    rate = data.meta.exchangeRate;

    for (const kit of data.kits) {
      const opt = document.createElement("option");
      opt.value = kit.officialPriceJPY;
      opt.textContent = kit.name + "（" + kit.officialPriceJPY.toLocaleString() + " 日元）";
      els.kitSelect.appendChild(opt);
    }
  } catch (err) {
    els.result.innerHTML = '<span class="error">数据加载失败，请刷新重试。</span>';
    console.error(err);
  }
}

// 核心计算：官方价有效 → 算五算基准 + 三档分界；填了现价 → 再判档位
function compute() {
  const jpy = Number(els.jpy.value);
  if (!els.jpy.value || !Number.isFinite(jpy) || jpy <= 0 || rate === null) {
    els.result.textContent = "填好官方日元价后，这里显示五算基准与各档位的价格分界。";
    return;
  }

  const base = KitCard.fiveKBase(jpy, rate);          // 五算基准价（四舍五入取整）
  const upper = Math.round(base * 1.2);                // 「合理」的上限 = 基准 × 1.2

  let html =
    "五算基准价：约 <strong>¥" + base + "</strong>" +
    "<br>各档位分界：低于 ¥" + base + " = 捡漏 ｜ ¥" + base + " ~ ¥" + upper + " = 合理 ｜ 高于 ¥" + upper + " = 溢价";

  const market = Number(els.market.value);
  if (els.market.value && Number.isFinite(market) && market > 0) {
    const tier = KitCard.tierOf(market, base);
    const diff = market - base;
    const diffText = diff === 0 ? "正好等于五算基准"
      : (diff > 0 ? "高出基准 ¥" + diff : "比基准低 ¥" + Math.abs(diff));
    html += '<div class="min-price">现价 ¥' + market + " " + diffText +
      " → 行情档位：<span class=\"tier " + tier.cls + "\">" + tier.label + "</span></div>";
  }

  els.result.innerHTML = html;
}

// 三个输入源任一变化都重算；选了机体就把官方价带进输入框（仍可手改）
els.kitSelect.addEventListener("change", () => {
  if (els.kitSelect.value) els.jpy.value = els.kitSelect.value;
  compute();
});
els.jpy.addEventListener("input", compute);
els.market.addEventListener("input", compute);

init();
