import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';

/**
 * 租客守卫:验证 JWT + role=tenant
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const payload = this.authService.verifyToken(token);
    if (payload.role !== 'tenant') {
      throw new UnauthorizedException('无权访问租客端接口');
    }

    (request as unknown as Record<string, unknown>)['user'] = payload;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const auth = request.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return undefined;
  }
}
