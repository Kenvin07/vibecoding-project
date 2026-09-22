// detail.js ｜ 详情页逻辑：按 URL 参数 ?id=xxx 找到机体，渲染五算参照、
// 三渠道 × 行水货价格表和行情档位（捡漏 / 合理 / 溢价）

// 与 main.js 同一套平台中文名
const PLATFORM_NAMES = {
  pdd: "拼多多",
  taobao: "淘宝",
  xianyu: "闲鱼"
};

// 从地址栏取 id：detail.html?id=mg-unicorn → "mg-unicorn"
function getKitId() {
  return new URLSearchParams(location.search).get("id");
}

// 五算基准价 = 官方日元价 × 汇率
// （TECH_DESIGN 5.4 原公式「×0.05×汇率」与自己的例子矛盾，2026-09-22 经 Master 拍板按例子修正）
function fiveK基准(officialJPY, rate) {
  return Math.round(officialJPY * rate);
}

// 行情档位：最低现价 < 五算 → 捡漏；五算 ~ 1.2 倍 → 合理；> 1.2 倍 → 溢价
function tierOf(minPrice, base) {
  if (minPrice < base) return { label: "捡漏", cls: "bargain" };
  if (minPrice <= base * 1.2) return { label: "合理", cls: "fair" };
  return { label: "溢价", cls: "high" };
}

// 渠道价格表：按拼多多 / 淘宝 / 闲鱼分组，每组下行货、水货两行
function channelTable(kit) {
  let html = '<table><tr><th>渠道</th><th>行 / 水</th><th>现价</th><th>录入日期</th><th>购买</th></tr>';
  for (const platform of ["pdd", "taobao", "xianyu"]) {
    const rows = (kit.channels || []).filter(c => c.platform === platform);
    for (const row of rows) {
      const priceHtml = (typeof row.price === "number")
        ? "¥" + row.price
        : '<span class="none">暂无报价</span>';
      const buyHtml = row.url
        ? '<a class="buy-link" target="_blank" rel="noopener" href="' + row.url + '">去购买</a>'
        : '<span class="none">暂无链接</span>';
      html += "<tr><td>" + PLATFORM_NAMES[platform] + "</td><td>" + row.marketType
            + "</td><td>" + priceHtml + "</td><td>" + row.updatedDate + "</td><td>" + buyHtml + "</td></tr>";
    }
  }
  return html + "</table>";
}

async function render() {
  const box = document.getElementById("detail");
  const updatedEl = document.getElementById("updated-at");
  const id = getKitId();

  let data;
  try {
    const res = await fetch("data/data.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    box.innerHTML = '<div class="error">数据加载失败，请刷新重试。</div>';
    console.error(err);
    return;
  }

  updatedEl.textContent = "数据更新于 " + data.meta.updatedAt + "（手动录入快照，非实时报价）";

  // 找不到对应机体（id 写错或不存在）→ 明确提示
  const kit = data.kits.find(k => k.id === id);
  if (!kit) {
    box.innerHTML = '<div class="error">没有找到这台机体，请从首页列表点进来。</div>';
    return;
  }

  const base = fiveK基准(kit.officialPriceJPY, data.meta.exchangeRate);
  const prices = (kit.channels || [])
    .map(c => c.price)
    .filter(p => typeof p === "number" && p !== null);
  const minPrice = Math.min(...prices);
  const tier = prices.length ? tierOf(minPrice, base) : null;

  box.innerHTML =
    '<div class="panel">' +
      '<h2>' + kit.name + '</h2>' +
      '<span class="series">' + kit.series + '</span>' +
      '<div class="ref">官方建议零售价：' + kit.officialPriceJPY.toLocaleString() + ' 日元<br>' +
      '五算基准价：约 ¥' + base + '（官方价 × 汇率 ' + data.meta.exchangeRate + '）</div>' +
      (tier
        ? '<div>当前最低价 ¥' + minPrice + ' → 行情档位：<span class="tier ' + tier.cls + '">' + tier.label + '</span></div>'
        : '<div class="none">暂无报价，无法判断档位</div>') +
    '</div>' +
    '<div class="panel"><h2>各渠道现价</h2><div class="table-wrap">' + channelTable(kit) + '</div></div>';
}

render();
