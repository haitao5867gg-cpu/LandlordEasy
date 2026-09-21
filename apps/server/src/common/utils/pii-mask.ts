/**
 * 审计日志 PII 脱敏工具
 *
 * 用于写入 AuditLog.detail 前对请求体做脱敏，避免租客姓名、手机号、
 * 身份证号等个人信息以明文落库。设计要点：
 * - 凭证类字段（password/token/inviteCode 等）整体替换为 [REDACTED]
 * - PII 字段按"保留首尾、掩码中间"处理，保留排查问题所需的最小信息
 * - 仅按字段名匹配，不做内容猜测，避免误伤业务字段（如楼栋 name、二维码 URL）
 */

export const REDACTED = '[REDACTED]';

/** 整体抹除的字段名（归一化后精确匹配）：凭证/密钥/一次性令牌 */
const REDACT_KEYS = new Set([
  'password',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'authorization',
  'sessionkey',
  'sign',
  'signature',
  'code',
  'invitecode',
  'invitecodes',
  'jwttoken',
]);

/** 手机号：保留前 3 后 4 */
const PHONE_SUFFIXES = ['phone', 'mobile', 'telephone', 'tel'];

/** 身份证号：保留前 3 后 4 */
const IDCARD_SUFFIXES = ['idcard', 'idnumber', 'identitynumber', 'idno', 'identitycard'];

/** 车牌：保留前 2 后 2 */
const PLATE_SUFFIXES = ['carplate', 'licenseplate', 'plateno', 'licenseno', 'plate'];

/** 银行卡/账号：保留后 4 */
const BANKCARD_SUFFIXES = [
  'bankcard',
  'bankcardno',
  'bankaccount',
  'cardnumber',
  'cardno',
  'accountnumber',
  'accountno',
];

/** 微信身份标识：保留前 4 后 4 */
const OPENID_SUFFIXES = ['openid', 'unionid'];

/**
 * 人名：仅当字段名以 name 结尾且带身份前缀时才掩码（tenantName/landlordName 等）。
 * 楼栋名、费用项名等业务 name 不脱敏，保证审计日志可读。
 */
const PERSON_NAME_PREFIXES = [
  'tenant',
  'landlord',
  'customer',
  'lessee',
  'renter',
  'owner',
  'contact',
  'guest',
  'user',
  'real',
  'full',
];

/** 归一化字段名：小写并去掉非字母数字字符（tenantPhone → tenantphone） */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function endsWithAny(normalized: string, suffixes: string[]): boolean {
  return suffixes.some((s) => normalized.endsWith(s));
}

/** 保留首尾、中间逐字符替换为 *；长度不足以保留时全掩码 */
function maskRange(value: string, keepStart: number, keepEnd: number): string {
  if (value.length <= keepStart + keepEnd) {
    return '*'.repeat(value.length);
  }
  const middle = value.length - keepStart - keepEnd;
  const tail = keepEnd > 0 ? value.slice(-keepEnd) : '';
  return value.slice(0, keepStart) + '*'.repeat(middle) + tail;
}

function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) return maskRange(value, 1, 0);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
}

/** 单个字段值的脱敏规则，按字段名分派；返回 undefined 表示无需脱敏 */
function maskValueByKey(key: string, value: string): string | undefined {
  const normalized = normalizeKey(key);

  if (REDACT_KEYS.has(normalized)) return REDACTED;

  // email 按包含匹配（userEmail/contactEmail 等变体），"email" 不太会出现在非邮箱字段名里
  if (normalized.includes('email')) return maskEmail(value);

  if (endsWithAny(normalized, PHONE_SUFFIXES)) return maskRange(value, 3, 4);
  if (endsWithAny(normalized, IDCARD_SUFFIXES)) return maskRange(value, 3, 4);
  if (endsWithAny(normalized, OPENID_SUFFIXES)) return maskRange(value, 4, 4);
  if (endsWithAny(normalized, BANKCARD_SUFFIXES)) return maskRange(value, 0, 4);
  if (endsWithAny(normalized, PLATE_SUFFIXES)) return maskRange(value, 2, 2);

  if (normalized.endsWith('name')) {
    const hasIdentityPrefix = PERSON_NAME_PREFIXES.some((p) => normalized.startsWith(p));
    if (hasIdentityPrefix) return maskRange(value, 1, 0);
  }

  return undefined;
}

const MAX_DEPTH = 8;

/**
 * 递归脱敏任意请求体（对象/数组/标量），返回原结构的新副本：
 * - 字符串按字段名规则掩码，数字/布尔等非字符串原样保留
 * - Date/Buffer 等非普通对象替换为占位符，避免二进制内容意外序列化进日志
 * - 循环引用替换为 '[CIRCULAR]'，深度超限截断
 */
export function maskPii<T>(value: T, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? {};

  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      // 顶层裸字符串无字段名可依据，原样保留（当前请求体均为对象）
      return value;
    }
    return value;
  }

  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => maskPii(item, depth + 1, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // Date/Buffer/类实例等：字段名已不可靠，统一占位
    return '[非文本字段]';
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string') {
      result[key] = maskValueByKey(key, val) ?? val;
    } else {
      result[key] = maskPii(val, depth + 1, seen);
    }
  }
  return result;
}
