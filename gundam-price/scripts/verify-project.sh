#!/usr/bin/env bash
# ===========================================================================
# verify-project.sh ｜ 发布前检查执行器（Day 25 产出）
# ===========================================================================
# 【说明书】gundam-price/skills/verify-project/SKILL.md（检查项、判据、为什么查这项）
#
# 【用法】
#   bash gundam-price/scripts/verify-project.sh              # 全量（静态 + 公网）
#   bash gundam-price/scripts/verify-project.sh --offline    # 只跑静态项（没网也能跑）
#
# 【输出】逐项 PASS / FAIL / SKIP + 证据；末尾一张汇总表。
# 【退出码】0 = 没有 FAIL（可以发布）；1 = 有 FAIL（先修）；2 = 环境不对（不是 bash / 找不到目录）
#
# 【设计原则】
#   ① 每项只回答一个问题，判据写在 SKILL.md 里，不靠"看着差不多"；
#   ② FAIL 必须带证据（命中了什么、期望什么、实际什么），不打印一句"失败"了事；
#   ③ 查不了的项宁可 SKIP 并说明，也不假装 PASS —— 虚报通过比漏报更害人。
# ===========================================================================

if [ -z "${BASH_VERSION:-}" ]; then
  echo "请用 bash 运行：bash gundam-price/scripts/verify-project.sh" >&2
  exit 2
fi

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd) || exit 2
FRONT_DIR=$(cd "$SCRIPT_DIR/.." && pwd) || exit 2
ROOT_DIR=$(cd "$FRONT_DIR/.." && pwd) || exit 2
ALLOWLIST="$FRONT_DIR/skills/verify-project/allowlist.txt"

# ---- 可调基线（库里数据变了就改这里，别改判据）---------------------------
BASE_URL="https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com"
ORIGIN_OK="http://localhost:8000"          # 必须被放行的本机来源
ORIGIN_BAD="https://evil.example.com"      # 必须不被放行的陌生来源
EXPECT_KITS=5                              # kits 表机体数（Day 24 基线）
EXPECT_PRICES=14                           # kit_prices 记录数（Day 24 基线）

OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数：$arg（可用：--offline / --help）" >&2; exit 2 ;;
  esac
done

TMPD=$(mktemp -d 2>/dev/null || echo "/tmp/verify-project.$$")
mkdir -p "$TMPD"
# Windows 上 mktemp 返回的是 C:\...\Temp/xxx 这种混写路径，部分工具处理起来会别扭，
# 统一转成 /c/... 的 POSIX 写法（Git Bash 自带 cygpath）。
if command -v cygpath >/dev/null 2>&1; then TMPD=$(cygpath -u "$TMPD"); fi
# 清理用 find -delete：本机的 rm 被安全策略拦（SAFE_DELETE_INVALID_PATH），find 可以正常删。
trap 'find "$TMPD" -delete 2>/dev/null; rmdir "$TMPD" 2>/dev/null' EXIT

PASS_N=0; FAIL_N=0; SKIP_N=0; FAILED_IDS=""
LINE="=================================================================="
SUB="------------------------------------------------------------------"

pass() { PASS_N=$((PASS_N+1)); printf '[PASS] %-4s %s\n' "$1" "$2"; shift 2; for e in "$@"; do printf '       证据: %s\n' "$e"; done; }
fail() { FAIL_N=$((FAIL_N+1)); FAILED_IDS="$FAILED_IDS $1"; printf '[FAIL] %-4s %s\n' "$1" "$2"; shift 2; for e in "$@"; do printf '       证据: %s\n' "$e"; done; }
skip() { SKIP_N=$((SKIP_N+1)); printf '[SKIP] %-4s %s\n' "$1" "$2"; shift 2; for e in "$@"; do printf '       说明: %s\n' "$e"; done; }

# 长行截断，避免一条命中把屏幕刷满
cutln() { cut -c1-150; }

# ---- 现场信息 -------------------------------------------------------------
HEAD_SHORT=$(git -C "$ROOT_DIR" log -1 --format=%h 2>/dev/null || echo "无 Git")
DIRTY=$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "$DIRTY" = "0" ] && DIRTY_TXT="干净" || DIRTY_TXT="有 $DIRTY 个未提交改动"

