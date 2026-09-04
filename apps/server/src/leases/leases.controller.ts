import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { LeasesService } from './leases.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import {
  ApproveTerminationRequestDto,
  ApproveTransferRequestDto,
  CreateContractSigningTaskDto,
  CreateLeaseDto,
  EndLeaseDto,
  LaunchContractSigningTaskDto,
  RejectRequestDto,
  RenewLeaseDto,
} from './leases.dto';
import { JwtPayload } from '../auth/auth.service';

@Controller('leases')
@UseGuards(LandlordGuard)
export class LeasesController {
  constructor(private readonly leasesService: LeasesService) {}

  @Get()
  findAll(@Query('roomId') roomId?: string, @Query('status') status?: string) {
    return this.leasesService.findAll(
      roomId ? parseInt(roomId) : undefined,
      status,
    );
  }

  /** 退租违约申请列表(房东)——必须声明在 `:id` 路由之前,否则会被当成 lease id 解析。 */
  @Get('termination-requests')
  listTerminationRequests(@Query('status') status?: string) {
    return this.leasesService.listTerminationRequests(status);
  }

  /** 换租申请列表(房东)——同样必须声明在 `:id` 路由之前。 */
  @Get('transfer-requests')
  listTransferRequests(@Query('status') status?: string) {
    return this.leasesService.listTransferRequests(status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leasesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLeaseDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.create(dto, user.sub);
  }

  @Post(':id/contract-signing-tasks')
  createContractSigningTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateContractSigningTaskDto,
  ) {
    return this.leasesService.createContractSigningTask(id, dto);
  }

  /** 生成/复用租客账号绑定二维码,替代邀请码。 */
  @Post(':id/bind-qrcode')
  getTenantBindQrcode(@Param('id', ParseIntPipe) id: number) {
    return this.leasesService.getOrCreateTenantBindQrcode(id);
  }

  @Post('contract-signing-tasks/:id/launch')
  launchContractSigningTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LaunchContractSigningTaskDto,
  ) {
    return this.leasesService.launchContractSigningTask(id, dto);
  }

  /** 房东手动预览当前微签文件,跳转触发失效时的人工兜底第一步(仅预览,不确认)。 */
  @Post('contract-signing-tasks/:id/preview-signed-file')
  previewSignedFile(@Param('id', ParseIntPipe) id: number) {
    return this.leasesService.previewSignedFile(id);
  }

  /** 房东肉眼核实乙方签字属实后手动确认已签署,跳转触发失效时的人工兜底第二步。 */
  @Post('contract-signing-tasks/:id/confirm-signed')
  async confirmSignedTask(@Param('id', ParseIntPipe) id: number) {
    const confirmed = await this.leasesService.tryConfirmSigned(id);
    if (!confirmed) {
      throw new BadRequestException(
        '未能确认签署,请先点击"下载查看签署进度"核实乙方签字后再试',
      );
    }
    return { confirmed: true };
  }

  @Post(':id/end')
  endLease(@Param('id', ParseIntPipe) id: number, @Body() dto: EndLeaseDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.endLease(id, dto, user.sub);
  }

  @Post(':id/renew')
  renew(@Param('id', ParseIntPipe) id: number, @Body() dto: RenewLeaseDto) {
    return this.leasesService.renew(id, dto);
  }

  @Post('termination-requests/:id/approve')
  approveTerminationRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveTerminationRequestDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.approveTerminationRequest(id, dto, user.sub);
  }

  @Post('termination-requests/:id/reject')
  rejectTerminationRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectRequestDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.rejectTerminationRequest(id, dto, user.sub);
  }

  @Post('transfer-requests/:id/approve')
  approveTransferRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveTransferRequestDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.approveTransferRequest(id, dto, user.sub);
  }

  @Post('transfer-requests/:id/reject')
  rejectTransferRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectRequestDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.rejectTransferRequest(id, dto, user.sub);
  }
}
