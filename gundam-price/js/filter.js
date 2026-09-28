// filter.js ｜ Day 12 筛选交互（关键词 + 平台双条件）
// ---------------------------------------------------------------------------
// 用户在首页做两件事：① 输入关键词（按机体名/系列搜）② 选平台（拼多多/淘宝/闲鱼）
// 两个条件是「同时满足」的关系：都填了就要两个都对上才显示。
//
// 三种状态（对应今天的三个测试用例）：
//   ① 有结果  → 只显示命中的卡片，上方显示「找到 N 台」
//   ② 无结果  → 显示「没有找到相关内容」
//   ③ 清空    → 关键词清空 + 平台回「全部」，恢复完整列表
//
// 怎么用（页面里引一次脚本，然后调方法）：
//   Filter.init({ listEl, data, rate })   // 绑定输入/下拉事件
//   Filter.apply()                        // 手动重算一次
//   Filter.hasAny(channels)               // 这台机体有没有该渠道的报价
//
// Skill 回查：本文件按 skills/frontend-design/SKILL.md 逐条自检过，
//   记录见该文件「四、使用记录」的 2026-09-28 条目。

const Filter = {

  // 目前生效的条件（页面初始化时为空 = 显示全部）
  state: {
    keyword: "",
    platform: ""     // "" = 全部平台
  },

  // 完整数据（筛选不会改动它，只挑其中一部分来渲染）
  data: null,
  listEl: null,
  countEl: null,

  // 平台代号 → 中文名（与 KitCard.PLATFORM_NAMES 保持一致；这里只用于下拉框之外的地方）
  PLATFORMS: [
    { code: "", name: "全部平台" },
    { code: "pdd", name: "拼多多" },
    { code: "taobao", name: "淘宝" },
    { code: "xianyu", name: "闲鱼" }
  ],

  // 这台机体有没有收录指定渠道的报价（平台为空 = 不限制）
  hasAny(channels, platform) {
    if (!platform) return true;
    return (channels || []).some(c => c.platform === platform);
  },

  // 关键词是否命中：机体名或系列名里包含关键词（不区分大小写）
  matchKeyword(kit, keyword) {
    if (!keyword) return true;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    const hay = (kit.name + " " + kit.series).toLowerCase();
    return hay.indexOf(kw) !== -1;
  },

  // 按当前条件挑出要显示的机体
  matches() {
    const kits = (this.data && this.data.kits) || [];
    const kw = this.state.keyword;
    const pf = this.state.platform;
    return kits.filter(kit => this.matchKeyword(kit, kw) && this.hasAny(kit.channels, pf));
  },

  // 重算并重画列表
  apply() {
    const listEl = this.listEl;
    const countEl = this.countEl;
    const kits = (this.data && this.data.kits) || [];
    const hit = this.matches();
    const rate = this.data.meta.exchangeRate;

    if (hit.length === 0) {
      // ② 无结果
      listEl.innerHTML =
        '<div class="state-box" role="status">' +
          '<div class="state-emoji" aria-hidden="true">🔍</div>' +
          '<div class="state-title">没有找到相关内容</div>' +
          '<div class="state-desc">试试换个关键词，或把平台切回「全部平台」。</div>' +
        '</div>';
      if (countEl) countEl.textContent = "没有找到相关内容";
      return;
    }

    // ① 有结果 / ③ 清空后恢复（都是走这一条：没条件就命中全部）
    KitCard.renderList(listEl, hit, { rate: rate });
    if (countEl) {
      const isAll = hit.length === kits.length;
      countEl.textContent = isAll
        ? "本期收录 " + kits.length + " 台机体"
        : "找到 " + hit.length + " 台机体（共 " + kits.length + " 台）";
    }
    // 每次重画后给列表一个轻微淡入，提示「列表变了」（Skill E2：动效服务于语义）
    // 尊重系统「减少动态效果」偏好（Skill E4）
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      listEl.classList.remove("list-fade");
      void listEl.offsetWidth; // 强制重算，动画才会重播
      listEl.classList.add("list-fade");
    }
  },

  // 绑定事件：输入框边打字边筛，下拉一变就筛
  init(opts) {
    this.data = opts.data;
    this.listEl = opts.listEl;
    this.countEl = opts.countEl || null;

    const kwInput = document.getElementById("filter-keyword");
    const pfSelect = document.getElementById("filter-platform");

    if (kwInput) {
      kwInput.addEventListener("input", () => {
        this.state.keyword = kwInput.value;
        this.apply();
      });
    }
    if (pfSelect) {
      pfSelect.addEventListener("change", () => {
        this.state.platform = pfSelect.value;
        this.apply();
      });
    }

    this.apply(); // 初始化时先渲染一次（此时无任何条件 = 完整列表）
  },

  // 清空所有条件并恢复完整列表（给「清空」按钮用）
  clear() {
    this.state.keyword = "";
    this.state.platform = "";
    const kwInput = document.getElementById("filter-keyword");
    const pfSelect = document.getElementById("filter-platform");
    if (kwInput) kwInput.value = "";
    if (pfSelect) pfSelect.value = "";
    this.apply();
  }
};
