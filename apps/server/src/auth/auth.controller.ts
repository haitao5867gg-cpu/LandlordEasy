import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

/** 登录类接口比全局限流更严格,防止暴力尝试 openid/code */
const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

class LoginDto {
  @IsString()
  code!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 查询备案审核演示登录是否开放 */
  @Get('review-mode')
  getReviewMode(): { enabled: boolean } {
    return { enabled: process.env.PUBLIC_REVIEW_MODE === 'true' };
  }

  /** 备案审核演示登录 */
  @Throttle(LOGIN_THROTTLE)
  @Post('landlord/review-login')
  async reviewLogin() {
    if (process.env.PUBLIC_REVIEW_MODE !== 'true') {
      throw new ForbiddenException('演示登录未开放');
    }
    return this.authService.reviewLogin();
  }

  /** 房东登录(mock: code = openid) */
  @Throttle(LOGIN_THROTTLE)
  @Post('landlord/login')
  async landlordLogin(@Body() dto: LoginDto) {
    return this.authService.landlordLogin(dto.code);
  }

  /** 租客登录(mock: code = openid) */
  @Throttle(LOGIN_THROTTLE)
  @Post('tenant/login')
  async tenantLogin(@Body() dto: LoginDto) {
    return this.authService.tenantLogin(dto.code);
  }
}
