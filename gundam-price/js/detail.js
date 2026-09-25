// detail.js ｜ 详情页逻辑：按 URL 参数 ?id=xxx 找到机体，渲染五算参照、
// 三渠道 × 行水货价格表和行情档位（捡漏 / 合理 / 溢价）
// 价格算法与渠道名统一由组件 js/components/kit-card.js 提供（加练项抽出，避免两处各写一遍）

// 从地址栏取 id：detail.html?id=mg-unicorn → "mg-unicorn"
function getKitId() {
  return new URLSearchParams(location.search).get("id");
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
      html += "<tr><td>" + KitCard.PLATFORM_NAMES[platform] + "</td><td>" + row.marketType
            + "</td><td>" + priceHtml + "</td><td>" + row.updatedDate + "</td><td>" + buyHtml + "</td></tr>";
    }
  }
  return html + "</table>";
}

// 走势图：每日最低价折线 + 五算基准虚线（同一张图方便对比）
// Chart.js 没加载成功（断网等）→ 显示文字兜底，页面不白屏
function renderTrendChart(kit, base) {
  const wrap = document.getElementById("trend-wrap");
  if (!wrap) return;
  const series = KitCard.historySeries(kit);
  if (series.length === 0) {
    wrap.innerHTML = '<span class="none">暂无历史数据，每天更新价格后会自动长出走势线。</span>';
    return;
  }
  if (typeof Chart === "undefined") {
    wrap.innerHTML = '<span class="none">图表库加载失败（可能没联网），价格数据仍在下方表格中。</span>';
    return;
  }
  const labels = series.map(h => h.date.slice(5));  // "2026-09-22" → "09-22"
  const prices = series.map(h => h.price);
  new Chart(document.getElementById("trend-chart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "每日最低价",
          data: prices,
          borderColor: "#1d4ed8",
          backgroundColor: "#dbeafe",
          fill: true,
          tension: 0.3,
          pointRadius: 4
        },
        {
          label: "五算基准价",
          data: labels.map(() => base),
          borderColor: "#92400e",
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { ticks: { callback: v => "¥" + v } }
      }
    }
  });
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

  const base = KitCard.fiveKBase(kit.officialPriceJPY, data.meta.exchangeRate);
  const prices = KitCard.validPrices(kit);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const tier = prices.length ? KitCard.tierOf(minPrice, base) : null;

  box.innerHTML =
    '<div class="panel hero">' +
      (kit.image
        ? '<img class="kit-img" src="img/' + kit.image + '" alt="' + kit.name + ' 机体图"' +
          ' onerror="this.style.display=\'none\'">'
        : "") +
      '<div class="hero-info">' +
        '<h2>' + kit.name + '</h2>' +
        '<span class="series">' + kit.series + '</span>' +
        '<div class="ref">官方建议零售价：' + kit.officialPriceJPY.toLocaleString() + ' 日元<br>' +
        '五算基准价：约 ¥' + base + '（官方价 × 汇率 ' + data.meta.exchangeRate + '）</div>' +
        (tier
          ? '<div class="min-price">当前最低价 <span class="min-price-num">¥' + minPrice + '</span> → 行情档位：<span class="tier ' + tier.cls + '">' + tier.label + '</span></div>'
          : '<div class="none">暂无报价，无法判断档位</div>') +
      '</div>' +
    '</div>' +
    '<div class="panel"><h2>各渠道现价</h2><div class="table-wrap">' + channelTable(kit) + '</div></div>' +
    '<div class="panel"><h2>价格走势（近 30 天每日最低价）</h2>' +
      '<div class="chart-wrap" id="trend-wrap"><canvas id="trend-chart"></canvas></div>' +
      (function () {
        const hist = KitCard.historyMin(kit);
        return hist ? '<div class="min-price">近 30 天最低 <span class="min-price-num">¥' + hist.price + '</span>（' + hist.date + '）</div>' : "";
      })() +
    '</div>';

  // HTML 已经挂到页面上，canvas 存在了，才能画图
  renderTrendChart(kit, base);
}

render();
