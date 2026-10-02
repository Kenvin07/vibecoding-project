// index.js ｜ Day 15 健康检查云函数（第 3 周第一个云函数）
// ---------------------------------------------------------------------------
// 类型：HTTP 云函数（新版 CloudBase）——它是一个真的「小网站服务器」：
//       scf_bootstrap 启动脚本运行 node index.js，常驻监听 9000 端口。
//       与旧版「事件函数」（exports.main 写法）不同，别混用两种写法。
// 作用：给公网一个「后端还活着」的信号——浏览器打开 /api/health 能看到 JSON，
//       就说明云函数部署成功、HTTP 访问已打通。
// 今天不做（Day 16-20 的活）：真实业务接口、数据库读写、跨域配置。

const http = require('http');

// 监听端口必须与控制台「监听端口 9000」配置一致
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, service: 'Gundam market situation' }));
});

server.listen(9000);
