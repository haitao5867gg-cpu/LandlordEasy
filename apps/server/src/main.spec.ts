import { NestFactory } from '@nestjs/core';
import { bootstrap } from './main';

describe('server bootstrap', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('fails before Nest creation and all resulting DB/scheduler/listen side effects', async () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      JWT_SECRET: '   ',
      WECHAT_MODE: 'mock',
      WECHAT_PAY_MODE: 'mock',
      ALIPAY_MODE: 'mock',
      ALIPAY_ENABLED: 'false',
      WEIQIAN_MODE: 'mock',
      ESIGN_MODE: 'mock',
    };
    const create = jest.spyOn(NestFactory, 'create');

    await expect(bootstrap()).rejects.toThrow(/JWT_SECRET/);
    expect(create).not.toHaveBeenCalled();
  });
});
