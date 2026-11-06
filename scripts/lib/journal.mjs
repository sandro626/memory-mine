import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function slugify(topic) {
  const ascii = String(topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii.length >= 3) return ascii.slice(0, 40);
  return createHash('sha1').update(String(topic)).digest('hex').slice(0, 8);
}

export function writeJournalEntry(memoryDir, { date, time, topic, facts, sessionFile }) {
  const journalDir = join(memoryDir, 'journal');
  mkdirSync(journalDir, { recursive: true });
  const base = `${date}-${time}-${slugify(topic)}`;
  let path = join(journalDir, `${base}.md`);
  let n = 2;
  while (existsSync(path)) path = join(journalDir, `${base}-${n++}.md`);
  const front = `---\nsession: ${sessionFile}\ndate: ${date}\nsource: memory-mine\n---\n`;
  const body = `# ${topic}\n\n` + facts.map(f => `- ${f}`).join('\n') + '\n';
  writeFileSync(path, front + body);
  return { journalPath: path, journalFile: basename(path) };
}

export function updateIndex(memoryDir, { date, topic, factCount, journalFile }) {
  const indexPath = join(memoryDir, 'JOURNAL.md');
  const line = `- ${date} | ${topic}（${factCount} 条）→ [journal/${journalFile}](journal/${journalFile})`;
  const isNew = !existsSync(indexPath);
  const header = '# JOURNAL — memory-mine 挖掘索引（倒序）\n';
  let rest = '';
  if (!isNew) {
    const prev = readFileSync(indexPath, 'utf8');
    rest = prev.split('\n').slice(1).join('\n').replace(/^\s+/, '');
  }
  writeFileSync(indexPath, `${header}\n${line}\n${rest}`);
  return { indexPath, isNew };
}

export function pointerLine() {
  return '- 历史会话日志：memory/journal/（索引 memory/JOURNAL.md，用 rg 检索）';
}
