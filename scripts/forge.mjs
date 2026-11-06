#!/usr/bin/env node
// /memory-mine forge：记忆语料 → 首席平台架构师专家（WorkBuddy + Claude agent 双出口）
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveProjectDir } from './lib/config.mjs';
import { callLLM } from './lib/llm.mjs';
import { buildCluster, buildPersona, buildMeta, parseJSONLoose, parseClusters } from './lib/prompts.mjs';
import { validateExpertDir } from './lib/validate.mjs';

const args = process.argv.slice(2);
const argValue = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const cwd = argValue('--project') || process.cwd();
const scope = argValue('--scope');
const lang = argValue('--lang') || 'zh';
const avatarArg = argValue('--avatar');
const projectNameOverride = argValue('--project-name');
const scriptDir = dirname(fileURLToPath(import.meta.url));

const { slug, memoryDir } = resolveProjectDir({ cwd });
const name = (argValue('--name') || `${slug.replace(/^-/, '')}-architect`).toLowerCase();

const indexPath = join(memoryDir, 'MEMORY.md');
if (!existsSync(indexPath)) { console.error(`未找到 ${indexPath}（该项目没有原生记忆索引，先跑 /memory-mine 或积累记忆）`); process.exit(1); }
const cfg = loadConfig({});

// 1. 语料与聚簇
let clusters = parseClusters(readFileSync(indexPath, 'utf8'));
const journalDir = join(memoryDir, 'journal');
if (existsSync(journalDir)) {
  const jf = readdirSync(journalDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 30);
  if (jf.length) clusters.push({ name: '近期会话判例', files: jf.map(f => 'journal/' + f) });
}
if (scope) clusters = clusters.filter(c => c.name.includes(scope));
if (clusters.length === 0) {
  clusters = [{
    name: '全部',
    files: readdirSync(memoryDir).filter(f => f.endsWith('.md') && !['MEMORY.md', 'JOURNAL.md'].includes(f)),
  }];
}
console.log(`类目 ${clusters.length} 个: ${clusters.map(c => `${c.name}(${c.files.length})`).join('、')}`);

// 2. 每簇压缩（语料上限 60K 字符）
const CAP = 60000;
const outputs = [];
for (const c of clusters) {
  let corpus = '';
  for (const rel of c.files) {
    const p = join(memoryDir, rel);
    if (!existsSync(p)) continue;
    corpus += `\n\n### ${rel}\n` + readFileSync(p, 'utf8');
    if (corpus.length > CAP) { corpus = corpus.slice(0, CAP) + '\n…(截断)'; break; }
  }
  if (!corpus.trim()) continue;
  // glm-5.3 是思考模型：thinking 块消耗输出 token 预算，4096 默认值会被烧光导致正文 0 字符，故显式抬到 32K（上限非目标，无额外成本）
  const { text } = await callLLM({ ...cfg, ...buildCluster({ clusterName: c.name, corpus }), maxTokens: 32768 });
  outputs.push({ name: c.name, text: text.trim() });
  console.log(`[cluster] ${c.name} → ${text.trim().length} 字符`);
}
if (outputs.length === 0) { console.error('语料为空，无法蒸馏'); process.exit(1); }

// 3. 人格 + 市场元数据
const projectName = projectNameOverride || slug.replace(/^-/, '');
let persona = (await callLLM({ ...cfg, ...buildPersona({ clusterOutputs: outputs, projectName, lang }), maxTokens: 32768 })).text.trim();
if (persona.length > 30720) persona = persona.slice(0, 30720) + '\n…(已按 30KB 预算截断)';
const meta = parseJSONLoose((await callLLM({ ...cfg, ...buildMeta({ clusterNames: outputs.map(o => o.name), projectName }), maxTokens: 32768 })).text);

// 4. 双出口
const outDir = join(process.cwd(), 'expert-out', name);
const agentRel = `agents/${name}.md`;
for (const d of [join(outDir, 'agents'), join(outDir, 'avatars'), join(outDir, '.codebuddy-plugin')]) mkdirSync(d, { recursive: true });

const pluginJson = {
  name, version: '1.0.0',
  description: meta.displayDescription?.en || `${name} distilled by memory-mine`,
  author: { name: 'memory-mine forge', email: '' },
  agents: [`./${agentRel}`], expertType: 'agent', agentName: name,
  displayName: meta.displayName, profession: meta.profession, displayDescription: meta.displayDescription,
  avatar: 'avatars/expert.png', categoryId: '02-Engineering',
  defaultInitPrompt: meta.quickPrompts[0], plugin: name,
  tags: meta.tags, quickPrompts: meta.quickPrompts,
};
writeFileSync(join(outDir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(pluginJson, null, 2));

const agentMd = `---\nname: ${name}\ndescription: ${projectName} platform architect distilled by memory-mine\ndisplayName:\n  zh: ${meta.displayName?.zh || name}\n  en: ${meta.displayName?.en || name}\nprofession:\n  zh: ${meta.profession?.zh || '首席平台架构师'}\n  en: ${meta.profession?.en || 'Chief Platform Architect'}\nmaxTurns: 100\n---\n\n${persona}\n`;
writeFileSync(join(outDir, agentRel), agentMd);
copyFileSync(avatarArg || join(scriptDir, 'assets', 'default-avatar.png'), join(outDir, 'avatars', 'expert.png'));
writeFileSync(join(outDir, 'README.md'), `# ${meta.displayName?.zh || name}\n\n${meta.displayDescription?.zh || ''}\n\n由 memory-mine forge 从项目记忆语料蒸馏。**私有专家，勿提交公开市场。**\n`);

const ccDir = join(process.env.HOME, '.claude', 'agents');
mkdirSync(ccDir, { recursive: true });
writeFileSync(join(ccDir, `${name}.md`), `---\nname: ${name}\ndescription: ${projectName} 首席平台架构师（memory-mine 蒸馏）\n---\n\n${persona}\n`);

// 5. 官方 validator
const v = validateExpertDir(outDir);
if (!v.valid) {
  console.error('官方规范校验未过:');
  for (const e of v.errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`\n完成（validator 全绿）:\n  专家插件: ${outDir}\n  Claude agent: ~/.claude/agents/${name}.md\n  本机安装: cp -r ${outDir} ~/.workbuddy/plugins/marketplaces/my-experts/plugins/${name}`);
