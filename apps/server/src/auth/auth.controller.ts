import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

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
  @Post('landlord/review-login')
  async reviewLogin() {
    if (process.env.PUBLIC_REVIEW_MODE !== 'true') {
      throw new ForbiddenException('演示登录未开放');
    }
    return this.authService.reviewLogin();
  }

  /** 房东登录(mock: code = openid) */
  @Post('landlord/login')
  async landlordLogin(@Body() dto: LoginDto) {
    return this.authService.landlordLogin(dto.code);
  }

  /** 租客登录(mock: code = openid) */
  @Post('tenant/login')
  async tenantLogin(@Body() dto: LoginDto) {
    return this.authService.tenantLogin(dto.code);
  }
}
