// lib/validators.js ｜ 参数校验与取值小工具
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构
//       原 index.js 的 readInt / readDate / readText / readEnum /
//       isRealDate / nextPriceId 原样搬来，逻辑一字未改。
//       Day 22 追加：nextCheckinId（打卡 id 生成）、readFlag（布尔开关参数），
//       均为新增函数，原有几个一字未动。
//
// 共同套路：能读到就返回，读不到就给默认值，**格式不对就抛 HttpError(400)** ——
// 抛出去由接入层统一翻成「400 + 中文提示」，所以这里只管判断，不管怎么回复。
// ---------------------------------------------------------------------------

const { HttpError } = require('./errors');

// 读一个可选的整数参数（limit / offset 用）
// 不传 → 返回 fallback；传了但不是正整数 / 超范围 → 抛 400
function readInt(sp, name, fallback, min, max) {
  const raw = sp.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 必须是正整数');
  }
  const n = Number(raw);
  if (n < min || n > max) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 的取值范围是 ' + min + ' ~ ' + max);
  }
  return n;
}

// 读一个可选的日期参数（YYYY-MM-DD），格式不对抛 400
function readDate(sp, name) {
  const raw = sp.get(name);
  if (raw === null || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 的格式必须是 YYYY-MM-DD');
  }
  return raw;
}

// 读一个可选字符串参数，顺手把首尾空格去掉
function readText(sp, name) {
  const raw = sp.get(name);
  if (raw === null) return null;
  const v = raw.trim();
  return v === '' ? null : v;
}

// 枚举参数校验（platform / marketType / series 这类）
function readEnum(sp, name, allowed) {
  const v = readText(sp, name);
  if (v === null) return null;
  if (!allowed.includes(v)) {
    throw new HttpError(400, 'INVALID_PARAM', name + ' 只能是 ' + allowed.join(' / '));
  }
  return v;
}

// 这真的是一个存在的日期吗？
// 光看格式（四个数字-两个数字-两个数字）不够：2026-02-30 格式完全正确，
// 但 2 月没有 30 号。办法是交给 Date 解析一次，再把结果转回 YYYY-MM-DD
// 跟原文比一比 —— 对得上才算真日期（2 月 30 号会被自动挪成 3 月 2 号，一比就露馅）。
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// 生成下一个记录 id：沿用库里现有的 pr_0001 风格（契约 2.2 就是这么登记的）。
// 取「所有长得像 pr_数字 的 id 里最大的那个」+1，补足 4 位。
// 库里一条这样的 id 都没有时，从 pr_0001 开始。
function nextPriceId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = /^pr_(\d+)$/.exec(String(r && r.id));
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return 'pr_' + String(max + 1).padStart(4, '0');
}

// 生成下一个打卡 id（Day 22）：与 nextPriceId 同一套做法，前缀换成 ck_。
// 为什么不复用 nextPriceId 加个前缀参数：那个函数是 Day 18 已验收的代码，
// 不去动它；这里多十行重复代码，换来「原来好的东西一行没变」。
function nextCheckinId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = /^ck_(\d+)$/.exec(String(r && r.id));
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return 'ck_' + String(max + 1).padStart(4, '0');
}

// 读一个可选的布尔开关参数（如 includeDeleted）。
// 只有明确写 true / 1 才算真；其余（不传、false、空串）一律返回 fallback。
// 为什么要这个函数：GET /api/checkins 默认要「跳过软删除的行」，
// 只有显式带上 includeDeleted=true 时才把删掉的那些也列出来。
function readFlag(sp, name, fallback) {
  const raw = sp.get(name);
  if (raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

module.exports = { readInt, readDate, readText, readEnum, isRealDate, nextPriceId, nextCheckinId, readFlag };
