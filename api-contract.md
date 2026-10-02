# api-contract.md ｜「高达行情」接口契约

> **Day 15 产出 · 2026-10-02（第 3 周）**
>
> ⚠️ **本文件是第 3 周建表、写接口的唯一依据。今天只登记（占位），不实现任何业务逻辑。**
> 实现从 Day 16 开始，按本文件逐条落地，接口写完前不改这里的约定；要改先改文档。
>
> 依据：`TECH_DESIGN.md` 第 5 节（数据对象及字段）+ 现有 `data/data.json`（字段一一对应）
> 环境：腾讯云 CloudBase · 环境 ID `gundam-market-d7gnjqg3h1f2f156f`（上海 · PostgreSQL）

---

## 0. 服务基址

| 项 | 值 |
|---|---|
| API 基址 | `https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com` |
| 已上线接口 | `GET /api/health` ✅（Day 15 部署并验证通过） |
| 鉴权 | **本期无登录**：读接口匿名可访问；写接口暂不对外开放（谁可写由 Day 16 拍板） |
| 跨域 | 暂不配置。前端域名与 API 域名是否同源，决定 Day 16 要不要开跨域 |

> 前端域名见「静态网站托管 → 基础配置 → 默认域名」，与上面 API 域名**不一定是同一个**（Day 15 已实测：直接用 API 域名打开前端会 404）。

---

## 1. 通用约定

| 约定项 | 规则 |
|---|---|
| 协议 | HTTPS，请求与响应体均为 `application/json; charset=utf-8` |
| 字段命名 | **小驼峰 `camelCase`**，与现有 `data.json` 完全一致（不改成下划线，前端才能零改动） |
| 成功响应 | 直接返回数据对象，**不额外包一层** `{code, data}` |
| 失败响应 | HTTP 状态码 + `{ "error": { "code": "...", "message": "..." } }` |
| 日期 | `YYYY-MM-DD`（如 `2026-09-22`） |
| 时间戳 | ISO 8601（如 `2026-10-02T16:30:00+08:00`） |
| 金额 | 人民币元，整数 `number`；日元也是整数 |
| 缺值 | 暂无报价用 `null`，**不用 `0`**（`0` 是「免费」，语义不同） |
| 分页 | 本期数据量极小（3 台机体），暂不分页；列表接口预留 `limit`/`offset` 参数 |

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

---

## 2. 数据表登记（Day 16 建表依据）

> 由现有 `data.json` 结构平移而来。**字段名不变**（TECH_DESIGN 第 11 节的承诺：字段即未来的表结构）。

### 2.1 `kits` 机体表

| 列 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (PK) | 是 | 英文小写标识，如 `mg-freedom-2`，详情页 URL 参数用它 |
| `name` | string | 是 | 机体名，如 `MG 自由 2.0` |
| `series` | string | 是 | 系列：`MG` / `MGEX` |
| `image` | string | 否 | 图片文件名（存对象存储），缺省时前端用文字占位 |
| `imagePos` | string | 否 | 图片裁剪位置，如 `center 30%` |
| `officialPriceJPY` | number | 是 | 日本官方建议零售价（日元） |
| `salesVolume` | number | 否 | 销量参考值（卡片展示用） |
| `createdAt` | timestamp | 是 | 录入时间 |
| `updatedAt` | timestamp | 是 | 最后修改时间 |

### 2.2 `kit_prices` 渠道价格记录表 ★ 核心记录表

> **每「录入一次某渠道某行/水货的价格」= 这里新增一行**。
> 详情页的「近 30 天每日最低价走势」不再单独建表：由本表按 `updatedDate` 分组取 `MIN(price)` 算出。少一张表，少一处同步。

| 列 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (PK) | 是 | 记录 id |
| `kitId` | string (FK → kits.id) | 是 | 属于哪台机体 |
| `platform` | string | 是 | 枚举：`pdd` / `taobao` / `xianyu` |
| `marketType` | string | 是 | 枚举：`行货` / `水货`（分行展示，不混算） |
| `price` | number / null | 是 | 现价（人民币元）；暂无报价存 `null` |
| `updatedDate` | date | 是 | 该条价格的录入日期 |
| `url` | string | 否 | 「去购买」跳转链接，空串 = 暂无链接 |
| `createdAt` | timestamp | 是 | 入库时间 |

**唯一约束建议**：`(kitId, platform, marketType, updatedDate)` 唯一 → 同一天同一渠道同类型只留一条，防重复录入。

### 2.3 `favorites` 收藏表

