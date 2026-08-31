import { expect, test } from '@playwright/test';
import { createWechatRedirectUri } from '../../apps/tenant-h5/src/utils/wechat-oauth';

for (const origin of [
  'https://landlordeasy.cn',
  'https://dev.landlordeasy.cn',
]) {
  test(`tenant OAuth redirect_uri includes the Vite base path for ${origin}`, () => {
    const redirectUri = createWechatRedirectUri(origin, '/tenant/');

    expect(decodeURIComponent(redirectUri)).toBe(`${origin}/tenant/login`);
  });
}