echo "$LINE"
echo "高达行情 · 发布前检查（Day 25 · verify-project）"
echo "执行时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo "仓库版本：$HEAD_SHORT   工作区：$DIRTY_TXT"
if [ "$OFFLINE" = "1" ]; then echo "模式：仅静态（--offline，跳过错公网 6 项）"; else echo "模式：全量（静态 10 项 + 公网 6 项）"; fi
echo "检查范围：$FRONT_DIR"
echo "$LINE"
echo ""

# ===========================================================================
# 一、静态检查（不联网）
# ===========================================================================

# ---- S1 密钥真值扫描 ------------------------------------------------------
# 踩坑来源：Day 23 —— 密钥只能放云函数环境变量，代码里不能有真值。
# 判据：check-secrets.sh 有效命中 = 0 条；命中但属于 allowlist 里的文档示例 → 不算。
S1_OUT=$(cd "$FRONT_DIR" && sh scripts/check-secrets.sh . 2>/dev/null)
S1_RAW=$(printf '%s\n' "$S1_OUT" | sed -n 's/.*【命中条数】\([0-9][0-9]*\).*/\1/p' | tail -1)
S1_RAW=${S1_RAW:-0}
# 命中块里除了命中行，还夹着空行和 ==== 分隔线 —— 都要剔掉，否则会把分隔线数成"第 3 条命中"。
S1_HITS=$(printf '%s\n' "$S1_OUT" | sed -n '/【命中结果】/,/【命中条数】/p' \
  | grep -vE '^(【|=+$)' | grep -v '（无输出）' || true)

S1_EXEMPTED=""
: > "$TMPD/s1_hits.txt"; printf '%s\n' "$S1_HITS" | grep . > "$TMPD/s1_hits.txt" || true
: > "$TMPD/s1_exempt.txt"
if [ -s "$TMPD/s1_hits.txt" ] && [ -f "$ALLOWLIST" ]; then
  grep -vE '^[[:space:]]*(#|$)' "$ALLOWLIST" > "$TMPD/allow.txt" 2>/dev/null || : > "$TMPD/allow.txt"
  if [ -s "$TMPD/allow.txt" ]; then
    S1_EXEMPTED=$(grep -E -f "$TMPD/allow.txt" "$TMPD/s1_hits.txt" || true)
    printf '%s\n' "$S1_EXEMPTED" | grep . > "$TMPD/s1_exempt.txt" || true
  fi
fi
# 【踩坑】这里不能用 `grep -v ... || cat 原文件` 兜底：
#   grep -v 在「所有行都被过滤掉」时返回码也是 1（它表示"没有选中任何行"），
#   于是兜底被误触发，把已豁免的行又当成命中打回来 —— 白名单等于失效。
#   正确的区分：返回码 1 = 全被豁免（正常）；返回码 ≥2 = 真出错，才回退。
S1_EFFECTIVE=$(grep -vF -x -f "$TMPD/s1_exempt.txt" "$TMPD/s1_hits.txt" 2>/dev/null)
[ $? -ge 2 ] && S1_EFFECTIVE=$(cat "$TMPD/s1_hits.txt")
S1_EFF_N=$(printf '%s\n' "$S1_EFFECTIVE" | grep -c . || true)

if [ "$S1_RAW" = "0" ]; then
  pass S1 "密钥真值扫描 —— 0 条命中" "脚本 scripts/check-secrets.sh：命中条数 0"
elif [ "$S1_EFF_N" = "0" ]; then
  EX_N=$(printf '%s\n' "$S1_EXEMPTED" | grep -c . || true)
  pass S1 "密钥真值扫描 —— 有效命中 0 条（$EX_N 条为白名单文档示例）" \
      "原始命中 $S1_RAW 条，全部匹配 allowlist.txt（Day 23 自查清单里的示例值）" \
      "白名单示例：$(printf '%s\n' "$S1_EXEMPTED" | head -1 | cutln)"
else
  fail S1 "密钥真值扫描 —— 有 $S1_EFF_N 条有效命中" \
      "第一条：$(printf '%s\n' "$S1_EFFECTIVE" | head -1 | cutln)" \
      "期望：0 条；真值一律迁到云函数环境变量，文档示例加入 allowlist.txt 并注明来源"
fi

