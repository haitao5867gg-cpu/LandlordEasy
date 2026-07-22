import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/** 将 class-validator 的英文错误消息映射为中文 */
function translateValidationError(error: ValidationError): string {
  const constraints = error.constraints || {};
  const key = Object.keys(constraints)[0];
  const field = error.property;

  const fieldMap: Record<string, string> = {
    startDate: '起租日',
    endDate: '到期日',
    rent: '租金',
    deposit: '押金',
    name: '名称',
    phone: '手机号',
    amount: '金额',
    date: '日期',
    code: '授权码',
    buildingId: '楼栋',
    roomId: '房间',
  };
  const fieldName = fieldMap[field] || field;

  const messageMap: Record<string, string> = {
    isDateString: `${fieldName}格式不正确,请使用 YYYY-MM-DD 格式`,
    isNotEmpty: `${fieldName}不能为空`,
    isNumber: `${fieldName}必须为数字`,
    isString: `${fieldName}必须为文本`,
    isInt: `${fieldName}必须为整数`,
    min: `${fieldName}不能小于最小值`,
    isEnum: `${fieldName}选项不正确`,
    whitelistValidation: `提交了不允许的字段: ${field}`,
  };

  return messageMap[key] || `提交的信息格式不正确,请检查后重试`;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const firstError = errors[0];
        const message = translateValidationError(firstError);
        return new BadRequestException(message);
      },
    }),
  );
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
