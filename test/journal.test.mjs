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
