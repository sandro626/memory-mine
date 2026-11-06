// 长文本按段落边界分块；病态超长单段硬切
export function chunkText(text, { maxChars = 20000 } = {}) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let cur = '';
  for (const p of String(text).split('\n\n')) {
    if (cur && cur.length + p.length + 2 > maxChars) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
    while (cur.length > maxChars) { chunks.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
