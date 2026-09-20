import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';

describe('AuditLogInterceptor（审计日志写入前脱敏）', () => {
  const landlordUser = { sub: 1, openid: 'o-landlord', role: 'landlord' as const };

  function createContext(request: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function createNext() {
    return { handle: () => of({ id: 99 }) } as CallHandler;
  }

  it('写库的 detail.body 中租客 PII 已脱敏，凭证已抹除', async () => {
    const prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    const interceptor = new AuditLogInterceptor(prisma as never);

    interceptor
      .intercept(
        createContext({
          method: 'POST',
          path: '/api/v1/leases',
          body: {
            roomId: 12,
            tenantName: '王小明',
            tenantPhone: '13812345678',
            tenantIdCard: '310101199001011234',
            password: 'should-not-appear',
          },
          user: landlordUser,
        }),
        createNext(),
      )
      .subscribe();

    // tap 内部是 async，等微任务落定
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditLog.create.mock.calls[0][0]['data'];
    const detail = data.detail as Record<string, unknown>;
    const body = detail.body as Record<string, unknown>;

    expect(body.tenantName).toBe('王**');
    expect(body.tenantPhone).toBe('138****5678');
    expect(body.tenantIdCard).toBe('310***********1234');
    expect(body.password).toBe('[REDACTED]');
    expect(body.roomId).toBe(12);
    expect(data.operatorId).toBe(1);
    expect(data.action).toBe('POST /api/v1/leases');
  });

  it('GET 请求与租客请求不写审计日志', () => {
    const prisma = { auditLog: { create: jest.fn() } };
    const interceptor = new AuditLogInterceptor(prisma as never);

    interceptor
      .intercept(
        createContext({ method: 'GET', path: '/api/v1/rooms', user: landlordUser }),
        createNext(),
      )
      .subscribe();
    interceptor
      .intercept(
        createContext({
          method: 'POST',
          path: '/api/v1/repairs',
          user: { sub: 5, openid: 'o-tenant', role: 'tenant' as const },
        }),
        createNext(),
      )
      .subscribe();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('日志写入失败不影响业务响应', (done) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const prisma = {
      auditLog: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const interceptor = new AuditLogInterceptor(prisma as never);

    interceptor
      .intercept(
        createContext({
          method: 'DELETE',
          path: '/api/v1/rooms/12',
          user: landlordUser,
        }),
        createNext(),
      )
      .subscribe({
        next: (value) => {
          expect(value).toEqual({ id: 99 });
          setTimeout(() => {
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
            done();
          }, 0);
        },
      });
  });
});