# ---- S2 .env 不入库且被忽略 ----------------------------------------------
# 踩坑来源：Day 23 —— .env 是"做好的菜"，绝不能进仓库；.env.example 是"菜谱"，必须进。
# 【第一轮误报记录】原判据用 grep -iE '\.env|\.pem|\.key|credential|secret'，
#   把 scripts/check-secrets.sh 也当成了敏感文件 —— 因为它文件名里有 "secret"。
#   修法：按「文件名形态」匹配，不按关键词匹配；扫描脚本本身不是密钥文件。
S2_TRACKED=$(git -C "$ROOT_DIR" ls-files 2>/dev/null \
  | grep -iE '(^|/)\.env(\.[^/]*)?$|\.pem$|\.key$|(^|/)(credential|secret)s?\.(json|ya?ml|ini|txt|env)$' \
  | grep -v '\.env\.example$' || true)
S2_IGN=$(git -C "$ROOT_DIR" check-ignore -v .env 2>/dev/null || true)
if [ -z "$S2_TRACKED" ] && [ -n "$S2_IGN" ]; then
  pass S2 ".env 未入库且被忽略" \
      "已跟踪的敏感文件：0 个（已排除 .env.example）" \
      "忽略规则：$(printf '%s' "$S2_IGN" | head -1)"
elif [ -n "$S2_TRACKED" ]; then
  fail S2 ".env / 密钥类文件被 Git 跟踪" "已跟踪：$(printf '%s\n' "$S2_TRACKED" | head -3 | tr '\n' ' ')" \
      "期望：除 .env.example 外一个都不进仓库；从索引移除并作废对应密钥"
else
  fail S2 ".env 没有被 .gitignore 拦住" "git check-ignore .env 无输出" \
      "期望：命中 .gitignore 规则（.env 与 .env.* 两行都要有）"
fi

# ---- S3 Git 历史无密钥 ----------------------------------------------------
# 踩坑来源：Day 23 —— 代码里删掉密钥 ≠ 安全，旧提交里仍能翻出来。
# 注意：先落盘再 grep。直连管道在本机偶发丢输出（实测过一次），落盘最稳。
git -C "$ROOT_DIR" log --all -p > "$TMPD/hist.txt" 2>/dev/null || : > "$TMPD/hist.txt"
S3_HITS=$(grep -nE '^\+.*(password|passwd|secret|api[_]?key|apikey|token|access[_]?key|private[_]?key)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}' "$TMPD/hist.txt" || true)
: > "$TMPD/s3_hits.txt"; printf '%s\n' "$S3_HITS" | grep . > "$TMPD/s3_hits.txt" || true
: > "$TMPD/s3_exempt.txt"
if [ -s "$TMPD/s3_hits.txt" ] && [ -s "$TMPD/allow.txt" ]; then
  grep -E -f "$TMPD/allow.txt" "$TMPD/s3_hits.txt" | grep . > "$TMPD/s3_exempt.txt" || true
fi
S3_EFF=$(grep -vF -x -f "$TMPD/s3_exempt.txt" "$TMPD/s3_hits.txt" 2>/dev/null)
[ $? -ge 2 ] && S3_EFF=$(cat "$TMPD/s3_hits.txt")
S3_EFF_N=$(printf '%s\n' "$S3_EFF" | grep -c . || true)
S3_EX_N=$(grep -c . "$TMPD/s3_exempt.txt" 2>/dev/null || true)
S3_EX_N=${S3_EX_N:-0}
if [ "${S3_EFF_N:-0}" -le 0 ]; then
  pass S3 "Git 历史无密钥赋值" \
      "扫描 $(wc -l < "$TMPD/hist.txt" | tr -d ' ') 行历史 diff：有效命中 0 条（白名单豁免 $S3_EX_N 条文档示例）"
else
  fail S3 "Git 历史里有 $S3_EFF_N 处密钥赋值" \
      "第一条：$(printf '%s\n' "$S3_EFF" | head -1 | cutln)" \
      "期望：0 条；一旦确认是真值，必须去平台作废并重新生成，光删代码没用"
fi

