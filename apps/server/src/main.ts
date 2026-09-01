import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { text } from 'express';
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
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  // 微信公众号事件推送用 text/xml,NestJS 内置的 json/urlencoded parser 不认这个
  // content-type,rawBody:true 全局开关对它不生效,req.rawBody 会一直是 undefined。
  // 单独给这个路由挂一个 text() parser 补上(2026-09-01 用真实微信XML请求体格式
  // 手动验证时发现 WechatController.event 一直拿到空字符串,才发现这个缺口)。
  app.use(
    '/api/v1/wechat/event',
    text({
      type: ['text/xml', 'application/xml'],
      verify: (req: unknown, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
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
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
