# api-contract.md ｜「高达行情」接口契约

> **Day 15 产出 · 2026-10-02（第 3 周）｜Day 16 更新：表结构已落地｜Day 17 更新：读接口 2 / 4 已实现**
>
> ⚠️ **本文件是第 3 周建表、写接口的唯一依据。**
> Day 16 已按第 2 节建好 `kits` / `kit_prices` 两张表（脚本见 `gundam-price/db/`），
> 但**尚未实现任何接口**——接口从 Day 17 开始逐条落地，写完前不改这里的约定；要改先改文档。
>
> **Day 17 更新要点**：① 统一响应外壳改为 `{ ok, data, error }`（第 1 节，今天首次落地，
> 写接口沿用同一外壳）；② 接口 2 `GET /api/kits`、接口 4 `GET /api/prices` **代码已实现、
> 已部署上线、已真库验证通过**（云函数 `api`，目录 `gundam-price/cloudfunctions/api/`，
> 详见 0.1 节）；③ 汇率暂以代码常量 `0.048` 提供（`app_meta` 表未建，见第 6 节待定项）。
>
> 依据：`TECH_DESIGN.md` 第 5 节（数据对象及字段）+ 现有 `data/data.json`（字段一一对应）
> 环境：腾讯云 CloudBase · 环境 ID `gundam-market-d7gnjqg3h1f2f156f`（上海 · PostgreSQL）

---

## 0. 服务基址

| 项 | 值 |
|---|---|
| API 基址 | `https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com` |
| 已上线接口 | `GET /api/health` ✅（Day 15 部署并验证通过）；`GET /api/kits`、`GET /api/prices` ✅（Day 17 实现、部署、真库验证通过，见 0.1 节） |
| 鉴权 | **本期无登录**：读接口匿名可访问；写接口暂不对外开放（谁可写由 Day 16 拍板） |
| 跨域 | 暂不配置。前端域名与 API 域名是否同源，决定 Day 16 要不要开跨域 |

> 前端域名见「静态网站托管 → 基础配置 → 默认域名」，与上面 API 域名**不一定是同一个**（Day 15 已实测：直接用 API 域名打开前端会 404）。

### 0.1 后端代码与部署登记（Day 17 新增，当日改为网关方案 B）

| 项 | 值 |
|---|---|
| 云函数目录 | `gundam-price/cloudfunctions/api/`（`index.js` + `package.json` + `scf_bootstrap`） |
| 运行时 | Node.js（HTTP 云函数，`scf_bootstrap` 启动，监听 **9000** 端口） |
| 依赖 | **无第三方依赖**（用 Node 自带 `fetch`，部署不用装包） |
| 一个函数管几条接口 | 一个 `api` 函数管全部接口，函数内按路径分流（Day 18 加收藏接口继续往里加） |
| 取数方式 | **CloudBase 数据网关 REST API**：`https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/<表>` |
| 为什么走网关 | 控制台目前**不展示**数据库直连用的「连接信息」（官方文档先于功能上线，社区 issue #1297 证实）；网关是官方支持的正路，且不需要数据库密码 |
| 防注入 | 用户输入**不进查询语句**：网关只按表名整表取数，筛选/校验全在云函数内存里做（本期数据量极小，契约原文「暂不分页」）；将来数据量大了再把过滤下放到网关查询参数，接口形状不变 |
| 凭证面 | 只有 API Key（=service_role 管理员身份）进环境变量；数据库密码全程不出现 |

**必需的环境变量**（控制台 → 云函数 → api → 函数配置 → 环境变量）：

| 变量 | 含义 | 值从哪来 |
|---|---|---|
| `CLOUDBASE_ENV_ID` | 环境 ID | `gundam-market-d7gnjqg3h1f2f156f` |
| `CLOUDBASE_API_KEY` | API Key（服务端专用，⚠️ 严禁进前端/截图/提交） | 控制台 → **环境管理 → API 密钥** → 新建「API Key」 |

> 另一个可选变量 `PORT`：本地自测时用来换端口（云函数上**不要设**，必须保持 9000）。

