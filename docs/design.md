# memory-mine 设计文档

从 Claude Code 会话转录中挖掘长记忆、并蒸馏领域专家的本地轻量工具。

- 日期：2026-11-06
- 状态：设计定稿（已与用户逐节确认）
- 许可：MIT

## 1. 背景与目标

### 痛点

- claude-mem 等现有记忆工具：观察者绑死 Anthropic 订阅 OAuth（国内 GLM/Qwen/Kimi 代理用户全部被排除）、后台 worker + 逐工具调用钩子太重、SQLite/向量库不透明、注入质量差
- Claude Code 原生 markdown 记忆好用但要 agent 手动记，覆盖不了历史会话
- 会话转录（`~/.claude/projects/<slug>/*.jsonl`）是无人开采的金矿：仅 creator-master 一个项目就有 417 个文件，内含大量只存在于对话中的架构裁定、复发坑判例、用户红线

### 目标

1. **透明**：产出全是可检视的 markdown 文件，无常驻进程、无数据库
2. **网关无关**：LLM 调用直接走用户自己配置的 anthropic 兼容端点（凭证从 `~/.claude/settings.json` 读取），零 Anthropic 登录依赖
3. **增量**：台账记录已挖会话，重复运行只处理新增
4. **可开源**：独立仓库、无个人/公司信息、双语 README

### 非目标

- 不做自动钩子（会话内记忆仍由 agent 原生机制顺手记）
- 不做向量检索（rg 足够，透明优先）
- 不做后台服务
- claude-mem 不卸载，仅保留其 work_state / deliverables 功能，记忆职责全部移交本工具

## 2. 核心决策（已裁定）

| 决策点 | 裁定 |
|--------|------|
| 捕获机制 | 混合：会话内 agent 顺手记（原生，免费）+ 手动批量挖历史（本工具）+ 无自动钩子 |
| claude-mem 处置 | 留壳卸忆：留 work_state + deliverables，记忆职责移交 |
| 架构 | 方案一管道式：确定性脚本 + GLM 直调，纯 markdown 输出 |
| 开源 | 是，独立仓库 `~/dev/memory-mine`，MIT |
| 专家人格 | 首席平台架构师（语料 70%+ 为工程知识；产品/战略语料不足且与已有专家重叠） |
| spec 位置 | 本文档随仓开源，不进公司仓库 |

## 3. 仓库结构与分发

```
memory-mine/
├── SKILL.md                # 技能定义（唯一入口，含子命令说明）
├── README.md               # 中英双语
├── LICENSE                 # MIT
├── docs/design.md          # 本文档
└── scripts/
    ├── mine.mjs            # 挖掘管线（node >= 18，零依赖）
    └── forge.mjs           # 专家编译器
```

- 仓库根 = 技能根：`git clone <url> ~/.claude/skills/memory-mine` 即装即用
- 开发机用软链：`ln -s ~/dev/memory-mine ~/.claude/skills/memory-mine`
- **单技能双子命令**：`/memory-mine` 挖掘（默认），`/memory-mine forge` 编译专家。不拆两个技能，保证单仓单技能的克隆即用性

## 4. 挖掘管线（mine）

```
/memory-mine [--since YYYY-MM-DD] [--limit N] [--dry-run] [--model 名]
  │
  ├─ 1. 定位项目：cwd → ~/.claude/projects/<slug>/（slug = 绝对路径斜线转横线）
  ├─ 2. 枚举 *.jsonl，按台账跳过已挖，--since/--limit 过滤（默认按时间旧→新处理）
  ├─ 3. 每会话（并发 3）：
  │     抽取 user/assistant 纯文本（丢工具调用/工具结果/子代理内部/坏行）
  │     → 超长分块（每块约 2 万字符）
  │     → 每块一次 GLM 调用蒸馏要点（map）
  │     → 一次 GLM 调用合并成稿（reduce，喂现有 MEMORY.md 索引剔除已知）
  │     → 无耐久事实则记 empty 不落盘
  ├─ 4. 写 memory/journal/<日期>-<时刻>-<主题slug>.md + JOURNAL.md 索引一行
  └─ 5. 台账 .mined.jsonl 记录
```

### journal 文件格式（私有，永不进仓库）

```markdown
---
session: <uuid>
date: 2026-11-04
source: memory-mine
---
# 一句话主题

- 耐久事实（含文件路径/数值/裁定结论，可被 rg 直接命中）
- ...
```

- 位置：`~/.claude/projects/<slug>/memory/journal/`
- 索引：`memory/JOURNAL.md` 倒序一行一条（日期、主题、事实数）
- 检索：MEMORY.md 加一行指针「历史日志在 memory/journal/，索引 JOURNAL.md」，agent 用 rg 检索——与 270 个原生记忆文件同体系，一套检索走天下
- 指针行不自动写入 MEMORY.md（该文件由 agent 原生机制管理）：mine 首次产出 journal 后在结束汇总里打印建议指针行，由 agent/用户手动加入，一次性动作

