// Claude Code 会话转录 .jsonl → 干净对话文本（丢工具噪音/子代理/坏行）
export function parseTranscript(jsonlText) {
  const messages = [];
  let skipped = 0;
  for (const line of String(jsonlText).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { skipped++; continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') { skipped++; continue; }
    if (obj.isSidechain || obj.isMeta) { skipped++; continue; }
    const msg = obj.message;
    if (!msg || typeof msg !== 'object') { skipped++; continue; }
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text).join('\n');
    }
    text = text.trim();
    if (!text) { skipped++; continue; }
    if (obj.type === 'user' && (text.startsWith('Caveat:') || text.startsWith('[Request interrupted'))) { skipped++; continue; }
    messages.push({ role: obj.type === 'user' ? 'user' : 'assistant', text });
  }
  return { messages, skipped };
}

export function renderConversation(messages) {
  return messages.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`).join('\n\n');
}