**实际部署结果（Day 17 实测，2026-10-04 16:53 生效）**：

| 项 | 实际值 |
|---|---|
| 控制台函数名 | `api`（**HTTP 云函数**，运行时 Nodejs 18.15，自动安装依赖已开） |
| 代码上传方式 | 新版控制台「通过代码创建 → 代码包」；实测「点击选择」弹的是**选择文件夹**对话框（只列文件夹、不列文件），故选 `cloudfunctions/api` 文件夹上传，平台自动压缩（zip 备用方案：直接拖拽 zip 到虚线框） |
| 环境变量 | 平台自带 1 条 + 本项目 2 条（`CLOUDBASE_ENV_ID` / `CLOUDBASE_API_KEY`），共 3 条 |
| 路由配置 | HTTP 网关 → 路由管理：`/api/kits` → `api`、`/api/prices` → `api`（域名=环境默认域名，身份认证=关，限流未设）；原 `/api/health` → `health` 未改动 |
| ⚠️ 关键开关 | **路径透传必须开启**（PathTransmission=开）。本函数一函数多路由、靠路径分流；关闭透传时网关会剥掉触发路径，两条路由剥完前缀后路径相同，接口直接错位。开启后函数收到完整 `/api/kits` / `/api/prices` |
| 生效耗时 | 路由保存后**未满 1 分钟**即生效（官方文档说 3~5 分钟，实测更快） |
| 真库验证 | SQL 编辑器 `UPDATE kit_prices SET price = 199 WHERE id = 'pr_0002'` → `/api/prices?kitId=mg-freedom-2&platform=pdd` 返回 199、`/api/kits` 中「MG 自由 2.0」`minPrice` 230 → 199；随后改回 230 并复核通过 |

---

## 1. 通用约定

| 约定项 | 规则 |
|---|---|
| 协议 | HTTPS，请求与响应体均为 `application/json; charset=utf-8` |
| 字段命名 | **小驼峰 `camelCase`**，与现有 `data.json` 完全一致（不改成下划线，前端才能零改动） |
| 成功响应 | 统一外壳：`{ "ok": true, "data": { ... }, "error": null }`（`data` 里装下面各接口定义的对象） |
| 失败响应 | HTTP 状态码 + `{ "ok": false, "data": null, "error": { "code": "...", "message": "..." } }`，**出错时 `data` 一律为 `null`** |
| 调用方怎么判成败 | 看 HTTP 状态码（400/404/405/500）或看 `ok` 字段，两者始终一致；`error.code` 是给代码判断用的稳定标识 |
| 日期 | `YYYY-MM-DD`（如 `2026-09-22`） |
| 时间戳 | ISO 8601（如 `2026-10-02T16:30:00+08:00`） |
| 金额 | 人民币元，整数 `number`；日元也是整数 |
| 缺值 | 暂无报价用 `null`，**不用 `0`**（`0` 是「免费」，语义不同） |
| 分页 | 本期数据量极小（5 台机体），暂不分页；列表接口预留 `limit`/`offset` 参数 |

### 状态码表

| 状态码 | 何时返回 | `error.code` 示例 |
|---|---|---|
| 200 | 读取成功 | — |
| 201 | 创建成功（POST） | — |
| 204 | 删除成功，无响应体 | — |
| 400 | 参数缺失/非法（如 `price` 为负数） | `INVALID_PARAM` |
| 404 | 资源不存在（如机体 id 写错） | `KIT_NOT_FOUND` |
| 405 | 方法不支持（如对只读接口发 POST） | `METHOD_NOT_ALLOWED` |
| 500 | 服务端异常（数据库连不上等） | `INTERNAL_ERROR` |
| 404 | 请求了本表没登记的路径（如 `/api/x`） | `NOT_FOUND` |

> 500 只给一句「服务异常，请稍后重试」，**内部报错（堆栈、连接串）只写后台日志，不回公网**。

---

## 2. 数据表登记（Day 16 已建表 ✅）

