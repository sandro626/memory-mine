import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function slugFromPath(absPath) {
  return String(absPath).replace(/\/+$/, '').replaceAll('/', '-');
}

export function loadConfig({ settingsPath = join(process.env.HOME, '.claude', 'settings.json'), env = process.env, modelOverride } = {}) {
  let s = {};
  try { s = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* 无 settings.json 时退回进程 env */ }
  const e = { ...(s.env || {}), ...env }; // 进程 env 优先
  const baseUrl = e.ANTHROPIC_BASE_URL;
  const authToken = e.ANTHROPIC_AUTH_TOKEN;
  const apiKey = e.ANTHROPIC_API_KEY;
  const model = modelOverride || e.ANTHROPIC_MODEL;
  if (!baseUrl) throw new Error('未找到 ANTHROPIC_BASE_URL（检查 ~/.claude/settings.json 的 env 或进程环境变量）');
  if (!authToken && !apiKey) throw new Error('未找到 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY');
  if (!model) throw new Error('未找到 ANTHROPIC_MODEL');
  return { baseUrl, authToken, apiKey, model };
}

export function resolveProjectDir({ home = process.env.HOME, cwd }) {
  const slug = slugFromPath(cwd);
  const projectDir = join(home, '.claude', 'projects', slug);
  return { slug, projectDir, memoryDir: join(projectDir, 'memory') };
}