# ---- 采集页面里所有本地 js/css 引用（S4 / S5 / S6 共用）------------------
: > "$TMPD/refs.txt"
for html in "$FRONT_DIR"/*.html; do
  [ -f "$html" ] || continue
  page=$(basename "$html")
  grep -oE '(src|href)="[^"]+\.(js|css)[^"]*"' "$html" 2>/dev/null \
    | sed -E 's/^(src|href)="//; s/"$//' \
    | while IFS= read -r ref; do
        case "$ref" in http://*|https://*|//*) continue ;; esac
        p=${ref%%\?*}; v="NONE"
        case "$ref" in *\?v=*) v=${ref#*\?v=} ;; esac
        printf '%s|%s|%s\n' "$p" "$v" "$page" >> "$TMPD/refs.txt"
      done
done
REF_N=$(wc -l < "$TMPD/refs.txt" | tr -d ' ')

# ---- S4 版本号一致性 ------------------------------------------------------
# 踩坑来源：Day 11 —— 改了 js 没升 ?v=，浏览器继续用旧缓存，表现为"代码改了但没生效"。
# 判据：同一个文件在所有页面里的 v 必须相同，且每个本地 js/css 都必须带 ?v=。
S4_MULTI=$(cut -d'|' -f1,2 "$TMPD/refs.txt" | sort -u \
  | awk -F'|' '{c[$1]++; v[$1]=v[$1]" "$2} END{for(k in c) if(c[k]>1) print k":"v[k]}' | head -5)
S4_NOVER=$(grep -c '|NONE|' "$TMPD/refs.txt" || true)
if [ -z "$S4_MULTI" ] && [ "$S4_NOVER" = "0" ]; then
  pass S4 "前端版本号一致（$REF_N 处引用，无缺失、无分歧）" \
      "每个本地 js/css 在 4 个页面里的 ?v= 唯一"
else
  # 两类问题合并成一条 FAIL（否则一次改动会重复计数，汇总数字失真）
  S4_MSG=""
  [ -n "$S4_MULTI" ] && S4_MSG="版本号分歧 → $(printf '%s' "$S4_MULTI" | head -2 | tr '\n' ';')"
  [ "$S4_NOVER" != "0" ] && S4_MSG="$S4_MSG 缺 ?v= 的引用 $S4_NOVER 处 → $(grep '|NONE|' "$TMPD/refs.txt" | head -2 | tr '\n' ';')"
  fail S4 "前端版本号不一致" "$S4_MSG" \
      "期望：同一文件全站同一个 ?v=；每个本地 js/css 都带 ?v=YYYYMMDD，否则缓存失效不了"
fi

# ---- S5 版本号不落后于代码改动 -------------------------------------------
# 【第二轮补入：这是第一版真实存在的漏报】
#   第一版只查「同一文件在四个页面里一致」。可如果四个页面**一起忘了升版本号**，
#   它照样全绿 —— 但浏览器拿的还是旧缓存，Day 23 的错误文案改造就等于没上线。
#   补的判据：?v=YYYYMMDD 不得早于该文件最后一次提交的日期。
# 【已知边界】只看已提交的历史；本地改了还没提交的改动查不出来（要靠 git status + 人工）。
S5_BAD=""
while IFS='|' read -r p v _page; do
  case "$v" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) continue ;; esac
  last=$(git -C "$ROOT_DIR" log -1 --format=%ad --date=format:%Y%m%d -- "gundam-price/$p" 2>/dev/null)
  [ -z "$last" ] && continue
  if [ "$last" -gt "$v" ]; then
    S5_BAD="$S5_BAD$p(v=$v < 最后改动 $last) "
  fi
done < <(cut -d'|' -f1,2 "$TMPD/refs.txt" | sort -u)

if [ -z "$S5_BAD" ]; then
  pass S5 "版本号跟得上代码改动（v 均不早于最后提交日）" \
      "逐文件比对 git log 最后提交日期，无落后项"
else
  fail S5 "有文件的版本号落后于它的改动" "$(printf '%s' "$S5_BAD" | cut -c1-150)" \
      "后果：浏览器继续用旧缓存，改了等于没改；把 ?v= 升到不早于最后改动日期，四个页面一起改"
fi

# ---- S6 本地资源引用全部存在 ---------------------------------------------
# 踩坑来源：Day 11 —— 路径写错/文件漏提交，页面直接白屏或卡片变白。
S6_MISSING=$(cut -d'|' -f1 "$TMPD/refs.txt" | sort -u | while IFS= read -r p; do
  [ -f "$FRONT_DIR/$p" ] || echo "$p"
done)
S6_UNIQ=$(cut -d'|' -f1 "$TMPD/refs.txt" | sort -u | wc -l | tr -d ' ')
if [ -z "$S6_MISSING" ]; then
  pass S6 "本地 js/css 引用全部存在（$S6_UNIQ 个文件）" "逐个 test -f 通过"
else
  fail S6 "有引用指向不存在的文件" "$(printf '%s\n' "$S6_MISSING" | head -3 | tr '\n' ' ')" \
      "期望：$S6_UNIQ 个引用全部能落到实体文件"
fi

# ---- S7 云函数环境变量清单一致 + 缺配时有明确报错 ------------------------
# 踩坑来源：Day 18 / Day 24 —— 环境变量只在控制台配，漏一个就 ConfigError；
#          且改完不重新部署不生效。代码里用到的变量必须都在 .env.example 登记。
S7_CODE=$(grep -rhoE 'process\.env\.[A-Za-z0-9_]+' "$FRONT_DIR/cloudfunctions" 2>/dev/null | sed 's/^process\.env\.//' | sort -u)
S7_DECL=$(grep -oE '^[A-Z][A-Z0-9_]*=' "$FRONT_DIR/.env.example" 2>/dev/null | tr -d '=' | sort -u)
S7_MISSING=$(comm -23 <(printf '%s\n' "$S7_CODE" | grep .) <(printf '%s\n' "$S7_DECL" | grep .) 2>/dev/null || true)
S7_CFG=$(grep -c 'ConfigError' "$FRONT_DIR/cloudfunctions/api/index.js" 2>/dev/null || true)
if [ -z "$S7_MISSING" ] && [ "${S7_CFG:-0}" -ge 1 ]; then
  pass S7 "云函数环境变量清单一致（代码用到 $(printf '%s\n' "$S7_CODE" | grep -c .) 个，模板全登记）" \
      "未登记变量：0 个；缺配分支 ConfigError → 500 明确报错"
else
  [ -n "$S7_MISSING" ] && fail S7 "有环境变量没在 .env.example 登记" \
      "缺：$(printf '%s\n' "$S7_MISSING" | tr '\n' ' ')" \
      "期望：代码里每个 process.env.X 都能在模板里找到，否则换环境必漏配"
  [ "${S7_CFG:-0}" -lt 1 ] && fail S7 "缺配时没有明确报错分支" "index.js 里找不到 ConfigError" \
      "期望：缺环境变量回 500 + 中文说明，而不是笼统 500 或进程崩掉"
fi

# ---- S8 未登记路径兜底 + 前端 status=0 判定链 ----------------------------
# 踩坑来源：Day 24 —— 网关对未登记路径回 404 且不带跨域头，浏览器拒收，
#          fetch 抛异常 → api.js 挂 status=0 → 用户看到"连不上服务器（其实是接口不存在）"。
# 判据：后端必须有 route===null → 404 NOT_FOUND 的兜底；前端必须保留 status=0 判定
#       （这样"真网络故障"和"后端 404"才不会混为一谈）。
S8_A=$(grep -n 'route === null' "$FRONT_DIR/cloudfunctions/api/index.js" 2>/dev/null | head -1)
S8_B=$(grep -n "NOT_FOUND" "$FRONT_DIR/cloudfunctions/api/index.js" 2>/dev/null | head -1)
S8_C=$(grep -n 'NETWORK_ERROR' "$FRONT_DIR/js/api.js" 2>/dev/null | head -1)
if [ -n "$S8_A" ] && [ -n "$S8_B" ] && [ -n "$S8_C" ]; then
  pass S8 "未登记路径有兜底，前端错误分层完整" \
      "后端 index.js:${S8_A%%:*} route===null → ${S8_B}" \
      "前端 api.js:${S8_C%%:*} fetch 异常 → status=0 / NETWORK_ERROR"
else
  fail S8 "错误分层链缺环，404 会被伪装成网络故障" \
      "缺少：$( [ -z "$S8_A" ] && printf 'route===null 兜底 ' ; [ -z "$S8_C" ] && printf 'status=0 判定 ' )" \
      "期望：网关之外的 404 由云函数兜底（返回本项目外壳），前端才拿得到真状态码"
fi

# ---- S9 软删除与防重复写入 -----------------------------------------------
# 踩坑来源：Day 22 —— 重复打卡靠唯一索引兜底；删除是软删除（行还在，isDeleted=true）。
# 判据：唯一索引必须带 WHERE isDeleted = false，否则"删掉后当天再也不能打卡"。
S9_IDX=$(grep -n 'checkins_unique_active_day' "$FRONT_DIR/db/schema.sql" 2>/dev/null | head -1)
S9_WHERE=$(grep -n 'WHERE "isDeleted" = false' "$FRONT_DIR/db/schema.sql" 2>/dev/null | head -1)
S9_DEF=$(grep -nE '"isDeleted"[[:space:]]+boolean[[:space:]]+NOT NULL DEFAULT false' "$FRONT_DIR/db/schema.sql" 2>/dev/null | head -1)
if [ -n "$S9_IDX" ] && [ -n "$S9_WHERE" ] && [ -n "$S9_DEF" ]; then
  pass S9 "防重复写入索引与软删除完整" \
      "schema.sql:${S9_IDX%%:*} 唯一索引 checkins_unique_active_day" \
      "schema.sql:${S9_WHERE%%:*} 只约束未删除行；isDeleted 默认 false"
else
  fail S9 "软删除 / 防重复索引缺项" \
      "缺少：$( [ -z "$S9_IDX" ] && printf '唯一索引 ' ; [ -z "$S9_WHERE" ] && printf 'WHERE isDeleted=false ' ; [ -z "$S9_DEF" ] && printf 'isDeleted 默认值 ' )" \
      "期望：重复写入被数据库拦下，且软删除后能重新打卡"
fi

# ---- S10 用户文案不含技术术语 --------------------------------------------
# 踩坑来源：Day 23 —— "Failed to fetch""HTTP 500""JSON" 不能出现在用户可见文案里。
# 【第一轮误报记录】原判据把 MESSAGES 对象里的注释也算进了"用户文案"：
#   注释写着「不说 Failed to fetch」，结果被当成"漏给用户的技术术语"报了出来。
#   修法：只取真正会展示出去的值行（`KEY: '...'`），注释行不参与判定。
S10_BLOCK=$(sed -n '/^const MESSAGES = {/,/^};/p' "$FRONT_DIR/js/error-message.js" 2>/dev/null \
  | grep -E "^[[:space:]]*[A-Z]+:[[:space:]]*['\"]")
S10_LEAK=$(printf '%s\n' "$S10_BLOCK" | grep -nE 'Failed to fetch|JSON|HTTP [0-9]{3}' || true)
S10_FILTER=$(grep -c 'Failed to fetch|TypeError' "$FRONT_DIR/js/error-message.js" 2>/dev/null || true)
if [ -z "$S10_LEAK" ] && [ "${S10_FILTER:-0}" -ge 1 ]; then
  pass S10 "用户文案不含技术术语" \
      "MESSAGES 三条固定文案：输入错 / 网络错 / 服务端错，无英文异常、无裸状态码" \
      "另有技术原话过滤器（Failed to fetch / TypeError …）兜住后端传上来的英文"
else
  fail S10 "用户文案里漏出技术术语" \
      "$(printf '%s\n' "$S10_LEAK" | head -3 | cutln)" \
      "期望：MESSAGES 里只有中文人话；技术细节只进 console"
fi

# ===========================================================================
# 二、公网检查（需要网络）
# ===========================================================================
echo ""
if [ "$OFFLINE" = "1" ]; then
  for id in N1 N2 N3 N4 N5 N6; do skip "$id" "公网检查（--offline 跳过）" "去掉 --offline 即可跑"; done
elif ! command -v curl >/dev/null 2>&1; then
  for id in N1 N2 N3 N4 N5 N6; do skip "$id" "公网检查" "找不到 curl，无法发请求"; done
else
  H="$TMPD/hdrs.txt"

  # ---- N1 健康接口 -------------------------------------------------------
  C1=$(curl -s -m 20 -o "$TMPD/n1.json" -w '%{http_code}' "$BASE_URL/api/health" 2>/dev/null); R1=$?
  B1=$(cat "$TMPD/n1.json" 2>/dev/null)
  if [ "$R1" != "0" ] || [ -z "$C1" ] || [ "$C1" = "000" ]; then
    fail N1 "健康接口不可达" "curl 退出码 $R1（超时/断网/域名解析失败）" \
        "期望：HTTP 200 + {\"ok\":true}；先确认网络，再看云函数是否在跑"
  elif [ "$C1" = "200" ] && printf '%s' "$B1" | grep -q '"ok":true'; then
    pass N1 "健康接口 200（不依赖数据库）" "GET /api/health → $C1 $(printf '%s' "$B1" | cutln)"
  else
    fail N1 "健康接口返回异常" "HTTP $C1 $(printf '%s' "$B1" | cutln)" "期望：200 且 ok=true"
  fi

  # ---- N2 读接口与数据基线 ----------------------------------------------
  C2=$(curl -s -m 20 -o "$TMPD/n2k.json" -w '%{http_code}' "$BASE_URL/api/kits" 2>/dev/null)
  C3=$(curl -s -m 20 -o "$TMPD/n2p.json" -w '%{http_code}' "$BASE_URL/api/prices" 2>/dev/null)
  C4=$(curl -s -m 20 -o "$TMPD/n2c.json" -w '%{http_code}' "$BASE_URL/api/checkins" 2>/dev/null)
  KITS=$(grep -oE '"total":[0-9]+' "$TMPD/n2k.json" 2>/dev/null | head -1 | cut -d: -f2)
  PRICES=$(grep -oE '"total":[0-9]+' "$TMPD/n2p.json" 2>/dev/null | head -1 | cut -d: -f2)
  CHK=$(grep -oE '"total":[0-9]+' "$TMPD/n2c.json" 2>/dev/null | head -1 | cut -d: -f2)
  if [ "$C2" = "200" ] && [ "$C3" = "200" ] && [ "$C4" = "200" ] \
     && [ "${KITS:-x}" = "$EXPECT_KITS" ] && [ "${PRICES:-x}" = "$EXPECT_PRICES" ]; then
    pass N2 "三条读接口全部 200，数据基线吻合" \
        "GET /api/kits → total=$KITS（基线 $EXPECT_KITS）" \
        "GET /api/prices → total=$PRICES（基线 $EXPECT_PRICES）；GET /api/checkins → total=${CHK:-?}"
  else
    fail N2 "读接口或数据基线不对" \
        "HTTP：kits=$C2 prices=$C3 checkins=$C4" \
        "total：kits=${KITS:-无}（基线 $EXPECT_KITS） prices=${PRICES:-无}（基线 $EXPECT_PRICES）" \
        "期望：200 且数量与基线一致；数量变了先确认是不是测试数据没清"
  fi

  # ---- N3 未登记路径返回本项目外壳 404 -----------------------------------
  # 这条路由只存在 CloudBase 控制台（不在 Git 里），重建环境最容易丢 → 必须每次发布验。
  C5=$(curl -s -m 20 -o "$TMPD/n3.json" -w '%{http_code}' "$BASE_URL/api/nope" 2>/dev/null)
  B5=$(cat "$TMPD/n3.json" 2>/dev/null)
  if [ "$C5" = "404" ] && printf '%s' "$B5" | grep -q '"code":"NOT_FOUND"'; then
    pass N3 "未登记路径返回本项目外壳 404 NOT_FOUND" \
        "GET /api/nope → HTTP $C5 $(printf '%s' "$B5" | cutln)" \
        "说明：控制台 /api 兜底路由仍在（这条不在 Git 里，重建环境要重配）"
  elif printf '%s' "$B5" | grep -q 'INVALID_PATH'; then
    fail N3 "兜底路由丢了：又回到网关的 INVALID_PATH" \
        "GET /api/nope → HTTP $C5 $(printf '%s' "$B5" | cutln)" \
        "期望：{\"error\":{\"code\":\"NOT_FOUND\"}}；去控制台 HTTP 访问服务 补 /api 前缀路由（路径透传开）"
  else
    fail N3 "未登记路径行为不对" "GET /api/nope → HTTP $C5 $(printf '%s' "$B5" | cutln)" \
        "期望：404 + 本项目统一外壳 error.code=NOT_FOUND"
  fi

  # ---- N4 跨域白名单 -----------------------------------------------------
  curl -s -m 20 -D "$H" -o /dev/null -H "Origin: $ORIGIN_OK" "$BASE_URL/api/kits" 2>/dev/null
  ACAO_OK=$(tr -d '\r' < "$H" | grep -i '^access-control-allow-origin:' | head -1 | cut -d: -f2- | sed 's/^ *//')
  curl -s -m 20 -D "$TMPD/hdrs2.txt" -o /dev/null -H "Origin: $ORIGIN_BAD" "$BASE_URL/api/kits" 2>/dev/null
  ACAO_BAD=$(tr -d '\r' < "$TMPD/hdrs2.txt" | grep -i '^access-control-allow-origin:' | head -1 | cut -d: -f2- | sed 's/^ *//')
  if [ -z "$ACAO_OK" ]; then
    fail N4 "本机来源被跨域拦住" "Origin: $ORIGIN_OK → 响应里没有 access-control-allow-origin" \
        "期望：回显 $ORIGIN_OK；去控制台「跨域设置」把来源加进去，别用全量 *"
  elif [ "$ACAO_OK" = "*" ]; then
    pass N4 "跨域已放行（当前为全量通配 *，建议收紧）" "Origin: $ORIGIN_OK → ACAO: *" \
        "提示：项目约定按来源逐条放行，通配等于对任何网站开门"
  elif [ -n "$ACAO_BAD" ]; then
    fail N4 "陌生来源也被放行" "Origin: $ORIGIN_BAD → ACAO: $ACAO_BAD" \
        "期望：只回显白名单内的来源；陌生来源不应拿到跨域许可"
  else
    pass N4 "跨域白名单生效" "Origin: $ORIGIN_OK → ACAO: $ACAO_OK" \
        "反例：Origin: $ORIGIN_BAD → 无 ACAO 头（正确）"
  fi

  # ---- N5 写接口无密钥必须 401 -------------------------------------------
  # 只发"必定被密钥挡下"的请求：验密钥在验参数之前，所以不会写进任何数据。
  C6=$(curl -s -m 20 -o "$TMPD/n5.json" -w '%{http_code}' -X POST \
       -H 'Content-Type: application/json' \
       -d '{"kitId":"probe-not-a-kit","checkinDate":"1970-01-01","status":"未完成"}' \
       "$BASE_URL/api/checkins" 2>/dev/null)
  B6=$(cat "$TMPD/n5.json" 2>/dev/null)
  if [ "$C6" = "401" ] && printf '%s' "$B6" | grep -q 'UNAUTHORIZED'; then
    pass N5 "写接口门锁有效（无密钥 → 401）" "POST /api/checkins 不带 X-API-KEY → $C6 $(printf '%s' "$B6" | cutln)"
  else
    fail N5 "写接口门锁失效或行为异常" "POST /api/checkins 不带密钥 → HTTP $C6 $(printf '%s' "$B6" | cutln)" \
        "期望：401 + UNAUTHORIZED；立刻检查 WRITE_API_KEY 是否被删空"
  fi

  # ---- N6 单条路径方法白名单 ---------------------------------------------
  curl -s -m 20 -D "$TMPD/hdrs3.txt" -o "$TMPD/n6.json" -X GET "$BASE_URL/api/checkins/ck_0001" 2>/dev/null
  # 【第一轮解析错误记录】-D 存下来的头里有两行 HTTP：第一行是代理的
  #   `HTTP/1.1 200 Connection Established`，第二行才是真响应。
  #   原来用 grep -m1 取第一行 → 405 被读成 200，把"通过"报成了"失败"（反向误报）。
  C7=$(tr -d '\r' < "$TMPD/hdrs3.txt" | grep '^HTTP/' | tail -1 | awk '{print $2}')
  ALLOW=$(tr -d '\r' < "$TMPD/hdrs3.txt" | grep -i '^allow:' | head -1 | cut -d: -f2- | sed 's/^ *//')
  B7=$(cat "$TMPD/n6.json" 2>/dev/null)
  if [ "$C7" = "405" ] && printf '%s' "$ALLOW" | grep -qi 'PATCH'; then
    pass N6 "单条路径方法白名单（GET → 405，Allow: $ALLOW）" \
        "GET /api/checkins/ck_0001 → $C7 $(printf '%s' "$B7" | cutln)"
  else
    fail N6 "方法白名单没生效" "GET /api/checkins/ck_0001 → HTTP ${C7:-?}  Allow=${ALLOW:-无}" \
        "期望：405 + Allow: PATCH, PUT, DELETE（按路由分流，不是一刀切）"
  fi
fi

# ===========================================================================
# 三、汇总
# ===========================================================================
TOTAL=$((PASS_N + FAIL_N + SKIP_N))
echo ""
echo "$LINE"
printf '发布前检查结果：%d PASS / %d FAIL / %d SKIP（共 %d 项）\n' "$PASS_N" "$FAIL_N" "$SKIP_N" "$TOTAL"
if [ "$FAIL_N" -eq 0 ]; then
  if [ "$SKIP_N" -gt 0 ]; then
    echo "结论：静态项全部通过；$SKIP_N 项未验证（见上方 SKIP 说明），不能当作全绿。"
  else
    echo "结论：全部通过 —— 可以发布。"
  fi
  echo "$LINE"
  exit 0
else
  echo "结论：不通过 —— FAIL 项：$(printf '%s' "$FAILED_IDS" | sed 's/^ *//')"
  echo "处理规矩：一次只改一处，改完用同一条命令重跑；别同时改三个地方。"
  echo "$LINE"
  exit 1
fi