> 现在收藏存在浏览器 `localStorage`（`favorite.js`）。接后端后跨设备保留。
> 本期无登录 → 用**匿名设备号 `deviceId`** 当"用户身份"（Day 16 拍板：是否换登录）。

| 列 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (PK) | 是 | 记录 id |
| `deviceId` | string | 是 | 匿名设备号（前端生成并持久化） |
| `kitId` | string (FK → kits.id) | 是 | 收藏的机体 |
| `createdAt` | timestamp | 是 | 收藏时间 |

**唯一约束建议**：`(deviceId, kitId)` 唯一 → 同一设备不会重复收藏同一台。

### 2.4 `app_meta` 全局设置表（小表，一行）

| 列 | 类型 | 说明 |
|---|---|---|
| `exchangeRate` | number | 日元→人民币汇率（如 `0.048`），**全站一份**，五算计算用 |
| `dataUpdatedAt` | date | 数据更新日期，页面顶部展示 |

> 汇率放全局而不是每台机体存一份 —— 换汇率只改一处（延续 TECH_DESIGN 第 11 节）。

---

## 3. 接口清单（总表）

| # | 路径 | 方法 | 用途 | 谁在用 | 状态 |
|---|---|---|---|---|---|
| 1 | `/api/health` | GET | 健康检查 | 运维自检 | ✅ Day 15 已上线 |
| 2 | `/api/kits` | GET | **机体列表读取**（首页） | `js/main.js` `js/filter.js` | ⬜ 待实现 |
| 3 | `/api/kits/{id}` | GET | 单台机体详情（含渠道价 + 走势） | `js/detail.js` | ⬜ 待实现 |
| 4 | `/api/prices` | GET | **价格记录表读取**（按条件查） | 管理/统计（预留） | ⬜ 待实现 |
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

---

### 4.2 `GET /api/kits` — 机体列表读取（首页）

- **请求参数**（全部可选，可组合）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `keyword` | string | 按机体名/系列模糊搜索（对应首页搜索框） |
| `platform` | string | 只返回有该渠道报价的机体：`pdd` / `taobao` / `xianyu` |
| `series` | string | 按系列过滤：`MG` / `MGEX` |
| `limit` | number | 预留，默认不限 |

- **响应 `200`**（结构与现在 `data.json` 一致，前端换 URL 即可）：

```json
{
  "meta": { "updatedAt": "2026-09-22", "exchangeRate": 0.048 },
  "total": 3,
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
}
```

> `minPrice` = 该机体所有非 `null` 报价里的最低值（前端也可自算，后端给了更省事）。
> 列表接口**带 `channels`**：首页按平台筛选要判断"这台机体有没有该渠道的报价"。

- **错误返回**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 400 | `limit` 非法 | `{ "error": { "code": "INVALID_PARAM", "message": "limit 必须是正整数" } }` |
| 500 | 数据库异常 | `{ "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后重试" } }` |

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

- **错误返回**：

| 状态码 | 场景 | 响应体 |
|---|---|---|
| 404 | id 不存在 | `{ "error": { "code": "KIT_NOT_FOUND", "message": "没有找到这台机体" } }` |
| 500 | 数据库异常 | `{ "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后重试" } }` |

---

### 4.4 `GET /api/prices` — 价格记录表读取

- **请求参数**（全部可选）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `kitId` | string | 只查某台机体的价格记录 |
| `platform` | string | `pdd` / `taobao` / `xianyu` |
| `marketType` | string | `行货` / `水货` |
| `dateFrom` / `dateTo` | string | 录入日期范围 `YYYY-MM-DD` |
| `limit` / `offset` | number | 预留，默认 `limit=100` |

- **响应 `200`**：

```json
{
  "total": 12,
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
}
```

- **错误返回**：`400 INVALID_PARAM`（日期格式错/`limit` 非法）、`500 INTERNAL_ERROR`

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

## 6. 待定项（Day 16 拍板，今天不决定）

1. **写接口谁能调** —— 管理后台？固定密钥？还是先只留只读接口？
2. **收藏的身份** —— 继续用匿名 `deviceId`，还是上微信/手机号登录？
3. **前端与 API 是否同源** —— 决定要不要开跨域、怎么开。
4. **数据迁移** —— 现有 `data.json` 里的 3 台机体 + 12 条渠道价，一次性导入 `kits` / `kit_prices`。
5. **图片存哪** —— 现在图片在静态托管；接入对象存储后是否迁移。

---

## 7. 变更记录

| 日期 | 变更 | 产出 |
|---|---|---|
| 2026-10-02 | 首次登记；`GET /api/health` 已上线并验证 | Day 15 |
