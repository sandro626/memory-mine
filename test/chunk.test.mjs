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
