// repositories/kitsRepository.js ｜ kits 表（机体表）的数据访问
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② —— 今天新拆出来的「数据访问层」
//
// 【这一层存在的意义】
//   上层（services）只会说「给我机体列表」「给我 id=xxx 那台」这种人话；
//   至于去哪张表、怎么发请求、钥匙放哪，全在这一层和 db/gateway.js 里解决。
//   以后调字段、换查询方式，只在 repositories/ 里找，不用翻业务代码。
//
// 【表结构出处】db/schema.sql 的 public.kits（契约 2.1）
// 【一个方法 = 一次查询】这一层的函数故意做得很薄，不掺任何业务判断 ——
//   筛选、排序、组装全在 services 层做（和重构前的分工保持一致）。
// ---------------------------------------------------------------------------

const gateway = require('../db/gateway');

// 取回全部机体行（原始行，字段原样，不做任何加工）
// 重构前对应：fetchKits 里的 gwGet('/kits')
async function listKits() {
  return gateway.get('kits');
}

// 按 id 找一台机体；找不到返回 null（不是抛错 —— 要不要当成 404 由上层决定）
// 重构前对应：createPrice 第 ④ 步的 `gwGet('/kits')` + `.some(...)` 判断
async function findKitById(id) {
  const rows = await gateway.get('kits');
  return rows.find((r) => r.id === id) || null;
}

module.exports = { listKits, findKitById };
