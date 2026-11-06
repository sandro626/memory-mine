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
