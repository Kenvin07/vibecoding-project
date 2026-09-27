// favorite.js ｜ Day 11 收藏交互（localStorage 本地记忆版）
// ---------------------------------------------------------------------------
// 收藏状态存在浏览器的 localStorage 里：同一台电脑、同一个浏览器，刷新/关机都在。
// 换浏览器或清除网站数据会丢；真正跨设备保存要等将来接后端。
//
// 按钮的四个状态（状态机）：
//   未收藏(☆ 收藏) --点击--> 处理中(⏳ 保存中…，按钮禁用)
//     --成功--> 已收藏(★ 已收藏，金色) + 绿色气泡「已收藏」
//     --失败--> 弹回原状态 + 红色气泡「收藏失败/取消收藏失败」+ 按钮抖一下
//   已收藏 --再点击--> 处理中 --成功--> 未收藏 + 气泡「已取消收藏」
//
// 怎么测「失败」：真实网络错误现在模拟不了（没有后端），
//   办法 ①：按住 Shift 再点收藏按钮 → 这一次保存必定失败（每次都只失败一次）
//   办法 ②：按 F12 打开控制台，输入 Favorite.armFail() 回车，效果相同

const Favorite = {

  // 已收藏机体的 id 集合（Set 有天生去重的好处：同一台机体不会存两次）
  ids: new Set(),

  // 收藏记录在 localStorage 里的钥匙（起个不会跟别人撞名的名字）
  STORE_KEY: "gundam-price-favs",

  // 一次性失败开关：置 true 后，下一次保存必定失败，用完自动复位
  failOnce: false,

  // 页面打开时调用：把上次的收藏从 localStorage 读回来
  load() {
    try {
      const raw = localStorage.getItem(this.STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) arr.forEach(id => this.ids.add(String(id)));
    } catch (e) {
      // 记录坏了（比如被手动改过）就当没收藏过，别让整页崩掉
      console.warn("读取收藏记录失败，按空开始：", e.message);
    }
  },

  // 把当前收藏集合写进 localStorage（Set 转数组再转 JSON 字符串）
  persist() {
    try {
      localStorage.setItem(this.STORE_KEY, JSON.stringify([...this.ids]));
    } catch (e) {
      console.warn("收藏记录写入本地存储失败：", e.message);
    }
  },

  // 测试辅助：让下一次点击模拟失败（也可以直接按住 Shift 点按钮，效果相同）
  armFail() {
    this.failOnce = true;
  },

  isFav(id) {
    return this.ids.has(id);
  },

  // 模拟「把收藏存到服务器」：等 400ms 再返回成功/失败，假装有一次网络往返。
  // 将来接了后端，只要把这个函数换成真正的 fetch 就行，按钮逻辑一行不用改。
  save() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.failOnce) {
          this.failOnce = false;
          reject(new Error("模拟网络错误"));
        } else {
          resolve();
        }
      }, 400);
    });
  },

  // 核心：切换某台机体的收藏状态
  // kitId：机体 id；btn：被点的那个按钮（用来改文字、加锁防连点）
  async toggle(kitId, btn) {
    // 防连点：处理中再点直接忽略（dataset.busy 是挂在按钮上的临时标记）
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.disabled = true; // disabled 也会挡掉鼠标点击，双保险

    const starEl = btn.querySelector(".fav-star");
    const textEl = btn.querySelector(".fav-text");
    const wasFav = this.isFav(kitId);
    const prevText = textEl.textContent;
    textEl.textContent = "保存中…";

    try {
      await this.save(); // 等 400ms 模拟网络
      if (wasFav) {
        // 取消收藏
        this.ids.delete(kitId);
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
        starEl.textContent = "☆";
        textEl.textContent = "收藏";
        this.toast("已取消收藏", "ok");
      } else {
        // 收藏成功
        this.ids.add(kitId);
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        starEl.textContent = "★";
        textEl.textContent = "已收藏";
        this.toast("已收藏", "ok");
      }
      this.persist(); // 成功才落盘：写进 localStorage，刷新后还在
      // 收藏/取消都给一个「弹一下」的动效反馈
      this.replay(btn, "pop");
    } catch (err) {
      // 失败：按钮弹回原来的样子（没收藏还是没收藏），文字恢复，再抖一下
      textEl.textContent = prevText;
      this.replay(btn, "shake");
      // 提示语跟着动作走：想收藏失败叫「收藏失败」，想取消失败叫「取消收藏失败」
      this.toast(wasFav ? "取消收藏失败，请重试" : "收藏失败，请重试", "err");
      console.warn("收藏保存失败：", err.message);
    } finally {
      // 不管成功失败，最后都解锁按钮
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  },

  // 重新触发一次 CSS 动画：先移除类、强制浏览器算一次布局、再加回去
  replay(btn, cls) {
    btn.classList.remove(cls);
    void btn.offsetWidth; // 这一行就是「强制重算」，没有它动画不会重播
    btn.classList.add(cls);
  },

  // 页面底部的气泡提示（同一时间只显示一条，新的会顶掉旧的）
  toast(msg, type) {
    let el = document.querySelector(".fav-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "fav-toast";
      document.body.appendChild(el);
    }
    // 清掉上一次还没播完的隐藏计时器，避免气泡闪一下就消失
    if (this._timer) clearTimeout(this._timer);
    el.textContent = msg;
    el.className = "fav-toast show " + (type || "ok");
    this._timer = setTimeout(() => {
      el.classList.remove("show");
    }, 1800);
  }
};

// 脚本一加载就把上次的收藏读回来（要在卡片渲染之前，按钮才能亮对状态）
Favorite.load();
