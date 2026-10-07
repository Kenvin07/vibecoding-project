// lib/constants.js ｜ 常量集中营
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构
// 原来这些常量散在 index.js 各处，现在集中到一层：**改行为改这里，不用翻逻辑**。
// 值与含义和重构前逐字一致 —— 重构铁律：只搬家，不改行为。
// ---------------------------------------------------------------------------

// 汇率：全站一份，五算计算用。
// 契约 2.4 的 app_meta 表今天还没建（今天不做改表结构），所以先放代码常量，
// 值与 data/data.json 一致。等 app_meta 建好后改成从库里读 —— 契约第 6 节已登记。
const EXCHANGE_RATE = 0.048;

// 枚举值：与建表时的 CHECK 约束保持一致（契约 2.2）
const PLATFORMS = ['pdd', 'taobao', 'xianyu'];
const MARKET_TYPES = ['行货', '水货'];

// 机体系列：读接口 series 参数只认这两个
//（建表时故意没给 series 加约束，这份白名单归接口这层管）
const SERIES_ALLOWED = ['MG', 'MGEX'];

// 列表接口的 limit 上限：现在总共十几行数据，纯防呆用
const MAX_LIMIT = 500;

// keyword 最长长度（防呆，不是防注入——输入根本不进查询语句）
const MAX_KEYWORD = 30;

// 写接口密钥的请求头名字。
// 代码里只有「头叫什么」，密钥的值来自环境变量 WRITE_API_KEY —— 值和代码分离，
// 这样密钥永远进不了代码库，也不会被截图/日志带出去。
const WRITE_KEY_HEADER = 'x-api-key';

// 请求体大小上限：一条价格记录就几百字节，64KB 纯属防呆
const MAX_BODY = 64 * 1024;

module.exports = {
  EXCHANGE_RATE,
  PLATFORMS,
  MARKET_TYPES,
  SERIES_ALLOWED,
  MAX_LIMIT,
  MAX_KEYWORD,
  WRITE_KEY_HEADER,
  MAX_BODY,
};
