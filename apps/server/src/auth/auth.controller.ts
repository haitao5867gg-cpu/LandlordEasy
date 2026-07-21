import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

class LoginDto {
  code!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
