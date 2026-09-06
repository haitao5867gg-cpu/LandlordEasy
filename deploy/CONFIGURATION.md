# Production configuration gate

The server validates configuration before loading `AppModule`. A validation
failure therefore occurs before Prisma connects, scheduled jobs start, the HTTP
port listens, or a real provider can be called. Startup errors name environment
variables but never print their values.

## Base production requirements

- Set `NODE_ENV=production`.
- Set `JWT_SECRET` to a non-empty deployment secret. `dev-secret` and the value
  shown in `.env.example` are rejected.
- Set `WECHAT_MODE=real`; mock authentication trusts a caller-supplied openid and
  is restricted to non-production environments.
- Set `WECHAT_PAY_MODE=real` (or use `PAYMENT_MODE=real` as its fallback).
- Set `WEIQIAN_MODE=real`; the mock implementation produces synthetic signing
  identifiers and PDF content and is restricted to non-production environments.
- Keep `ALIPAY_ENABLED=false` until Alipay is intentionally opened. If enabled,
  its resolved mode must be `real`.
- Every supplied mode must be exactly `mock` or `real`. `ALIPAY_ENABLED` must be
  exactly `true` or `false` when supplied.

## Fields required by enabled real providers

| Provider | Required variables |
| --- | --- |
| WeChat public account (`WECHAT_MODE=real`) | `WECHAT_APPID`, `WECHAT_SECRET`, `WECHAT_TOKEN`, `WECHAT_TEMPLATE_RENT_REMINDER` |
| WeChat Pay (`WECHAT_PAY_MODE=real`) | `WECHAT_APPID`, `WECHAT_PAY_MCH_ID`, `WECHAT_PAY_APIV3_KEY`, `WECHAT_PAY_SERIAL_NO`, `WECHAT_PAY_PRIVATE_KEY`, `WECHAT_PAY_PUBLIC_KEY_ID`, `WECHAT_PAY_PUBLIC_KEY`, `PAYMENT_NOTIFY_BASE_URL` |
| Alipay (`ALIPAY_ENABLED=true`, `ALIPAY_MODE=real`) | `ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`, `PAYMENT_NOTIFY_BASE_URL` |
| WeiQian (`WEIQIAN_MODE=real`) | `WEIQIAN_API_BASE_URL`, `WEIQIAN_APP_ID`, `WEIQIAN_APP_SECRET`, `WEIQIAN_COMPANY_ID`, `WEIQIAN_SEAL_ID`, `SERVER_PUBLIC_BASE_URL`, `WEIQIAN_SIGN_BASE_URL` |
| Tencent eSign (`ESIGN_MODE=real`) | `TENCENT_ESIGN_TEMPLATE_ID`, `TENCENT_ESIGN_APP_ID`, `TENCENT_ESIGN_PROXY_ORGANIZATION_OPEN_ID`, `TENCENT_ESIGN_PROXY_OPERATOR_OPEN_ID`, `TENCENT_ESIGN_TENANT_RECIPIENT_ID`, `TENCENT_ESIGN_SECRET_ID`, `TENCENT_ESIGN_SECRET_KEY` |

Disabled Alipay does not require Alipay credentials and may retain either mode.
`ESIGN_MODE` may remain `mock` because the active signing path uses WeiQian.
Explicit all-mock settings remain supported for local development.
The payment simulation endpoint is unavailable whenever `NODE_ENV=production`.
