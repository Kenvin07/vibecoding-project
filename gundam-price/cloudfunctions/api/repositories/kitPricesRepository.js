// repositories/kitPricesRepository.js ｜ kit_prices 表（渠道价格记录表）的数据访问
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② —— 今天新拆出来的「数据访问层」
//
// 这是核心记录表（数据主要长在这张表上），所以它有两个方向：
//   读：listPrices()      —— 把表里的行全取回来
//   写：insertPrice(row)  —— 插一行，并把「插进去之后的样子」拿回来
//
// 【表结构出处】db/schema.sql 的 public.kit_prices（契约 2.2）
//   唯一约束 kit_prices_unique_channel（机体+渠道+类型+日期 不重复）
//   外键 "kitId" → kits.id
//   这两条数据库自己的规矩，写库时由数据库兜底；接口层再做一道前置校验给「人话」提示。
// ---------------------------------------------------------------------------

const gateway = require('../db/gateway');

// 取回全部价格记录行（原始行，字段原样）
// 重构前对应：fetchKits 里的 gwGet('/kit_prices')、fetchPrices 里的 gwGet('/kit_prices')、
//             createPrice 第 ⑤ 步查重用的 gwGet('/kit_prices') —— 三处并成这一个方法。
async function listPrices() {
  return gateway.get('kit_prices');
}

// 插入一条价格记录，返回插入后的完整记录（含云端生成的 createdAt）
// 重构前对应：createPrice 第 ⑦ 步的 gwPost('/kit_prices', {...})
async function insertPrice(row) {
  return gateway.post('kit_prices', row);
}

module.exports = { listPrices, insertPrice };
