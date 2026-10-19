---
name: verify-project
description: 高达行情的发布前检查。每次要提交/部署/交接之前，或改完 js、后端、数据库、环境变量之后使用；自动跑 16 项检查（密钥、.env、Git 历史、前端缓存版本号、资源路径、云函数环境变量、错误分层、软删除索引、错误文案 + 公网健康/数据基线/兜底路由/跨域/写接口门锁/方法白名单），逐项给出 PASS/FAIL/SKIP 与证据。有一项 FAIL 就不能发布。
---

# 发布前检查 Skill（verify-project）

## 这个 Skill 是干什么的

把「这个项目以前踩过的坑」固化成一张**能自动跑、能出证据**的检查表。

它的价值不在"多检查几项"，而在两件事：

1. **不许虚报通过**。查不了的项写 SKIP 并说明原因，不写 PASS；PASS 必须带证据（命中几条、返回什么、哪一行）。
2. **判据来自真实事故**。每一项都能指出它是哪一天、哪个 Bug 换来的（见每项的「为什么查」）。不是网上抄的通用清单。

**什么时候跑：**

- 每次 `git commit` 之前（尤其是改了 `js/`、`cloudfunctions/`、`db/`、`.env.example`、HTML 里的 `?v=`）
- 部署/发布之前
- 换电脑、重建 CloudBase 环境之后（有几项配置只存在控制台，不在 Git 里）
- 交接给别人之前

**什么时候不用跑：** 只改文档、只改注释、只改 `docs/` 里的文字时，跑一次也只要十几秒，但优先级不高。

---

## 一、怎么跑

在仓库根目录（`vibecoding打卡project`）执行：

```bash
bash gundam-price/scripts/verify-project.sh
```

只跑静态项（没网、或不想碰公网时）：

```bash
bash gundam-price/scripts/verify-project.sh --offline
```

看帮助：

```bash
bash gundam-price/scripts/verify-project.sh --help
```

> **必须用 bash**，不能用 `cmd` 或 PowerShell 直接跑 `.sh`。Windows 上打开 Git Bash 即可（或在 cmd 里先 `chcp 65001` 再看中文输出）。

### 输出怎么读

```
[PASS] S1   密钥真值扫描 —— 有效命中 0 条（2 条为白名单文档示例）
       证据: 原始命中 2 条，全部匹配 allowlist.txt（Day 23 自查清单里的示例值）
[FAIL] S4   前端版本号不一致
       证据: 版本号分歧 → js/api.js: 20261001 20261008
       期望: 同一文件全站同一个 ?v=；每个本地 js/css 都带 ?v=YYYYMMDD，否则缓存失效不了
```

| 状态 | 含义 | 能不能发布 |
|---|---|---|
| **PASS** | 判据满足，且带了证据 | 能 |
| **FAIL** | 判据不满足，或行为与预期不符 | **不能**，先修 |
| **SKIP** | 这一项这次没法验证（没网、没 curl） | 不能当作全绿 |

**退出码**：`0` = 无 FAIL；`1` = 有 FAIL；`2` = 环境不对（找不到目录 / 不是 bash）。
所以它可以直接被别的东西调用（比如以后真要做流水线，`&&` 接在后面就行 —— 但**今天不做流水线**）。

### 一轮跑完的规矩

- 有 FAIL → **一次只改一处**，改完用同一条命令重跑。同时改三处，就分不清哪一处起了作用。
- 修完必须**从头重跑**，不许"只重跑刚才那项"。Day 24 的教训：修好 A、弄坏 B 是常态。

---

## 二、16 项检查（逐项：为什么查 / 命令 / 通过标准 / 证据）

> 下面的命令都是**单项手动复核**用的。日常只需要跑总脚本，不必逐条敲。
> `$ROOT` = 仓库根目录，`$FRONT` = `$ROOT/gundam-price`。

### 静态项（不联网，`--offline` 也跑）

#### S1 密钥真值扫描

