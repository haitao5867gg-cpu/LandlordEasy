import { Module } from '@nestjs/common';
import { MockWeiQianService } from './mock-weiqian.service';
import { RealWeiQianService } from './real-weiqian.service';
import { WEIQIAN_SERVICE } from './weiqian.interface';
import { resolveWeiQianMode } from '../config/startup-config';

const weiqianMode = resolveWeiQianMode();

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
