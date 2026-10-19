#!/usr/bin/env bash
# ===========================================================================
# check-live.sh ｜ 线上核验 + 回滚计时（Day 26 产出）
# ===========================================================================
# 【它回答三个问题】
#   ① 公网现在能打开吗？（首页、接口各自的状态码）
#   ② 公网现在跑的是哪一版？（读 version.json，不信肉眼）
#   ③ 从「我开始等」到「新版本真的生效」用了多久？（回滚演练的耗时证据）
#
# 【用法】
#   bash gundam-price/scripts/check-live.sh
#       立刻核验一次，打印四项结果 + 结论
#
#   bash gundam-price/scripts/check-live.sh --wait-for 0.9.0
#       盯着线上版本号，直到它变成 0.9.0 并打印耗时（默认最多等 300 秒）
#       —— 演练时先跑这条，再回控制台点上传，屏幕上的秒数就是这一步的真实耗时
#
#   bash gundam-price/scripts/check-live.sh --wait-for 1.0.0 --timeout 600
#
# 【退出码】0 全部正常；1 有异常；2 用法不对
# ===========================================================================

if [ -z "${BASH_VERSION:-}" ]; then
  echo "请用 bash 运行：bash gundam-price/scripts/check-live.sh" >&2
  exit 2
fi

set -u

# 站点域名（静态托管）与接口域名（云函数 HTTP 访问服务）不是同一个，别混用：
#   静态域名根路径 = index.html；接口域名根路径 = 网关的 INVALID_PATH（它不是站点）
BASE_STATIC="https://gundam-market-d7gnjqg3h1f2f156f-1499380808.tcloudbaseapp.com"
BASE_API="https://gundam-market-d7gnjqg3h1f2f156f-1499380808.ap-shanghai.app.tcloudbase.com"

WAIT_FOR=""
TIMEOUT=300
while [ $# -gt 0 ]; do
  case "$1" in
    --wait-for) WAIT_FOR="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-300}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1（可用：--wait-for 版本号 / --timeout 秒）" >&2; exit 2 ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "找不到 curl，无法发请求" >&2
  exit 2
fi

TMPD=$(mktemp -d 2>/dev/null || echo "/tmp/check-live.$$")
mkdir -p "$TMPD"
if command -v cygpath >/dev/null 2>&1; then TMPD=$(cygpath -u "$TMPD"); fi
trap 'find "$TMPD" -mindepth 1 -delete 2>/dev/null; rmdir "$TMPD" 2>/dev/null' EXIT

