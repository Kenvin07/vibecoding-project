// ===========================================================================
// version.js ｜ 页脚版本徽标（Day 26 发布 v1.0 时新增）
// ===========================================================================
// 【它解决什么问题】
//   发布和回滚都要回答同一个问题：「现在公网上跑的是哪一版？」
//   肉眼看页面看不出来；把版本号写死在 HTML 里也不可靠 —— HTML 会被整个覆盖。
//   所以版本号只在 version.json 里写一次（由发布脚本生成），本脚本负责读出来显示。
//
// 【为什么这样就能当回滚证据】
//   徽标显示的内容来自线上那份 version.json：
//     线上是 v1.0 包 → 徽标显示 v1.0.0
//     回退到 v0.9 包 → 旧包没有本脚本、也没有徽标（徽标消失本身就是证据）
//     恢复 v1.0 包   → 徽标回来，且版本号一致
//
// 【依赖】同目录上一级的 version.json；取不到时只显示一句人话，不影响页面其它功能。
// ===========================================================================
(function () {
  "use strict";

  var SELECTOR = "[data-app-version]";
  var TEXT_LOADING = "版本读取中…";
  var TEXT_FALLBACK = "版本信息未取到（离线预览时属正常）";

  function paint(text) {
    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = text;
    }
  }

  function describe(data) {
    if (!data || !data.version) throw new Error("version.json 缺少 version 字段");
    var channel = data.channel === "stable" ? "正式版" : "预发布";
    var date = data.releasedAt ? " · " + data.releasedAt : "";
    return "v" + data.version + date + " · " + channel;
  }

  function boot() {
    if (!document.querySelector(SELECTOR)) return;
    paint(TEXT_LOADING);
    // 时间戳绕开缓存：刚发布完立刻刷新就能看到新版本号，不用等缓存过期
    var url = "version.json?t=" + Date.now();
    fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        paint(describe(data));
      })
      .catch(function (err) {
        // 失败只说人话：技术原因进控制台，不糊到页面上
        if (window.console && console.warn) console.warn("[version]", err);
        paint(TEXT_FALLBACK);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
