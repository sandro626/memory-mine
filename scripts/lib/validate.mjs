// 官方专家市场校验（open.workbuddy.cn/docs/expert）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CATEGORY_IDS = [
  '01-ProductDesign', '02-Engineering', '03-GameSpatial', '04-DataAI', '05-MarketingGrowth',
  '06-ContentCreative', '07-SalesCommerce', '08-FinanceInvestment', '09-OperationsHR',
  '10-ProjectQuality', '11-SecurityCompliance', '12-IndustryConsultant', '13-TencentZone',
  '14-WorldWise', '15-Education',
];

export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null; // 'IHDR'
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function validateExpertDir(dir) {
  const errors = [];
  const p = join(dir, '.codebuddy-plugin', 'plugin.json');
  if (!existsSync(p)) return { valid: false, errors: ['缺少 .codebuddy-plugin/plugin.json'] };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { return { valid: false, errors: [`plugin.json 解析失败: ${e.message}`] }; }

  for (const k of ['name', 'version', 'description', 'author', 'agents', 'expertType', 'agentName',
    'displayName', 'profession', 'displayDescription', 'avatar', 'categoryId',
    'defaultInitPrompt', 'plugin', 'tags', 'quickPrompts']) {
    if (j[k] == null || j[k] === '') errors.push(`缺字段 ${k}`);
  }
  if (j.expertType !== 'agent') errors.push('expertType 必须为 "agent"');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(j.name || ''))) errors.push('name 须为小写字母+连字符');
  if (j.plugin !== j.name) errors.push('plugin 须与 name 一致');
  if (!Array.isArray(j.quickPrompts) || j.quickPrompts.length !== 3) errors.push('quickPrompts 须固定 3 条');
  if (!Array.isArray(j.tags) || j.tags.length !== 3) errors.push('tags 须固定 3 个');
  if (Array.isArray(j.quickPrompts) && j.quickPrompts[0] && j.defaultInitPrompt &&
    (j.quickPrompts[0].zh !== j.defaultInitPrompt.zh || j.quickPrompts[0].en !== j.defaultInitPrompt.en)) {
    errors.push('defaultInitPrompt 必须与 quickPrompts[0] 一致');
  }
  const zhLen = [...String(j.displayDescription?.zh || '')].length;
  if (zhLen < 40 || zhLen > 50) errors.push(`displayDescription.zh 中文须 40-50 字（当前 ${zhLen}）`);
  if (!CATEGORY_IDS.includes(j.categoryId)) errors.push('categoryId 不在官方枚举');

  if (j.avatar) {
    const ap = join(dir, j.avatar);
    if (!existsSync(ap)) errors.push(`头像不存在: ${j.avatar}`);
    else {
      const buf = readFileSync(ap);
      const size = pngSize(buf);
      if (!size) errors.push('头像不是合法 PNG');
      else {
        if (size.width !== 512 || size.height !== 512) errors.push(`头像须 512×512（当前 ${size.width}×${size.height}）`);
        if (buf.length > 500 * 1024) errors.push(`头像须 ≤500KB（当前 ${Math.round(buf.length / 1024)}KB）`);
      }
    }
  }
  if (Array.isArray(j.agents)) {
    for (const a of j.agents) if (!existsSync(join(dir, a))) errors.push(`agent 文件缺失: ${a}`);
  }
  return { valid: errors.length === 0, errors };
}
