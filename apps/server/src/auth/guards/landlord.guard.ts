import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 房东守卫:验证 JWT + 每次请求实时查库确认 openid 在白名单且 isActive
 * 这样移除白名单后立即生效,无需等待 JWT 过期
 */
@Injectable()
export class LandlordGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const payload = this.authService.verifyToken(token);
    if (payload.role !== 'landlord') {
      throw new UnauthorizedException('无权访问房东端接口');
    }

    // 实时查库确认白名单状态
    const landlord = await this.prisma.landlord.findUnique({
      where: { id: payload.sub },
    });
    if (!landlord || !landlord.isActive) {
      throw new UnauthorizedException('账号已被禁用,请联系管理员');
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