> 由现有 `data.json` 结构平移而来。**字段名不变**（TECH_DESIGN 第 11 节的承诺：字段即未来的表结构）。
>
> **Day 16 更新（2026-10-02）**：2.1 / 2.2 已按 `gundam-price/db/schema.sql` 落地为真实表，
> 数据由 `gundam-price/db/seed.sql` 灌入（两脚本均可重复执行）。
> 下表「类型」列已换成**数据库里的真实类型**，与 `data.json` 的 `number`/`string` 只是表示法不同，
> **JSON 输出格式不变**，第 4 节的响应示例照旧有效。
> 2.3 `favorites` / 2.4 `app_meta` **今天没建**，按需再补（不影响 Day 17 的读接口）。
> ⚠️ 列名在库里保持小驼峰，写 SQL 时需加双引号（如 `"officialPriceJPY"`、`"kitId"`）。

### 2.1 `kits` 机体表 ✅ 已建

| 列 | 类型（实际建表） | 必填 | 说明 |
|---|---|---|---|
| `id` | `text` **PK** | 是 | 英文小写标识，如 `mg-freedom-2`，详情页 URL 参数用它。**不用自增数字**：前后端共用同一把钥匙，省一层换算 |
| `name` | `text` | 是 | 机体名，如 `MG 自由 2.0` |
| `series` | `text` | 是 | 系列：`MG` / `MGEX`。**故意不加枚举限制**——以后收 RG / PG 不用改表结构 |
| `image` | `text` | 否 | 图片文件名（存对象存储），缺省时前端用文字占位 |
| `imagePos` | `text` | 否 | 图片裁剪位置，如 `center 30%` |
| `officialPriceJPY` | `integer` | 是 | 日本官方建议零售价（日元）。日元是整数 → 用整数类型；`CHECK >= 0` 挡负数 |
| `salesVolume` | `integer` | 否 | 销量参考值（卡片展示用）。**可空且不设默认 0**：空 = 没统计过，0 = 真的卖 0 台 |
| `createdAt` | `timestamptz` | 是 | 录入时间，`DEFAULT now()`。带时区，对应第 1 节 `2026-10-02T16:30:00+08:00` 的写法 |
| `updatedAt` | `timestamptz` | 是 | 最后修改时间，`DEFAULT now()` |

> **Day 16 实际入库 5 行**：原 3 台（自由 2.0 / 强袭自由 / 独角兽）+ 新增 2 台
> （`mg-sazabi-verka` 沙扎比 Ver.Ka 9,000 円、`mg-nu-verka` ν高达 Ver.Ka 7,000 円，官方价均为真实公开数据）。
> 新增 2 台**暂无渠道报价**，`image` / `salesVolume` 存 `null`（没数据就留空，不编）。

### 2.2 `kit_prices` 渠道价格记录表 ★ 核心记录表 ✅ 已建

> **每「录入一次某渠道某行/水货的价格」= 这里新增一行**。
> 详情页的「近 30 天每日最低价走势」不再单独建表：由本表按 `updatedDate` 分组取 `MIN(price)` 算出。少一张表，少一处同步。

| 列 | 类型（实际建表） | 必填 | 说明 |
|---|---|---|---|
| `id` | `text` **PK** | 是 | 记录 id，如 `pr_0001`。不设自动生成：Day 17 新增接口由后端生成 |
| `kitId` | `text` **FK → `kits.id`** | 是 | ★关联字段。`ON DELETE CASCADE`（删机体时连带删它的价格，不留孤儿数据） |
| `platform` | `text` | 是 | 枚举（`CHECK` 约束）：`pdd` / `taobao` / `xianyu`。加京东需 `ALTER TABLE` |
| `marketType` | `text` | 是 | 枚举（`CHECK` 约束）：`行货` / `水货`（分行展示，不混算） |
| `price` | `integer` | **否** | 现价（人民币元）；**暂无报价存 `null` 且无默认值**（`0` 是「免费」，语义不同）；`CHECK >= 0` 只挡负数 |
| `updatedDate` | `date` | 是 | 该条价格的录入日期。用 date 而非文字——走势图靠它按天分组 |
| `url` | `text` | 是 | 「去购买」跳转链接，`DEFAULT ''`（空串 = 暂无链接） |
| `createdAt` | `timestamptz` | 是 | 入库时间，`DEFAULT now()` |