- **为什么查**：Day 23 定下的底线 —— 密钥只放云函数环境变量，代码、文档、截图里都不能有真值。
- **执行命令**：`cd $FRONT && sh scripts/check-secrets.sh .`
- **通过标准**：**有效命中 0 条**。落在 `skills/verify-project/allowlist.txt` 里的"文档示例"不计入有效命中，但会在证据里报出豁免条数（不隐藏）。
- **证据形态**：`命中条数 N` + 首条命中位置；豁免时显示"原始 N 条 / 豁免 M 条"。

#### S2 `.env` 不入库且被忽略

- **为什么查**：Day 23 —— `.env` 是"做好的菜"，绝不能进仓库；`.env.example` 是"菜谱"，必须进。
- **执行命令**：
  ```bash
  cd $ROOT
  git ls-files | grep -iE '(^|/)\.env(\.[^/]*)?$|\.pem$|\.key$|(^|/)(credential|secret)s?\.(json|ya?ml|ini|txt|env)$' | grep -v '\.env\.example$'
  git check-ignore -v .env
  ```
- **通过标准**：第一条**无输出**（除 `.env.example` 外没有敏感文件被跟踪）；第二条**有输出**（`git check-ignore -v .env` 命中某条规则）。
- **证据形态**：已跟踪敏感文件数 + 命中的忽略规则原文（如 `.gitignore:20:.env`）。

#### S3 Git 历史无密钥

- **为什么查**：Day 23 —— 代码里删掉密钥 ≠ 安全，旧提交里仍能翻出来。真出过事，唯一正确的动作是**去平台作废并重新生成**。
- **执行命令**：
  ```bash
  cd $ROOT
  git log --all -p > /tmp/hist.txt
  grep -nE '^\+.*(password|passwd|secret|api[_]?key|apikey|token|access[_]?key|private[_]?key)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}' /tmp/hist.txt
  ```
- **通过标准**：有效命中 0 条（同样走 allowlist 豁免文档示例）。
- **证据形态**：扫描的历史 diff 行数 + 有效命中数。
- **注意**：**先把 `git log -p` 落盘再 grep**。直连管道在本机实测丢过一次输出（同样的正则，管道里 0 条、落盘后 2 条）。

#### S4 前端版本号一致性

- **为什么查**：Day 11 / Day 13 —— 改了 js 没升 `?v=`，浏览器继续用旧缓存，现象是"代码明明改了却没生效"，最容易误判成没部署。
- **执行命令**：
  ```bash
  cd $FRONT && grep -hoE 'js/[a-z/-]+\.js\?v=[0-9]+|css/[a-z-]+\.css\?v=[0-9]+' *.html | sort | uniq -c
  ```
- **通过标准**：同一个文件在**所有页面**里的 `?v=` **完全相同**；每个本地 js/css **都带** `?v=`（CDN 外链不算）。
- **证据形态**：引用总数 + 分歧项（`文件: 版本A 版本B`）。

#### S5 版本号跟得上代码改动

- **为什么查**：**这一项是第二轮的补漏**。S4 只查"四个页面是不是一致"——可如果四个页面**一起忘了升**，S4 照样全绿，而浏览器拿的还是旧缓存。补上 S5 后第一轮实跑立刻抓到 5 个文件版本号落后（`api.js` / `main.js` / `detail.js` / `calc.js` / `check.js`）。
- **执行命令**：
  ```bash
  cd $ROOT
  git log -1 --format=%ad --date=format:%Y%m%d -- gundam-price/js/api.js
  grep -o 'js/api\.js?v=[0-9]*' gundam-price/*.html | sort -u
  ```
- **通过标准**：`?v=YYYYMMDD` 的日期 **不早于** 该文件最后一次提交的日期。
- **证据形态**：落后清单（`文件(v=旧 < 最后改动 新)`）。
- **已知边界**：只看**已提交**的历史。本地改了还没提交的，它看不见（要靠 `git status` + 人工确认）。

#### S6 本地资源引用全部存在

