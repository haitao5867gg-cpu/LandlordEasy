import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../auth/auth.service';

/**
 * 操作日志拦截器
 * 对 POST/PUT/PATCH/DELETE 请求自动记录操作日志
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // 只对写操作记录日志
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const user = (request as unknown as Record<string, unknown>)['user'] as JwtPayload | undefined;
    if (!user || user.role !== 'landlord') {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap(async (responseData) => {
        try {
          // 从路径中推断实体类型和 ID
          const pathSegments = request.path.split('/').filter(Boolean);
          // /api/v1/leases/123 → entityType=leases, entityId=123
          const entityType = pathSegments[2] || 'unknown';
          const entityId = parseInt(pathSegments[3]) || (responseData as Record<string, unknown>)?.['id'] as number || 0;

          await this.prisma.auditLog.create({
            data: {
              operatorId: user.sub,
              action: `${method} ${request.path}`,
              entityType,
              entityId: entityId || 0,
              detail: JSON.parse(JSON.stringify({
                method,
                path: request.path,
                body: this.sanitizeBody(request.body),
                duration: Date.now() - startTime,
              })),
            },
          });
        } catch (error) {
          // 审计日志写入失败不影响业务
          console.error('AuditLog write failed:', error);
        }
      }),
    );
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    if (!body) return {};
    // 脱敏：移除可能的密码等敏感字段
    const sanitized = { ...body };
    delete sanitized['password'];
    delete sanitized['secret'];
    return sanitized;
  }
}
