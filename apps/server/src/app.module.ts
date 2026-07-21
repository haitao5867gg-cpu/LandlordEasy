import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { WechatModule } from './wechat/wechat.module';
import { AuthModule } from './auth/auth.module';
import { BuildingsModule } from './buildings/buildings.module';
import { RoomTypesModule } from './room-types/room-types.module';
import { RoomsModule } from './rooms/rooms.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { LeasesModule } from './leases/leases.module';
import { BillsModule } from './bills/bills.module';
import { PaymentsModule } from './payments/payments.module';
import { RemindersModule } from './reminders/reminders.module';
import { TenantApiModule } from './tenant-api/tenant-api.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AdminModule } from './admin/admin.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'data/uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    HealthModule,
    WechatModule,
    AuthModule,
    BuildingsModule,
    RoomTypesModule,
    RoomsModule,
    DashboardModule,
    MaintenanceModule,
    LeasesModule,
    BillsModule,
    PaymentsModule,
    RemindersModule,
    TenantApiModule,
    ExpensesModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
