import { randomInt } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApproveTerminationRequestDto,
  ApproveTransferRequestDto,
  CreateContractSigningTaskDto,
  CreateLeaseDto,
  CreateTerminationRequestDto,
  CreateTransferRequestDto,
  EndLeaseDto,
  LaunchContractSigningTaskDto,
  RejectRequestDto,
  RenewLeaseDto,
} from './leases.dto';
import {
  IWechatQrcodeService,
  WECHAT_QRCODE_SERVICE,
} from '../wechat/wechat-qrcode.interface';
import {
  IWechatCustomerServiceService,
  WECHAT_CUSTOMER_SERVICE,
} from '../wechat/wechat-customer-service.interface';
import {
  IWechatNotifyService,
  WECHAT_NOTIFY_SERVICE,
} from '../wechat/wechat-notify.interface';
import { ContractPdfService } from '../contract-pdf/contract-pdf.service';
import {
  ContractFacilities,
  ContractPdfData,
} from '../contract-pdf/contract-pdf.types';
import {
  IWeiQianService,
  WEIQIAN_SERVICE,
} from '../weiqian/weiqian.interface';

import { readContractPdf, writeContractPdf } from './contract-storage';
const DEFAULT_WEIQIAN_SIGN_BASE_URL = 'http://forwave.picp.net:8888';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const FACILITY_NAME_TO_KEY: Record<string, keyof ContractFacilities> = {
  空调: 'airConditioner',
  冰箱: 'refrigerator',
  洗衣机: 'washingMachine',
  热水器: 'waterHeater',
  燃气灶: 'gasStove',
  电视: 'television',
  淋浴器: 'shower',
  油烟机: 'rangeHood',
  床: 'bed',
  桌子: 'table',
  椅子: 'chair',
  沙发: 'sofa',
};