# 一次取线上版本号；取不到（旧包没有 version.json）时输出空
live_version() {
  curl -s -m 15 "$BASE_STATIC/version.json?t=$(date +%s)" 2>/dev/null \
    | tr -d '\r\n' | grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

live_build() {
  curl -s -m 15 "$BASE_STATIC/version.json?t=$(date +%s)" 2>/dev/null \
    | tr -d '\r\n' | grep -oE '"releasedAt"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

START=$(date +%s)

# ---- 等待模式：等到版本号变成目标值，打印耗时 --------------------------
if [ -n "$WAIT_FOR" ]; then
  echo "=================================================================="
  echo "等待线上切换到 v$WAIT_FOR（每 3 秒查一次，最多 $TIMEOUT 秒）"
  echo "现在线上：" "$(v=$(live_version); echo "${v:-读不到版本标记}")"
  echo "提示：保持这个窗口不动，现在去控制台上传发布包"
  echo "------------------------------------------------------------------"
  while :; do
    ELAPSED=$(( $(date +%s) - START ))
    CUR=$(live_version)
    if [ "$CUR" = "$WAIT_FOR" ]; then
      echo "  +${ELAPSED}s  检测到 v$CUR ✔"
      echo "------------------------------------------------------------------"
      echo "切换耗时：约 ${ELAPSED} 秒（从开始等待到线上版本号变成 v$WAIT_FOR）"
      exit 0
    fi
    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
      echo "  +${ELAPSED}s  超时，线上仍是「${CUR:-没有版本标记}」"
      echo "------------------------------------------------------------------"
      echo "排查顺序：① 文件是不是传到了根目录（根路径能打开 index.html？）"
      echo "          ② 是不是传到了子目录（会变成 /v1.0.0/index.html）"
      echo "          ③ 浏览器是不是缓存了旧页面（换无痕窗口）"
      echo "          ④ 控制台是否提示上传失败 / 文件被跳过"
      exit 1
    fi
    echo "  +${ELAPSED}s  线上仍是「${CUR:-没有版本标记}」"
    sleep 3
  done
fi

# ---- 单次核验 ---------------------------------------------------------
CODE_HOME=$(curl -s -m 20 -o "$TMPD/home.html" -w '%{http_code}' "$BASE_STATIC/" 2>/dev/null)
SIZE_HOME=$(wc -c < "$TMPD/home.html" 2>/dev/null | tr -d ' ')
HAS_BADGE="否"
grep -q 'data-app-version' "$TMPD/home.html" 2>/dev/null && HAS_BADGE="是"

VER=$(live_version)
BUILD=$(live_build)

CODE_HEALTH=$(curl -s -m 20 -o "$TMPD/health.json" -w '%{http_code}' "$BASE_API/api/health" 2>/dev/null)
BODY_HEALTH=$(head -c 80 "$TMPD/health.json" 2>/dev/null | tr -d '\r\n')

CODE_KITS=$(curl -s -m 20 -o "$TMPD/kits.json" -w '%{http_code}' "$BASE_API/api/kits" 2>/dev/null)
KITS=$(grep -oE '"total":[0-9]+' "$TMPD/kits.json" 2>/dev/null | head -1 | cut -d: -f2)

FAILN=0
row() { # $1=名称 $2=状态码判断(PASS/FAIL) $3=说明
  printf '[%s] %-10s %s\n' "$2" "$1" "$3"
  [ "$2" = "FAIL" ] && FAILN=$((FAILN + 1))
}

echo "=================================================================="
echo "线上核验 ｜ $(date '+%Y-%m-%d %H:%M:%S')"
echo "站点：$BASE_STATIC"
echo "------------------------------------------------------------------"

if [ "$CODE_HOME" = "200" ] && [ "$SIZE_HOME" -gt 500 ] 2>/dev/null; then
  row "首页" PASS "HTTP 200 · $SIZE_HOME 字节 · 页面含版本徽标：$HAS_BADGE"
else
  row "首页" FAIL "HTTP ${CODE_HOME:-000} · ${SIZE_HOME:-0} 字节 —— 打不开就不是站点问题，先看是不是传错了目录"
fi

if [ -n "$VER" ]; then
  row "版本标记" PASS "version.json → v$VER（发布日 ${BUILD:-?}）"
else
  row "版本标记" FAIL "version.json 读不到 —— 这一版没有版本标记，无法确认跑的是哪一版"
fi

if [ "$CODE_HEALTH" = "200" ] && printf '%s' "$BODY_HEALTH" | grep -q '"ok":true'; then
  row "健康接口" PASS "HTTP 200 · $BODY_HEALTH"
else
  row "健康接口" FAIL "HTTP ${CODE_HEALTH:-000} · ${BODY_HEALTH:-无响应}"
fi

if [ "$CODE_KITS" = "200" ] && [ -n "${KITS:-}" ]; then
  row "读接口" PASS "/api/kits HTTP 200 · total=$KITS"
else
  row "读接口" FAIL "/api/kits HTTP ${CODE_KITS:-000} · total=${KITS:-无} —— 页面会是空白/错误态"
fi

echo "------------------------------------------------------------------"
ELAPSED=$(( $(date +%s) - START ))
if [ "$FAILN" = "0" ]; then
  echo "结论：线上 v$VER 正常（页面 + 版本标记 + 接口四项全过）｜本次核验耗时 ${ELAPSED} 秒"
  exit 0
else
  echo "结论：有 $FAILN 项异常，先别截图报"已完成" ｜本次核验耗时 ${ELAPSED} 秒"
  exit 1
fi
