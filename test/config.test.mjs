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
