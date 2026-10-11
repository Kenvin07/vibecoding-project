// repositories/checkinsRepository.js ｜ checkins 表（巡查打卡表）的数据访问
// ---------------------------------------------------------------------------
// 产出：Day 22（第 4 周）· 板块① PATCH / DELETE 实现
//
// 这一层只认表、只干「怎么读写 checkins」，不含任何业务判断
// （不判断「这条打卡合不合法」「id 存不存在」——那是 services 的事）。
//
// 【表结构出处】db/schema.sql 的 public.checkins（契约 2.5）
//   "kitId" 外键 → kits.id（ON DELETE CASCADE）
//   部分唯一索引 checkins_unique_active_day：("kitId","checkinDate") 只对
//   "isDeleted" = false 的行唯一 —— 也就是「同机体同一天只允许有一条还活着的打卡」。
//
// 三个方向：
//   读：listCheckins()          —— 把表里的行整批取回来
//   增：insertCheckin(row)      —— 插一行，返回插进去之后的完整记录
//   改：updateCheckin(id, val)  —— 按 id 改若干列，返回改完之后的记录
//                                 ★软删除（把 "isDeleted" 置 true）也走这一个方法
//
// 【为什么不单独写一个 deleteCheckin】因为本期的删除是【软删除】：它不删行，
//   只是把 "isDeleted" 这一列从 false 改成 true —— 从数据库角度看，它就是一次
//   普通的修改。所以不需要网关层的 DELETE 能力，updateCheckin 一个方法就够。
//   （这也是软删除的一个副作用：接口层少了一个方法，但读接口必须多一层过滤。）
// ---------------------------------------------------------------------------

const gateway = require('../db/gateway');

// 取回全部打卡行（原始行，字段原样）
// 与 kitPricesRepository.listPrices() 同一套做法：整表取回，筛选交给业务层内存里做。
// 本期数据量极小（种子 5 行），这样最省事，也避免在网关侧拼复杂查询。
async function listCheckins() {
  return gateway.get('checkins');
}

// 插入一条打卡记录，返回插入后的完整记录（含云端生成的 "createdAt"）
async function insertCheckin(row) {
  return gateway.post('checkins', row);
}

// 按 id 改若干列，返回改完之后的完整记录。
// patch 是「列名 → 新值」的对象，如 { status: '已完成', note: '已核对' }
// 或软删除用的 { "isDeleted": true }。
// 只改传进来的列，没传的列原样不动 —— 这正是 PATCH 的语义（局部修改），
// 也是「只传要改的字段」能成立的原因。
async function updateCheckin(id, patchObj) {
  return gateway.patch('checkins', { id: id }, patchObj);
}

module.exports = { listCheckins, insertCheckin, updateCheckin };
