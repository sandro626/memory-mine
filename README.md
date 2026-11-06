# memory-mine

> Local long-term memory for Claude Code — mine durable facts from session transcripts into Markdown, then forge a domain expert. 无常驻进程 · 纯文件透明 · 任意 anthropic 网关可用（GLM/Qwen/Kimi）

**[中文](#中文) · [English](#english)**

---

## 中文

### 这是什么

一个 Claude Code 技能（skill）：把你积攒的会话转录（`~/.claude/projects/<项目>/*.jsonl`）挖一遍，蒸馏出「耐久事实」——架构裁定、复发坑判例、用户红线、关键数值——存成透明的 Markdown 日志；再一步，把全部记忆语料编译成一个领域专家（WorkBuddy 专家 / Claude Code agent 双格式）。

### 为什么不用 claude-mem

claude-mem 的观察者绑死 Anthropic 订阅 OAuth——挂国产 anthropic 兼容网关（智谱 GLM、Qwen、Kimi）的用户全部被挡在外面。它还需要后台 worker、逐工具调用钩子、SQLite + 向量库，重且不透明。

memory-mine 的取舍：

- **零守护进程、零数据库**：产出全是可检视的 Markdown，可进 git
- **网关无关**：LLM 调用直接走你自己配置的端点（读 `~/.claude/settings.json` 的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`），零 Anthropic 登录依赖
- **增量**：台账记录已挖会话，重复运行只处理新增，断点续跑
- **专家蒸馏**：`forge` 把记忆语料编译成可对话的领域专家
- **隐私承诺**：转录数据只发往你自己配置的网关，本工具零遥测

### 快速开始

```bash
git clone https://github.com/sandro626/memory-mine.git ~/.claude/skills/memory-mine
```

然后在任意项目的 Claude Code 会话里：

```
/memory-mine            # 挖掘当前项目的历史会话转录
/memory-mine --dry-run  # 只列出会挖哪些，零 LLM 调用
/memory-mine forge      # 把记忆语料编译成领域专家
```

> 状态：**设计定稿，实现中**。设计全文见 [docs/design.md](docs/design.md)。

---

## English

A Claude Code skill that mines your accumulated session transcripts (`~/.claude/projects/<project>/*.jsonl`) for **durable facts** — architecture rulings, recurring pitfalls, hard constraints, key numbers — and stores them as transparent Markdown journals. Then, in one more step, it compiles your entire memory corpus into a conversational **domain expert** (dual format: WorkBuddy expert / Claude Code agent).

**Why not claude-mem?** Its observer is hard-wired to Anthropic subscription OAuth — anyone running Claude Code through an Anthropic-compatible gateway (Zhipu GLM, Qwen, Kimi) is locked out. It also requires a background worker, per-tool-call hooks, and SQLite + vector DBs.

memory-mine's trade-offs:

- **Zero daemons, zero databases** — output is plain, inspectable, git-friendly Markdown
- **Gateway-agnostic** — LLM calls go to *your* endpoint, read from `~/.claude/settings.json`; no Anthropic login required
- **Incremental** — a ledger tracks mined sessions; re-runs only process new ones, resumable after interruption
- **Expert forging** — `forge` compiles the memory corpus into a deployable domain-expert persona
- **Privacy promise** — transcripts are sent only to the gateway you configure; this tool has zero telemetry

### Quick start

```bash
git clone https://github.com/sandro626/memory-mine.git ~/.claude/skills/memory-mine
```

Then, in any project's Claude Code session:

```
/memory-mine            # mine this project's session transcripts
/memory-mine --dry-run  # list what would be mined, zero LLM calls
/memory-mine forge      # compile the memory corpus into a domain expert
```

> Status: **design finalized, implementation in progress** — see [docs/design.md](docs/design.md).

---

## License

MIT
