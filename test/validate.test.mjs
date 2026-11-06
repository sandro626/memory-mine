import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
