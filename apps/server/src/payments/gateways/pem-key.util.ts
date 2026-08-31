import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** 环境变量既支持 PEM 原文（可含转义换行），也支持 PEM 文件路径。 */
export function loadPemKey(
  value: string,
  name: string,
  type: 'PRIVATE KEY' | 'PUBLIC KEY',
): string {
  if (!value) throw new Error(`${name} 未配置`);

  const normalized = value.replace(/\\n/g, '\n').trim();
  if (normalized.includes('-----BEGIN')) return normalized;

  const path = resolve(normalized);
  if (existsSync(path)) return readFileSync(path, 'utf8');

  const body = normalized.replace(/\s/g, '').match(/.{1,64}/g)?.join('\n');
  if (!body) throw new Error(`${name} 格式无效`);
  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`;
}
