#!/bin/sh
# ===========================================================================
# check-secrets.sh ｜ 密钥排查脚本（Day 23 · 板块① 产出）
# ===========================================================================
# 【这个脚本干什么】
#   把「密钥泄漏」这件事翻成一条能自动跑的检查：在项目里找有没有
#   「键名 + 等号/冒号 + 引号里的长串」这种**真值**写法。
#
# 【为什么搜的是一串正则，而不是直接搜 password、secret】
#   直接搜 password / secret / apikey 这类词，会命中两种完全不同的东西：
#     ① 变量名与文档说明，如 process.env.WRITE_API_KEY、注释里的「密钥只放环境变量」
#        —— 这些是**正确做法**，不是泄漏；
#     ② 真正的密钥真值，如 WRITE_API_KEY = "a3f9c1..."、postgresql://user:密码@主机
#        —— 这些才是要抓的。
#   把变量名也当命中，等于报警器对着自家门牌狂响，没有意义。
#   所以这里瞄的是「真值的长相」：键名 + 赋值符号 + 引号包着的 6 位以上字符串。
#
# 【这个正则是怎么调出来的】（实测记录，不是拍脑袋写的）
#   第一版把 WRITE_API_KEY = "真值" 漏掉了 —— 因为键名要求以 api 开头，
#   而 WRITE_API_KEY 里 api 前面还有个下划线，匹配不到。
#   漏报比误报危险（该报的没报），所以改成「键名可带前缀 + 左侧单词边界」：
#     命中：WRITE_API_KEY = "..."、API_KEY="..."、apiKey = "..."、password = "..."
#     不命中：process.env.WRITE_API_KEY、ConfigError("WRITE_API_KEY")、文档说明文字
#
# 【怎么读结果】
#   输出 0 条 = 没发现任何密钥真值（今天的验收目标就是这个）
#   输出若干行 = 每行都是 `文件:行号:那一行的内容`，逐条人工确认是变量名还是真值
#
# 【怎么用】
#   cd 到 gundam-price 目录（或任意子目录），然后：sh scripts/check-secrets.sh
#   想只搜云端函数：sh scripts/check-secrets.sh cloudfunctions
#   想搜整个仓库根：sh scripts/check-secrets.sh ..
#
# 【自测方法（证明它不是个永远返回 0 的摆设）】
#   造一个含假密钥的文件再搜它，应能命中：
#     mkdir -p /tmp/t && printf 'WRITE_API_KEY = "deadbeefdeadbeef";\n' > /tmp/t/f.js
#     sh scripts/check-secrets.sh /tmp/t
# ===========================================================================

# 搜索范围：默认当前目录；也可以把路径当参数传进来（见上面「怎么用」）
TARGET="${1:-.}"

# 要排除的目录：.git 存的是历史对象、node_modules 是第三方依赖，都不是我们写的代码
# 要排除的文件：这个脚本自己 —— 它的注释和正则里就写着「密钥长什么样」的示例，
#   不排除的话它会对着自己报警，白白多出几条假命中。
#   （这是个通用的坑：凡是「搜索工具」本身，都要记得把它自己摘出去）
# 【Day 25 补充】再加排除 *.log：发布前检查的日志会把命中行原样抄进文件，
#   不排除的话第二次扫描就会命中上一次的日志 —— 工具产物污染自己的判据。
EXCLUDES="--exclude-dir=.git --exclude-dir=node_modules --exclude=check-secrets.sh --exclude=*.log"

# 密钥真值的正则，六个分支（用 | 连起来，命中任意一个就算）：
#
#   分支① 键名 + 等号/冒号 + 引号里的 6 位以上字符串
#     (^|[^A-Za-z0-9])          左侧必须是开头或非字母数字 —— 防止误伤
#     (password|passwd|...|private[_]?key)
#                               键名核心词；api[_]?key 同时覆盖 api_key / apikey
#     [A-Za-z0-9_]*             键名后缀 —— 让 WRITE_API_KEY 这类带前缀的也算（关键修正）
#     [[:space:]]*[:=][[:space:]]*   冒号或等号，两侧允许空格
#     ["'"'"'][^"'"'"']{6,}     引号包着的 6 位以上 —— 真值有长度，说明文字没有
#
#   分支② sk- 开头 + 16 位以上字母数字   —— OpenAI 风格的密钥
#   分支③ AKID 开头 + 10 位以上字母数字  —— 腾讯云 SecretId 的固定前缀
#   分支④ -----BEGIN                     —— PEM 私钥文件的开头
#   分支⑤ postgres:// 用户:密码@主机      —— 带密码的连接串（含 postgresql:// 变体）
#   分支⑥ mysql:// 用户:密码@主机         —— 同上，MySQL 版本
PATTERN='(^|[^A-Za-z0-9])(password|passwd|secret|api[_]?key|apikey|token|access[_]?key|secret[_]?key|private[_]?key)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}|sk-[A-Za-z0-9]{16,}|AKID[A-Za-z0-9]{10,}|-----BEGIN|(postgres(ql)?|mysql)://[^:@[:space:]]+:[^@[:space:]]+@'

echo "=================================================================="
echo "密钥排查（Day 23）"
echo "搜索范围：$TARGET"
echo "=================================================================="
echo "检查项 A｜键名 + 引号内长串   （如 WRITE_API_KEY = \"xxx...\"）"
echo "检查项 B｜sk- / AKID 前缀密钥  （OpenAI / 腾讯云密钥形态）"
echo "检查项 C｜PEM 私钥文件头       （-----BEGIN）"
echo "检查项 D｜带密码的数据库连接串（postgres:// 用户:密码@主机）"
echo "------------------------------------------------------------------"

# 跑搜索：-r 递归 / -n 带行号 / -E 用扩展正则 / -I 跳过二进制文件 / -i 不分大小写
RESULTS=$(grep -rniE $EXCLUDES "$PATTERN" "$TARGET" 2>/dev/null)

if [ -z "$RESULTS" ]; then
  COUNT=0
  echo ""
  echo "【命中结果】"
  echo "  （无输出）"
else
  COUNT=$(printf '%s\n' "$RESULTS" | wc -l | tr -d ' ')
  echo ""
  echo "【命中结果】"
  printf '%s\n' "$RESULTS"
fi

echo ""
echo "=================================================================="
echo "【命中条数】$COUNT"
if [ "$COUNT" -eq 0 ]; then
  echo "【结论】未发现密钥真值 —— 通过"
else
  echo "【结论】有 $COUNT 条命中，请逐条确认是「变量名」还是「真值」"
fi
echo "=================================================================="
