# releases/ ｜ 发布包放这里（Day 26 起）

这个目录里放的是**能直接上传到公网**的成品包，不是源码。每个版本一套：

```
releases/
├── README.md                      ← 本文件（进仓库）
├── v0.9.0/                        ← 上一版（当前公网上跑的那一版，2026-10-08 构建）
├── gundam-price-v0.9.0.zip
├── v1.0.0/                        ← 首个正式版
└── gundam-price-v1.0.0.zip
```

## 这些文件为什么没进 Git

包里每个文件在仓库里都有一份，版本号 + Git 提交就是它的「配方」，随时能重建：

```bash
# 重建 v1.0.0（用当前工作区）
bash gundam-price/scripts/make-release.sh 1.0.0

# 重建 v0.9.0（用当时发布的那次提交）
bash gundam-price/scripts/make-release.sh 0.9.0 efa8050
```

所以 `.gitignore` 只放行本文件。**换电脑后先跑上面两条命令，包就回来了**——这就是「代码备份」和「产物备份」的分工：代码靠 Git，产物靠脚本可重建。

## 包里有什么（白名单）

| 进包 | 不进包 |
|---|---|
| 4 个 html（index / detail / calc / check） | docs/ 各 Day 的检查报告与修复记录 |
| js/ css/ img/ data/ | db/ 建表 SQL、cloudfunctions/ 云函数源码 |
| version.json（版本标记，发布时生成） | scripts/ skills/ 各种 .md 与 .sh |

脚本会自检：包内一旦出现 `.md` / `.sh` / `.sql` / `.bat` / `.env*`，直接报错不生成。
理由很直白：静态托管上的文件任何人都能访问，仓库里的资料不该跟着上线。
