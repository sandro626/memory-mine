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
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { rate: res.status === 429 });
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
      // 429 是账号级限流：短退避只会撞得更狠，按 15s/30s/45s 等限流窗口；其他可重试错误 500ms/1s/2s
      if (e.rate) await sleep(15000 * (attempt + 1));
      else await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}
