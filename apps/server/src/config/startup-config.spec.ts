import {
  getJwtSecret,
  isPaymentSimulationEnabled,
  resolveAlipayEnabled,
  resolveAlipayMode,
  resolveWechatPayMode,
  validateStartupConfig,
} from './startup-config';

const localMock = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  WECHAT_MODE: 'mock',
  WECHAT_PAY_MODE: 'mock',
  ALIPAY_MODE: 'mock',
  ALIPAY_ENABLED: 'false',
  WEIQIAN_MODE: 'mock',
  ESIGN_MODE: 'mock',
});

const safeJwt = { JWT_SECRET: 'test-only-long-random-jwt-secret' };

const productionConfig = (): NodeJS.ProcessEnv => ({
  ...localMock(),
  ...safeJwt,
  NODE_ENV: 'production',
  WECHAT_MODE: 'real',
  WECHAT_APPID: 'app-id',
  WECHAT_SECRET: 'app-secret',
  WECHAT_TOKEN: 'wechat-token',
  WECHAT_TEMPLATE_RENT_REMINDER: 'reminder-template',
  WECHAT_PAY_MODE: 'real',
  WECHAT_PAY_MCH_ID: 'merchant-id',
  WECHAT_PAY_APIV3_KEY: '12345678901234567890123456789012',
  WECHAT_PAY_SERIAL_NO: 'serial',
  WECHAT_PAY_PRIVATE_KEY: 'private-key-reference',
  WECHAT_PAY_PUBLIC_KEY_ID: 'public-key-id',
  WECHAT_PAY_PUBLIC_KEY: 'public-key-reference',
  PAYMENT_NOTIFY_BASE_URL: 'https://example.test',
  WEIQIAN_MODE: 'real',
  WEIQIAN_API_BASE_URL: 'https://sign-api.example.test',
  WEIQIAN_APP_ID: 'weiqian-app-id',
  WEIQIAN_APP_SECRET: 'weiqian-app-secret',
  WEIQIAN_COMPANY_ID: '123',
  WEIQIAN_SEAL_ID: '456',
  SERVER_PUBLIC_BASE_URL: 'https://example.test/api/v1',
  WEIQIAN_SIGN_BASE_URL: 'https://sign.example.test',
});