**唯一约束（已落地）**：约束名 `kit_prices_unique_channel`，`(kitId, platform, marketType, updatedDate)` 唯一
→ 同一天同一渠道同类型只留一条，防重复录入。

> 附带两个好处：① 契约 4.5 的 `409 DUPLICATE_RECORD` 由数据库直接拦住，接口层不用自己判断；
> ② 该约束自动建的索引最左列就是 `kitId`，正好给"查某台机的所有价格"加速，无需再单独建索引。
>
> **Day 16 实际入库 12 行**（原 3 台 × 每台 4 条，与 `data.json` 逐条一致，日期统一 `2026-09-22`）。新增的 2 台暂无记录。

### 2.3 `favorites` 收藏表 ⬜ 未建（本周按需补）

> 现在收藏存在浏览器 `localStorage`（`favorite.js`）。接后端后跨设备保留。
> 本期无登录 → 用**匿名设备号 `deviceId`** 当"用户身份"（身份方案见第 6 节待定项 2）。
> **Day 16 未建此表**：接口 8/9/10 还没排上，等真要用时再建。

| 列 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (PK) | 是 | 记录 id |
| `deviceId` | string | 是 | 匿名设备号（前端生成并持久化） |
| `kitId` | string (FK → kits.id) | 是 | 收藏的机体 |
| `createdAt` | timestamp | 是 | 收藏时间 |

**唯一约束建议**：`(deviceId, kitId)` 唯一 → 同一设备不会重复收藏同一台。

### 2.4 `app_meta` 全局设置表（小表，一行）⬜ 未建（Day 17 读接口要用时再建）

| 列 | 类型 | 说明 |
|---|---|---|
| `exchangeRate` | number | 日元→人民币汇率（如 `0.048`），**全站一份**，五算计算用 |
| `dataUpdatedAt` | date | 数据更新日期，页面顶部展示 |

> 汇率放全局而不是每台机体存一份 —— 换汇率只改一处（延续 TECH_DESIGN 第 11 节）。
>
> **Day 17 现状**：本表**仍未建**（今天不做改表结构）。`GET /api/kits` 的 `meta.exchangeRate`
> 暂时由云函数里的常量 `EXCHANGE_RATE = 0.048` 提供（值与 `data/data.json` 一致），
> 等 `app_meta` 建好后改成查库 —— 已登记在第 6 节待定项 8。

---

## 3. 接口清单（总表）

| # | 路径 | 方法 | 用途 | 谁在用 | 状态 |
|---|---|---|---|---|---|
| 1 | `/api/health` | GET | 健康检查 | 运维自检 | ✅ Day 15 已上线 |
| 2 | `/api/kits` | GET | **机体列表读取**（首页） | `js/main.js` `js/filter.js` | ✅ Day 17 已上线并真库验证 |
| 3 | `/api/kits/{id}` | GET | 单台机体详情（含渠道价 + 走势） | `js/detail.js` | ⬜ 待实现 |
| 4 | `/api/prices` | GET | **价格记录表读取**（按条件查） | 管理/统计（预留） | ✅ Day 17 已上线并真库验证 |
| 5 | `/api/prices` | POST | 新增一条价格记录 | 录入（预留） | ⬜ 待实现 |
| 6 | `/api/prices/{id}` | PUT | 修改一条价格记录 | 录入（预留） | ⬜ 待实现 |
| 7 | `/api/prices/{id}` | DELETE | 删除一条价格记录 | 录入（预留） | ⬜ 待实现 |
| 8 | `/api/favorites` | GET | **收藏列表读取** | `js/favorite.js` | ⬜ 待实现 |
| 9 | `/api/favorites` | POST | 添加收藏 | `js/favorite.js` | ⬜ 待实现 |
| 10 | `/api/favorites/{kitId}` | DELETE | 取消收藏 | `js/favorite.js` | ⬜ 待实现 |

> **计算器页（`calc.html` / `js/calc.js`）不需要新接口** —— 它只要「汇率 + 各机体官方价」，复用接口 2 就够。

---