@Injectable()
export class LeasesService {
  private readonly logger = new Logger(LeasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_QRCODE_SERVICE) private readonly wechatQrcode: IWechatQrcodeService,
    private readonly contractPdf: ContractPdfService,
    @Inject(WEIQIAN_SERVICE) private readonly weiqian: IWeiQianService,
    @Inject(WECHAT_CUSTOMER_SERVICE)
    private readonly wechatCustomerService: IWechatCustomerServiceService,
    @Inject(WECHAT_NOTIFY_SERVICE)
    private readonly wechatNotify: IWechatNotifyService,
  ) {}

  async findAll(roomId?: number, status?: string) {
    const where: Record<string, unknown> = {};
    if (roomId) where.roomId = roomId;
    if (status) where.status = status;

    return this.prisma.lease.findMany({
      where,
      include: { room: { include: { building: true } }, tenant: true },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: number) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: {
        room: { include: { building: true } },
        tenant: true,
        bills: { include: { items: true, payments: true }, orderBy: { periodStart: 'desc' } },
        depositRecords: true,
        handoverRecords: true,
        contractSigningTasks: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lease) throw new NotFoundException('租约不存在');
    return lease;
  }

  /** 创建电子签约任务；已绑定 openid 时直接自动发起签署，否则生成关注场景二维码。 */
  async createContractSigningTask(leaseId: number, dto: CreateContractSigningTaskDto) {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: { id: true, tenant: { select: { openid: true } } },
    });
    if (!lease) throw new NotFoundException('租约不存在');

    const followerOpenid = lease.tenant.openid;
    const task = await this.createContractSigningTaskRecord(
      leaseId,
      dto,
      followerOpenid,
    );
    if (followerOpenid) {
      try {
        return await this.launchContractSigningTaskInternal(task.id, {});
      } catch (error) {
        this.logger.warn(
          `签约任务 ${task.id} 创建后自动发起失败,任务保留在 FOLLOWED: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return task;
      }
    }

    const { qrCodeImage } = await this.wechatQrcode.createSceneQrcode(task.sceneValue);

    return this.prisma.contractSigningTask.update({
      where: { id: task.id },
      data: { qrCodeImage },
    });
  }

  /** 生成(或复用)租客账号绑定二维码,扫码关注公众号即自动绑定 tenant-h5,替代邀请码。 */
  async getOrCreateTenantBindQrcode(
    leaseId: number,
  ): Promise<{ qrCodeImage: string; sceneValue: number }> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: { tenantId: true },
    });
    if (!lease) throw new NotFoundException('租约不存在');

    const sceneValue = await this.ensureTenantBindSceneValue(lease.tenantId);
    const { qrCodeImage } = await this.wechatQrcode.createSceneQrcode(sceneValue);
    return { qrCodeImage, sceneValue };
  }

  private async ensureTenantBindSceneValue(tenantId: number): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { bindSceneValue: true },
    });
    if (tenant?.bindSceneValue) return tenant.bindSceneValue;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const updated = await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { bindSceneValue: randomInt(1, 2 ** 31) },
          select: { bindSceneValue: true },
        });
        return updated.bindSceneValue!;
      } catch (error) {
        const shouldRetry =
          attempt === 0 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!shouldRetry) throw error;
      }
    }

    throw new Error('无法生成唯一的绑定场景值');
  }

  private async createContractSigningTaskRecord(
    leaseId: number,
    dto: CreateContractSigningTaskDto,
    followerOpenid: string | null,
  ) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.contractSigningTask.create({
          data: {
            leaseId,
            type: dto.type,
            sceneValue: randomInt(1, 2 ** 31),
            waterMeterReading: dto.waterMeterReading,
            electricityMeterReading: dto.electricityMeterReading,
            gasMeterReading: dto.gasMeterReading,
            facilities: dto.facilities
              ? JSON.parse(JSON.stringify(dto.facilities))
              : [],
            ...(dto.extraTerms === undefined ? {} : { extraTerms: dto.extraTerms }),
            penaltyMonths: dto.penaltyMonths,
            overdueToleranceDays: dto.overdueToleranceDays,
            cleaningFee: dto.cleaningFee,
            renewalNoticeDays: dto.renewalNoticeDays,
            status: followerOpenid ? 'FOLLOWED' : 'PENDING_SCAN',
            ...(followerOpenid ? { followerOpenid } : {}),
          },
        });
      } catch (error) {
        const shouldRetry =
          attempt === 0 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!shouldRetry) throw error;
      }
    }

    throw new Error('无法生成唯一的微信场景值');
  }

  /** 在租客关注后发起微签互签任务，供自动流程和房东手动重试复用。 */
  async launchContractSigningTask(
    taskId: number,
    dto: LaunchContractSigningTaskDto,
  ) {
    return this.launchContractSigningTaskInternal(taskId, dto);
  }

  private async launchContractSigningTaskInternal(
    taskId: number,
    dto: LaunchContractSigningTaskDto,
  ) {
    const task = await this.prisma.contractSigningTask.findUnique({
      where: { id: taskId },
      include: {
        lease: {
          include: {
            room: {
              include: { building: { include: { property: true } } },
            },
            tenant: true,
          },
        },
      },
    });
    if (!task) throw new NotFoundException('电子签约任务不存在');
    if (task.status !== 'FOLLOWED') {
      throw new BadRequestException(
        '当前状态不允许发起签署,需要租客先关注公众号',
      );
    }

    const settings = await this.prisma.contractSettings.findFirst({
      orderBy: { id: 'asc' },
    });
    if (!settings) {
      throw new BadRequestException(
        '尚未配置合同甲方信息,请先到系统设置完成合同签约配置',
      );
    }

    const tenant = task.lease.tenant;
    if (!tenant.idCard) {
      throw new BadRequestException('租客身份证号未填写,无法发起实名认证签署');
    }
    if (!task.followerOpenid) {
      throw new BadRequestException('未记录租客关注信息,请重新生成二维码并让租客扫码');
    }

    const publicBaseUrl = process.env.SERVER_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    if (!publicBaseUrl) {
      throw new InternalServerErrorException(
        '未配置 SERVER_PUBLIC_BASE_URL,无法生成签署完成回跳地址',
      );
    }

    const pdfData: ContractPdfData = {
      landlordName: settings.landlordName,
      landlordIdCard: settings.landlordIdCard,
      landlordPhone: settings.landlordPhone,
      tenantName: tenant.name,
      tenantIdCard: tenant.idCard,
      tenantPhone: tenant.phone,
      propertyAddress: this.buildPropertyAddress(task.lease.room),
      leaseStartDate: task.lease.startDate,
      leaseEndDate: task.lease.endDate,
      monthlyRent: Number(task.lease.rent),
      paymentCycle: this.formatPaymentCycle(task.lease.payCycle),
      depositAmount: Number(task.lease.deposit),
      penaltyMonths:
        dto.penaltyMonths ?? task.penaltyMonths ?? settings.defaultPenaltyMonths,
      overdueToleranceDays:
        dto.overdueToleranceDays ??
        task.overdueToleranceDays ??
        settings.defaultOverdueDays,
      cleaningFee: Number(
        dto.cleaningFee ?? task.cleaningFee ?? settings.defaultCleaningFee,
      ),
      renewalNoticeDays:
        dto.renewalNoticeDays ??
        task.renewalNoticeDays ??
        settings.defaultRenewNoticeDays,
      waterMeterReading:
        task.waterMeterReading === null
          ? undefined
          : Number(task.waterMeterReading),
      electricityMeterReading:
        task.electricityMeterReading === null
          ? undefined
          : Number(task.electricityMeterReading),
      gasMeterReading:
        task.gasMeterReading === null ? undefined : Number(task.gasMeterReading),
      facilities: this.toContractFacilities(task.facilities),
      extraTerms: task.extraTerms ?? undefined,
      contractNumber: `LE-${task.id}`,
    };

    const fileName = `contract-${task.id}.pdf`;
    const pdfBuffer = await this.contractPdf.generate(pdfData);
    const uploadedFile = await this.weiqian.uploadFile(pdfBuffer, fileName);
    const createdTask = await this.weiqian.createEachSignTask({
      launchAccount: settings.landlordPhone,
      fBIds: [uploadedFile.bId],
      fileName,
      receiverAccount: tenant.phone,
      receiverName: tenant.name,
      receiverIdCard: tenant.idCard,
      expiresTime: Date.now() + SEVEN_DAYS_MS,
      sendSmsToReceiver: true,
      finishSignJumpPage: `${publicBaseUrl}/wechat/contract-sign-callback`,
      parm: String(task.id),
    });

    const updatedTask = await this.prisma.contractSigningTask.update({
      where: { id: task.id },
      data: {
        status: 'CREATED',
        weiqianBId: createdTask.bId,
        weiqianShortCode: createdTask.shortCode,
      },
    });
    const signBaseUrl = (
      process.env.WEIQIAN_SIGN_BASE_URL || DEFAULT_WEIQIAN_SIGN_BASE_URL
    ).replace(/\/+$/, '');
    const signUrl = `${signBaseUrl}/q/${createdTask.shortCode}`;
    const roomLabel = this.formatRoomLabel(task.lease.room);
    await this.wechatCustomerService.sendTextMessage(
      task.followerOpenid,
      `【${roomLabel}】您的租房合同可以签署了,请点击链接完成实名认证并签字(建议在微信内直接打开):
${signUrl}
链接7天内有效,请尽快完成`,
    );

    return updatedTask;
  }

  /** 拼装"R栋205"这样的房间标识,用于客服消息区分多套房源。 */
  private formatRoomLabel(room: { roomNo: string; building: { name: string } }): string {
    return `${room.building.name}${room.roomNo}`;
  }

  /** 核实微签已签文件并完成本地归档、状态更新和租客 openid 绑定 */
  async tryConfirmSigned(taskId: number): Promise<boolean> {
    const task = await this.prisma.contractSigningTask.findUnique({
      where: { id: taskId },
      include: {
        lease: {
          include: {
            tenant: true,
            room: { include: { building: { include: { property: true } } } },
          },
        },
      },
    });
    if (!task || task.status !== 'CREATED' || !task.weiqianBId) return false;

    const signedPdf = await this.weiqian.downloadSignedFile(task.weiqianBId);
    if (!signedPdf) return false;

    const signedPdfUrl = this.saveSignedPdf(task.id, signedPdf);

    const updateResult = await this.prisma.contractSigningTask.updateMany({
      where: { id: task.id, status: 'CREATED' },
      data: { status: 'SIGNED', signedPdfUrl, signedAt: new Date() },
    });
    if (updateResult.count === 0) return true;

    if (task.followerOpenid) {
      const roomLabel = this.formatRoomLabel(task.lease.room);
      await this.wechatCustomerService.sendTextMessage(
        task.followerOpenid,
        `【${roomLabel}】您的租房合同已签署完成,感谢配合。如有疑问请直接联系房东`,
      );

      // 客服消息受微信48小时互动窗口限制、经常发不出去;模板消息不受这个限制,
      // 作为保底通道并行发送,只要模板ID配置了就发,两条消息都发不影响业务。
      const templateId = process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
      if (templateId) {
        await this.wechatNotify.sendTemplateMessage({
          openid: task.followerOpenid,
          templateId,
          data: {
            thing1: { value: this.buildPropertyAddress(task.lease.room) },
            character_string2: { value: `LE-${task.id}` },
            // const3是微信审核过的固定候选词字段,值必须跟后台"管理枚举值"里审核
            // 通过的原文完全一致,不能随便改——"公寓房屋租赁合同"是2026-09-04审核
            // 通过的值(此前"新签合同"/"续签合同"、"房屋租赁合同"都被驳回过)
            const3: { value: '公寓房屋租赁合同' },
            time4: {
              value: `${task.lease.startDate.toISOString().split('T')[0]}~${task.lease.endDate.toISOString().split('T')[0]}`,
            },
            thing5: { value: task.lease.tenant.name },
          },
        });
      }
    }

    const tenant = task.lease.tenant;
    if (task.followerOpenid && !tenant.openid) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { openid: task.followerOpenid },
      });
    } else if (
      task.followerOpenid &&
      tenant.openid &&
      tenant.openid !== task.followerOpenid
    ) {
      this.logger.warn(
        `签约任务 ${task.id} 的关注 openid 与租客 ${tenant.id} 已绑定 openid 冲突,未自动覆盖`,
      );
    }

    return true;
  }

  /**
   * 房东手动预览当前微签文件,用于跳转触发失效时的人工兜底核实。
   * 只是把微签当前能下载到的文件存一份给房东看,绝不代表签署已确认——
   * 不修改任务状态、signedPdfUrl、signedAt,也不做 openid 绑定。
   */
  async previewSignedFile(taskId: number): Promise<{ previewUrl: string }> {
    await this.previewContractPdf(taskId);
    return { previewUrl: `/api/v1/leases/contract-signing-tasks/${taskId}/preview` };
  }

  async previewContractPdf(taskId: number): Promise<Buffer> {
    const task = await this.prisma.contractSigningTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('电子签约任务不存在');
    if (task.status !== 'CREATED' || !task.weiqianBId) {
      throw new BadRequestException('当前状态不支持预览签署进度');
    }
    const pdf = await this.weiqian.downloadSignedFile(task.weiqianBId);
    if (!pdf) throw new BadRequestException('微签暂未返回文件,可能签署尚未开始,请稍后重试');
    writeContractPdf(taskId, 'preview', pdf);
    return pdf;
  }

  async listTenantContracts(tenantId: number) {
    return this.prisma.contractSigningTask.findMany({
      where: { status: 'SIGNED', lease: { tenantId } },
      select: { id: true, leaseId: true, status: true, createdAt: true, signedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async downloadSignedContract(taskId: number, tenantId?: number): Promise<Buffer> {
    const task = await this.prisma.contractSigningTask.findUnique({
      where: { id: taskId }, include: { lease: true },
    });
    // No lease-status filter: historic contracts remain the tenant's own records.
    if (!task || task.status !== 'SIGNED' || (tenantId !== undefined && task.lease.tenantId !== tenantId)) {
      throw new NotFoundException('已签合同不存在或无权访问');
    }
    try {
      return readContractPdf(taskId);
    } catch {
      // Fail closed for missing/unmigrated/unsafe files; never follow signedPdfUrl or public fallback.
      throw new NotFoundException('合同文件暂不可用,请联系房东');
    }
  }

  private saveSignedPdf(taskId: number, signedPdf: Buffer): string {
    writeContractPdf(taskId, 'signed', signedPdf);
    return `/api/v1/leases/contract-signing-tasks/${taskId}/pdf`;
  }

  private buildPropertyAddress(room: {
    roomNo: string;
    building: { name: string; property: { name: string } };
  }): string {
    return `${room.building.property.name}${room.building.name}${room.roomNo}室`;
  }

  private formatPaymentCycle(payCycle: string): string {
    return { MONTHLY: '月付', QUARTERLY: '季付', YEARLY: '年付' }[payCycle] ?? payCycle;
  }

  private toContractFacilities(value: unknown): ContractFacilities {
    const result: ContractFacilities = {
      airConditioner: false,
      refrigerator: false,
      washingMachine: false,
      waterHeater: false,
      gasStove: false,
      television: false,
      shower: false,
      rangeHood: false,
      bed: false,
      table: false,
      chair: false,
      sofa: false,
    };
    if (!Array.isArray(value)) return result;

    for (const facility of value) {
      if (!facility || typeof facility !== 'object') continue;
      const item = facility as { name?: unknown; has?: unknown };
      if (typeof item.name !== 'string') continue;
      const key = FACILITY_NAME_TO_KEY[item.name];
      if (key) result[key] = item.has === true;
    }
    return result;
  }

  /** 新签租约 */
  async create(dto: CreateLeaseDto, operatorId: number) {
    // 检查房间是否空置
    const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.status !== 'VACANT') {
      throw new BadRequestException('房间不是空置状态,无法签约');
    }

    // 创建或查找租客
    let tenant = await this.prisma.tenant.findFirst({
      where: { phone: dto.tenantPhone },
    });
    if (!tenant) {
      tenant = await this.prisma.tenant.create({
        data: {
          name: dto.tenantName,
          phone: dto.tenantPhone,
          idCard: dto.tenantIdCard,
        },
      });
    }

    const inviteCode = this.generateInviteCode();

    const lease = await this.prisma.lease.create({
      data: {
        roomId: dto.roomId,
        tenantId: tenant.id,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        rent: dto.rent,
        deposit: dto.deposit,
        payCycle: dto.payCycle || 'MONTHLY',
        feeItems: dto.feeItems ? JSON.parse(JSON.stringify(dto.feeItems)) : undefined,
        carPlate: dto.carPlate,
        commission: dto.commission,
        inviteCode,
      },
    });

    // 房间转已租
    await this.prisma.room.update({
      where: { id: dto.roomId },
      data: { status: 'RENTED' },
    });

    // 押金入台账
    await this.prisma.depositRecord.create({
      data: {
        leaseId: lease.id,
        type: 'RECEIVE',
        amount: dto.deposit,
        operatorId,
      },
    });

    return lease;
  }

  /** 退租 */
  async endLease(id: number, dto: EndLeaseDto, operatorId: number) {
    const lease = await this.prisma.lease.findUnique({ where: { id } });
    if (!lease) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('租约已结束');
    }

    // 押金结算
    const depositAmount = Number(lease.deposit);
    if (dto.depositRefund > depositAmount) {
      throw new BadRequestException('退还押金不能超过实际押金金额');
    }
    if (dto.depositRefund > 0) {
      await this.prisma.depositRecord.create({
        data: {
          leaseId: id,
          type: 'REFUND',
          amount: dto.depositRefund,
          operatorId,
        },
      });
    }
    const deductAmount = depositAmount - dto.depositRefund;
    if (deductAmount > 0) {
      await this.prisma.depositRecord.create({
        data: {
          leaseId: id,
          type: 'DEDUCT',
          amount: deductAmount,
          reason: dto.depositDeductReason || '退租扣款',
          operatorId,
        },
      });
    }

    // 租约归档
    const updatedLease = await this.prisma.lease.update({
      where: { id },
      data: {
        status: 'ENDED',
        endedAt: new Date(dto.endDate),
        endReason: dto.endReason,
      },
    });

    // 房间转空置
    await this.prisma.room.update({
      where: { id: lease.roomId },
      data: { status: 'VACANT' },
    });

    return updatedLease;
  }

  /** 续签 */
  async renew(id: number, dto: RenewLeaseDto) {
    const lease = await this.prisma.lease.findUnique({ where: { id } });
    if (!lease) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') {
      throw new BadRequestException('只能续签活跃租约');
    }
    if (new Date(dto.newEndDate) <= lease.startDate) {
      throw new BadRequestException('新到期日不能早于或等于起租日');
    }

    return this.prisma.lease.update({
      where: { id },
      data: {
        endDate: new Date(dto.newEndDate),
        ...(dto.newRent !== undefined && { rent: dto.newRent }),
      },
    });
  }

  private generateInviteCode(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  // ========== 租客退租违约申请 ==========

  /** 违约金建议值:月租金 × 该租约签约时约定的违约金月数(没有电子签约记录时用系统默认值) */
  private async calculateSuggestedPenalty(leaseId: number): Promise<number> {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new NotFoundException('租约不存在');
    const task = await this.prisma.contractSigningTask.findFirst({
      where: { leaseId, penaltyMonths: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const settings = await this.prisma.contractSettings.findFirst();
    const penaltyMonths = task?.penaltyMonths ?? settings?.defaultPenaltyMonths ?? 1;
    return Number(lease.rent) * penaltyMonths;
  }

  async previewTerminationPenalty(leaseId: number, tenantId: number) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.tenantId !== tenantId) throw new NotFoundException('租约不存在');
    const suggestedPenalty = await this.calculateSuggestedPenalty(leaseId);
    return { suggestedPenalty };
  }

  async createTerminationRequest(
    leaseId: number,
    tenantId: number,
    dto: CreateTerminationRequestDto,
  ) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.tenantId !== tenantId) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') throw new BadRequestException('租约已结束');
    const existing = await this.prisma.leaseTerminationRequest.findFirst({
      where: { leaseId, status: 'PENDING' },
    });
    if (existing) throw new BadRequestException('已有一条待处理的退租申请,请勿重复提交');

    const suggestedPenalty = await this.calculateSuggestedPenalty(leaseId);
    return this.prisma.leaseTerminationRequest.create({
      data: {
        leaseId,
        tenantId,
        requestedMoveOutDate: new Date(dto.requestedMoveOutDate),
        reason: dto.reason,
        suggestedPenalty,
      },
    });
  }

  async listMyTerminationRequests(tenantId: number) {
    return this.prisma.leaseTerminationRequest.findMany({
      where: { tenantId },
      include: { lease: { include: { room: { include: { building: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listTerminationRequests(status?: string) {
    return this.prisma.leaseTerminationRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        lease: { include: { room: { include: { building: true } }, tenant: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveTerminationRequest(
    id: number,
    dto: ApproveTerminationRequestDto,
    operatorId: number,
  ) {
    const req = await this.prisma.leaseTerminationRequest.findUnique({
      where: { id },
      include: { lease: true },
    });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new BadRequestException('该申请已处理,不能重复操作');

    const finalPenalty = dto.finalPenalty ?? Number(req.suggestedPenalty);
    if (finalPenalty < 0) throw new BadRequestException('违约金不能为负数');
    const deposit = Number(req.lease.deposit);
    const depositRefund = Math.max(0, deposit - finalPenalty);
    const shortfall = Math.max(0, finalPenalty - deposit);

    await this.endLease(
      req.leaseId,
      {
        endDate: req.requestedMoveOutDate.toISOString().split('T')[0],
        endReason: `租客申请退租(违约金¥${finalPenalty})`,
        depositRefund,
        depositDeductReason: `违约金¥${finalPenalty}`,
      },
      operatorId,
    );

    if (shortfall > 0) {
      await this.createAdHocBill(
        req.leaseId,
        '违约金差额',
        shortfall,
        req.requestedMoveOutDate,
      );
    }

    return this.prisma.leaseTerminationRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        finalPenalty,
        resolvedBy: operatorId,
        resolvedAt: new Date(),
      },
    });
  }

  async rejectTerminationRequest(id: number, dto: RejectRequestDto, operatorId: number) {
    const req = await this.prisma.leaseTerminationRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new BadRequestException('该申请已处理,不能重复操作');
    return this.prisma.leaseTerminationRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        landlordNote: dto.note,
        resolvedBy: operatorId,
        resolvedAt: new Date(),
      },
    });
  }

  /** 生成一张与正常月度账期无关的一次性账单(比如违约金差额),leaseId+periodStart 唯一约束冲突时顺延一天重试。 */
  private async createAdHocBill(
    leaseId: number,
    itemName: string,
    amount: number,
    dueDate: Date,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const periodStart = new Date(dueDate);
      periodStart.setDate(periodStart.getDate() + attempt);
      try {
        const bill = await this.prisma.bill.create({
          data: {
            leaseId,
            periodStart,
            periodEnd: periodStart,
            dueDate: periodStart,
            totalAmount: amount,
          },
        });
        await this.prisma.billItem.create({
          data: { billId: bill.id, type: 'OTHER', name: itemName, amount },
        });
        return bill;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException('生成一次性账单失败');
  }

  // ========== 租客换租申请 ==========

  async createTransferRequest(leaseId: number, tenantId: number, dto: CreateTransferRequestDto) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.tenantId !== tenantId) throw new NotFoundException('租约不存在');
    if (lease.status !== 'ACTIVE') throw new BadRequestException('租约已结束');
    const existing = await this.prisma.roomTransferRequest.findFirst({
      where: { leaseId, status: 'PENDING' },
    });
    if (existing) throw new BadRequestException('已有一条待处理的换租申请,请勿重复提交');

    return this.prisma.roomTransferRequest.create({
      data: {
        leaseId,
        tenantId,
        preferredRoom: dto.preferredRoom,
        reason: dto.reason,
      },
    });
  }

  async listMyTransferRequests(tenantId: number) {
    return this.prisma.roomTransferRequest.findMany({
      where: { tenantId },
      include: {
        lease: { include: { room: { include: { building: true } } } },
        targetRoom: { include: { building: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listTransferRequests(status?: string) {
    return this.prisma.roomTransferRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        lease: { include: { room: { include: { building: true } }, tenant: true } },
        targetRoom: { include: { building: true } },
        newLease: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveTransferRequest(id: number, dto: ApproveTransferRequestDto, operatorId: number) {
    const req = await this.prisma.roomTransferRequest.findUnique({
      where: { id },
      include: { lease: { include: { tenant: true } } },
    });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new BadRequestException('该申请已处理,不能重复操作');

    const targetRoom = await this.prisma.room.findUnique({ where: { id: dto.targetRoomId } });
    if (!targetRoom) throw new NotFoundException('目标房间不存在');
    if (targetRoom.status !== 'VACANT') throw new BadRequestException('目标房间不是空置状态');

    const tenant = req.lease.tenant;
    const tenantIdCard = dto.tenantIdCard || tenant.idCard;
    if (!tenantIdCard) {
      throw new BadRequestException('该租客缺少身份证号,请在审批时通过 tenantIdCard 字段补充');
    }

    const oldDepositRefund = dto.oldDepositRefund ?? Number(req.lease.deposit);

    await this.endLease(
      req.leaseId,
      {
        endDate: new Date().toISOString().split('T')[0],
        endReason: `换租至${targetRoom.roomNo}`,
        depositRefund: oldDepositRefund,
        depositDeductReason: dto.oldDepositDeductReason,
      },
      operatorId,
    );

    const newLease = await this.create(
      {
        roomId: dto.targetRoomId,
        tenantName: tenant.name,
        tenantPhone: tenant.phone,
        tenantIdCard,
        startDate: dto.newStartDate || new Date().toISOString().split('T')[0],
        endDate: dto.newEndDate,
        rent: dto.newRent,
        deposit: dto.newDeposit,
        payCycle: req.lease.payCycle,
      },
      operatorId,
    );

    try {
      await this.createContractSigningTask(newLease.id, { type: 'NEW' });
    } catch (error) {
      this.logger.warn(
        `换租后自动发起电子签约失败,租约 ${newLease.id} 已创建但尚未生成签约任务: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.prisma.roomTransferRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        targetRoomId: dto.targetRoomId,
        newLeaseId: newLease.id,
        resolvedBy: operatorId,
        resolvedAt: new Date(),
      },
    });
  }

  async rejectTransferRequest(id: number, dto: RejectRequestDto, operatorId: number) {
    const req = await this.prisma.roomTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new BadRequestException('该申请已处理,不能重复操作');
    return this.prisma.roomTransferRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        landlordNote: dto.note,
        resolvedBy: operatorId,
        resolvedAt: new Date(),
      },
    });
  }
}
