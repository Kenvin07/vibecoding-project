-- ============================================================================
-- 高达行情 · 建表脚本  schema.sql
-- ----------------------------------------------------------------------------
-- 产出：Day 16（第 3 周）· 板块② 建表
-- 依据：api-contract.md 第 2 节「数据表登记」——表名、列名、类型全部照契约平移，
--       不自己另造一套。
-- 目标库：腾讯云 CloudBase · PostgreSQL（环境 gundam-market-d7gnjqg3h1f2f156f）
--
-- 【怎么用】在 CloudBase 控制台「数据库 → SQL 编辑器」里整段粘贴执行。
-- 【可重复执行】脚本用的是 CREATE TABLE IF NOT EXISTS：表已存在就跳过，
--              跑第二遍不报错，也不会清掉已有数据。
--
-- 【今天建两张核心表】
--   kits        机体表      一台机体 = 一行
--   kit_prices  渠道价格表  录入一次价格 = 一行（核心记录表，数据主要长在这）
-- 【两张表怎么关联】
--   kit_prices."kitId"  →  kits.id    （外键，"一台机体对多条价格记录"的一对多）
--
-- 【列名为什么带双引号】契约要求字段名保持小驼峰（officialPriceJPY 这种）。
--   PostgreSQL 会把不加引号的标识符自动折成小写，officialPriceJPY 就变成
--   officialpricejpy，然后报 "column does not exist"。所以下面凡是小驼峰的
--   列名一律用 "双引号" 包住。全小写的名字（name、price、platform…）不用包。
--
-- 【表名为什么带 public.】public 是 PostgreSQL 的默认模式（约等于"默认文件夹"），
--   建在这里的表才能被 CloudBase 的接口层看到。官方文档的建表示例也是这么写的，
--   加上它不依赖当前的默认搜索路径，最稳。
--
-- 【今天不做】权限（RLS / GRANT / Policy）今天一律不碰：今天只建表、灌数据、
--   用 select 验证。云函数怎么拿数据是 Day 17 的事，需要时再单独做。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 表一：kits 机体表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kits (
  id                 text        PRIMARY KEY,
  name               text        NOT NULL,
  series             text        NOT NULL,
  image              text,
  "imagePos"         text,
  "officialPriceJPY" integer     NOT NULL CHECK ("officialPriceJPY" >= 0),
  "salesVolume"      integer,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

-- 逐列说明（对不上就改错地方了）：
--   id                 主键。英文小写标识，如 mg-freedom-2，同时是详情页 URL 参数。
--                      不用自增数字：前后端共用同一把钥匙，省一层换算。
--   name               机体名，必填。
--   series             系列（MG / MGEX…）。故意不加取值范围限制，
--                      以后收 RG、PG 不用改表结构。
--   image              图片文件名。可空 —— 没图时前端用文字占位。
--   "imagePos"         图片裁剪位置，如 center 30%。没图时无意义，故可空。
--   "officialPriceJPY" 日本官方建议零售价（日元）。日元是整数，所以用 integer。
--                      CHECK >= 0 挡住负数。
--   "salesVolume"      销量参考值。可空且【不设默认 0】——
--                      空 = 没统计过，0 = 真的卖 0 台，语义不同。
--   "createdAt"        入库时间。timestamptz = 带时区的时刻，契约里的时间戳
--                      是 2026-10-02T16:30:00+08:00 这种带偏移的写法，配它才对得上。
--   "updatedAt"        最后修改时间。


-- ----------------------------------------------------------------------------
-- 表二：kit_prices 渠道价格表（核心记录表）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kit_prices (
  id             text        PRIMARY KEY,
  "kitId"        text        NOT NULL REFERENCES public.kits(id) ON DELETE CASCADE,
  platform       text        NOT NULL CHECK (platform IN ('pdd', 'taobao', 'xianyu')),
  "marketType"   text        NOT NULL CHECK ("marketType" IN ('行货', '水货')),
  price          integer     CHECK (price >= 0),
  "updatedDate"  date        NOT NULL,
  url            text        NOT NULL DEFAULT '',
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kit_prices_unique_channel
    UNIQUE ("kitId", platform, "marketType", "updatedDate")
);

-- 逐列说明：
--   id            主键。契约示例是 pr_0001。今天不设"自动生成"，理由：
--                 seed.sql 里会显式写入 pr_0001 ~ pr_0012，若同时挂一个自动
--                 生成器，两边容易撞号。Day 17 写「新增价格」接口时，
--                 由后端生成 id（合同 4.5 的返回里本来就要带 id）。
--   "kitId"       ★关联字段。外键指向 kits.id，两条作用：
--                   ① 不许挂空：插一条不存在的机体 id，数据库直接拒绝；
--                   ② 连带删除（ON DELETE CASCADE）：删掉某台机体时，
--                      它的价格记录自动一起删，不留孤儿数据。
--                      代价：删机体前要确认，它是"连带删"不是"拦住不让删"。
--   platform      渠道，只能是 pdd / taobao / xianyu 三个值之一。
--                  加了这层限制，渠道名打错字根本存不进去。
--                  想加京东等新渠道 → 要改表结构（ALTER TABLE），属于有意的取舍。
--   "marketType"  行货 / 水货。契约要求分行展示、不混算，
--                  限制死才不会出现「行货」「行貨」两个值混着。
--   price         现价（人民币元）。【可空且无默认值】——
--                  契约原话：暂无报价用 null，不用 0（0 是免费，语义不同）。
--                  CHECK (price >= 0) 只挡负数；值为 null 时 CHECK 会自动放行
--                  （SQL 里 null 参与比较的结果是"未知"，不算违规）。
--   "updatedDate" 录入日期。用 date 日期类型而不是文字：
--                  详情页「近 30 天每日最低价走势」就是按它分组取 MIN(price)
--                  算出来的，存文字没法这么查。
--   url           「去购买」链接。契约写"空串 = 暂无链接"，照它来。
--   "createdAt"   入库时间。
--
-- 联合唯一约束 kit_prices_unique_channel：
--   同一天 + 同一渠道 + 同一类型（行/水货）只能有一条记录，防重复录入。
--   顺带两个好处：
--     ① 契约 4.5 里那个 409「该渠道今日已有记录」，Day 17 不用自己判断，
--        数据库会直接拦下来；
--     ② 它自动建的索引最左边就是 "kitId"，正好给"查某台机的所有价格"
--        这个最常用查询加速，所以不用再单独建索引。
--   （现在总共十几行数据，不做其他索引优化，避免过早优化。）


-- ----------------------------------------------------------------------------
-- 执行完自检：应当看到 2 张表
-- ----------------------------------------------------------------------------
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN ('kits', 'kit_prices')
--  ORDER BY table_name;