- **为什么查**：Day 11 —— 路径写错或文件漏提交，页面白屏、卡片变白，控制台一条 404。
- **执行命令**：
  ```bash
  cd $FRONT && grep -hoE '(src|href)="[^"]+\.(js|css)[^"]*"' *.html | sed -E 's/^(src|href)="//; s/"$//' | cut -d'?' -f1 | sort -u | while read p; do [ -f "$p" ] || echo "缺: $p"; done
  ```
- **通过标准**：无输出（每个引用都能落到实体文件）。
- **证据形态**：检查了多少个唯一文件 + 缺失清单。

#### S7 云函数环境变量清单一致

- **为什么查**：Day 18 / Day 24 —— 环境变量只在控制台配，代码里用了却没登记，换环境必漏配；漏配时如果没有明确报错，就会变成"莫名其妙的 500"。
- **执行命令**：
  ```bash
  cd $FRONT
  grep -rhoE 'process\.env\.[A-Za-z0-9_]+' cloudfunctions | sed 's/process\.env\.//' | sort -u
  grep -oE '^[A-Z][A-Z0-9_]*=' .env.example | tr -d '='
  ```
- **通过标准**：代码里每个 `process.env.X` 都能在 `.env.example` 找到；且 `cloudfunctions/api/index.js` 里有 `ConfigError` 分支（缺配 → 500 + 中文说明）。
- **证据形态**：变量个数 + 未登记清单。

#### S8 未登记路径兜底 + 前端错误分层

- **为什么查**：Day 24 的真实 Bug —— 网关对未登记路径回 404 且**不带跨域头**，浏览器拒收，`fetch` 抛异常，前端把 `status` 记成 `0`，用户看到"连不上服务器，请检查网络"，其实接口根本不存在。修法是**在云函数里兜底**（`route === null` → 404 `NOT_FOUND`）+ **保留 `status=0` 判定**（否则真断网和 404 又混在一起）。
- **执行命令**：
  ```bash
  cd $FRONT
  grep -n 'route === null' cloudfunctions/api/index.js
  grep -n 'NOT_FOUND' cloudfunctions/api/index.js
  grep -n 'NETWORK_ERROR' js/api.js
  ```
- **通过标准**：三处都存在。
- **证据形态**：三个行号。

#### S9 软删除与防重复索引

- **为什么查**：Day 22 —— 重复打卡靠唯一索引兜底；删除是软删除（行还在，`isDeleted=true`）。唯一索引**必须带** `WHERE "isDeleted" = false`，否则"删掉之后当天再也不能打卡"。
- **执行命令**：
  ```bash
  cd $FRONT
  grep -n 'checkins_unique_active_day' db/schema.sql
  grep -n 'WHERE "isDeleted" = false' db/schema.sql
  grep -nE '"isDeleted"[[:space:]]+boolean[[:space:]]+NOT NULL DEFAULT false' db/schema.sql
  ```
- **通过标准**：三处都存在（索引名 + 部分索引条件 + 默认值）。
- **证据形态**：三处行号。

#### S10 用户文案不含技术术语

- **为什么查**：Day 23 —— 用户不该看到 `Failed to fetch`、裸 `HTTP 500`、`JSON` 这类词；技术细节应留在 F12 控制台。
- **执行命令**：
  ```bash
  cd $FRONT
  sed -n '/^const MESSAGES = {/,/^};/p' js/error-message.js | grep -E "^[[:space:]]*[A-Z]+:[[:space:]]*['\"]"
  ```
- **通过标准**：取出的**文案值行**里不含 `Failed to fetch`、`JSON`、`HTTP 三位数字`；且文件里保留了技术原话过滤器（`/Failed to fetch|TypeError|SyntaxError|NetworkError/i`）。
- **证据形态**：三条固定文案的存在性 + 过滤器位置。
- **注意**：只看**值行**，不看注释。第一版把注释也算了进去，注释里写着"不说 Failed to fetch"，结果被当成"漏给用户"报了假警。

### 公网项（需要网络；`--offline` 时全部 SKIP）

> 公网基址写死在脚本顶部 `BASE_URL`，换环境改这一行，**别改判据**。

#### N1 健康接口

