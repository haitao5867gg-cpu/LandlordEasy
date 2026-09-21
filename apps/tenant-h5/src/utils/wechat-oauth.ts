export function createWechatRedirectUri(origin: string, baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return encodeURIComponent(`${origin}${normalizedBaseUrl}/login`);
}

/** 是否在微信内置浏览器里(只有在微信内才存在无感OAuth与JSAPI支付)。 */
export function isInWechatBrowser(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

/**
 * 发起一次snsapi_base静默授权跳转(微信内无感,回来时URL带code)。
 * 支付前授权状态过期时用它无感刷新——微信JSAPI支付能力与最近一次网页
 * 授权绑定,闲置数分钟后调起会报-1(2026-09-21实测)。
 */
export function redirectToWechatAuth() {
  const appId = import.meta.env.VITE_WECHAT_APPID || '';
  const redirectUri = createWechatRedirectUri(
    window.location.origin,
    import.meta.env.BASE_URL,
  );
  window.location.href =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}` +
    `&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=tenant#wechat_redirect`;
}
