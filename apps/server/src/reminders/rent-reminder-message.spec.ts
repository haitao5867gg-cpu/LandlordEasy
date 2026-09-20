import {
  buildRentReminderMessage,
  buildTenantBillPayUrl,
} from './rent-reminder-message';

describe('rent reminder message', () => {
  const originalPublicBaseUrl = process.env.SERVER_PUBLIC_BASE_URL;

  afterEach(() => {
    if (originalPublicBaseUrl === undefined) delete process.env.SERVER_PUBLIC_BASE_URL;
    else process.env.SERVER_PUBLIC_BASE_URL = originalPublicBaseUrl;
  });

  it('从 SERVER_PUBLIC_BASE_URL 推导租客付款页 URL', () => {
    process.env.SERVER_PUBLIC_BASE_URL = 'https://landlordeasy.cn/api/v1/';

    expect(buildTenantBillPayUrl(88)).toBe(
      'https://landlordeasy.cn/tenant/bills/88/pay',
    );
  });

  it('SERVER_PUBLIC_BASE_URL 未配置时消息不包含 url', () => {
    delete process.env.SERVER_PUBLIC_BASE_URL;

    expect(
      buildRentReminderMessage(
        {
          id: 88,
          totalAmount: 3030,
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-11-30T00:00:00.000Z'),
          dueDate: new Date('2026-09-01T00:00:00.000Z'),
          lease: {
            room: {
              roomNo: '301',
              building: { name: '2号楼', property: { name: '阳光公寓' } },
            },
          },
        },
        'openid-tenant',
        'tpl-rent-reminder',
      ),
    ).not.toHaveProperty('url');
  });
});