- **为什么查**：Day 15 —— 这一层最容易把"环境问题"误当成"代码问题"。它不依赖数据库，永远该成功。
- **执行命令**：`curl -s -w '\n%{http_code}\n' $BASE/api/health`
- **通过标准**：`200` 且响应体 `"ok":true`。
- **证据形态**：状态码 + 响应原文。

#### N2 读接口与数据基线

- **为什么查**：Day 16 / Day 17 —— 表建了没灌数据、环境换了数据没迁移，都会表现为"页面空着"。
- **执行命令**：
  ```bash
  curl -s $BASE/api/kits    | grep -o '"total":[0-9]*'
  curl -s $BASE/api/prices  | grep -o '"total":[0-9]*'
  curl -s $BASE/api/checkins| grep -o '"total":[0-9]*'
  ```
- **通过标准**：三条都 `200`；`kits.total = 5`、`prices.total = 14`（基线来自 Day 24 实测，数据变了就改脚本顶部 `EXPECT_*`）。
- **证据形态**：三个 total 的实际值。
- **说明**：`checkins` 只报数不设基线 —— 它是会被人正常增删的业务数据。

#### N3 未登记路径返回本项目外壳 404

- **为什么查**：Day 24 的修复是**在控制台加一条 `/api` 前缀路由**（路径透传开）。**这条路由不在 Git 里**，重建环境 / 换环境 ID / 导入导出时都可能丢，丢了 Bug 原样复发。
- **执行命令**：`curl -s -w '\n%{http_code}\n' $BASE/api/nope`
- **通过标准**：`404` 且 `error.code = "NOT_FOUND"`（本项目外壳）。
- **证据形态**：状态码 + 响应原文。
- **反例判据**：如果看到 `INVALID_PATH`，说明请求在网关门口就被退回了 → 去控制台补 `/api` 路由（关联 `api` 函数、路径透传**开**、域名用环境默认域名、身份认证关）。

#### N4 跨域白名单

- **为什么查**：Day 24 —— 前端域名与后端域名不同，靠控制台白名单放行；白名单一改，整片红。
- **执行命令**：
  ```bash
  curl -s -D - -o /dev/null -H 'Origin: http://localhost:8000' $BASE/api/kits | grep -i access-control-allow-origin
  curl -s -D - -o /dev/null -H 'Origin: https://evil.example.com' $BASE/api/kits | grep -i access-control-allow-origin
  ```
- **通过标准**：本机来源**被回显**；陌生来源**拿不到** `access-control-allow-origin`。
- **证据形态**：两个 Origin 各自的 ACAO 值。
- **说明**：若返回 `*`（全量通配），本项记 PASS 但会附一句"建议收紧" —— 项目约定是按来源逐条放行。

#### N5 写接口门锁

- **为什么查**：Day 18 —— 写接口必须带 `X-API-KEY`。这一项**不写任何数据**：后端验密钥在验参数之前，所以必定在门口被拦下。
- **执行命令**：
  ```bash
  curl -s -w '\n%{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d '{"kitId":"probe-not-a-kit","checkinDate":"1970-01-01","status":"未完成"}' \
    $BASE/api/checkins
  ```
- **通过标准**：`401` 且 `error.code = "UNAUTHORIZED"`。
- **证据形态**：状态码 + 响应原文。

#### N6 单条路径方法白名单

- **为什么查**：Day 22 —— 一函数多接口，方法要**按路由**允许（`/api/checkins/{id}` 只收 PATCH/PUT/DELETE），不能一刀切。
- **执行命令**：
  ```bash
  curl -s -D - -o /dev/null -X GET $BASE/api/checkins/ck_0001
  ```
- **通过标准**：`405` 且 `Allow` 头里包含 `PATCH`。
- **证据形态**：状态码 + `Allow` 值。
- **解析注意**：走代理时响应头里有**两行** `HTTP/...`，第一行是代理的 `200 Connection Established`。必须取**最后一行**才是业务状态码（取第一行会把 405 读成 200）。

---

## 三、误报怎么办：白名单机制

`skills/verify-project/allowlist.txt` 是唯一允许的"豁免清单"，只收**文档里的示例值**。

规则：

