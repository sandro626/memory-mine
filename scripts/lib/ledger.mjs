import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export function readLedger(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const r = JSON.parse(t); map.set(r.file, r); } catch { /* 坏行忽略 */ }
  }
  return map;
}

export function appendLedger(path, record) {
  appendFileSync(path, JSON.stringify(record) + '\n');
}

export function shouldSkip(ledgerMap, fileName, mtimeMs) {
  const prev = ledgerMap.get(fileName);
  return !!prev && prev.mtime === mtimeMs;
}
