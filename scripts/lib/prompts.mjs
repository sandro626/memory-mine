// ===== mine：蒸馏提示词 =====
export function buildMap({ conversationText }) {
  return {
    system: '你是工程会话记忆蒸馏器。从对话片段中提取「耐久事实」：裁定与决策（含理由）、环境坑（含判别方法）、规范约束、关键数值与文件路径、进行中状态。排除：一次性 debug 细节、常规代码编辑、临时探索、寒暄。每条以 "- " 开头，自包含（含路径/数值）。没有耐久事实时只输出 NONE。',
    user: `以下是 Claude Code 会话片段：\n\n${conversationText}\n\n输出耐久事实列表（每条 "- " 开头），或只输出 NONE。`,
  };
}

export function buildReduce({ mapNotes, knownIndex = '', recentTitles = '' }) {
  return {
    system: '你是记忆合并器。输入是多个片段蒸馏出的事实列表。任务：1) 去重合并 2) 剔除「已知事实」已覆盖的内容 3) 按耐久度排序（裁定>坑>规范>状态）4) 最多保留 15 条。输出格式严格为：第一行 "TOPIC: <一句话主题>"，随后每行一条 "- <事实>"。若全部已知或无价值，只输出 SKIP。',
    user: `片段蒸馏结果：\n${mapNotes.join('\n')}\n\n已知事实（已覆盖的须剔除）：\n${knownIndex || '（无）'}\n\n近期已记录主题（避免重复）：\n${recentTitles || '（无）'}\n\n按格式输出 TOPIC 与事实列表，或 SKIP。`,
  };
}

export function parseReduceOutput(text) {
  const t = String(text || '').trim();
  if (!t || t.toUpperCase().startsWith('SKIP')) return { skip: true };
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const topicLine = lines.find(l => l.toUpperCase().startsWith('TOPIC:'));
  if (!topicLine) return { skip: true };
  const topic = topicLine.replace(/^TOPIC:\s*/i, '').trim();
  const facts = lines.filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
  if (!topic || facts.length === 0) return { skip: true };
  return { skip: false, topic, facts };
}

// ===== forge：语料聚簇与专家蒸馏提示词 =====
export function parseClusters(indexText) {
  const clusters = [];
  let cur = null;
  for (const line of String(indexText).split('\n')) {
    if (!line.startsWith('##')) {
      const h = line.match(/^#\s*—(.+?)—\s*$/) || line.match(/^#\s+(.+?)\s*$/);
      if (h) { cur = { name: h[1].trim(), files: [] }; clusters.push(cur); continue; }
    }
    const m = line.match(/\[[^\]]+\]\(([^)]+?\.md)\)/);
    if (m && cur) cur.files.push(m[1]);
  }
  return clusters.filter(c => c.files.length > 0);
}

// publicScrub：公开发布模式——生成时即禁止私有标识落进产出
const SCRUB_RULE = '本产出将公开发布：严禁出现具体公司名/客户名/学校名/项目代号/价格数字/服务器地址与别名/密钥与账号信息/竞对商号；此类内容一律用「某公司/某客户/某项目」替代或直接删除。';

export function buildCluster({ clusterName, corpus, publicScrub = false }) {
  return {
    system: '你是知识压缩器。把输入的项目记忆语料压缩成 ≤3KB 高密度知识，中文，markdown 小节。优先级：裁定（含为什么）> 复发坑（判别方法+修法）> 规范 > 背景。只保留对未来工程决策有用的事实，保留关键文件路径与数值。严禁编造语料中没有的内容。' + (publicScrub ? SCRUB_RULE : ''),
    user: `类目：${clusterName}\n\n语料：\n${corpus}\n\n输出 ≤3KB 高密度知识 markdown（不要用代码块包裹）。`,
  };
}

export function buildPersona({ clusterOutputs, projectName, lang, personaTitle, publicScrub = false }) {
  const title = personaTitle || `${projectName} 首席平台架构师`;
  return {
    system: `你是专家人格撰写者。基于给定知识段，撰写「${title}」人格文档（${lang === 'zh' ? '中文' : 'English'}）。结构：一级标题「${title}」与 3 句内身份定位 → 「## 工作原则」（5 条内）→ 每个知识段一节（保留原文高密度事实，不稀释）→ 最后「## 工程红线与判例」（把语料中的工程裁定/禁令集中放此节）。总长 ≤30KB。严禁编造。` + (publicScrub ? SCRUB_RULE : ''),
    user: clusterOutputs.map(c => `【${c.name}】\n${c.text}`).join('\n\n'),
  };
}

export function buildMeta({ clusterNames, projectName }) {
  return {
    system: `为 WorkBuddy 专家市场生成元数据，严格只输出一个 JSON 对象（无其他文字）：{"displayName":{"zh":"","en":""},"profession":{"zh":"首席平台架构师","en":"Chief Platform Architect"},"displayDescription":{"zh":"","en":""},"tags":[{"zh":"","en":""}],"quickPrompts":[{"zh":"","en":""}]}。硬性要求：displayDescription.zh 逐字数过、连标点严格 40-50 字（写完先数，超长删到范围内、不足补到范围内，此为硬校验违反即拒收）；tags 恰 3 个；quickPrompts 恰 3 条且第一条是用户最可能的开场提问、具体可执行；全部围绕 ${projectName} 平台工程。`,
    user: `项目：${projectName}\n知识类目：${clusterNames.join('、')}\n\n输出该 JSON 对象。`,
  };
}

export function parseJSONLoose(text) {
  const s = String(text).indexOf('{');
  const e = String(text).lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('LLM 未返回 JSON 对象');
  return JSON.parse(String(text).slice(s, e + 1));
}