## 4. 接口详情

### 4.1 `GET /api/health` ✅ 已实现（Day 15）

**用途**：确认后端还活着、公网访问已打通。

- 请求参数：无
- 响应 `200`：

```json
{ "ok": true, "service": "Gundam market situation" }
```

- 错误返回：无（本接口不依赖数据库，永远返回 200）
  > 注：本接口是 Day 15 的产物，保持当时的 `{"ok":true,"service":...}` 原样不动（契约第 3 周起新写的接口一律走第 1 节的 `{ok,data,error}` 外壳）。

---

### 4.2 `GET /api/kits` — 机体列表读取（首页）✅ 已上线（Day 17 部署 + 真库验证）

- **请求参数**（全部可选，可组合）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `keyword` | string | 按机体名/系列模糊搜索（对应首页搜索框），不分大小写 |
| `platform` | string | 只返回有该渠道报价的机体：`pdd` / `taobao` / `xianyu` |
| `series` | string | 按系列过滤：`MG` / `MGEX` |
| `limit` | number | 预留，默认不限；取值 `1 ~ 500`，非法值报 `400` |

- **响应 `200`**（结构与现在 `data.json` 一致，前端换 URL 即可）：

```json
{
  "ok": true,
  "data": {
    "meta": { "updatedAt": "2026-09-22", "exchangeRate": 0.048 },
    "total": 5,
    "kits": [
      {
        "id": "mg-freedom-2",
        "name": "MG 自由 2.0",
        "series": "MG",
        "image": "mg-freedom-2.jpg",
        "imagePos": "center 30%",
        "officialPriceJPY": 4500,
        "salesVolume": 1580,
        "minPrice": 230,
        "channels": [
          { "platform": "pdd", "marketType": "行货", "price": 280, "updatedDate": "2026-09-22", "url": "" }
        ]
      }
    ]
  },
  "error": null
}
```

> `minPrice` = 该机体所有非 `null` 报价里的最低值（一条报价都没有 → `null`，不是 `0`）；前端也可自算，后端给了更省事。
> 列表接口**带 `channels`**：首页按平台筛选要判断"这台机体有没有该渠道的报价"。
>
> **Day 17 实现后的几点实际行为**（写代码时定的，与上面示例一致）：
>
> | 项 | 实际行为 | 为什么 |
> |---|---|---|
> | `data.total` | = 本次返回的机体条数（`limit` 生效后按截断后的数算） | 契约原文没写死语义，取"你拿到几条就是几条"，前端好核对 |
> | `meta.updatedAt` | 取 `kit_prices` 全表的 `max("updatedDate")`，即库里的最新录入日期 | 让它也是"从库里查出来的真实值"，不写死 |
> | `meta.exchangeRate` | 代码常量 `0.048`（`app_meta` 表未建，见第 6 节待定项 8） | 今天不改表结构 |
> | `platform` 过滤 | 只筛"机体"，机体的 `channels` 仍返回全部渠道 | 按契约原文："只返回有该渠道报价的机体" |
> | 无报价机体 | 照常出现在结果里，`channels: []`、`minPrice: null` | 用 `LEFT JOIN` 而非 `INNER JOIN`，不让没数据的机体从列表里消失 |
> | `series` 过滤 | 只认 `MG` / `MGEX`，其他值报 `400` | 与建表的系列口径一致；以后收 RG/PG 时同步放宽 |

- **错误返回**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 状态码 | 场景 | 响应体 |
|---|---|---|
| 400 | `limit` 非法 | `{ "ok": false, "data": null, "error": { "code": "INVALID_PARAM", "message": "limit 必须是正整数" } }` |
| 500 | 数据库异常 | `{ "ok": false, "data": null, "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后重试" } }` |

- **空结果不报错**：没有匹配机体时返回 `200` + `"kits": []`（前端已有的「空状态」负责展示）。

---

### 4.3 `GET /api/kits/{id}` — 单台机体详情

- **路径参数**：`id`（机体标识，如 `mg-unicorn`）
- **响应 `200`**：

