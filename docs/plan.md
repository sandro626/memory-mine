# memory-mine 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 docs/design.md 定稿的 Claude Code 技能——`/memory-mine` 挖会话转录为 journal 长记忆，`/memory-mine forge` 蒸馏「首席平台架构师」专家（WorkBuddy + Claude Code 双出口）。

**Architecture:** 纯 markdown 透明输出；LLM 直调用户自己的 anthropic 网关（凭证读 `~/.claude/settings.json`）；台账增量幂等；零守护进程。CLI 入口 `scripts/mine.mjs` / `scripts/forge.mjs`，逻辑全在 `scripts/lib/` 纯函数模块，node:test 单测覆盖。

**Tech Stack:** Node ≥ 18（全局 fetch、node:test、ESM .mjs），零 npm 依赖。

## Global Constraints

- Node ≥ 18；**零 npm 依赖**（只用 `node:` 内置模块 + 全局 fetch）
- ESM（.mjs）；测试 `node --test test/<file>`；命令均在仓库根 `~/dev/memory-mine` 执行
- 面向用户的输出文案用中文；代码注释从简（与设计文档口径一致）
- 凭证只读 `~/.claude/settings.json` env 与进程 env；**严禁硬编码密钥/严禁入库**
- `journal/`、`expert-out/` 永不入库（.gitignore 已含）
- forge 产出必须过官方 validator：quickPrompts 恰 3 条且 defaultInitPrompt 与第 1 条一致；displayDescription.zh 40-50 字；tags 恰 3 个；avatar 512×512 PNG ≤500KB；categoryId=`02-Engineering`；name 小写字母+连字符；expertType=`"agent"`
- 私有语料蒸馏的专家永不提交公开市场
- commit 信息用 `feat:` / `test:` / `docs:` / `chore:` 前缀
- 仓库 `~/dev/memory-mine`，remote origin = `git@github-sandro:sandro626/memory-mine.git`，git 身份已配 `sandro626@hotmail.com`

---

### Task 1: 脚手架 + 转录抽取器 extract

**Files:**
- Create: `.gitignore`、`LICENSE`、`package.json`
- Create: `scripts/lib/extract.mjs`
- Create: `test/fixtures/sample-tools.jsonl`
- Test: `test/extract.test.mjs`

**Interfaces:**
- Produces: `parseTranscript(jsonlText: string) → { messages: Array<{role:'user'|'assistant', text:string}>, skipped: number }`；`renderConversation(messages) → string`（"用户: …"/"助手: …" 以空行连接）。后续 Task 8 消费。

- [ ] **Step 1: 脚手架文件**

`.gitignore`：
```
expert-out/
node_modules/
.DS_Store
```

`LICENSE`（MIT，版权人 sandro626，年份 2026）——标准 MIT 全文。

`package.json`：
```json
{
  "name": "memory-mine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Local long-term memory for Claude Code — mine session transcripts into Markdown, forge domain experts",
  "license": "MIT",
  "scripts": { "test": "node --test test/" }
}
```

- [ ] **Step 2: 建 fixture `test/fixtures/sample-tools.jsonl`**（每行一个 JSON，覆盖全部噪音形态）：

```jsonl
{"type":"user","message":{"role":"user","content":"帮我看下这个报错"},"uuid":"a1"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"我先看看日志"},{"type":"tool_use","name":"Read","input":{"file_path":"x"}}]},"uuid":"a2"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"file body"}]},"uuid":"a3"}
{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"子代理内部"}]},"uuid":"a4"}
{"type":"summary","summary":"旧会话摘要","uuid":"a5"}
{broken json
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"根因是连接池打满，修法=只跑一个实例"}]},"uuid":"a6"}
{"type":"user","isMeta":true,"message":{"role":"user","content":"Caveat: 本地命令输出"},"uuid":"a7"}
```

- [ ] **Step 3: 写失败测试 `test/extract.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript, renderConversation } from '../scripts/lib/extract.mjs';

const raw = readFileSync(new URL('./fixtures/sample-tools.jsonl', import.meta.url), 'utf8');

test('parseTranscript 保留 user/assistant 纯文本，过滤全部噪音', () => {
  const { messages, skipped } = parseTranscript(raw);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].text, '帮我看下这个报错');
  assert.equal(messages[1].text, '我先看看日志');           // tool_use 块被丢，text 保留
  assert.equal(messages[2].text, '根因是连接池打满，修法=只跑一个实例');
  assert.equal(skipped, 5); // tool_result行/sidechain/summary/坏行/meta
});

test('parseTranscript 空串与空行容错', () => {
  const r = parseTranscript('');
  assert.deepEqual(r, { messages: [], skipped: 0 });
});

test('renderConversation 角色前缀拼接', () => {
  const s = renderConversation([{ role: 'user', text: '问' }, { role: 'assistant', text: '答' }]);
  assert.equal(s, '用户: 问\n\n助手: 答');
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `node --test test/extract.test.mjs`
Expected: FAIL（Cannot find module ../scripts/lib/extract.mjs）

- [ ] **Step 5: 实现 `scripts/lib/extract.mjs`**

```js
// Claude Code 会话转录 .jsonl → 干净对话文本（丢工具噪音/子代理/坏行）
export function parseTranscript(jsonlText) {
  const messages = [];
  let skipped = 0;
  for (const line of String(jsonlText).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { skipped++; continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') { skipped++; continue; }
    if (obj.isSidechain || obj.isMeta) { skipped++; continue; }
    const msg = obj.message;
    if (!msg || typeof msg !== 'object') { skipped++; continue; }
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text).join('\n');
    }
    text = text.trim();
    if (!text) { skipped++; continue; }
    if (obj.type === 'user' && (text.startsWith('Caveat:') || text.startsWith('[Request interrupted'))) { skipped++; continue; }
    messages.push({ role: obj.type === 'user' ? 'user' : 'assistant', text });
  }
  return { messages, skipped };
}

