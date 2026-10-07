// lib/http.js ｜ 跟 HTTP 打交道的几个小工具
// ---------------------------------------------------------------------------
// 产出：Day 19（第 3 周）· 板块② 分层重构（原 index.js 的 sendJson/sendOk/
//            sendCreated/sendFail/readBody 原样搬来）
//
// 统一响应形状（api-contract.md 第 1 节）：
//   成功 { "ok": true,  "data": { ... }, "error": null }
//   失败 { "ok": false, "data": null,    "error": { "code": "...", "message": "..." } }
// 这四个 send* 就是这套外壳的唯一出口 —— 想改响应形状，只改这里一处。
// ---------------------------------------------------------------------------

const { HttpError } = require('./errors');
const { MAX_BODY } = require('./constants');

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(text);
}

// 成功：契约统一外壳 { ok, data, error }
function sendOk(res, data) {
  sendJson(res, 200, { ok: true, data: data, error: null });
}

// 成功（创建）：契约规定 POST 成功用 201，外壳跟 200 完全一样，
// 只有「新建了一个东西」和「读到了东西」的状态码区别。
function sendCreated(res, data) {
  sendJson(res, 201, { ok: true, data: data, error: null });
}

// 失败：HTTP 状态码 + { ok:false, data:null, error:{code,message} }
function sendFail(res, status, code, message) {
  sendJson(res, status, {
    ok: false,
    data: null,
    error: { code: code, message: message },
  });
}

// 把请求体（POST 的 body）整个读出来，返回原始字符串。
// 为什么不直接 req.body：这个函数零依赖（连 express 都没装），
// 原生 http 的请求体是一段「流」，得自己一片一片攒起来。
function readBody(req) {
  return new Promise((resolve, reject) => {
    req.setEncoding('utf8'); // 按 utf8 攒 —— 中文（行货/水货）不会被拆成半个字
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // 防呆：体太大直接掐断，别让一个巨型请求把内存吃光
      if (raw.length > MAX_BODY) {
        reject(new HttpError(400, 'INVALID_PARAM', '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', (e) => reject(e));
  });
}

module.exports = { sendJson, sendOk, sendCreated, sendFail, readBody };