- 每条一行，写 `grep -E` 正则，只写「值的片段」，**不要写完整赋值形态**（否则白名单自己也会被扫成真值 —— 这个坑本文件踩过）。
- 每条前面用 `#` 写清来源文件和为什么是示例。
- 检查结果会显示"原始命中 N / 豁免 M"，**不会悄悄变成 0**。
- **绝不允许**为了让检查变绿把真值加进来。真值只有一个去处：云函数环境变量。

---

## 四、已知边界（诚实声明）

| 查不到的 | 为什么 | 目前怎么补 |
|---|---|---|
| 云平台控制台里的实际配置（环境变量、路由、跨域白名单） | 不在 Git 里，没有 API 可查 | N3 / N4 用**行为**反推；环境变量值靠人工核对 |
| 本地改了还没提交的改动 | S5 只看已提交历史 | `git status` + 人工确认 |
| 浏览器里的真实缓存表现 | 需要真开浏览器 | S4/S5 把"能查的部分"查死；真机验收见 Day 24 清单 |
| 数据库里的实际行数是否"正确" | 只有基线，没有业务规则 | N2 比对基线；差异要人工判断是不是测试数据 |
| `*.log` 文件里的密钥 | 日志是生成物，且检查日志会把命中行抄进去（自我污染） | 日志不入库；真值只在环境变量 |

---

## 五、怎么加一项新检查（维护规矩）

1. **先有事故**：能指出"哪一天、什么现象、为什么会复发"。没有事故支撑的检查项不加。
2. 在脚本里按 `S*`（静态）/ `N*`（公网）编号，用 `pass / fail / skip` 三个函数输出，**必须带证据**。
3. 在本文档补一节：为什么查 / 命令 / 通过标准 / 证据形态 / 已知边界。
4. **验证它真的会红**：故意制造一次不符合，确认它 FAIL；再把问题修掉，确认它 PASS。只见过绿的检查项等于没写过。
5. 每次改动都往下面「使用记录」记一行。**没记录 = 没跑过。**

---

## 六、使用记录

| 日期 | 轮次 | 检查对象 | 结果 |
|---|---|---|---|
| 2026-10-19 | 第 1 轮（15 项，故意留 S4 缺陷） | 全项目 | 13 PASS / 2 FAIL：S1（误报，文档示例被当真值）、S4（**故意留的问题被查出**） |
| 2026-10-19 | 第 2 轮（16 项，补 S5 后） | 全项目 | 15 PASS / 1 FAIL：S5 抓到 5 个文件版本号落后（`api.js` / `main.js` / `detail.js` / `calc.js` / `check.js`）—— 这是第一版的**漏报** |
| 2026-10-19 | 第 3 轮（修完全部问题） | 全项目 | **16 PASS / 0 FAIL / 0 SKIP**，退出码 0 |

三份原始输出留在 `docs/`：`Day25-run1-故意留问题.log`、`Day25-run2-补漏报后.log`、`Day25-run3-确认通过.log`。

### 这一轮暴露的四个「检查器自己的坑」（都已修）

| # | 坑 | 现象 | 修法 |
|---|---|---|---|
| 1 | 按关键词匹配文件名 | `check-secrets.sh` 因为文件名含 `secret`，被 S2 当成"敏感文件被提交" | 改成按**文件名形态**匹配（`.env` / `.pem` / `.key` / `credentials.json`） |
| 2 | 把注释当文案 | S10 把 `MESSAGES` 里的注释（"不说 Failed to fetch"）当成漏给用户的术语 | 只取真正的**值行** |
| 3 | 取错了状态行 | 走代理时响应头有两行 `HTTP/`，`grep -m1` 取到代理的 200，把 405 报成通过 | 取**最后一行** |
| 4 | `grep -v` 的返回码 | 全部命中被豁免时 `grep -v` 返回 1，被 `\|\| cat` 兜底误触发，白名单等于失效 | 区分返回码 1（全豁免，正常）与 ≥2（真出错） |

> 教训：**检查器本身也要被检查**。所以每一项都要求"故意弄坏能查出来"，不是看它跑绿了就算完。
