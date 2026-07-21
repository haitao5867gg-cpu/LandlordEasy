import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';

/**
 * 房东守卫:验证 JWT + openid 必须在 Landlord 表且 isActive
 */
@Injectable()
export class LandlordGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const payload = this.authService.verifyToken(token);
    if (payload.role !== 'landlord') {
      throw new UnauthorizedException('无权访问房东端接口');
    }

    // 将用户信息挂载到 request
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
