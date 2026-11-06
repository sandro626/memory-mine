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
