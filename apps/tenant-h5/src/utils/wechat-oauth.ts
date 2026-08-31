export function createWechatRedirectUri(origin: string, baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return encodeURIComponent(`${origin}${normalizedBaseUrl}/login`);
}
