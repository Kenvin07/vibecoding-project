#!/usr/bin/env bash
# ===========================================================================
# make-release.sh ｜ 生成可上传、可回退的发布包（Day 26 产出）
# ===========================================================================
# 【为什么要有发布包】
#   回滚的本质是「把上一版的包重新传上去」。没有包，就没有可回退的东西 ——
#   只剩下「改代码重新发」这一条路，那不叫回滚，那叫再发一版。
#
#   包只装公网该看到的文件：4 个 html、js/、css/、img/、data/、version.json。
#   docs / db / cloudfunctions / scripts / *.md / .env* 一律不进包 ——
#   这些是仓库里的资料，不该出现在任何人都能访问的静态托管上。
#
# 【用法】
#   bash gundam-price/scripts/make-release.sh 1.0.0            # 用当前工作区打包
#   bash gundam-price/scripts/make-release.sh 0.9.0 efa8050    # 用指定提交重建（回滚/复盘用）
#
# 【产物】
#   gundam-price/releases/v<版本号>/                  ← 上传用的文件夹（控制台直接拖）
#   gundam-price/releases/gundam-price-v<版本号>.zip  ← 存档，换电脑后不用翻 Git 也能重传
#
# 【退出码】0 成功；1 打包过程出错；2 用法不对
# ===========================================================================

if [ -z "${BASH_VERSION:-}" ]; then
  echo "请用 bash 运行：bash gundam-price/scripts/make-release.sh 1.0.0" >&2
  exit 2
fi

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd) || exit 2
FRONT_DIR=$(cd "$SCRIPT_DIR/.." && pwd) || exit 2
ROOT_DIR=$(cd "$FRONT_DIR/.." && pwd) || exit 2

VERSION="${1:-}"
REV="${2:-}"

if [ -z "$VERSION" ]; then
  echo "用法：bash gundam-price/scripts/make-release.sh <版本号> [git 提交]" >&2
  echo "  例：bash gundam-price/scripts/make-release.sh 1.0.0" >&2
  echo "  例：bash gundam-price/scripts/make-release.sh 0.9.0 efa8050" >&2
  exit 2
fi
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "版本号要写成 主.次.修订，例如 1.0.0（收到：$VERSION）" >&2; exit 2 ;;
esac

STAGE=$(mktemp -d 2>/dev/null || echo "/tmp/make-release.$$")
# Windows 上 mktemp 可能返回 C:\... 这种反斜杠路径，tar/cp 处理起来会报 "Cannot open"；
# 统一转成 /c/... 的 POSIX 写法（Git Bash 自带 cygpath）。
if command -v cygpath >/dev/null 2>&1; then STAGE=$(cygpath -u "$STAGE"); fi
mkdir -p "$STAGE"
# 本机 rm 被安全策略拦（SAFE_DELETE_INVALID_PATH），清理统一用 find -delete
trap 'find "$STAGE" -mindepth 1 -delete 2>/dev/null; rmdir "$STAGE" 2>/dev/null' EXIT

# ---- 一、确定源目录：工作区 or 指定提交 --------------------------------
if [ -n "$REV" ]; then
  if ! git -C "$ROOT_DIR" rev-parse --verify "$REV^{commit}" >/dev/null 2>&1; then
    echo "找不到提交：$REV（在仓库根目录用 git log --oneline 看可用的提交）" >&2
    exit 1
  fi
  SRC="$STAGE/gundam-price"
  mkdir -p "$SRC"
  if ! git -C "$ROOT_DIR" archive "$REV" gundam-price | tar -x -C "$STAGE"; then
    echo "从提交 $REV 导出文件失败" >&2
    exit 1
  fi
  SOURCE_DESC="提交 $REV（$(git -C "$ROOT_DIR" log -1 --format='%h %ad %s' --date=format:%Y-%m-%d "$REV" 2>/dev/null)）"
else
  SRC="$FRONT_DIR"
  SOURCE_DESC="当前工作区"
fi

# ---- 二、装包（白名单复制）--------------------------------------------
OUT="$FRONT_DIR/releases/v$VERSION"
ZIP="$FRONT_DIR/releases/gundam-price-v$VERSION.zip"
mkdir -p "$FRONT_DIR/releases"
if [ -d "$OUT" ]; then find "$OUT" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$OUT"

for d in js css img data; do
  if [ -d "$SRC/$d" ]; then
    mkdir -p "$OUT/$d"
    cp -r "$SRC/$d/." "$OUT/$d/" || { echo "复制 $d/ 失败" >&2; exit 1; }
  fi
done
for f in "$SRC"/*.html; do
  [ -f "$f" ] || continue
  cp "$f" "$OUT/" || { echo "复制 $(basename "$f") 失败" >&2; exit 1; }
done

# ---- 三、写版本标记（唯一真值，页面上的徽标就读它）--------------------
BUILD=$(date +%Y%m%d)
RELEASED=$(date +%Y-%m-%d)
CHANNEL="stable"
case "$VERSION" in 0.*) CHANNEL="prerelease" ;; esac
cat > "$OUT/version.json" <<JSON
{
  "version": "$VERSION",
  "build": "$BUILD",
  "releasedAt": "$RELEASED",
  "channel": "$CHANNEL",
  "note": "由 scripts/make-release.sh 生成；源：$SOURCE_DESC"
}
JSON

# ---- 四、自检：包内不许有仓库资料，必须能打开首页 ---------------------
PROBLEMS=""
[ -f "$OUT/index.html" ] || PROBLEMS="$PROBLEMS 缺 index.html;"
LEAK=$(find "$OUT" -type f \( -name '*.md' -o -name '*.sh' -o -name '*.sql' -o -name '*.bat' -o -name '.env*' -o -name '*.zip' \) 2>/dev/null | head -5)
[ -n "$LEAK" ] && PROBLEMS="$PROBLEMS 包内混入仓库资料：$(printf '%s' "$LEAK" | tr '\n' ' ');"

if [ -n "$PROBLEMS" ]; then
  echo "发布包自检不通过：$PROBLEMS" >&2
  exit 1
fi

# ---- 五、存档成 zip（方便换电脑后重传；不含文件夹前缀，解压即站点根目录）
if command -v python >/dev/null 2>&1; then
  if python - "$OUT" "$ZIP" <<'PY'
import os, sys, zipfile
src, out = os.path.abspath(sys.argv[1]), sys.argv[2]
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(src):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, src).replace("\\", "/")
            z.write(full, rel)
            n += 1
print("zip: %d 个文件" % n)
PY
  then :; else
    echo "提示：zip 打包失败，但文件夹已经生成，直接上传文件夹即可" >&2
  fi
else
  echo "提示：本机没有 python，跳过 zip；直接上传文件夹即可" >&2
fi

# ---- 六、汇总 ---------------------------------------------------------
FILES=$(find "$OUT" -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "$OUT" 2>/dev/null | cut -f1)
echo ""
echo "=================================================================="
echo "发布包已生成：v$VERSION"
echo "  来源    ：$SOURCE_DESC"
echo "  文件夹  ：gundam-price/releases/v$VERSION/（$FILES 个文件，$SIZE）"
[ -f "$ZIP" ] && echo "  压缩包  ：gundam-price/releases/gundam-price-v$VERSION.zip"
echo "  内容    ：$(cd "$OUT" && ls -d *.html js css img data version.json 2>/dev/null | tr '\n' ' ')"
echo "  版本标记：$OUT/version.json → version=$VERSION build=$BUILD channel=$CHANNEL"
echo "=================================================================="
echo "下一步：把这个文件夹上传到 CloudBase 静态托管（步骤见 docs/Day26-发布清单-v1.0.md）"