### 蒸馏提示词

**Map（每块一次）**：提取耐久事实——裁定/决策（含理由）、环境坑（含判别方法）、规范约束、关键数值与路径、进行中状态。排除一次性 debug、常规代码编辑、临时探索、寒暄。每条 bullet 自包含。

**Reduce（每会话一次）**：输入 map 结果 + 现有 MEMORY.md 索引（标注已知，剔除）+ 近期 journal 标题。去重合并、按耐久度排序，最多 15 条；全无价值输出 SKIP。

## 5. 专家编译器（forge）

```
/memory-mine forge [--scope 域过滤] [--lang zh] [--name 专家名]
                                       # 专家名缺省 = <项目slug>-architect，如 creator-master-architect
  │
  ├─ 1. 读语料：MEMORY.md 索引 + memory/*.md + memory/journal/*.md
  ├─ 2. 按类聚簇：复用 MEMORY.md 现成分类标题当簇种子
  ├─ 3. 每簇一次 GLM 综合调用 → ≤3KB 高密度知识（优先级：裁定 > 坑 > 规范 > 背景）
  ├─ 4. 人格组装（单独一次调用）：身份定位 + 工作原则 + quickPrompts
  └─ 5. 产出 expert-out/<专家名>/ 完整插件目录 + Claude Code agent 双出口
```

### 人格规格：首席平台架构师

- profession：首席平台架构师（Chief Platform Architect）
- 知识段：架构判例 / 复发坑库 / 管线与规范 / **业务红线与语境**（让工程判断自动对齐业务边界）
- 体积预算：人格文档 ≤30KB，超限按 裁定>坑>规范>背景 裁剪
- quickPrompts ≥4 条（从高频簇生成）
- 留可选出口 `--persona product|strategy`（YAGNI，不默认实现）

### 产出物（私有，永不进仓库）

```
expert-out/<专家名>/
├── .codebuddy-plugin/plugin.json   # displayName/profession/tags/quickPrompts/categoryId/expertType:agent
├── agents/<专家名>.md              # frontmatter + 人格系统提示词
└── README.md
```

- 双出口：同一人格另写 `~/.claude/agents/<专家名>.md`（WorkBuddy 专家格式与 Claude Code agent 同构）
- 安装路径（已在真实 WorkBuddy 验证）：复制进 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/`

## 6. 台账、容错与 LLM 调用

### 台账

- 文件：`journal/.mined.jsonl`，逐条追加 `{file, mtime, status: mined|empty|failed, journalFile?, ts}`
- 幂等：按 file+mtime 匹配跳过；会话续写致 mtime 变化 → 重挖，journal 追加新条目
- 断点续跑：kill 后重跑从台账断点继续

### 容错

- 每会话独立 try/catch，单会话失败不影响批次
- GLM 429/5xx 指数退避重试 2 次
- **连续 10 次失败熔断停止**（防雪崩烧钱）
- 结束打印汇总：N mined / M empty / K failed + 失败文件名清单

### LLM 调用

- 凭证与模型：`~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL` + `env.ANTHROPIC_AUTH_TOKEN` + `env.ANTHROPIC_MODEL`；进程 env 可覆盖；`--model` 临时指定
- 协议：`POST {BASE}/v1/messages`（anthropic messages 格式），max_tokens 4096，temperature 0.2
- 隐私承诺（写入 README）：转录数据只发往用户自己配置的网关，工具零遥测

## 7. 验收标准

1. 克隆即用：`git clone` 放进 `~/.claude/skills/` 后任意项目可用
2. `--dry-run` 列表与台账一致、零 LLM 调用；连跑两次第二次秒退
3. 质量抽检：3 个已知重要会话的 journal 命中关键裁定事实
4. 后台挖完存量全量（417 会话基准），失败率 <5% 且列名；kill 后断点续跑验证通过
5. forge 双出口产出完整；WorkBuddy 真机安装后可对话；人格 ≤30KB、含业务红线节、quickPrompts ≥4
6. 开源卫生：无硬编码个人路径/密钥/公司信息；README 中英双语；MIT；`expert-out/`、`journal/` 在 .gitignore

## 8. 测试

- `node:test` 内置 runner，零依赖
- 单测：jsonl 抽取器（丢工具噪音/坏行容错）、分块器（边界/上限）、台账读写（幂等/断点）、提示词组装（已知事实注入）
- fixture：3 个小型 jsonl 样本（含工具调用噪音/超长会话/纯寒暄）
- E2E：dry-run 全量；单会话真调 GLM；forge 小语料真调