```json
{
  "meta": { "updatedAt": "2026-09-22", "exchangeRate": 0.048 },
  "kit": {
    "id": "mg-unicorn",
    "name": "MG 独角兽",
    "series": "MG",
    "image": "mg-unicorn.jpg",
    "imagePos": "center 12%",
    "officialPriceJPY": 8000,
    "salesVolume": 1240,
    "minPrice": 366,
    "channels": [
      { "platform": "pdd", "marketType": "行货", "price": 450, "updatedDate": "2026-09-22", "url": "" }
    ],
    "history": [
      { "date": "2026-09-22", "price": 366 }
    ]
  }
}
```

> `history` = 由 `kit_prices` 按日期聚合的「每日最低价」，供详情页走势图用。
> ⚠️ 本接口**尚未实现**（Day 18 起）；实现时响应同样按第 1 节的 `{ok, data, error}` 外壳包裹，
> 即 `{"ok": true, "data": {...上面这个对象...}, "error": null}`，下面示例为 `data` 的内容。

- **错误返回**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 404 | id 不存在 | `{ "error": { "code": "KIT_NOT_FOUND", "message": "没有找到这台机体" } }` |
| 500 | 数据库异常 | `{ "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后重试" } }` |

---

### 4.4 `GET /api/prices` — 价格记录表读取 ✅ 已上线（Day 17 部署 + 真库验证）

- **请求参数**（全部可选）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `kitId` | string | 只查某台机体的价格记录 |
| `platform` | string | `pdd` / `taobao` / `xianyu`（其他值报 `400`） |
| `marketType` | string | `行货` / `水货`（其他值报 `400`） |
| `dateFrom` / `dateTo` | string | 录入日期范围 `YYYY-MM-DD`（格式错报 `400`；`dateFrom` 晚于 `dateTo` 也报 `400`） |
| `limit` / `offset` | number | 预留，默认 `limit=100`、`offset=0`；`limit` 取值 `1 ~ 500` |

- **响应 `200`**：

```json
{
  "ok": true,
  "data": {
    "total": 12,
    "limit": 100,
    "offset": 0,
    "items": [
      {
        "id": "pr_0001",
        "kitId": "mg-unicorn",
        "platform": "pdd",
        "marketType": "水货",
        "price": 380,
        "updatedDate": "2026-09-22",
        "url": ""
      }
    ]
  },
  "error": null
}
```

> **Day 17 实现说明**：`total` 是**符合条件的总条数**（不受 `limit` 影响，另跑一条 `count(*)` 得到），
> 和 `items` 的实际长度可能不同 —— 这是分页该有的样子；响应里回显 `limit` / `offset`，
> 便于前端判断"还有没有下一页"。排序：`updatedDate` 倒序（最新的在前），同日期按 `id` 升序（结果稳定可复现）。
>
> ⚠️ 与 4.2 的差别：4.2 的 `total` 是**返回条数**，本接口的 `total` 是**符合条件总数**。两处语义不同是刻意的
> （列表页要"总共几条"，首页只要"给了几台"），已在各自的实现说明里写明，别混用。

- **错误返回**：`400 INVALID_PARAM`（参数非法）、`405 METHOD_NOT_ALLOWED`（对只读接口发 POST）、`500 INTERNAL_ERROR`

---

### 4.5 `POST /api/prices` — 新增价格记录

- **请求体**：

```json
{
  "kitId": "mg-unicorn",
  "platform": "pdd",
  "marketType": "水货",
  "price": 380,
  "updatedDate": "2026-10-02",
  "url": ""
}
```

- **响应 `201`**：`{ "item": { ...新增成功后的完整记录，含 id... } }`
- **错误返回**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 400 | 必填缺失 / `price` 负数 / `platform` 不在枚举内 | `{ "error": { "code": "INVALID_PARAM", "message": "platform 只能是 pdd / taobao / xianyu" } }` |
| 404 | `kitId` 不存在 | `{ "error": { "code": "KIT_NOT_FOUND", "message": "没有找到这台机体" } }` |
| 409 | 同一天同渠道同类型已存在 | `{ "error": { "code": "DUPLICATE_RECORD", "message": "该渠道今日已有记录，请使用 PUT 修改" } }` |

