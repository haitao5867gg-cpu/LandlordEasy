import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import {
  EsignCallbackHeaders,
  EsignCallbackResult,
} from './tencent-esign.interface';

const TC3_ALGORITHM = 'TC3-HMAC-SHA256';

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const hmac = (
  key: string | Buffer,
  value: string,
  encoding?: 'hex',
): Buffer | string => {
  const result = createHmac('sha256', key).update(value, 'utf8');
  return encoding === 'hex' ? result.digest('hex') : result.digest();
};

export interface Tc3HeadersInput {
  secretId: string;
  secretKey: string;
  host: string;
  service: string;
  action: string;
  version: string;
  payload: string;
  timestamp?: number;
}

export interface Tc3Headers extends Record<string, string> {
  Authorization: string;
  'Content-Type': string;
  Host: string;
  'X-TC-Action': string;
  'X-TC-Version': string;
  'X-TC-Timestamp': string;
}

/** 腾讯云 API 3.0（TC3-HMAC-SHA256）POST JSON 签名。 */
export function buildTc3Headers(input: Tc3HeadersInput): Tc3Headers {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${input.host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(input.payload),
  ].join('\n');
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [
    TC3_ALGORITHM,
    timestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const secretDate = hmac(`TC3${input.secretKey}`, date) as Buffer;
  const secretService = hmac(secretDate, input.service) as Buffer;
  const secretSigning = hmac(secretService, 'tc3_request') as Buffer;
  const signature = hmac(secretSigning, stringToSign, 'hex') as string;

  return {
    Authorization:
      `${TC3_ALGORITHM} Credential=${input.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: input.host,
    'X-TC-Action': input.action,
    'X-TC-Version': input.version,
    'X-TC-Timestamp': timestamp.toString(),
  };
}

interface CallbackEnvelope {
  MsgType?: unknown;
  MsgData?: unknown;
}

interface FlowStatusCallbackData {
  FlowId?: unknown;
  FlowStatus?: unknown;
}

export interface ParseCallbackOptions {
  verifyToken?: string;
  encryptionKey?: string;
}

function getHeader(
  headers: EsignCallbackHeaders,
  headerName: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === headerName.toLowerCase(),
  );
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function toRawBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return undefined;
}

function verifyCallbackSignature(
  rawBody: string | undefined,
  headers: EsignCallbackHeaders,
  verifyToken: string,
): void {
  if (rawBody === undefined) {
    throw new Error('腾讯电子签回调验签需要未经修改的原始请求体');
  }
  const actual = getHeader(headers, 'Content-Signature');
  if (!actual) throw new Error('腾讯电子签回调缺少 Content-Signature');

  const expected = `sha256=${createHmac('sha256', verifyToken)
    .update(rawBody, 'utf8')
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('腾讯电子签回调签名校验失败');
  }
}

function decryptCallback(encrypted: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'utf8');
  if (key.length !== 32) {
    throw new Error('TENCENT_ESIGN_CALLBACK_ENCRYPT_KEY 必须为 32 字节');
  }
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('腾讯电子签回调不是有效 JSON');
  }
}

/** 验签、可选解密并解析官方 FlowStatusChange 回调。 */
export function parseTencentEsignCallback(
  body: unknown,
  headers: EsignCallbackHeaders,
  options: ParseCallbackOptions = {},
): EsignCallbackResult {
  const rawBody = toRawBody(body);
  if (options.verifyToken) {
    verifyCallbackSignature(rawBody, headers, options.verifyToken);
  }

  let parsed: unknown = rawBody === undefined ? body : parseJson(rawBody);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('腾讯电子签回调结构无效');
  }

  const encrypted = (parsed as { encrypt?: unknown }).encrypt;
  if (typeof encrypted === 'string') {
    if (!options.encryptionKey) {
      throw new Error('腾讯电子签回调已加密，但未配置回调加密 key');
    }
    parsed = parseJson(decryptCallback(encrypted, options.encryptionKey));
  }

  const envelope = parsed as CallbackEnvelope;
  if (envelope.MsgType !== 'FlowStatusChange') {
    throw new Error(`不支持的腾讯电子签回调类型: ${String(envelope.MsgType)}`);
  }
  const data = envelope.MsgData as FlowStatusCallbackData | undefined;
  if (
    !data ||
    typeof data.FlowId !== 'string' ||
    typeof data.FlowStatus !== 'string'
  ) {
    throw new Error('腾讯电子签合同状态回调缺少 FlowId 或 FlowStatus');
  }

  // 官方 FlowStatusChange 不含 PDF URL；签署完成后需另调
  // DescribeResourceUrlsByFlows，因此此处不伪造 signedPdfUrl。
  return { flowId: data.FlowId, status: data.FlowStatus };
}
