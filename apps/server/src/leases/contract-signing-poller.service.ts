import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LeasesService } from './leases.service';

@Injectable()
export class ContractSigningPollerService {
  private readonly logger = new Logger(ContractSigningPollerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leasesService: LeasesService,
  ) {}

  /** 每 10 分钟核实仍处于 CREATED 状态的微签任务。 */
  @Cron('*/10 * * * *')
  async pollCreatedTasks(): Promise<void> {
    const tasks = await this.prisma.contractSigningTask.findMany({
      where: { status: 'CREATED' },
      select: { id: true },
    });

    for (const task of tasks) {
      try {
        await this.leasesService.tryConfirmSigned(task.id);
      } catch (error) {
        this.logger.warn(
          `轮询签约任务 ${task.id} 失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
