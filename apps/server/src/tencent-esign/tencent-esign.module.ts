import { Module } from '@nestjs/common';
import { MockTencentEsignService } from './mock-tencent-esign.service';
import { RealTencentEsignService } from './real-tencent-esign.service';
import { TENCENT_ESIGN_SERVICE } from './tencent-esign.interface';

const esignMode = process.env.ESIGN_MODE || 'mock';

const tencentEsignProvider = {
  provide: TENCENT_ESIGN_SERVICE,
  useClass:
    esignMode === 'real'
      ? RealTencentEsignService
      : MockTencentEsignService,
};

@Module({
  providers: [tencentEsignProvider],
  exports: [TENCENT_ESIGN_SERVICE],
})
export class TencentEsignModule {}
