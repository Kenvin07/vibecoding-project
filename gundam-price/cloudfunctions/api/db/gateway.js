// db/gateway.js ｜ 数据网关客户端（最底层：只管「怎么跟 CloudBase 说话」）
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构
// 【这段代码从哪搬来的】
//   原来住在 index.js 第 74–175 行（那一段标题叫「一、数据网关客户端」），
//   现在整段搬到 db/gateway.js。代码一字未改，只把 gwGet→get、gwPost→post。
//
// 【这一层管什么 / 不管什么】
//   管：拼网址、带钥匙（Authorization 头）、发请求、超时、把原始行 JSON 解析出来。
//   不管：数据是什么意思、要筛选什么、结果长什么样 ——
//         它只认「表名」，对上层的业务一无所知。这就是「数据访问」和「业务」的分界线。
//
// 【数据怎么拿 · Day 17 定稿】
//   走 CloudBase 官方「数据网关」REST API（PostgREST 风格）：
//     https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/<表名>
//   为什么不直连数据库：控制台目前不展示直连用的「连接信息」（社区已确认是功能缺口，
//   免费档还可能没有网络入口）；网关是官方长期支持的正路，用 API Key 开门，
//   不需要数据库密码 —— 凭证面更小，也不用装任何驱动（Node 自带 fetch）。
//
// 【防注入】用户输入【根本不进查询语句】—— 全部经过 URLSearchParams 编码，
//   或干脆在服务端内存里过滤（本期数据量极小）。效果和参数化一样：
//   用户输入和查询逻辑永远分离。
//
// 【凭证 · 环境变量，不进代码不进 Git】
//   CLOUDBASE_ENV_ID    环境 ID（控制台 → 环境管理 → API 密钥 同页可见）
//   CLOUDBASE_API_KEY   API Key（=service_role 管理员身份，只放云函数环境变量，
//                       严禁写进前端代码，严禁出现在响应里）
// ---------------------------------------------------------------------------

const { ConfigError } = require('../lib/errors');

function gwBase() {
  const envId = process.env.CLOUDBASE_ENV_ID;
  if (!envId) throw new ConfigError();
  return 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest';
}

// GET 一张表：返回解析好的 JSON 数组
// url 里【永远没有】API Key —— 它只出现在请求头 Authorization 里
async function get(table) {
  const envId = process.env.CLOUDBASE_ENV_ID;
  const key = process.env.CLOUDBASE_API_KEY;
  if (!envId || !key) throw new ConfigError();

  // 表名不带前导斜杠（防 /rest//kits 这种双斜杠，网关会当 404）
  const tablePath = table.replace(/^\/+/, '');
  const url = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest/' + tablePath;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000), // 8 秒没回话就放弃，别让调用方干等
    });
  } catch (err) {
    // 网络层错误（超时 / 连不上）：只记日志，不把内部细节回给公网
    console.error('[api] 网关请求失败（网络层）：', url, err && err.message);
    throw new Error('gateway network error');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[api] 网关返回异常：', res.status, url, body.slice(0, 500));
    throw new Error('gateway http ' + res.status);
  }
  return res.json();
}

// POST 写一张表：插一行，返回「插入后的完整记录」
// 【Day 18 新增】与 get 同款的规矩：API Key 只走请求头；出错细节只写日志，不回公网。
// 为什么另写一个、不把 get 改成通用函数：读路径是 Day 17 已验收通过的代码，
// 不动它，少一处「改坏了原来好的东西」的风险。两边多几行重复，认了。
async function post(table, row) {
  const envId = process.env.CLOUDBASE_ENV_ID;
  const key = process.env.CLOUDBASE_API_KEY;
  if (!envId || !key) throw new ConfigError();

  const tablePath = table.replace(/^\/+/, '');
  const url = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest/' + tablePath;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        // 让网关把插入的数据回给我们（不写这行 = 只回状态码，拿不到 id/createdAt）
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[api] 网关写入失败（网络层）：', url, err && err.message);
    throw new Error('gateway network error');
  }
  if (!res.ok) {
    // ⚠️ 读写最大的差别就在这：写失败的响应体里带着「数据库为什么拒绝」，
    //    必须读出来 —— 数据库的约束错误码（SQLSTATE，如 23505）就藏在这里面，
    //    靠它才能把「重复录入」和「机体不存在」两种 409 分开。
    const body = await res.text().catch(() => '');
    console.error('[api] 网关写入被拒：', res.status, url, body.slice(0, 500));
    const e = new Error('gateway http ' + res.status);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  // return=representation 时响应体是 JSON（数组或对象），空体则没有
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// 把网关返回的行里，驼峰列名稳妥地取出来（列在库里就是小驼峰，原样取）
function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row[k] !== undefined ? row[k] : null;
  return out;
}

// ⚠️ 遗留说明（Day 19 原样搬来，未删）：
//   gwBase 和 pick 这两个函数在重构前就没有任何一处调用它们 —— 是死代码。
//   按项目规则「不擅自改动已有代码」，本次只搬家不删。要用要删，等你发话。
module.exports = { get, post, gwBase, pick };
