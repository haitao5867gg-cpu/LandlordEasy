import { Injectable, Inject, UnauthorizedException, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { WECHAT_AUTH_SERVICE, IWechatAuthService } from '../wechat/wechat-auth.interface';

export interface JwtPayload {
  sub: number;
  openid: string;
  role: 'landlord' | 'tenant';
  tenantId?: number;
}

const PUBLIC_REVIEW_OPENID = '__public_review_reviewer__';
const PUBLIC_REVIEW_JWT_EXPIRES_IN = 2 * 60 * 60; // 2 hours in seconds

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
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
      // TEMP(11.4 流程,加白名单用,用完立刻revert): 临时打印真实 openid
      this.logger.warn(`房东微信授权成功，但启用状态的白名单中未找到该账号，openid=${openid}`);
      throw new UnauthorizedException('无权访问:当前微信未加入房东白名单');
    }
    this.logger.log('房东微信授权及白名单校验成功');

    const payload: JwtPayload = {
      sub: landlord.id,
      openid,
      role: 'landlord',
    };

    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
    return { token };
  }

  /**
   * 备案审核演示登录:复用固定房东账号并签发短期 JWT
   */
  async reviewLogin(): Promise<{ token: string }> {
    const landlord = await this.prisma.landlord.upsert({
      where: { openid: PUBLIC_REVIEW_OPENID },
      update: {},
      create: {
        openid: PUBLIC_REVIEW_OPENID,
        name: '备案审核演示账号',
        isActive: true,
      },
    });

    const payload: JwtPayload = {
      sub: landlord.id,
      openid: PUBLIC_REVIEW_OPENID,
      role: 'landlord',
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: PUBLIC_REVIEW_JWT_EXPIRES_IN,
    });
    this.logger.log('备案审核演示登录已签发');
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
