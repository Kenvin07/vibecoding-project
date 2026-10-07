// lib/errors.js ｜ 两种「故意抛出来的错」
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构（原 index.js 里两个 class 原样搬来）
//
// 为什么要分两种：
//   HttpError   —— 参数/请求本身的问题（400/401/404/409），措辞可以直接告诉调用方；
//   ConfigError —— 服务端自己没配好（缺环境变量），属于运维问题，
//                  公网上只说「服务异常」，细节只写日志。
// 接入层（index.js）靠 instanceof 分辨这两种，所以它俩必须只有一份定义 ——
// 放在 lib/ 里、谁用谁 require，才能保证全项目是同一个 class。
// ---------------------------------------------------------------------------

class ConfigError extends Error {
  constructor(missing) {
    super('缺少环境变量 ' + (missing || 'CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY'));
  }
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { ConfigError, HttpError };
