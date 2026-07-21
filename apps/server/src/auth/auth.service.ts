import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { WECHAT_AUTH_SERVICE, IWechatAuthService } from '../wechat/wechat-auth.interface';

export interface JwtPayload {
  sub: number;
  openid: string;
  role: 'landlord' | 'tenant';
  tenantId?: number;
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: number; // seconds

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_AUTH_SERVICE) private readonly wechatAuth: IWechatAuthService,
  ) {
    this.jwtSecret = process.env.JWT_SECRET || 'dev-secret';
    this.jwtExpiresIn = 7 * 24 * 60 * 60; // 7 days in seconds
  }

  /**
   * 房东登录:code(mock 模式下=openid) → 校验白名单 → 签发 JWT
   */
  async landlordLogin(code: string): Promise<{ token: string }> {
    const { openid } = await this.wechatAuth.getOpenidByCode(code);

    const landlord = await this.prisma.landlord.findUnique({ where: { openid } });
    if (!landlord || !landlord.isActive) {
      throw new UnauthorizedException('无权访问:openid 不在房东白名单中');
    }

    const payload: JwtPayload = {
      sub: landlord.id,
      openid,
      role: 'landlord',
    };

    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
    return { token };
  }

  /**
   * 租客登录:code(mock 模式下=openid) → 签发 JWT(含 tenantId,若已绑定)
   */
  async tenantLogin(code: string): Promise<{ token: string; bound: boolean }> {
    const { openid } = await this.wechatAuth.getOpenidByCode(code);

    const tenant = await this.prisma.tenant.findUnique({ where: { openid } });

    const payload: JwtPayload = {
      sub: tenant?.id || 0,
      openid,
      role: 'tenant',
      tenantId: tenant?.id,
    };

    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
    return { token, bound: !!tenant };
  }

  /**
   * 验证 JWT 并返回 payload
   */
  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException('登录已过期,请重新登录');
    }
  }
}