describe('startup config validation', () => {
  it.each([undefined, '', '   ', 'dev-secret', 'your-jwt-secret-change-in-production'])(
    'rejects missing, blank, or example JWT_SECRET in production (%p)',
    (jwtSecret) => {
      const env = productionConfig();
      if (jwtSecret === undefined) delete env.JWT_SECRET;
      else env.JWT_SECRET = jwtSecret;

      expect(() => validateStartupConfig(env)).toThrow(/JWT_SECRET/);
    },
  );

  it.each([
    'WECHAT_MODE',
    'PAYMENT_MODE',
    'WECHAT_PAY_MODE',
    'ALIPAY_MODE',
    'WEIQIAN_MODE',
    'ESIGN_MODE',
  ])('rejects an invalid %s value', (name) => {
    const env = { ...localMock(), [name]: 'unexpected-mode' };
    expect(() => validateStartupConfig(env)).toThrow(name);
  });

  it('rejects an invalid ALIPAY_ENABLED value', () => {
    expect(() =>
      validateStartupConfig({ ...localMock(), ALIPAY_ENABLED: 'yes' }),
    ).toThrow(/ALIPAY_ENABLED/);
  });

  it('rejects production with the enabled WeChat payment mock', () => {
    expect(() =>
      validateStartupConfig({
        ...localMock(),
        ...safeJwt,
        NODE_ENV: 'production',
      }),
    ).toThrow(/WECHAT_PAY_MODE/);
  });

  it('rejects an unsafe JWT when a real integration is enabled outside production', () => {
    expect(() =>
      validateStartupConfig({
        ...localMock(),
        WECHAT_MODE: 'real',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects production with enabled Alipay in mock mode', () => {
    expect(() =>
      validateStartupConfig({
        ...productionConfig(),
        ALIPAY_ENABLED: 'true',
        ALIPAY_MODE: 'mock',
      }),
    ).toThrow(/ALIPAY_MODE/);
  });

  it.each([
    ['WECHAT_MODE', '微信认证'],
    ['WEIQIAN_MODE', '电子签约'],
  ])('rejects production with mock %s to prevent fake %s', (name) => {
    expect(() =>
      validateStartupConfig({
        ...productionConfig(),
        [name]: 'mock',
      }),
    ).toThrow(name);
  });

  it('accepts a complete production configuration with disabled Alipay', () => {
    expect(() =>
      validateStartupConfig({
        ...productionConfig(),
        ALIPAY_ENABLED: 'false',
        ALIPAY_MODE: 'mock',
      }),
    ).not.toThrow();
  });

  it.each([
    ['WECHAT_MODE', 'real', 'WECHAT_APPID'],
    ['WECHAT_PAY_MODE', 'real', 'WECHAT_PAY_MCH_ID'],
    ['WEIQIAN_MODE', 'real', 'WEIQIAN_API_BASE_URL'],
    ['ESIGN_MODE', 'real', 'TENCENT_ESIGN_SECRET_ID'],
  ])('requires provider fields for %s=%s', (name, value, expectedName) => {
    expect(() =>
      validateStartupConfig({
        ...localMock(),
        ...safeJwt,
        [name]: value,
      }),
    ).toThrow(expectedName);
  });

  it('requires Alipay fields only when Alipay is enabled and real', () => {
    expect(() =>
      validateStartupConfig({
        ...localMock(),
        ...safeJwt,
        ALIPAY_ENABLED: 'true',
        ALIPAY_MODE: 'real',
      }),
    ).toThrow(/ALIPAY_APP_ID/);

    expect(() =>
      validateStartupConfig({
        ...localMock(),
        ALIPAY_ENABLED: 'false',
        ALIPAY_MODE: 'real',
      }),
    ).not.toThrow();
  });

  it('supports an explicit all-mock local configuration and central JWT fallback', () => {
    const config = validateStartupConfig(localMock());
    expect(config).toMatchObject({
      nodeEnv: 'development',
      jwtSecret: 'dev-secret',
      wechatMode: 'mock',
      wechatPayMode: 'mock',
      alipayMode: 'mock',
      alipayEnabled: false,
      weiqianMode: 'mock',
      esignMode: 'mock',
    });
    expect(getJwtSecret(localMock())).toBe('dev-secret');
  });

  it('honors channel overrides over the legacy payment fallback', () => {
    const env = {
      PAYMENT_MODE: 'real',
      WECHAT_PAY_MODE: 'mock',
      ALIPAY_MODE: 'mock',
    };
    expect(resolveWechatPayMode(env)).toBe('mock');
    expect(resolveAlipayMode(env)).toBe('mock');
  });

  it('uses one normalized Alipay enable resolver', () => {
    expect(resolveAlipayEnabled({ ALIPAY_ENABLED: ' true ' })).toBe(true);
    expect(resolveAlipayEnabled({ ALIPAY_ENABLED: ' false ' })).toBe(false);
  });

  it('does not expose payment simulation for a disabled mock Alipay channel', () => {
    expect(
      isPaymentSimulationEnabled({
        NODE_ENV: 'development',
        WECHAT_PAY_MODE: 'real',
        ALIPAY_MODE: 'mock',
        ALIPAY_ENABLED: 'false',
      }),
    ).toBe(false);
  });

  it('never exposes payment simulation in production', () => {
    expect(
      isPaymentSimulationEnabled({
        NODE_ENV: 'production',
        WECHAT_PAY_MODE: 'real',
        ALIPAY_MODE: 'mock',
        ALIPAY_ENABLED: 'false',
      }),
    ).toBe(false);
  });

  it('never includes configured secret values in validation errors', () => {
    const secretMarker = 'do-not-print-this-secret';
    let message = '';
    try {
      validateStartupConfig({
        ...localMock(),
        ...safeJwt,
        WECHAT_MODE: 'real',
        WECHAT_APPID: secretMarker,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('WECHAT_SECRET');
    expect(message).not.toContain(secretMarker);
  });
});
