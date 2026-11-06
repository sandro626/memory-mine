import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClusters, buildCluster, buildPersona, buildMeta, parseJSONLoose } from '../scripts/lib/prompts.mjs';

const INDEX = `# Memory Index
# — DB / 计费 —
- [积分白名单](points-billing.md) 坑
- [连接打爆](pg-conn.md)
# — 视频 —
- [SSIM tier](ssim.md)
## 子标题不建簇
- [子链](sub.md)
# 普通标题簇
- [孤儿](orphan.md)
`;

test('parseClusters 两种标题+链接归簇，##子标题不建簇', () => {
  const cs = parseClusters(INDEX);
  const names = cs.map(c => c.name);
  assert.deepEqual(names, ['DB / 计费', '视频', '普通标题簇']);
  assert.deepEqual(cs[0].files, ['points-billing.md', 'pg-conn.md']);
  assert.deepEqual(cs[1].files, ['ssim.md', 'sub.md']); // 子标题下链接归当前簇
  assert.deepEqual(cs[2].files, ['orphan.md']);
});

test('parseClusters 无链接的簇被过滤，空文本返回空', () => {
  assert.deepEqual(parseClusters('# A\n无链接'), []);
  assert.deepEqual(parseClusters(''), []);
});

test('buildCluster 含类目与语料', () => {
  const p = buildCluster({ clusterName: '视频', corpus: '语料X' });
  assert.ok(p.user.includes('视频') && p.user.includes('语料X'));
  assert.ok(p.system.includes('3KB'));
});

test('buildPersona 注入簇输出与项目名', () => {
  const p = buildPersona({ clusterOutputs: [{ name: '视频', text: '知识Y' }], projectName: 'creator-master', lang: 'zh' });
  assert.ok(p.user.includes('知识Y'));
  assert.ok(p.system.includes('creator-master'));
});

test('buildMeta 要求严格 JSON；parseJSONLoose 容忍前后杂文', () => {
  const p = buildMeta({ clusterNames: ['视频'], projectName: 'p' });
  assert.ok(p.system.includes('JSON'));
  const obj = parseJSONLoose('前言 {"a":1,"b":[2]} 后记');
  assert.deepEqual(obj, { a: 1, b: [2] });
  assert.throws(() => parseJSONLoose('没有json'), /JSON/);
});
