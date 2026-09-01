import { Module } from '@nestjs/common';
import { MockWeiQianService } from './mock-weiqian.service';
import { RealWeiQianService } from './real-weiqian.service';
import { WEIQIAN_SERVICE } from './weiqian.interface';

const weiqianMode = process.env.WEIQIAN_MODE || 'mock';

const weiqianProvider = {
  provide: WEIQIAN_SERVICE,
  useClass:
    weiqianMode === 'real' ? RealWeiQianService : MockWeiQianService,
};

@Module({
  providers: [weiqianProvider],
  exports: [WEIQIAN_SERVICE],
})
export class WeiqianModule {}
