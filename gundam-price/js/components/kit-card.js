// kit-card.js ｜ 可复用组件：一台机体 → 一张卡片 / 一列卡片 / 加载占位卡片
// ---------------------------------------------------------------------------
// 怎么用（页面里引一次脚本，然后调方法）：
//   <script src="js/components/kit-card.js"></script>
//
//   KitCard.renderList(容器, 机体数组, { rate: 汇率 })   // 成功态：渲染卡片列表
//   KitCard.renderSkeleton(容器, 3)                      // 加载态：渲染骨架卡片
//   KitCard.create(单台机体, { rate, onOpen })           // 单张卡片，返回 DOM 节点
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

  // ---- 历史价格工具（Day 10 走势图用，首页卡片与详情页共用） ----

  // 近 N 天（默认 30）的历史价序列：过滤无效项后按日期升序排好
  historySeries(kit, days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return (kit.history || [])
      .filter(h => h && typeof h.price === "number" && new Date(h.date + "T00:00:00").getTime() >= cutoff)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  },

  // 近 N 天的最低价那条记录：{ date, price }，没有历史返回 null
  historyMin(kit, days = 30) {
    const series = this.historySeries(kit, days);
    if (series.length === 0) return null;
    return series.reduce((min, h) => (h.price < min.price ? h : min), series[0]);
  },

  // 最低现价区间："¥230 ~ ¥300"；一个价就只显示一个；没报价给提示文案
  priceRange(prices) {
    if (prices.length === 0) return "暂无报价";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? "¥" + min : "¥" + min + " ~ ¥" + max;
  },

  // 造一张卡片，返回 DOM 节点（不改动页面，方便将来放进别的容器里）
  // opts: { rate 汇率, onOpen 点击回调 }
  create(kit, opts = {}) {
    const rate = opts.rate;
    const prices = this.validPrices(kit);
    const base = this.fiveKBase(kit.officialPriceJPY, rate);
    const tier = prices.length ? this.tierOf(Math.min(...prices), base) : null;
    // Day 10 修改：卡片底部对比条由「销量对比」换成「价格对比」
    // 原因：月销量是 data.json 里手动录入的估计值（salesVolume），没有真实来源，
    //       且本期只收录 3 台、价位段不同，拿销量排名容易误导，故整块撤掉。
    // 新逻辑：以「1.2 × 五算基准」（溢价线）为满格，条宽 = 最低现价占满格的比例；
    //         条上的竖线 = 五算基准位置（1 ÷ 1.2 ≈ 83.33%），条没到竖线就是捡漏。
    const minPrice = prices.length ? Math.min(...prices) : null;
    const pct = (minPrice !== null && base > 0)
      ? Math.min(100, Math.round(minPrice / (base * 1.2) * 100))
      : 0;

    // Day 11：卡片顶部头雕横幅（图片加载失败自动换成文字占位，不出现裂图）
    // Day 11 补充：每台机体的头部位置不同，imagePos 单独控制横幅对准哪里（默认 center 18%）
    const banner = kit.image
      ? '<div class="card-banner"><img src="img/' + kit.image + '" alt="' + kit.name + ' 头雕" loading="lazy"' +
        ' style="object-position:' + (kit.imagePos || "center 18%") + '"' +
        ' onerror="this.parentNode.innerHTML=\'<div class=&quot;card-banner-ph&quot;>暂无图片</div>\'"></div>'
      : '<div class="card-banner"><div class="card-banner-ph">' + kit.series + '</div></div>';

    const card = document.createElement("div");
    card.className = "card";
    // Day 9：让键盘 Tab 能聚焦到卡片，按 Enter 等同点击（功能不变，只是多了键盘入口）
    card.tabIndex = 0;
    // Day 10：有历史数据时多显示一行「近 30 天最低」
    const hist = this.historyMin(kit);
    card.innerHTML = banner +
      '<div class="card-body">' +
        '<div class="card-top">' +
          '<span class="series">' + kit.series + '</span>' +
          (tier ? '<span class="tier tier-small ' + tier.cls + '">' + tier.label + '</span>' : "") +
        '</div>' +
        '<h2>' + kit.name + '</h2>' +
        '<div class="price">' + this.priceRange(prices) + '</div>' +
        (hist ? '<div class="hist-min">近 30 天最低 ¥' + hist.price + '（' + hist.date + '）</div>' : "") +
        '<div class="sales">' +
        '<div class="sales-label">价格对比<span class="sales-hint">竖线 = 五算基准</span></div>' +
        '<div class="sales-bar"><span style="width:' + pct + '%"></span><i class="base-mark"></i></div>' +
        '<div class="sales-num">' + (minPrice !== null
          ? "最低现价 ¥" + minPrice + " · 五算基准 ¥" + base
          : "暂无报价，无法对比") + '</div>' +
      '</div>' +
    '</div>';

    card.addEventListener("click", () => {
      if (typeof opts.onOpen === "function") { opts.onOpen(kit); return; }
      // Day 11：立体翻转过场——卡片先绕竖轴翻转 90°，再进详情页
      card.classList.add("flipping");
      setTimeout(() => { location.href = "detail.html?id=" + kit.id; }, 300);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") card.click();
    });

    return card;
  },

  // 成功态：把一列机体渲染进容器（会先清空容器；Day 10 起卡片底部为价格对比条）
  renderList(container, kits, opts = {}) {
    container.innerHTML = "";
    for (const kit of kits) {
      container.appendChild(this.create(kit, opts));
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
