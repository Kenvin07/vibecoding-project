// kit-card.js ｜ 可复用组件：一台机体 → 一张卡片 / 一列卡片 / 加载占位卡片
// ---------------------------------------------------------------------------
// 怎么用（页面里引一次脚本，然后调方法）：
//   <script src="js/components/kit-card.js"></script>
//
//   KitCard.renderList(容器, 机体数组, { rate: 汇率 })   // 成功态：渲染卡片列表
//   KitCard.renderSkeleton(容器, 3)                      // 加载态：渲染骨架卡片
//   KitCard.create(单台机体, { rate, maxSales, rank })   // 单张卡片，返回 DOM 节点
//
// 价格工具（详情页也在用，避免两处算法各写一遍）：
//   KitCard.fiveKBase(官方日元价, 汇率)   KitCard.tierOf(最低现价, 五算基准)
//   KitCard.priceRange([价格数组])        KitCard.validPrices(机体)
//   KitCard.PLATFORM_NAMES               // 渠道代号 → 中文名

const KitCard = {

  // 渠道代号 → 中文名
  PLATFORM_NAMES: {
    pdd: "拼多多",
    taobao: "淘宝",
    xianyu: "闲鱼"
  },

  // 五算基准价 = 官方日元价 × 汇率
  fiveKBase(officialJPY, rate) {
    return Math.round(officialJPY * rate);
  },

  // 行情档位：最低现价 < 五算 → 捡漏；五算 ~ 1.2 倍 → 合理；> 1.2 倍 → 溢价
  tierOf(minPrice, base) {
    if (minPrice < base) return { label: "捡漏", cls: "bargain" };
    if (minPrice <= base * 1.2) return { label: "合理", cls: "fair" };
    return { label: "溢价", cls: "high" };
  },

  // 挑出有效价格：是数字、且不是 null（暂无报价的渠道不算）
  validPrices(kit) {
    return (kit.channels || [])
      .map(c => c.price)
      .filter(p => typeof p === "number" && p !== null);
  },

  // 最低现价区间："¥230 ~ ¥300"；一个价就只显示一个；没报价给提示文案
  priceRange(prices) {
    if (prices.length === 0) return "暂无报价";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? "¥" + min : "¥" + min + " ~ ¥" + max;
  },

  // 造一张卡片，返回 DOM 节点（不改动页面，方便将来放进别的容器里）
  // opts: { rate 汇率, maxSales 本期销量王, rank 销量排名, onOpen 点击回调 }
  create(kit, opts = {}) {
    const rate = opts.rate;
    const prices = this.validPrices(kit);
    const base = this.fiveKBase(kit.officialPriceJPY, rate);
    const tier = prices.length ? this.tierOf(Math.min(...prices), base) : null;
    const pct = opts.maxSales ? Math.round((kit.salesVolume || 0) / opts.maxSales * 100) : 0;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="card-top">' +
        '<span class="series">' + kit.series + '</span>' +
        (tier ? '<span class="tier tier-small ' + tier.cls + '">' + tier.label + '</span>' : "") +
      '</div>' +
      '<h2>' + kit.name + '</h2>' +
      '<div class="price">' + this.priceRange(prices) + '</div>' +
      '<div class="sales">' +
        '<div class="sales-label">销量对比' +
          (opts.rank ? '<span class="sales-rank">No.' + opts.rank + '</span>' : "") +
        '</div>' +
        '<div class="sales-bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="sales-num">本期收录机型对比 · 月销约 ' + (kit.salesVolume || 0) + ' 台</div>' +
      '</div>';

    card.addEventListener("click", () => {
      if (typeof opts.onOpen === "function") opts.onOpen(kit);
      else location.href = "detail.html?id=" + kit.id;
    });

    return card;
  },

  // 成功态：把一列机体渲染进容器（会先清空容器；销量条按本期最高销量等比画）
  renderList(container, kits, opts = {}) {
    const maxSales = kits.length ? Math.max(...kits.map(k => k.salesVolume || 0)) : 0;
    const bySales = [...kits].sort((a, b) => (b.salesVolume || 0) - (a.salesVolume || 0));

    container.innerHTML = "";
    for (const kit of kits) {
      const rank = bySales.findIndex(k => k.id === kit.id) + 1;
      container.appendChild(this.create(kit, Object.assign({}, opts, { maxSales, rank })));
    }
  },

  // 加载态：渲染 count 张骨架占位卡片（灰色线条闪动）
  renderSkeleton(container, count = 3) {
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const sk = document.createElement("div");
      sk.className = "card skeleton";
      sk.innerHTML =
        '<div class="sk-line sk-tag"></div>' +
        '<div class="sk-line sk-title"></div>' +
        '<div class="sk-line sk-price"></div>' +
        '<div class="sk-line sk-bar"></div>';
      container.appendChild(sk);
    }
  }
};
