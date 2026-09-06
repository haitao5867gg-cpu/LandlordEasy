export type IntegrationMode = 'mock' | 'real';

const DEFAULT_JWT_SECRET = 'dev-secret';
const EXAMPLE_JWT_SECRET = 'your-jwt-secret-change-in-production';

export interface StartupConfig {
  nodeEnv: string;
  jwtSecret: string;
  wechatMode: IntegrationMode;
  wechatPayMode: IntegrationMode;
  alipayMode: IntegrationMode;
  alipayEnabled: boolean;
  weiqianMode: IntegrationMode;
  esignMode: IntegrationMode;
}

function configured(env: NodeJS.ProcessEnv, name: string): boolean {
  return typeof env[name] === 'string' && env[name]!.trim().length > 0;
}

function mode(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: IntegrationMode = 'mock',
): IntegrationMode {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (value === 'mock' || value === 'real') return value;
  throw new Error(`启动配置无效: ${name} 必须为 mock 或 real`);
}

function required(env: NodeJS.ProcessEnv, names: string[]): void {
  const missing = names.filter((name) => !configured(env, name));
  if (missing.length > 0) {
    throw new Error(`启动配置缺失: ${missing.join(', ')}`);
  }
}

export function resolveAlipayEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.ALIPAY_ENABLED?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('启动配置无效: ALIPAY_ENABLED 必须为 true 或 false');
}

export function resolveWechatMode(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationMode {
  return mode(env, 'WECHAT_MODE');
}

export function resolveWeiQianMode(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationMode {
  return mode(env, 'WEIQIAN_MODE');
}

export function resolveEsignMode(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationMode {
  return mode(env, 'ESIGN_MODE');
}

export function resolveWechatPayMode(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationMode {
  const paymentFallback = mode(env, 'PAYMENT_MODE');
  return mode(env, 'WECHAT_PAY_MODE', paymentFallback);
}

export function resolveAlipayMode(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationMode {
  const paymentFallback = mode(env, 'PAYMENT_MODE');
  return mode(env, 'ALIPAY_MODE', paymentFallback);
}

export function isPaymentSimulationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV?.trim() === 'production') return false;
  return (
    resolveWechatPayMode(env) === 'mock' ||
    (resolveAlipayEnabled(env) && resolveAlipayMode(env) === 'mock')
  );
}

/** JWT signing and verification share this one fallback for explicit local mocks. */
export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env, 'JWT_SECRET') ? env.JWT_SECRET! : DEFAULT_JWT_SECRET;
}

/** Validate all process configuration before Nest loads AppModule. */
export function validateStartupConfig(
  env: NodeJS.ProcessEnv = process.env,
): StartupConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const wechatMode = resolveWechatMode(env);
  const wechatPayMode = resolveWechatPayMode(env);
  const alipayMode = resolveAlipayMode(env);
  const alipayEnabled = resolveAlipayEnabled(env);
  const weiqianMode = resolveWeiQianMode(env);
  const esignMode = resolveEsignMode(env);
  const jwtSecret = getJwtSecret(env);
  const anyRealIntegration =
    wechatMode === 'real' ||
    wechatPayMode === 'real' ||
    (alipayEnabled && alipayMode === 'real') ||
    weiqianMode === 'real' ||
    esignMode === 'real';

  if (
    (nodeEnv === 'production' || anyRealIntegration) &&
    (!configured(env, 'JWT_SECRET') ||
      jwtSecret.trim() === DEFAULT_JWT_SECRET ||
      jwtSecret.trim() === EXAMPLE_JWT_SECRET)
  ) {
    throw new Error(
      '启动配置不安全: JWT_SECRET 必须设置为非空且不可使用开发示例值',
    );
  }

  if (nodeEnv === 'production' && wechatPayMode === 'mock') {
    throw new Error(
      '启动配置不安全: NODE_ENV=production 时 WECHAT_PAY_MODE（或 PAYMENT_MODE）必须为 real',
    );
  }
  if (nodeEnv === 'production' && wechatMode === 'mock') {
    throw new Error(
      '启动配置不安全: NODE_ENV=production 时 WECHAT_MODE 必须为 real',
    );
  }
  if (nodeEnv === 'production' && weiqianMode === 'mock') {
    throw new Error(
      '启动配置不安全: NODE_ENV=production 时 WEIQIAN_MODE 必须为 real',
    );
  }
  if (nodeEnv === 'production' && alipayEnabled && alipayMode === 'mock') {
    throw new Error(
      '启动配置不安全: NODE_ENV=production 且 ALIPAY_ENABLED=true 时 ALIPAY_MODE（或 PAYMENT_MODE）必须为 real',
    );
  }

  if (wechatMode === 'real') {
    required(env, [
      'WECHAT_APPID',
      'WECHAT_SECRET',
      'WECHAT_TOKEN',
      'WECHAT_TEMPLATE_RENT_REMINDER',
    ]);
  }
  if (wechatPayMode === 'real') {
    required(env, [
      'WECHAT_APPID',
      'WECHAT_PAY_MCH_ID',
      'WECHAT_PAY_APIV3_KEY',
      'WECHAT_PAY_SERIAL_NO',
      'WECHAT_PAY_PRIVATE_KEY',
      'WECHAT_PAY_PUBLIC_KEY_ID',
      'WECHAT_PAY_PUBLIC_KEY',
      'PAYMENT_NOTIFY_BASE_URL',
    ]);
  }
  if (alipayEnabled && alipayMode === 'real') {
    required(env, [
      'ALIPAY_APP_ID',
      'ALIPAY_PRIVATE_KEY',
      'ALIPAY_PUBLIC_KEY',
      'PAYMENT_NOTIFY_BASE_URL',
    ]);
  }
  if (weiqianMode === 'real') {
    required(env, [
      'WEIQIAN_API_BASE_URL',
      'WEIQIAN_APP_ID',
      'WEIQIAN_APP_SECRET',
      'WEIQIAN_COMPANY_ID',
      'WEIQIAN_SEAL_ID',
      'SERVER_PUBLIC_BASE_URL',
      'WEIQIAN_SIGN_BASE_URL',
    ]);
  }
  if (esignMode === 'real') {
    required(env, [
      'TENCENT_ESIGN_TEMPLATE_ID',
      'TENCENT_ESIGN_APP_ID',
      'TENCENT_ESIGN_PROXY_ORGANIZATION_OPEN_ID',
      'TENCENT_ESIGN_PROXY_OPERATOR_OPEN_ID',
      'TENCENT_ESIGN_TENANT_RECIPIENT_ID',
      'TENCENT_ESIGN_SECRET_ID',
      'TENCENT_ESIGN_SECRET_KEY',
    ]);
  }

  return {
    nodeEnv,
    jwtSecret,
    wechatMode,
    wechatPayMode,
    alipayMode,
    alipayEnabled,
    weiqianMode,
    esignMode,
  };
}
