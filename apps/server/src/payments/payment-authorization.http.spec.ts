import { INestApplication, Module, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

// Real Nest HTTP routing with isolated service fixtures. This proves the retired
// endpoint cannot reach a write path while the supported payment routes remain.
describe('SEC-002 payment authorization HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  const paymentsService = {
    tenantReport: jest.fn(),
    createWechatOrder: jest.fn(),
    manualRecord: jest.fn(),
    confirmOrReject: jest.fn(),
    handleWechatNotify: jest.fn(),
  };

  const authService = {
    verifyToken: jest.fn((token: string) => {
      if (token === 'tenant-fixture') {
        return { sub: 7, tenantId: 7, openid: 'fixture-openid', role: 'tenant' };
      }
      if (token === 'landlord-fixture') {
        return { sub: 11, openid: 'landlord-openid', role: 'landlord' };
      }
      throw new UnauthorizedException();
    }),
  };
  const prisma = { landlord: { findUnique: jest.fn().mockResolvedValue({ id: 11, isActive: true }) } };

  beforeAll(async () => {
    class FixtureModule {}
    Module({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: paymentsService },
        LandlordGuard,
        TenantGuard,
        { provide: AuthService, useValue: authService },
        { provide: PrismaService, useValue: prisma },
      ],
    })(FixtureModule);
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it.each([undefined, 'Bearer tenant-fixture', 'Bearer landlord-fixture'])(
    'returns 404 for retired POST /payments/report (%s)',
    async (authorization) => {
      const response = await fetch(`${base}/api/v1/payments/report`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          billId: 99,
          amount: 1,
          paidAt: '2026-09-05',
        }),
      });

      expect(response.status).toBe(404);
      expect(paymentsService.tenantReport).not.toHaveBeenCalled();
    },
  );

  it('keeps tenant WeChat order creation scoped by the guard identity', async () => {
    paymentsService.createWechatOrder.mockResolvedValue({ outTradeNo: 'WX50FIXTURE' });
    const response = await fetch(`${base}/api/v1/payments/wechat/create-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tenant-fixture' },
      body: JSON.stringify({ billId: 50 }),
    });

    expect(response.status).toBe(201);
    expect(paymentsService.createWechatOrder).toHaveBeenCalledWith(
      50,
      7,
      'fixture-openid',
    );
  });

  it('keeps landlord manual recording and historic pending confirmation routes', async () => {
    paymentsService.manualRecord.mockResolvedValue({ id: 81 });
    paymentsService.confirmOrReject.mockResolvedValue({ id: 82, status: 'CONFIRMED' });

    const manual = await fetch(`${base}/api/v1/payments/manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer landlord-fixture' },
      body: JSON.stringify({ billId: 50, channel: 'CASH', amount: 10, paidAt: '2026-09-05' }),
    });
    const confirm = await fetch(`${base}/api/v1/payments/82/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer landlord-fixture' },
      body: JSON.stringify({ action: 'confirm' }),
    });

    expect(manual.status).toBe(201);
    expect(confirm.status).toBe(201);
    expect(paymentsService.manualRecord).toHaveBeenCalledWith(
      expect.objectContaining({ billId: 50, channel: 'CASH', amount: 10 }),
      11,
    );
    expect(paymentsService.confirmOrReject).toHaveBeenCalledWith(82, 'confirm', 11);
  });

  it('keeps the gateway callback public', async () => {
    paymentsService.handleWechatNotify.mockResolvedValue({ code: 'SUCCESS' });
    const response = await fetch(`${base}/api/v1/payments/wechat/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ out_trade_no: 'WX50FIXTURE', trade_state: 'SUCCESS' }),
    });

    expect(response.status).toBe(201);
    expect(paymentsService.handleWechatNotify).toHaveBeenCalledWith(
      expect.objectContaining({ out_trade_no: 'WX50FIXTURE' }),
      undefined,
      expect.any(Object),
    );
  });
});
