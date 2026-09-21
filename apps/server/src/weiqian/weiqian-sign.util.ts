import { createHmac } from 'crypto';

export type WeiQianSignParameter =
  | string
  | number
  | boolean
  | null
  | undefined
  | object;

/**
 * 按微签规范对公共请求参数签名。对象/文件流参数应先序列化为 Data；
 * 这里仅签入可直接拼接的标量，并显式排除 Sign。
 */
export function createWeiQianSign(
  parameters: Record<string, WeiQianSignParameter>,
  appSecret: string,
): string {
  const canonicalString = Object.entries(parameters)
    .filter(
      ([key, value]) =>
        key !== 'Sign' &&
        value !== null &&
        value !== undefined &&
        ['string', 'number', 'boolean'].includes(typeof value),
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

  return createHmac('sha256', appSecret)
    .update(canonicalString, 'utf8')
    .digest('base64');
}
