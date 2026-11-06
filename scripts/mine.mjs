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
