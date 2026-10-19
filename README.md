# 高达行情（Gundam Price Watch）

MG 高达模型的多渠道价格比价网页：一台模型在拼多多 / 淘宝 / 闲鱼的现价对比、五算基准价与行情档位（捡漏 / 合理 / 溢价）、近 30 天价格走势，外加五算计算器和每日打卡检查页。

本项目是 28 天 vibe coding 打卡项目的实战作品，从 Day 1 的静态页面迭代到现在的「静态前端 + CloudBase 云函数 + PostgreSQL」结构。

- **在线地址**：<https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com>（CloudBase 静态托管 + 云函数 `/api/*`）

## 快速开始

本地预览（不改数据时看页面够用）：

```bash
cd gundam-price
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

每天更新价格、手机访问、常见报错，见 **[gundam-price/运行说明.md](gundam-price/运行说明.md)**——日常操作只看那一份就够了。

## 发布前检查（提交 / 部署之前先跑这条）

```bash
# 在仓库根目录执行
bash gundam-price/scripts/verify-project.sh

# 没网 / 不想碰公网时，只跑静态项
bash gundam-price/scripts/verify-project.sh --offline
```

16 项检查逐项输出 `PASS / FAIL / SKIP` 和证据，覆盖：密钥与配置、前端版本号与资源引用、后端兜底与防重复写入、公网接口与跨域白名单。全绿（无 FAIL）才发。

- 每项检查的判据和踩坑来历：[gundam-price/skills/verify-project/SKILL.md](gundam-price/skills/verify-project/SKILL.md)
- 误报豁免只写在 [gundam-price/skills/verify-project/allowlist.txt](gundam-price/skills/verify-project/allowlist.txt)，且只允许收文档示例值

## 仓库结构

```
├── PRD.md               # 产品需求文档（Day 4）
├── TECH_DESIGN.md       # 技术设计
├── api-contract.md      # 前后端接口契约
├── AGENTS.md            # 给 AI 协作者的项目约定
└── gundam-price/        # 项目本体
    ├── index.html / detail.html / calc.html / check.html
    ├── js/  css/  img/
    ├── cloudfunctions/  # CloudBase 云函数（/api/*）
    ├── db/              # 建表 SQL（schema.sql）
    ├── data/            # 本地数据源 data.json
    ├── scripts/         # check-secrets.sh、verify-project.sh
    ├── skills/          # 可复用检查 Skill（frontend-design、verify-project）
    ├── docs/            # 各 Day 的自查清单、修复记录、检查报告
    └── 运行说明.md       # ← 日常操作入口（启动 / 录数据 / 排错 / 组件用法）
```

## 文档索引

| 想找什么 | 去哪 |
|---|---|
| 怎么启动、怎么录数据、报错怎么办 | `gundam-price/运行说明.md` |
| 发布前 16 项检查怎么用、每项为什么存在 | `gundam-price/skills/verify-project/SKILL.md` |
| 产品要做什么、验收标准 | `PRD.md` |
| 接口长什么样、字段含义 | `api-contract.md` |
| 安全自查、修复记录、检查报告 | `gundam-price/docs/`（Day 23 ~ Day 25） |
