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

test('readLedger 不存在文件返回空 Map，坏行忽略', async () => {
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
