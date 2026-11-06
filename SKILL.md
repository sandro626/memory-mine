---
name: memory-mine
description: 挖掘 Claude Code 会话转录为长记忆（journal markdown），并可把记忆语料蒸馏为 WorkBuddy/Claude 领域专家。当用户要「挖会话/挖记忆/整理历史会话/生成专家/蒸馏专家」或提到 memory-mine 时使用。
---

# memory-mine

两个子命令，脚本在本技能目录 scripts/ 下：

## /memory-mine — 挖掘会话转录

用法：`node <本技能目录>/scripts/mine.mjs [--since YYYY-MM-DD] [--limit N] [--dry-run] [--model 名] [--project 绝对路径]`

- 默认挖当前 cwd 对应项目（~/.claude/projects/<slug>/*.jsonl）
- **先跑 --dry-run 看清单**再真跑；大批量用 nohup 后台：`nohup node .../mine.mjs > /tmp/mm.log 2>&1 &`
- 凭证自动读 ~/.claude/settings.json（与 Claude Code 同源），无需配置
- 首次产出 journal 后，把脚本末尾打印的指针行加入该项目 MEMORY.md（一次性）

## /memory-mine forge — 蒸馏领域专家

用法：`node <本技能目录>/scripts/forge.mjs [--scope 类目substring] [--lang zh] [--name 名] [--project-name 显示项目名] [--avatar png路径] [--project 绝对路径]`

- 产出 `expert-out/<名>/`（WorkBuddy 专家插件，已过官方 validator）+ `~/.claude/agents/<名>.md`
- 默认人格：首席平台架构师（categoryId 02-Engineering）
- **隐私铁律**：私有语料蒸馏的专家只装本机（~/.workbuddy/plugins/marketplaces/my-experts/plugins/），永不提交公开市场

设计文档：docs/design.md