---

### 4.6 `PUT /api/prices/{id}` — 修改价格记录

- **路径参数**：`id`
- **请求体**：同 4.5，字段均可选（只传要改的）
- **响应 `200`**：`{ "item": { ...修改后的完整记录... } }`
- **错误返回**：`400 INVALID_PARAM`、`404 RECORD_NOT_FOUND`

### 4.7 `DELETE /api/prices/{id}` — 删除价格记录

- **路径参数**：`id`
- **响应 `204`**：无响应体
- **错误返回**：`404 RECORD_NOT_FOUND`

---

### 4.8 `GET /api/favorites` — 收藏列表读取

- **请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | string | 是 | 匿名设备号（本期当用户身份用） |

- **响应 `200`**：

```json
{
  "deviceId": "dev_7f3a9c21",
  "total": 1,
  "kitIds": ["mg-unicorn"]
}
```

> 只返回 id 集合：前端 `favorite.js` 是靠 id 集合给按钮上色的（★/☆）。
> 若将来做「我的收藏」页面，再加 `?withKits=1` 返回机体详情，不破坏现有调用。

- **错误返回**：`400 INVALID_PARAM`（缺 `deviceId`）、`500 INTERNAL_ERROR`

### 4.9 `POST /api/favorites` — 添加收藏

- **请求体**：`{ "deviceId": "dev_7f3a9c21", "kitId": "mg-unicorn" }`
- **响应 `201`**：`{ "deviceId": "dev_7f3a9c21", "kitId": "mg-unicorn", "createdAt": "2026-10-02T16:30:00+08:00" }`
- **错误返回**：`400 INVALID_PARAM`、`404 KIT_NOT_FOUND`、`409 ALREADY_FAVORITED`

### 4.10 `DELETE /api/favorites/{kitId}` — 取消收藏

- **路径参数**：`kitId`；**查询参数**：`deviceId`（必填）
- **响应 `204`**：无响应体（不存在也返回 204，保证幂等 —— 重复点"取消"不会报错）
- **错误返回**：`400 INVALID_PARAM`

---

## 5. 接口就绪后，前端要改的地方（先登记，本周不改）

| 文件 | 现在 | 将来 | 说明 |
|---|---|---|---|
| `js/main.js` | `fetch("data/data.json")` | `fetch(API + "/api/kits")` | 只改 URL 与 base |
| `js/detail.js` | 读全量再 `find` | `fetch(API + "/api/kits/" + id)` | 详情页不再拉全量 |
| `js/calc.js` | 读 `data.json` 拿汇率 | 同接口 2，只取 `meta.exchangeRate` | 计算逻辑一行不动 |
| `js/favorite.js` | `localStorage` + 模拟 400ms | 调接口 8/9/10 替换 `save()` / `load()` | 按钮状态机不动（当初就是为这天留的口子） |
| 三个 HTML | — | **不动** | 读取逻辑集中在 js 里，改数据源不碰页面 |

---

## 6. 待定项（滚动更新）

1. **写接口谁能调** —— 管理后台？固定密钥？还是先只留只读接口？
2. **收藏的身份** —— 继续用匿名 `deviceId`，还是上微信/手机号登录？
3. **前端与 API 是否同源** —— 决定要不要开跨域、怎么开。
4. ~~**数据迁移**~~ —— ✅ **Day 16 已办**：`data.json` 的 3 台机体 + 12 条渠道价已由 `seed.sql` 导入 `kits` / `kit_prices`，select 验证通过（各 5 行 / 12 行）。
5. **图片存哪** —— 现在图片在静态托管；接入对象存储后是否迁移。
6. ~~**PRD 收录台数与库里不一致**~~ —— ✅ **Day 16 已同步**：`PRD.md` 已按 5 台改写
   （第 1 行新增修订说明；3.1 收录范围换成 5 台表格并写明"为什么从 3 台变成 5 台"；4.1 首页 5 张卡片；
   5 数据方案；6 验收标准第 2 条；7 版本规划）。
   **剩余遗留**：① `data.json` 仍只有 3 台（今天不改前端）——Day 17 前端切到接口后自然对齐；
   ② `TECH_DESIGN.md` 第 63 行写着"本期固定 3 台"，待同步。
