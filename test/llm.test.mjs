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