export function renderConversation(messages) {
  return messages.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`).join('\n\n');
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test test/extract.test.mjs`
Expected: 3 pass

- [ ] **Step 7: Commit**

```bash
git add .gitignore LICENSE package.json scripts/lib/extract.mjs test/fixtures/sample-tools.jsonl test/extract.test.mjs
git commit -m "feat: 转录抽取器——保留对话文本过滤工具噪音/子代理/坏行"
```

---

### Task 2: 分块器 chunk

**Files:**
- Create: `scripts/lib/chunk.mjs`
- Test: `test/chunk.test.mjs`

**Interfaces:**
- Produces: `chunkText(text: string, { maxChars?: number } = {}) → string[]`。Task 8 消费。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../scripts/lib/chunk.mjs';

test('短文本不分块', () => {
  assert.deepEqual(chunkText('hello', { maxChars: 100 }), ['hello']);
  assert.deepEqual(chunkText(''), ['']);
});

test('按段落边界分块且不超上限', () => {
  const paras = Array.from({ length: 10 }, (_, i) => 'p'.repeat(30) + i);
  const text = paras.join('\n\n'); // ~310 chars
  const chunks = chunkText(text, { maxChars: 100 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 200, `块超限: ${c.length}`); // 允许单段硬切后 ≤2×max
  assert.equal(chunks.join('\n\n'), text);
});

test('超长单段硬切', () => {
  const chunks = chunkText('x'.repeat(250), { maxChars: 100 });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(''), 'x'.repeat(250));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/chunk.test.mjs`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 `scripts/lib/chunk.mjs`**

```js
// 长文本按段落边界分块；病态超长单段硬切
export function chunkText(text, { maxChars = 20000 } = {}) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let cur = '';
  for (const p of String(text).split('\n\n')) {
    if (cur && cur.length + p.length + 2 > maxChars) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
    while (cur.length > maxChars * 2) { chunks.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/chunk.test.mjs`
Expected: 3 pass

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/chunk.mjs test/chunk.test.mjs
git commit -m "feat: 分块器——段落边界优先+超长单段硬切"
```

---

### Task 3: 配置解析 config

**Files:**
- Create: `scripts/lib/config.mjs`
- Create: `test/fixtures/fake-settings.json`
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces:
  - `slugFromPath(absPath: string) → string`（`/Users/x/dev/p` → `-Users-x-dev-p`）
  - `loadConfig({ settingsPath?, env?, modelOverride? } = {}) → { baseUrl, authToken, apiKey, model }`（缺项抛 Error，中文消息）
  - `resolveProjectDir({ home?, cwd }) → { slug, projectDir, memoryDir }`
- Task 8/12 消费。

- [ ] **Step 1: fixture `test/fixtures/fake-settings.json`**

```json
{ "env": { "ANTHROPIC_BASE_URL": "https://gw.example/api", "ANTHROPIC_AUTH_TOKEN": "tok-123", "ANTHROPIC_MODEL": "m-base" } }
```

- [ ] **Step 2: 写失败测试 `test/config.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugFromPath, loadConfig, resolveProjectDir } from '../scripts/lib/config.mjs';

const settings = new URL('./fixtures/fake-settings.json', import.meta.url).pathname;

test('slugFromPath 斜线转横线', () => {
  assert.equal(slugFromPath('/Users/zle/dev/creator-master'), '-Users-zle-dev-creator-master');
  assert.equal(slugFromPath('/a/b/'), '-a-b');
});

test('loadConfig 读 settings.json，env 覆盖，modelOverride 最高', () => {
  const base = loadConfig({ settingsPath: settings, env: {} });
  assert.equal(base.baseUrl, 'https://gw.example/api');
  assert.equal(base.authToken, 'tok-123');
  assert.equal(base.model, 'm-base');
  const overridden = loadConfig({ settingsPath: settings, env: { ANTHROPIC_MODEL: 'm-env' } });
  assert.equal(overridden.model, 'm-env');
  const flagged = loadConfig({ settingsPath: settings, env: {}, modelOverride: 'm-flag' });
  assert.equal(flagged.model, 'm-flag');
});

test('loadConfig 缺 baseUrl 抛错', () => {
  assert.throws(() => loadConfig({ settingsPath: '/nonexistent.json', env: {} }), /ANTHROPIC_BASE_URL/);
});

test('resolveProjectDir 拼出转录与记忆目录', () => {
  const r = resolveProjectDir({ home: '/home/u', cwd: '/home/u/dev/p' });
  assert.deepEqual(r, {
    slug: '-home-u-dev-p',
    projectDir: '/home/u/.claude/projects/-home-u-dev-p',
    memoryDir: '/home/u/.claude/projects/-home-u-dev-p/memory',
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/config.test.mjs`
Expected: FAIL

- [ ] **Step 4: 实现 `scripts/lib/config.mjs`**

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function slugFromPath(absPath) {
  return String(absPath).replace(/\/+$/, '').replaceAll('/', '-');
}

export function loadConfig({ settingsPath = join(process.env.HOME, '.claude', 'settings.json'), env = process.env, modelOverride } = {}) {
  let s = {};
  try { s = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* 无 settings.json 时退回进程 env */ }
  const e = { ...(s.env || {}), ...env }; // 进程 env 优先
  const baseUrl = e.ANTHROPIC_BASE_URL;
  const authToken = e.ANTHROPIC_AUTH_TOKEN;
  const apiKey = e.ANTHROPIC_API_KEY;
  const model = modelOverride || e.ANTHROPIC_MODEL;
  if (!baseUrl) throw new Error('未找到 ANTHROPIC_BASE_URL（检查 ~/.claude/settings.json 的 env 或进程环境变量）');
  if (!authToken && !apiKey) throw new Error('未找到 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY');
  if (!model) throw new Error('未找到 ANTHROPIC_MODEL');
  return { baseUrl, authToken, apiKey, model };
}

export function resolveProjectDir({ home = process.env.HOME, cwd }) {
  const slug = slugFromPath(cwd);
  const projectDir = join(home, '.claude', 'projects', slug);
  return { slug, projectDir, memoryDir: join(projectDir, 'memory') };
}
```

- [ ] **Step 5: 跑测试确认通过 + Commit**

Run: `node --test test/config.test.mjs` → 4 pass

```bash
git add scripts/lib/config.mjs test/fixtures/fake-settings.json test/config.test.mjs
git commit -m "feat: 配置解析——网关凭证/模型与项目slug定位"
```

---

### Task 4: 台账 ledger

**Files:**
- Create: `scripts/lib/ledger.mjs`
- Test: `test/ledger.test.mjs`

**Interfaces:**
- Produces: `readLedger(path) → Map<file, {file, mtime, status, journalFile?, ts}>`（同文件以最后一条为准）；`appendLedger(path, record)`；`shouldSkip(map, fileName, mtimeMs) → boolean`（mtime 相同才跳过，会话续写后重挖）。Task 8 消费。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLedger, appendLedger, shouldSkip } from '../scripts/lib/ledger.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mm-ledger-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const p = join(dir, '.mined.jsonl');

test('台账追加/读取/同文件取最后一条', () => {
  appendLedger(p, { file: 'a.jsonl', mtime: 1, status: 'mined', journalFile: 'j1.md', ts: 1 });
  appendLedger(p, { file: 'b.jsonl', mtime: 2, status: 'empty', ts: 2 });
  appendLedger(p, { file: 'a.jsonl', mtime: 3, status: 'mined', ts: 3 }); // a 被重挖
  const m = readLedger(p);
  assert.equal(m.size, 2);
  assert.equal(m.get('a.jsonl').mtime, 3);
});

test('readLedger 不存在文件返回空 Map，坏行忽略', () => {
  assert.equal(readLedger(join(dir, 'nope.jsonl')).size, 0);
  const bad = join(dir, 'bad.jsonl');
  appendLedger(bad, { file: 'x', mtime: 1, status: 'mined' });
  appendLedger(bad, { file: 'y', mtime: 1, status: 'mined' });
  // 手动写一行坏 JSON
  const fs = await import('node:fs');
  fs.appendFileSync(bad, '{broken\n');
  assert.equal(readLedger(bad).size, 2);
});

test('shouldSkip 仅 mtime 相同才跳过', () => {
  const m = readLedger(p);
  assert.equal(shouldSkip(m, 'a.jsonl', 3), true);
  assert.equal(shouldSkip(m, 'a.jsonl', 4), false); // 会话续写，mtime 变了
  assert.equal(shouldSkip(m, 'zz.jsonl', 1), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/ledger.test.mjs` → FAIL

- [ ] **Step 3: 实现 `scripts/lib/ledger.mjs`**

```js
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export function readLedger(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const r = JSON.parse(t); map.set(r.file, r); } catch { /* 坏行忽略 */ }
  }
  return map;
}

export function appendLedger(path, record) {
  appendFileSync(path, JSON.stringify(record) + '\n');
}

export function shouldSkip(ledgerMap, fileName, mtimeMs) {
  const prev = ledgerMap.get(fileName);
  return !!prev && prev.mtime === mtimeMs;
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `node --test test/ledger.test.mjs` → 3 pass

```bash
git add scripts/lib/ledger.mjs test/ledger.test.mjs
git commit -m "feat: 台账——增量幂等与断点续跑基础"
```

---

### Task 5: LLM 调用层 llm（重试/熔断可注入）

**Files:**
- Create: `scripts/lib/llm.mjs`
- Test: `test/llm.test.mjs`

**Interfaces:**
- Produces:
  - `createBreaker(limit = 10) → { get tripped(): boolean, ok(), fail(), get count(): number }`
  - `callLLM({ baseUrl, authToken?, apiKey?, model, system, user, maxTokens?, temperature?, fetchImpl?, retry?, breaker?, sleep? }) → Promise<{ text: string, usage }>`
  - 协议：`POST {baseUrl}/v1/messages`，authToken → `Authorization: Bearer`，否则 `x-api-key`；429/5xx/网络错退避重试（500ms、1s），4xx 致命不重试；breaker 连续失败达限即拒发。Task 8/12 消费。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { callLLM, createBreaker } from '../scripts/lib/llm.mjs';

const ok = { status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } }) };
const base = { baseUrl: 'https://gw.example', authToken: 't', model: 'm', system: 's', user: 'u', sleep: async () => {} };

test('成功调用返回 text 与 usage', async () => {
  let called = 0;
  const r = await callLLM({ ...base, fetchImpl: async () => { called++; return ok; } });
  assert.equal(r.text, 'hi');
  assert.equal(called, 1);
});

test('429 退避重试后成功', async () => {
  let n = 0;
  const sleeps = [];
  const r = await callLLM({ ...base, sleep: async ms => sleeps.push(ms), fetchImpl: async () => { if (++n === 1) return { status: 429, ok: false }; return ok; } });
  assert.equal(r.text, 'hi');
  assert.deepEqual(sleeps, [500]);
});

test('400 致命错误不重试', async () => {
  let called = 0;
  await assert.rejects(
    () => callLLM({ ...base, fetchImpl: async () => { called++; return { status: 400, ok: false, text: async () => 'bad' }; } }),
    /400/
  );
  assert.equal(called, 1);
});

test('熔断：连续失败达限后拒发', async () => {
  const breaker = createBreaker(2);
  const failing = { ...base, retry: 0, breaker, fetchImpl: async () => { throw new Error('network down'); } };
  await assert.rejects(() => callLLM(failing));
  await assert.rejects(() => callLLM(failing));
  assert.equal(breaker.tripped, true);
  await assert.rejects(() => callLLM(failing), /熔断/);
});

test('成功后熔断计数清零', async () => {
  const breaker = createBreaker(2);
  await assert.rejects(() => callLLM({ ...base, retry: 0, breaker, fetchImpl: async () => { throw new Error('x'); } }));
  await callLLM({ ...base, breaker, fetchImpl: async () => ok });
  assert.equal(breaker.count, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/llm.test.mjs` → FAIL

- [ ] **Step 3: 实现 `scripts/lib/llm.mjs`**

```js
// anthropic messages 直调：重试退避 + 连续失败熔断，全部依赖可注入
export function createBreaker(limit = 10) {
  let consecutive = 0;
  return {
    get tripped() { return consecutive >= limit; },
    get count() { return consecutive; },
    ok() { consecutive = 0; },
    fail() { consecutive++; },
  };
}

export async function callLLM({ baseUrl, authToken, apiKey, model, system, user,
  maxTokens = 4096, temperature = 0.2, fetchImpl = fetch, retry = 2, breaker = null,
  sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  else headers['x-api-key'] = apiKey;
  const body = JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] });
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    if (breaker?.tripped) throw new Error(`熔断：连续失败 ${breaker.count} 次，停止调用`);
    try {
      const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/v1/messages`, { method: 'POST', headers, body });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`), { fatal: true });
      }
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      breaker?.ok();
      return { text, usage: data.usage || null };
    } catch (e) {
      lastErr = e;
      breaker?.fail();
      if (e.fatal || attempt === retry) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `node --test test/llm.test.mjs` → 5 pass

```bash
git add scripts/lib/llm.mjs test/llm.test.mjs
git commit -m "feat: LLM调用层——网关直调/退避重试/连续失败熔断"
```

---

### Task 6: 蒸馏提示词 prompts（mine 部分）

**Files:**
- Create: `scripts/lib/prompts.mjs`
- Test: `test/prompts.test.mjs`

**Interfaces:**
- Produces:
  - `buildMap({ conversationText }) → { system, user }`
  - `buildReduce({ mapNotes: string[], knownIndex?: string, recentTitles?: string }) → { system, user }`
  - `parseReduceOutput(text) → { skip: true } | { skip: false, topic: string, facts: string[] }`（协议：首行 `TOPIC: <主题>`，其余 `- ` 行为事实；输出 SKIP 表无价值）
- Task 8 消费。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, buildReduce, parseReduceOutput } from '../scripts/lib/prompts.mjs';

test('buildMap 含对话文本与排除指令', () => {
  const p = buildMap({ conversationText: '用户: 内容X' });
  assert.ok(p.user.includes('内容X'));
  assert.ok(p.system.includes('耐久事实'));
});

test('buildReduce 注入已知索引与近期标题', () => {
  const p = buildReduce({ mapNotes: ['- 事实A'], knownIndex: '# 已知\n- 旧裁定', recentTitles: '- 旧主题' });
  assert.ok(p.user.includes('事实A'));
  assert.ok(p.user.includes('旧裁定'));
  assert.ok(p.user.includes('旧主题'));
});

test('parseReduceOutput 正常输出', () => {
  const r = parseReduceOutput('TOPIC: 连接池治理\n- 裁定A\n- 坑B');
  assert.equal(r.skip, false);
  assert.equal(r.topic, '连接池治理');
  assert.deepEqual(r.facts, ['裁定A', '坑B']);
});

test('parseReduceOutput SKIP/畸形输入兜底', () => {
  assert.deepEqual(parseReduceOutput('SKIP'), { skip: true });
  assert.deepEqual(parseReduceOutput('skip。'), { skip: true });
  assert.deepEqual(parseReduceOutput(''), { skip: true });
  assert.deepEqual(parseReduceOutput('没有TOPIC行\n- 孤儿事实'), { skip: true });
  assert.deepEqual(parseReduceOutput('TOPIC: 有题无实\n正文'), { skip: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/prompts.test.mjs` → FAIL

- [ ] **Step 3: 实现 `scripts/lib/prompts.mjs`（本任务只写 mine 三函数，forge 函数 Task 10 追加）**

```js
// ===== mine：蒸馏提示词 =====
export function buildMap({ conversationText }) {
  return {
    system: '你是工程会话记忆蒸馏器。从对话片段中提取「耐久事实」：裁定与决策（含理由）、环境坑（含判别方法）、规范约束、关键数值与文件路径、进行中状态。排除：一次性 debug 细节、常规代码编辑、临时探索、寒暄。每条以 "- " 开头，自包含（含路径/数值）。没有耐久事实时只输出 NONE。',
    user: `以下是 Claude Code 会话片段：\n\n${conversationText}\n\n输出耐久事实列表（每条 "- " 开头），或只输出 NONE。`,
  };
}

export function buildReduce({ mapNotes, knownIndex = '', recentTitles = '' }) {
  return {
    system: '你是记忆合并器。输入是多个片段蒸馏出的事实列表。任务：1) 去重合并 2) 剔除「已知事实」已覆盖的内容 3) 按耐久度排序（裁定>坑>规范>状态）4) 最多保留 15 条。输出格式严格为：第一行 "TOPIC: <一句话主题>"，随后每行一条 "- <事实>"。若全部已知或无价值，只输出 SKIP。',
    user: `片段蒸馏结果：\n${mapNotes.join('\n')}\n\n已知事实（已覆盖的须剔除）：\n${knownIndex || '（无）'}\n\n近期已记录主题（避免重复）：\n${recentTitles || '（无）'}\n\n按格式输出 TOPIC 与事实列表，或 SKIP。`,
  };
}

export function parseReduceOutput(text) {
  const t = String(text || '').trim();
  if (!t || t.toUpperCase().startsWith('SKIP')) return { skip: true };
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const topicLine = lines.find(l => l.toUpperCase().startsWith('TOPIC:'));
  if (!topicLine) return { skip: true };
  const topic = topicLine.replace(/^TOPIC:\s*/i, '').trim();
  const facts = lines.filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
  if (!topic || facts.length === 0) return { skip: true };
  return { skip: false, topic, facts };
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `node --test test/prompts.test.mjs` → 5 pass

```bash
git add scripts/lib/prompts.mjs test/prompts.test.mjs
git commit -m "feat: mine蒸馏提示词——map/reduce与SKIP协议"
```

---

### Task 7: journal 落盘与索引

**Files:**
- Create: `scripts/lib/journal.mjs`
- Test: `test/journal.test.mjs`

**Interfaces:**
- Produces:
  - `slugify(topic) → string`（ASCII 主题取连字符段；中文等回退 sha1 前 8 位）
  - `writeJournalEntry(memoryDir, { date: 'YYYY-MM-DD', time: 'HHMMSS', topic, facts: string[], sessionFile }) → { journalPath, journalFile }`（同名碰撞自动 `-2` 后缀）
  - `updateIndex(memoryDir, { date, topic, factCount, journalFile }) → { indexPath, isNew }`（JOURNAL.md 倒序，新行在最上）
  - `pointerLine() → string`
- Task 8 消费。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, writeJournalEntry, updateIndex, pointerLine } from '../scripts/lib/journal.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mm-journal-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('slugify：ASCII 用连字符，中文回退哈希', () => {
  assert.equal(slugify('SSIM Tier 三层链!'), 'ssim-tier');
  assert.match(slugify('长征事故裁定'), /^[0-9a-f]{8}$/);
});

test('writeJournalEntry 落盘 frontmatter+事实，碰撞加后缀', () => {
  const a = writeJournalEntry(dir, { date: '2026-11-06', time: '101010', topic: 'SSIM tier', facts: ['裁定A', '坑B'], sessionFile: 's1.jsonl' });
  const b = writeJournalEntry(dir, { date: '2026-11-06', time: '101010', topic: 'SSIM tier', facts: ['裁定C'], sessionFile: 's1.jsonl' });
  assert.match(a.journalFile, /^2026-11-06-101010-ssim-tier\.md$/);
  assert.notEqual(a.journalFile, b.journalFile);
  const text = readFileSync(a.journalPath, 'utf8');
  assert.ok(text.includes('session: s1.jsonl'));
  assert.ok(text.includes('# SSIM tier'));
  assert.ok(text.includes('- 裁定A'));
});

test('updateIndex 新建并在最上方插入', () => {
  updateIndex(dir, { date: '2026-11-05', topic: '旧', factCount: 1, journalFile: 'a.md' });
  updateIndex(dir, { date: '2026-11-06', topic: '新', factCount: 2, journalFile: 'b.md' });
  const lines = readFileSync(join(dir, 'JOURNAL.md'), 'utf8').split('\n');
  assert.ok(lines[0].startsWith('# JOURNAL'));
  assert.ok(lines[2].includes('新'));
  assert.ok(lines[3].includes('旧'));
});

test('pointerLine 常量', () => {
  assert.ok(pointerLine().includes('memory/journal/'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/journal.test.mjs` → FAIL

- [ ] **Step 3: 实现 `scripts/lib/journal.mjs`**

```js
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function slugify(topic) {
  const ascii = String(topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii.length >= 3) return ascii.slice(0, 40);
  return createHash('sha1').update(String(topic)).digest('hex').slice(0, 8);
}

export function writeJournalEntry(memoryDir, { date, time, topic, facts, sessionFile }) {
  const journalDir = join(memoryDir, 'journal');
  mkdirSync(journalDir, { recursive: true });
  const base = `${date}-${time}-${slugify(topic)}`;
  let path = join(journalDir, `${base}.md`);
  let n = 2;
  while (existsSync(path)) path = join(journalDir, `${base}-${n++}.md`);
  const front = `---\nsession: ${sessionFile}\ndate: ${date}\nsource: memory-mine\n---\n`;
  const body = `# ${topic}\n\n` + facts.map(f => `- ${f}`).join('\n') + '\n';
  writeFileSync(path, front + body);
  return { journalPath: path, journalFile: basename(path) };
}

export function updateIndex(memoryDir, { date, topic, factCount, journalFile }) {
  const indexPath = join(memoryDir, 'JOURNAL.md');
  const line = `- ${date} | ${topic}（${factCount} 条）→ [journal/${journalFile}](journal/${journalFile})`;
  const isNew = !existsSync(indexPath);
  const header = '# JOURNAL — memory-mine 挖掘索引（倒序）\n';
  let rest = '';
  if (!isNew) {
    const prev = readFileSync(indexPath, 'utf8');
    rest = prev.split('\n').slice(1).join('\n').replace(/^\s+/, '');
  }
  writeFileSync(indexPath, `${header}\n${line}\n${rest}`);
  return { indexPath, isNew };
}

export function pointerLine() {
  return '- 历史会话日志：memory/journal/（索引 memory/JOURNAL.md，用 rg 检索）';
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `node --test test/journal.test.mjs` → 4 pass

```bash
git add scripts/lib/journal.mjs test/journal.test.mjs
git commit -m "feat: journal落盘与倒序索引"
```

---

### Task 8: mine.mjs CLI 主链（E2E：dry-run/单会话真调/幂等）

**Files:**
- Create: `scripts/mine.mjs`

**Interfaces:**
- Consumes: Task 1-7 全部导出。
- Produces: CLI `node scripts/mine.mjs [--since YYYY-MM-DD] [--limit N] [--dry-run] [--model 名] [--project 绝对路径]`；台账写到 `<memoryDir>/journal/.mined.jsonl`；journal 与 JOURNAL.md 落盘；结束打印汇总与 MEMORY.md 指针行建议。

- [ ] **Step 1: 实现 `scripts/mine.mjs`**

```js
#!/usr/bin/env node
// /memory-mine 主链：枚举→抽取→分块→map→reduce→journal→台账（并发3，连续10失败熔断）
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveProjectDir } from './lib/config.mjs';
import { parseTranscript, renderConversation } from './lib/extract.mjs';
import { chunkText } from './lib/chunk.mjs';
import { readLedger, appendLedger, shouldSkip } from './lib/ledger.mjs';
import { callLLM, createBreaker } from './lib/llm.mjs';
import { buildMap, buildReduce, parseReduceOutput } from './lib/prompts.mjs';
import { writeJournalEntry, updateIndex, pointerLine } from './lib/journal.mjs';

const args = process.argv.slice(2);
const argValue = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');
const since = argValue('--since');
const limit = parseInt(argValue('--limit') || '0', 10);
const modelOverride = argValue('--model');
const cwd = argValue('--project') || process.cwd();

const { projectDir, memoryDir } = resolveProjectDir({ cwd });
if (!existsSync(projectDir)) { console.error(`未找到项目转录目录: ${projectDir}`); process.exit(1); }
mkdirSync(join(memoryDir, 'journal'), { recursive: true });

const cfg = loadConfig({ modelOverride });
const ledgerPath = join(memoryDir, 'journal', '.mined.jsonl');
const ledger = readLedger(ledgerPath);

const sinceMs = since ? new Date(`${since}T00:00:00`).getTime() : 0;
const all = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
  .map(f => ({ f, mtime: statSync(join(projectDir, f)).mtimeMs, size: statSync(join(projectDir, f)).size }))
  .filter(x => !shouldSkip(ledger, x.f, x.mtime) && x.mtime >= sinceMs)
  .sort((a, b) => a.mtime - b.mtime); // 旧→新
const selected = limit > 0 ? all.slice(0, limit) : all;

if (DRY) {
  console.log(`[dry-run] 项目: ${projectDir}`);
  console.log(`[dry-run] 待挖 ${selected.length} 个会话（台账已有 ${ledger.size} 个文件记录）:`);
  for (const x of selected) console.log(`  ${new Date(x.mtime).toISOString().slice(0, 10)}  ${x.f}  ${(x.size / 1024).toFixed(0)}KB`);
  process.exit(0);
}

const knownIndexPath = join(memoryDir, 'MEMORY.md');
const knownIndex = existsSync(knownIndexPath) ? readFileSync(knownIndexPath, 'utf8') : '';
let recentTitles = '';
try { recentTitles = readFileSync(join(memoryDir, 'JOURNAL.md'), 'utf8').split('\n').slice(0, 30).join('\n'); } catch {}

const breaker = createBreaker(10);
const stats = { mined: 0, empty: 0, failed: 0 };
const failedFiles = [];
const firstJournal = !existsSync(join(memoryDir, 'JOURNAL.md'));

async function mineOne(x) {
  const { messages } = parseTranscript(readFileSync(join(projectDir, x.f), 'utf8'));
  if (messages.length === 0) {
    appendLedger(ledgerPath, { file: x.f, mtime: x.mtime, status: 'empty', ts: Date.now() });
    stats.empty++;
    return;
  }
  const chunks = chunkText(renderConversation(messages));
  const notes = [];
  for (const c of chunks) {
    const { text } = await callLLM({ ...cfg, ...buildMap({ conversationText: c }), breaker });
    if (text.trim() !== 'NONE') notes.push(text.trim());
  }
  let out = { skip: true };
  if (notes.length > 0) {
    const { text } = await callLLM({ ...cfg, ...buildReduce({ mapNotes: notes, knownIndex, recentTitles }), breaker });
    out = parseReduceOutput(text);
  }
  if (out.skip) {
    appendLedger(ledgerPath, { file: x.f, mtime: x.mtime, status: 'empty', ts: Date.now() });
    stats.empty++;
    return;
  }
  const d = new Date(x.mtime);
  const { journalFile } = writeJournalEntry(memoryDir, {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 19).replaceAll(':', ''),
    topic: out.topic, facts: out.facts, sessionFile: x.f,
  });
  updateIndex(memoryDir, { date: d.toISOString().slice(0, 10), topic: out.topic, factCount: out.facts.length, journalFile });
  appendLedger(ledgerPath, { file: x.f, mtime: x.mtime, status: 'mined', journalFile, ts: Date.now() });
  stats.mined++;
  console.log(`[mined] ${x.f} → ${journalFile}（${out.facts.length} 条）`);
}

const queue = [...selected];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length && !breaker.tripped) {
    const x = queue.shift();
    if (!x) break;
    try { await mineOne(x); }
    catch (e) {
      stats.failed++;
      failedFiles.push(x.f);
      console.error(`[failed] ${x.f}: ${e.message}`);
    }
  }
}));

console.log(`\n完成: mined=${stats.mined} empty=${stats.empty} failed=${stats.failed}`);
if (failedFiles.length) { console.log('失败清单:'); for (const f of failedFiles) console.log('  ' + f); }
if (firstJournal && stats.mined > 0) console.log(`\n建议把此行加入该项目 MEMORY.md（一次性）:\n${pointerLine()}`);
if (breaker.tripped) { console.error('熔断触发：连续 10 次失败已中止。重跑将从台账断点继续。'); process.exit(2); }
```

- [ ] **Step 2: E2E dry-run（零 LLM 调用）**

Run: `node scripts/mine.mjs --project /Users/zle/dev/creator-master --dry-run | head -8`
Expected: 打印项目路径、待挖 N（约 417）、逐行 `日期 文件名 KB`，退出码 0

- [ ] **Step 3: E2E 单会话真调（走智谱网关）**

Run: `SMALLEST=$(ls -S ~/.claude/projects/-Users-zle-dev-creator-master/*.jsonl | tail -1 | xargs basename)`，记下文件名后：
`node scripts/mine.mjs --project /Users/zle/dev/creator-master --limit 1`
Expected: `[mined] <文件> → 2026-XX-XX-…md（N 条）` 或 empty；汇总行 `mined=1 empty=0 failed=0`（empty 也算通过——真实会话可能确实无耐久事实，看打印判断）
检查产出: `cat ~/.claude/projects/-Users-zle-dev-creator-master/memory/JOURNAL.md | head -5` 有索引行；`ls ~/.claude/projects/-Users-zle-dev-creator-master/memory/journal/` 有 .md 与 .mined.jsonl

- [ ] **Step 4: E2E 幂等验证**

Run: `node scripts/mine.mjs --project /Users/zle/dev-creator-master --dry-run | grep -c "<Step3挖过的文件名>" || echo 0`
Expected: `0`（台账生效，不再列出）

- [ ] **Step 5: Commit**

```bash
git add scripts/mine.mjs
git commit -m "feat: mine主链CLI——并发3/熔断/台账增量/journal落盘"
```

---

### Task 9: SKILL.md + 本机软链 + 可见性验证

**Files:**
- Create: `SKILL.md`
- Modify: 无

**Interfaces:**
- Produces: 技能入口（仓库根=技能根）；本机软链 `~/.claude/skills/memory-mine → ~/dev/memory-mine`。

- [ ] **Step 1: 写 `SKILL.md`**

```markdown
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

用法：`node <本技能目录>/scripts/forge.mjs [--scope 类目substring] [--lang zh] [--name 名] [--avatar png路径] [--project 绝对路径]`

- 产出 `expert-out/<名>/`（WorkBuddy 专家插件，已过官方 validator）+ `~/.claude/agents/<名>.md`
- 默认人格：首席平台架构师（categoryId 02-Engineering）
- **隐私铁律**：私有语料蒸馏的专家只装本机（~/.workbuddy/plugins/marketplaces/my-experts/plugins/），永不提交公开市场

设计文档：docs/design.md
```

- [ ] **Step 2: 本机软链 + 验证**

Run:
```bash
mkdir -p ~/.claude/skills && ln -sfn ~/dev/memory-mine ~/.claude/skills/memory-mine
ls -la ~/.claude/skills/memory-mine/SKILL.md
git clone ~/dev/memory-mine /tmp/mm-clone-test && ls /tmp/mm-clone-test/SKILL.md && rm -rf /tmp/mm-clone-test
```
Expected: 软链存在；clone 后 SKILL.md 在根（克隆即用成立）。用户在新的 Claude Code 会话输入 `/memory-mine` 应能看到技能（用户确认）。

- [ ] **Step 3: Commit**

```bash
git add SKILL.md
git commit -m "feat: 技能入口SKILL.md——双子命令用法"
```

---

### Task 10: forge 语料解析与提示词

**Files:**
- Modify: `scripts/lib/prompts.mjs`（文件末尾追加 forge 部分）
- Test: `test/prompts-forge.test.mjs`

**Interfaces:**
- Produces:
  - `parseClusters(indexText) → Array<{ name: string, files: string[] }>`（识别 `# — X —` 与通用 `# X` 两级标题下的 `.md` 链接；空簇过滤）
  - `buildCluster({ clusterName, corpus }) → { system, user }`
  - `buildPersona({ clusterOutputs: Array<{name, text}>, projectName, lang }) → { system, user }`
  - `buildMeta({ clusterNames: string[], projectName }) → { system, user }`（要求严格输出一个 JSON 对象）
  - `parseJSONLoose(text) → object`（截取首尾大括号解析）
- Task 12 消费。

- [ ] **Step 1: 写失败测试 `test/prompts-forge.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClusters, buildCluster, buildPersona, buildMeta, parseJSONLoose } from '../scripts/lib/prompts.mjs';

const INDEX = `# Memory Index
# — DB / 计费 —
- [积分白名单](points-billing.md) 坑
- [连接打爆](pg-conn.md)
# — 视频 —
- [SSIM tier](ssim.md)
## 子标题不建簇
- [子链](sub.md)
# 普通标题簇
- [孤儿](orphan.md)
`;

test('parseClusters 两种标题+链接归簇，##子标题不建簇', () => {
  const cs = parseClusters(INDEX);
  const names = cs.map(c => c.name);
  assert.deepEqual(names, ['DB / 计费', '视频', '普通标题簇']);
  assert.deepEqual(cs[0].files, ['points-billing.md', 'pg-conn.md']);
  assert.deepEqual(cs[1].files, ['ssim.md', 'sub.md']); // 子标题下链接归当前簇
  assert.deepEqual(cs[2].files, ['orphan.md']);
});

test('parseClusters 无链接的簇被过滤，空文本返回空', () => {
  assert.deepEqual(parseClusters('# A\n无链接'), []);
  assert.deepEqual(parseClusters(''), []);
});

test('buildCluster 含类目与语料', () => {
  const p = buildCluster({ clusterName: '视频', corpus: '语料X' });
  assert.ok(p.user.includes('视频') && p.user.includes('语料X'));
  assert.ok(p.system.includes('3KB'));
});

test('buildPersona 注入簇输出与项目名', () => {
  const p = buildPersona({ clusterOutputs: [{ name: '视频', text: '知识Y' }], projectName: 'creator-master', lang: 'zh' });
  assert.ok(p.user.includes('知识Y'));
  assert.ok(p.system.includes('creator-master'));
});

test('buildMeta 要求严格 JSON；parseJSONLoose 容忍前后杂文', () => {
  const p = buildMeta({ clusterNames: ['视频'], projectName: 'p' });
  assert.ok(p.system.includes('JSON'));
  const obj = parseJSONLoose('前言 {"a":1,"b":[2]} 后记');
  assert.deepEqual(obj, { a: 1, b: [2] });
  assert.throws(() => parseJSONLoose('没有json'), /JSON/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/prompts-forge.test.mjs` → FAIL

- [ ] **Step 3: 在 `scripts/lib/prompts.mjs` 末尾追加 forge 部分**

```js
// ===== forge：语料聚簇与专家蒸馏提示词 =====
export function parseClusters(indexText) {
  const clusters = [];
  let cur = null;
  for (const line of String(indexText).split('\n')) {
    if (!line.startsWith('##')) {
      const h = line.match(/^#\s*—(.+?)—\s*$/) || line.match(/^#\s+(.+?)\s*$/);
      if (h) { cur = { name: h[1].trim(), files: [] }; clusters.push(cur); continue; }
    }
    const m = line.match(/\[[^\]]+\]\(([^)]+?\.md)\)/);
    if (m && cur) cur.files.push(m[1]);
  }
  return clusters.filter(c => c.files.length > 0);
}

export function buildCluster({ clusterName, corpus }) {
  return {
    system: '你是知识压缩器。把输入的项目记忆语料压缩成 ≤3KB 高密度知识，中文，markdown 小节。优先级：裁定（含为什么）> 复发坑（判别方法+修法）> 规范 > 背景。只保留对未来工程决策有用的事实，保留关键文件路径与数值。严禁编造语料中没有的内容。',
    user: `类目：${clusterName}\n\n语料：\n${corpus}\n\n输出 ≤3KB 高密度知识 markdown（不要用代码块包裹）。`,
  };
}

export function buildPersona({ clusterOutputs, projectName, lang }) {
  return {
    system: `你是专家人格撰写者。基于给定知识段，撰写「${projectName} 首席平台架构师」人格文档（${lang === 'zh' ? '中文' : 'English'}）。结构：一级标题「首席平台架构师」与 3 句内身份定位 → 「## 工作原则」（5 条内）→ 每个知识段一节（保留原文高密度事实，不稀释）→ 最后「## 业务红线与语境」（把语料中的用户裁定/禁令集中放此节）。总长 ≤30KB。严禁编造。`,
    user: clusterOutputs.map(c => `【${c.name}】\n${c.text}`).join('\n\n'),
  };
}

export function buildMeta({ clusterNames, projectName }) {
  return {
    system: `为 WorkBuddy 专家市场生成元数据，严格只输出一个 JSON 对象（无其他文字）：{"displayName":{"zh":"","en":""},"profession":{"zh":"首席平台架构师","en":"Chief Platform Architect"},"displayDescription":{"zh":"","en":""},"tags":[{"zh":"","en":""}],"quickPrompts":[{"zh":"","en":""}]}。硬性要求：displayDescription.zh 必须 40-50 个汉字；tags 恰 3 个；quickPrompts 恰 3 条且第一条是用户最可能的开场提问、具体可执行；全部围绕 ${projectName} 平台工程。`,
    user: `项目：${projectName}\n知识类目：${clusterNames.join('、')}\n\n输出该 JSON 对象。`,
  };
}

export function parseJSONLoose(text) {
  const s = String(text).indexOf('{');
  const e = String(text).lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('LLM 未返回 JSON 对象');
  return JSON.parse(String(text).slice(s, e + 1));
}
```

- [ ] **Step 4: 跑测试确认通过（含 Task 6 旧测试不回归）+ Commit**

Run: `node --test test/prompts.test.mjs test/prompts-forge.test.mjs` → 10 pass

```bash
git add scripts/lib/prompts.mjs test/prompts-forge.test.mjs
git commit -m "feat: forge提示词——MEMORY.md聚簇/簇压缩/人格组装/市场元数据JSON"
```

---

### Task 11: 官方 validator + 默认头像资产

**Files:**
- Create: `scripts/lib/validate.mjs`
- Create: `scripts/assets/default-avatar.png`（二进制，512×512）
- Test: `test/validate.test.mjs`

**Interfaces:**
- Produces:
  - `CATEGORY_IDS: string[]`（官方 15 类枚举）
  - `pngSize(buf: Buffer) → { width, height } | null`（IHDR 解析）
  - `validateExpertDir(dir) → { valid: boolean, errors: string[] }`
- Task 12 消费。

- [ ] **Step 1: 生成默认头像（本机 PIL，一次生成提交入库，终端用户零依赖）**

Run: `mkdir -p scripts/assets && python3 -c "from PIL import Image; Image.new('RGB',(512,512),(30,58,138)).save('scripts/assets/default-avatar.png')"`
Expected: 生成后 `ls -la scripts/assets/default-avatar.png` 存在（约 1-2KB）。

- [ ] **Step 2: 写失败测试 `test/validate.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORY_IDS, pngSize, validateExpertDir } from '../scripts/lib/validate.mjs';

// 伪 PNG：8 字节签名 + 4长度 + 'IHDR' + width + height（pngSize 只查 IHDR）
function fakePng(w, h) {
  const b = Buffer.alloc(24);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test('CATEGORY_IDS 含工程类', () => {
  assert.ok(CATEGORY_IDS.includes('02-Engineering'));
});

test('pngSize 读 IHDR 宽高，非 PNG 返回 null', () => {
  assert.deepEqual(pngSize(fakePng(512, 512)), { width: 512, height: 512 });
  assert.equal(pngSize(Buffer.alloc(24)), null);
});

const dir = mkdtempSync(join(tmpdir(), 'mm-validate-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function buildExpert({ descZh = '四十五个汉字'.padEnd(45, '字') } = {}) {
  const d = join(dir, 'e-' + Math.random().toString(36).slice(2));
  mkdirSync(join(d, '.codebuddy-plugin'), { recursive: true });
  mkdirSync(join(d, 'avatars'), { recursive: true });
  writeFileSync(join(d, 'avatars', 'expert.png'), fakePng(512, 512));
  const json = {
    name: 'p-architect', version: '1.0.0', description: 'd',
    author: { name: 'x', email: '' },
    agents: ['./agents/p-architect.md'], expertType: 'agent', agentName: 'p-architect',
    displayName: { zh: '架构师', en: 'Architect' },
    profession: { zh: '首席平台架构师', en: 'Chief Platform Architect' },
    displayDescription: { zh: descZh, en: 'desc' },
    avatar: 'avatars/expert.png', categoryId: '02-Engineering',
    defaultInitPrompt: { zh: '问一', en: 'q1' }, plugin: 'p-architect',
    tags: [{ zh: 't', en: 't' }, { zh: 't', en: 't' }, { zh: 't', en: 't' }],
    quickPrompts: [
      { zh: '问一', en: 'q1' }, { zh: '问二', en: 'q2' }, { zh: '问三', en: 'q3' },
    ],
  };
  writeFileSync(join(d, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(json));
  mkdirSync(join(d, 'agents'), { recursive: true });
  writeFileSync(join(d, 'agents', 'p-architect.md'), '---\nname: p-architect\n---\nbody');
  return d;
}

test('合规目录通过', () => {
  const r = validateExpertDir(buildExpert());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test('描述字数不足 / quickPrompts 数量错 / initPrompt 不一致 全被拦', () => {
  const short = validateExpertDir(buildExpert({ descZh: '太短' }));
  assert.ok(short.errors.some(e => e.includes('40-50')));
  const d = buildExpert();
  const jsonPath = join(d, '.codebuddy-plugin', 'plugin.json');
  const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
  j.quickPrompts = j.quickPrompts.slice(0, 2);
  writeFileSync(jsonPath, JSON.stringify(j));
  const r = validateExpertDir(d);
  assert.ok(r.errors.some(e => e.includes('quickPrompts')));
  const d2 = buildExpert();
  const j2 = JSON.parse(readFileSync(join(d2, '.codebuddy-plugin', 'plugin.json'), 'utf8'));
  j2.defaultInitPrompt = { zh: '不一样', en: 'x' };
  writeFileSync(join(d2, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(j2));
  const r2 = validateExpertDir(d2);
  assert.ok(r2.errors.some(e => e.includes('defaultInitPrompt')));
});
```

注意：测试顶部需 `import { readFileSync } from 'node:fs';`（与 mkdtempSync 等合并在同一 import）。

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/validate.test.mjs` → FAIL

- [ ] **Step 4: 实现 `scripts/lib/validate.mjs`**

```js
// 官方专家市场校验（open.workbuddy.cn/docs/expert）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CATEGORY_IDS = [
  '01-ProductDesign', '02-Engineering', '03-GameSpatial', '04-DataAI', '05-MarketingGrowth',
  '06-ContentCreative', '07-SalesCommerce', '08-FinanceInvestment', '09-OperationsHR',
  '10-ProjectQuality', '11-SecurityCompliance', '12-IndustryConsultant', '13-TencentZone',
  '14-WorldWise', '15-Education',
];

export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null; // 'IHDR'
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function validateExpertDir(dir) {
  const errors = [];
  const p = join(dir, '.codebuddy-plugin', 'plugin.json');
  if (!existsSync(p)) return { valid: false, errors: ['缺少 .codebuddy-plugin/plugin.json'] };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { return { valid: false, errors: [`plugin.json 解析失败: ${e.message}`] }; }

  for (const k of ['name', 'version', 'description', 'author', 'agents', 'expertType', 'agentName',
    'displayName', 'profession', 'displayDescription', 'avatar', 'categoryId',
    'defaultInitPrompt', 'plugin', 'tags', 'quickPrompts']) {
    if (j[k] == null || j[k] === '') errors.push(`缺字段 ${k}`);
  }
  if (j.expertType !== 'agent') errors.push('expertType 必须为 "agent"');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(j.name || ''))) errors.push('name 须为小写字母+连字符');
  if (j.plugin !== j.name) errors.push('plugin 须与 name 一致');
  if (!Array.isArray(j.quickPrompts) || j.quickPrompts.length !== 3) errors.push('quickPrompts 须固定 3 条');
  if (!Array.isArray(j.tags) || j.tags.length !== 3) errors.push('tags 须固定 3 个');
  if (Array.isArray(j.quickPrompts) && j.quickPrompts[0] && j.defaultInitPrompt &&
    (j.quickPrompts[0].zh !== j.defaultInitPrompt.zh || j.quickPrompts[0].en !== j.defaultInitPrompt.en)) {
    errors.push('defaultInitPrompt 必须与 quickPrompts[0] 一致');
  }
  const zhLen = [...String(j.displayDescription?.zh || '')].length;
  if (zhLen < 40 || zhLen > 50) errors.push(`displayDescription.zh 中文须 40-50 字（当前 ${zhLen}）`);
  if (!CATEGORY_IDS.includes(j.categoryId)) errors.push('categoryId 不在官方枚举');

  if (j.avatar) {
    const ap = join(dir, j.avatar);
    if (!existsSync(ap)) errors.push(`头像不存在: ${j.avatar}`);
    else {
      const buf = readFileSync(ap);
      const size = pngSize(buf);
      if (!size) errors.push('头像不是合法 PNG');
      else {
        if (size.width !== 512 || size.height !== 512) errors.push(`头像须 512×512（当前 ${size.width}×${size.height}）`);
        if (buf.length > 500 * 1024) errors.push(`头像须 ≤500KB（当前 ${Math.round(buf.length / 1024)}KB）`);
      }
    }
  }
  if (Array.isArray(j.agents)) {
    for (const a of j.agents) if (!existsSync(join(dir, a))) errors.push(`agent 文件缺失: ${a}`);
  }
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 5: 跑测试确认通过 + Commit**

Run: `node --test test/validate.test.mjs` → 5 pass

```bash
git add scripts/lib/validate.mjs scripts/assets/default-avatar.png test/validate.test.mjs
git commit -m "feat: 官方专家validator——全字段硬校验+默认头像资产"
```

---

### Task 12: forge.mjs CLI（组装 + 双出口 + validator）

**Files:**
- Create: `scripts/forge.mjs`

**Interfaces:**
- Consumes: Task 3/5/10/11 导出。
- Produces: CLI `node scripts/forge.mjs [--scope substring] [--lang zh] [--name 名] [--avatar png] [--project 绝对路径]`；产出 `expert-out/<name>/`（plugin.json + agents + avatars + README）与 `~/.claude/agents/<name>.md`；结束跑 validator，不过则退出码 1。

- [ ] **Step 1: 实现 `scripts/forge.mjs`**

```js
#!/usr/bin/env node
// /memory-mine forge：记忆语料 → 首席平台架构师专家（WorkBuddy + Claude agent 双出口）
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveProjectDir } from './lib/config.mjs';
import { callLLM } from './lib/llm.mjs';
import { buildCluster, buildPersona, buildMeta, parseJSONLoose, parseClusters } from './lib/prompts.mjs';
import { validateExpertDir } from './lib/validate.mjs';

const args = process.argv.slice(2);
const argValue = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const cwd = argValue('--project') || process.cwd();
const scope = argValue('--scope');
const lang = argValue('--lang') || 'zh';
const avatarArg = argValue('--avatar');
const scriptDir = dirname(fileURLToPath(import.meta.url));

const { slug, memoryDir } = resolveProjectDir({ cwd });
const name = (argValue('--name') || `${slug.replace(/^-/, '')}-architect`).toLowerCase();

const indexPath = join(memoryDir, 'MEMORY.md');
if (!existsSync(indexPath)) { console.error(`未找到 ${indexPath}（该项目没有原生记忆索引，先跑 /memory-mine 或积累记忆）`); process.exit(1); }
const cfg = loadConfig({});

// 1. 语料与聚簇
let clusters = parseClusters(readFileSync(indexPath, 'utf8'));
const journalDir = join(memoryDir, 'journal');
if (existsSync(journalDir)) {
  const jf = readdirSync(journalDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 30);
  if (jf.length) clusters.push({ name: '近期会话判例', files: jf.map(f => 'journal/' + f) });
}
if (scope) clusters = clusters.filter(c => c.name.includes(scope));
if (clusters.length === 0) {
  clusters = [{
    name: '全部',
    files: readdirSync(memoryDir).filter(f => f.endsWith('.md') && !['MEMORY.md', 'JOURNAL.md'].includes(f)),
  }];
}
console.log(`类目 ${clusters.length} 个: ${clusters.map(c => `${c.name}(${c.files.length})`).join('、')}`);

// 2. 每簇压缩（语料上限 60K 字符）
const CAP = 60000;
const outputs = [];
for (const c of clusters) {
  let corpus = '';
  for (const rel of c.files) {
    const p = join(memoryDir, rel);
    if (!existsSync(p)) continue;
    corpus += `\n\n### ${rel}\n` + readFileSync(p, 'utf8');
    if (corpus.length > CAP) { corpus = corpus.slice(0, CAP) + '\n…(截断)'; break; }
  }
  if (!corpus.trim()) continue;
  const { text } = await callLLM({ ...cfg, ...buildCluster({ clusterName: c.name, corpus }) });
  outputs.push({ name: c.name, text: text.trim() });
  console.log(`[cluster] ${c.name} → ${text.trim().length} 字符`);
}
if (outputs.length === 0) { console.error('语料为空，无法蒸馏'); process.exit(1); }

// 3. 人格 + 市场元数据
const projectName = slug.replace(/^-/, '');
let persona = (await callLLM({ ...cfg, ...buildPersona({ clusterOutputs: outputs, projectName, lang }) })).text.trim();
if (persona.length > 30720) persona = persona.slice(0, 30720) + '\n…(已按 30KB 预算截断)';
const meta = parseJSONLoose((await callLLM({ ...cfg, ...buildMeta({ clusterNames: outputs.map(o => o.name), projectName }) })).text);

// 4. 双出口
const outDir = join(process.cwd(), 'expert-out', name);
const agentRel = `agents/${name}.md`;
for (const d of [join(outDir, 'agents'), join(outDir, 'avatars'), join(outDir, '.codebuddy-plugin')]) mkdirSync(d, { recursive: true });

const pluginJson = {
  name, version: '1.0.0',
  description: meta.displayDescription?.en || `${name} distilled by memory-mine`,
  author: { name: 'memory-mine forge', email: '' },
  agents: [`./${agentRel}`], expertType: 'agent', agentName: name,
  displayName: meta.displayName, profession: meta.profession, displayDescription: meta.displayDescription,
  avatar: 'avatars/expert.png', categoryId: '02-Engineering',
  defaultInitPrompt: meta.quickPrompts[0], plugin: name,
  tags: meta.tags, quickPrompts: meta.quickPrompts,
};
writeFileSync(join(outDir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(pluginJson, null, 2));

const agentMd = `---\nname: ${name}\ndescription: ${projectName} platform architect distilled by memory-mine\ndisplayName:\n  zh: ${meta.displayName?.zh || name}\n  en: ${meta.displayName?.en || name}\nprofession:\n  zh: ${meta.profession?.zh || '首席平台架构师'}\n  en: ${meta.profession?.en || 'Chief Platform Architect'}\nmaxTurns: 100\n---\n\n${persona}\n`;
writeFileSync(join(outDir, agentRel), agentMd);
copyFileSync(avatarArg || join(scriptDir, 'assets', 'default-avatar.png'), join(outDir, 'avatars', 'expert.png'));
writeFileSync(join(outDir, 'README.md'), `# ${meta.displayName?.zh || name}\n\n${meta.displayDescription?.zh || ''}\n\n由 memory-mine forge 从项目记忆语料蒸馏。**私有专家，勿提交公开市场。**\n`);

const ccDir = join(process.env.HOME, '.claude', 'agents');
mkdirSync(ccDir, { recursive: true });
writeFileSync(join(ccDir, `${name}.md`), `---\nname: ${name}\ndescription: ${projectName} 首席平台架构师（memory-mine 蒸馏）\n---\n\n${persona}\n`);

// 5. 官方 validator
const v = validateExpertDir(outDir);
if (!v.valid) {
  console.error('官方规范校验未过:');
  for (const e of v.errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`\n完成（validator 全绿）:\n  专家插件: ${outDir}\n  Claude agent: ~/.claude/agents/${name}.md\n  本机安装: cp -r ${outDir} ~/.workbuddy/plugins/marketplaces/my-experts/plugins/${name}`);
```

- [ ] **Step 2: E2E 小语料真调**

Run: `node scripts/forge.mjs --project /Users/zle/dev/mujoco-learn --name mujoco-architect`
（mujoco-learn 项目记忆只有 2 个文件，语料最小、成本最低）
Expected: 打印类目清单、每簇 `[cluster]`、结束 `完成（validator 全绿）`；`ls expert-out/mujoco-architect/` 四件套齐全；`ls ~/.claude/agents/mujoco-architect.md` 存在
注意：若 mujoco-learn 无 MEMORY.md（该项目的记忆在 creator-master 名下），改用 `--project /Users/zle/dev/creator-master --scope 视` 只蒸一个类目做小语料验证（--name creator-master-architect）。

- [ ] **Step 3: Commit**

```bash
git add scripts/forge.mjs
git commit -m "feat: forge CLI——聚簇压缩/人格组装/双出口/官方validator门禁"
```

---

### Task 13: WorkBuddy 真机安装验收（用户参与）

**Files:** 无新文件（验收任务）

- [ ] **Step 1: 安装到本机 my-experts**

Run: `cp -r expert-out/<专家名> ~/.workbuddy/plugins/marketplaces/my-experts/plugins/<专家名> && ls ~/.workbuddy/plugins/marketplaces/my-experts/plugins/`
Expected: 目录出现。

- [ ] **Step 2: 用户在 WorkBuddy 验证（用户动作）**

重启 WorkBuddy → 专家市场 → 我的专家 → 找到专家 → 召唤专家 → 用 quickPrompts 第一条开场提问 → 确认回答体现蒸馏知识（如能说出某个裁定/坑）。
Expected: 专家可见、可对话、回答含语料知识。

- [ ] **Step 3: Claude Code agent 出口验证**

在任意 Claude Code 会话问一个应触发 subagent 的问题，或检查 `/tmp` 下 `claude --debug` 列表；最简验证：`head -5 ~/.claude/agents/<专家名>.md` frontmatter 正确（name/description），并在会话中输入「用 <专家名> agent 查一下 X」。
Expected: agent 文件被 Claude Code 识别（Agent 工具列表中出现该名）。

- [ ] **Step 4: 记录验收结果并 Commit（若有微调）**

```bash
git add -A && git commit -m "test: WorkBuddy真机安装验收通过" || echo "无改动，跳过"
```

---

### Task 14: 全量挖掘 + README 状态更新 + 推送 GitHub

**Files:**
- Modify: `README.md`（状态行）

- [ ] **Step 1: 全量后台挖（用户确认成本后执行）**

预估：417 会话 × 平均 1-3 块 ≈ 500-1200 次 GLM 调用（走你的智谱账户）。
Run: `nohup node scripts/mine.mjs --project /Users/zle/dev/creator-master > /tmp/mm-full.log 2>&1 &` 然后 `tail -f /tmp/mm-full.log` 观察进展。
Expected: 结束汇总 `failed < 5%`（417 的 5% ≈ 21）；失败清单有文件名可单独重跑。
可选：先 `--since 2026-10-01` 切近一个月降低首跑成本，用户定。

- [ ] **Step 2: 断点续跑验证**

Run: `kill <pid>` 中途杀一次 → 重跑同一命令 → 日志显示继续处理未挖会话（台账生效），已挖文件不再重复。
Expected: 重跑后汇总的 mined 数从断点累计，无重复 journal（JOURNAL.md 无同 session 重复行）。

- [ ] **Step 3: 更新 README 状态**

README 两处 `> 状态：**设计定稿，实现中**` / `> Status: **design finalized, implementation in progress**` 改为 `> 状态：v0.1.0 已实现（挖掘 + 专家蒸馏全链路）` / `> Status: v0.1.0 shipped (mining + expert forging)`。

- [ ] **Step 4: 全测试回归 + 推送**

Run: `node --test test/ && git add -A && git commit -m "docs: v0.1.0 实现收口——README状态更新" && git push origin main`
Expected: 全部单测绿；push 成功；GitHub 上 README 状态更新。

---

## Self-Review 记录

- **Spec 覆盖**：设计第 3 节仓库结构→Task 1/9/11；第 4 节挖掘管线→Task 1-8；journal 格式→Task 7；指针行→Task 8 Step 3 输出+Task 9 文档；第 5 节 forge→Task 10-12；官方 validator→Task 11；双出口→Task 12；隐私铁律→Task 9/12 文案与 README；第 6 节台账/容错/LLM 调用→Task 4/5/8；第 7 节验收 1-6→Task 9(克隆即用)/8(dry-run 幂等)/8+14(抽检、全量、断点)/12-13(forge 双出口、真机)/14(开源卫生)；第 8 节测试→各任务 TDD 步骤。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`parseTranscript→{messages,skipped}`（Task 1 定义，Task 8 用 `messages`）；`chunkText(text,{maxChars})`；`loadConfig({settingsPath,env,modelOverride})→{baseUrl,authToken,apiKey,model}`（Task 8 `...cfg` 展开传入 callLLM 字段名一致）；`readLedger/appendLedger/shouldSkip`；`createBreaker/callLLM`；`buildMap/buildReduce/parseReduceOutput`；`writeJournalEntry({date,time,topic,facts,sessionFile})→{journalPath,journalFile}`；`parseClusters/buildCluster/buildPersona/buildMeta/parseJSONLoose`；`validateExpertDir/pngSize/CATEGORY_IDS`。签名与消费点核对一致。