7. **2 台新机体的渠道报价** —— `mg-sazabi-verka` / `mg-nu-verka` 目前没有任何渠道价，详情页会显示"暂无报价"。何时补录由 Master 定（补录后 `kit_prices` 行数会超过 12）。
8. **汇率的落点** —— `meta.exchangeRate` 现在来自云函数常量 `0.048`（`app_meta` 表未建，Day 17 不改表结构）。等哪天要动汇率了，一并把 `app_meta` 表建起来改成查库。
9. **接口返回 5 台，前端页面只有 3 台** —— 库里有 5 台机体，`data/data.json` 仍是 3 台。Day 17 的两条接口是直接查库的，所以**接口会比页面多出 2 台**（`mg-nu-verka` / `mg-sazabi-verka`，无报价、页面暂无图）。等前端切到接口（第 5 节）后自然对齐；在那之前，页面与接口数字不一致属预期现象。
10. **前端何时切到接口** —— 第 5 节登记了"接口就绪后，前端怎么改"。Day 17 只做接口本身，**不碰前端**；切换时机（是否要同时开跨域）由后续天数决定。

---

## 7. 变更记录

| 日期 | 变更 | 产出 |
|---|---|---|
| 2026-10-02 | 首次登记；`GET /api/health` 已上线并验证 | Day 15 |
| 2026-10-02 | 第 2 节落地为真实表：`kits` / `kit_prices` 按 `gundam-price/db/schema.sql` 建成，`seed.sql` 灌入 5 台机体 + 12 条渠道价（两脚本均可重复执行，已 select 验证）。补记外键 `kit_prices."kitId" → kits.id`（`ON DELETE CASCADE`）、联合唯一约束 `kit_prices_unique_channel`、`platform`/`marketType` 的枚举 `CHECK`；类型列换成实际建表类型；2.3 / 2.4 标记未建；第 6 节新增「PRD 台数待同步」「2 台新机无报价」两项待办；同日已同步 `PRD.md` 收录台数 3 → 5（第 6 节待定项 6 关闭） | Day 16 |
| 2026-10-03 | **统一响应外壳改为 `{ok, data, error}`**（第 1 节原写"直接返回数据对象"，今天按实现要求改成统一外壳，成功/失败两行重写；4.2 / 4.4 的响应示例同步换成外壳版）。**接口 2 `GET /api/kits`、接口 4 `GET /api/prices` 代码实现完成**：非法参数 400、方法不对 405、未登记路径 404、上游故障 500；第 4 节补「Day 17 实现说明」两张表（含 4.2 与 4.4 的 `total` 语义差异）；新增 0.1 节登记云函数目录、运行时、依赖与环境变量清单；第 6 节新增待定项 8/9/10（汇率落点、接口 5 台 vs 页面 3 台、前端切换时机）。**取数方案当日二改**：原计划 pg 直连，因控制台不展示「连接信息」（社区 issue #1297）改为**数据网关 REST API + API Key**（0.1 节已更新，无第三方依赖，本地桩自检 51/51 通过）。**部署与真库验证当日未完成（跨日续做，结果见 2026-10-04 行）** | Day 17 |
| 2026-10-04 | **接口 2 / 接口 4 部署上线并真库验证通过**。云函数 `api`（HTTP 云函数，Nodejs 18.15）在控制台建成；环境变量 2 条（`CLOUDBASE_ENV_ID` / `CLOUDBASE_API_KEY`）；HTTP 网关路由 `/api/kits`、`/api/prices` → `api`，**路径透传开启**（关键：关闭时一函数多路由会错位），身份认证关闭。实测 `/api/kits` 返回 `total:5`、`/api/prices` 返回 `total:12`；SQL 编辑器改 `pr_0002` 价格 230 → 199，两个接口同步体现（`minPrice` 230 → 199），改回复核通过。0.1 节补「实际部署结果」表。接口 2 / 4 状态由 🟡 升 ✅ | Day 17 |
