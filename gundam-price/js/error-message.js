// error-message.js ｜ 把「技术异常」翻译成「三类中文人话」（Day 23 新增）
// ===========================================================================
// 【为什么要有这个文件】
//   Day 23 之前，前端各处自己拼错误文案，风格不统一，还会把技术术语漏给用户：
//     · "连不上服务器（Failed to fetch）"        ← 括号里是浏览器原话，英文
//     · "服务器返回的不是合法 JSON（HTTP 502）"  ← JSON / HTTP 502 是术语
//     · "HTTP 500"                               ← 光一个状态码，等于没说
//   用户看到这些只会懵。今天把这些「技术话」收进这一个文件，
//   统一翻成三类中文提示 —— 想改文案只改这里一处。
//
// 【三类错误，是今天定的标准】
//   ① INPUT   输入错   —— 你填/点错了（400、409，或前端校验不通过）
//                         这类后端本来就给中文说明，直接用它，不遮不掩
//   ② NETWORK 网络错   —— 根本没连上（断网 / 域名解析失败 / 跨域被拦）
//   ③ SERVER  服务端错 —— 连上了，但对方处理不了（5xx、坏 JSON、意外状态码）
//
// 【关键设计：技术细节不删，只是挪窝】
//   面向用户的那句话给「人话」，原始的英文异常/状态码/错误码写给 console。
//   用户看不懂的不给他看；你要排查时按 F12，原始信息一条不少。
//   这样「好懂的提示」和「可排查的细节」两件事同时成立，不是二选一。
// ===========================================================================

// 三类错误的「面向用户」文案 —— 全站唯一的文案源
const MESSAGES = {
  // ① 输入错：默认兜底文案（多数情况会用后端给的具体说明）
  INPUT: '填写的内容不符合要求，请检查后重试',
  // ② 网络错：不说「Failed to fetch」，只说人能做到的事 —— 检查网络、重试
  NETWORK: '连不上服务器，请检查网络后重试',
  // ③ 服务端错：不说 5xx/JSON，只说「不是你的问题，等等再试」
  SERVER: '服务器暂时无法处理请求，请稍后重试',
};

// 判定「HTTP 状态码」属于哪一类。
// 为什么这样分：
//   4xx = 「你这边的问题」（参数错、密钥错、找不到、重复）→ 归为输入错，
//         因为这类错误后端都给了能直接照做的中文说明；
//   5xx = 「服务端自己的问题」→ 归为服务端错，这类细节不能外露。
//   0   = 前端自己造的「没连上」标记（见 api.js）→ 网络错。
function classify(status) {
  if (status === 0) return 'NETWORK';
  if (typeof status === 'number' && status >= 500) return 'SERVER';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'INPUT';
  return 'SERVER'; // 状态码缺失/异常，一律当作服务端问题，最保守
}

// 主函数：吃一个 Error，吐一句能直接显示给用户的中文。
// 约定：Error 上会带三个字段（由 api.js 的 apiError 挂上）
//   e.status —— HTTP 状态码，如 400 / 500 / 0
//   e.code   —— 后端错误码，如 INVALID_PARAM
//   e.message—— 可能是人话，也可能是技术原话
function toUserMessage(err) {
  const status = err && typeof err.status === 'number' ? err.status : null;
  const code = (err && err.code) || null;
  const kind = classify(status);

  // ① 输入错：优先直接用后端的中文说明（它写得比我们猜的准）
  //    只有在后端没给 message 时才退回默认文案。
  if (kind === 'INPUT') {
    const msg = err && err.message ? String(err.message).trim() : '';
    // 排除三种「看起来不像人话」的情况，退回默认文案：
    //   a. 空字符串
    //   b. 纯状态码，如 "HTTP 400" —— 说了等于没说
    //   c. 技术原话：含英文异常名（Failed to fetch / TypeError 等）
    //   d. 字符串化的空值："null" / "undefined" / "NaN"
    //      （来源：new Error(null) 会把 null 转成字符串 "null"，实测踩过，
    //        不加这条护栏用户就会看到字面上的 "null"）
    const looksLikeNull = /^(null|undefined|NaN|false)$/i.test(msg);
    const looksLikeStatusOnly = /^HTTP \d+$/.test(msg);
    const looksTechnical = /Failed to fetch|TypeError|SyntaxError|NetworkError/i.test(msg);
    if (msg && !looksLikeNull && !looksLikeStatusOnly && !looksTechnical) {
      return msg;
    }
    return MESSAGES.INPUT;
  }

  // ② 网络错 / ③ 服务端错：一律用固定人话，细节进 console
  return MESSAGES[kind];
}

// 把技术细节整理成一行，交给 console。
// 【为什么单独一个函数】把「给用户看什么」和「给开发者看什么」彻底分开，
// 以后想改日志格式（比如加时间戳），也只改这里。
function toDebugDetail(err) {
  const status = err && typeof err.status === 'number' ? err.status : null;
  const code = (err && err.code) || null;
  const raw = err && err.message ? String(err.message) : '(无 message)';
  const parts = [];
  if (status !== null) parts.push('HTTP ' + status);
  if (code) parts.push('code=' + code);
  parts.push('原始信息: ' + raw);
  return parts.join(' | ');
}

// 一句话合成：既把中文显示给用户，又把细节写进 console。
// 调用方只需要 await API.getKits() 出错时喊一声 showError(err) 就够了，
// 不用每个页面都自己写一遍 console.error。
function report(err) {
  const userText = toUserMessage(err);
  if (typeof console !== 'undefined' && console.error) {
    console.error('[错误] ' + userText + '　←　' + toDebugDetail(err));
  }
  return userText;
}

// 【今天新增的调试开关】地址栏加 ?err=network / server / input，
// 让「网络错」「服务端错」这类平时难以自然复现的错误，可以随时演出来。
// 用途：① 验收时逐类截图；② 以后改文案时快速预览效果。
// 【安全说明】它只在页面加载时读一个参数、伪造一个本地错误，
//   不发任何请求、不碰数据。正式访问不带这个参数就完全不起作用。
function forcedErrorKind() {
  try {
    const v = new URLSearchParams(location.search).get('err');
    if (v === 'network' || v === 'server' || v === 'input') return v.toUpperCase();
  } catch (e) {
    // location 不可用时（如被当作模块在非浏览器环境加载）静默跳过
  }
  return null;
}

// 造一个「假装出来的错误」，字段形状与 api.js 的真错误一致，
// 好让上层代码走的是同一条渲染路径 —— 预览到的就是真实效果。
function makeForcedError(kind) {
  if (kind === 'NETWORK') {
    const e = new Error('Failed to fetch');
    e.status = 0;
    e.code = 'NETWORK_ERROR';
    return e;
  }
  if (kind === 'INPUT') {
    const e = new Error('price 必须是不小于 0 的整数（暂无报价就不传）');
    e.status = 400;
    e.code = 'INVALID_PARAM';
    return e;
  }
  // SERVER
  const e = new Error('Internal Server Error');
  e.status = 500;
  e.code = 'INTERNAL_ERROR';
  return e;
}

// 导出为全局对象 Errs（英文 errors 的缩写），
// 这样 index.html / detail.html / calc.html 引一个 <script> 就能用，
// 与项目里 KitCard / API / Filter 的做法保持一致（本项目不用打包工具）。
var Errs = {
  MESSAGES: MESSAGES,
  classify: classify,
  toUserMessage: toUserMessage,
  toDebugDetail: toDebugDetail,
  report: report,
  forcedErrorKind: forcedErrorKind,
  makeForcedError: makeForcedError,
};

// 供 Node 环境（桩自检脚本）读取
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Errs;
}
