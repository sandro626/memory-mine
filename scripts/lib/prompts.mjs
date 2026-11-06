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
