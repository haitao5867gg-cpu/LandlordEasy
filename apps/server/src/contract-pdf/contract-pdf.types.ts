// M22 新标准合同模板的数据结构(定稿文本见 specs/contract-template/FINAL-TEMPLATE.md)
export interface ChecklistEntry {
  item: string;
  quantity: number | null;
  condition: string;
}

export interface CoOccupantInfo {
  name: string;
  idCard: string;
  phone: string;
}

export interface ContractPdfData {
  // 合同编号
  contractNumber?: string;
  // 甲方(ContractSettings)
  landlordName: string;
  landlordIdCard: string;
  landlordPhone: string;
  // 乙方(Tenant)
  tenantName: string;
  tenantIdCard: string;
  tenantPhone: string;
  // 租约
  propertyAddress: string;
  leaseStartDate: Date | string;
  leaseEndDate: Date | string;
  monthlyRent: number;
  paymentCycle: string;
  depositAmount: number;
  // 收款人(ContractSettings.payeeName)
  payeeName: string;
  // 提前支付天数(AdminService 提醒参数 reminderPreDays)
  advancePaymentDays: number;
  // 附件三:入住交接(取该租约 CHECKIN HandoverRecord)
  handoverDate: Date | string | null;
  waterMeterReading?: number;
  electricityMeterReading?: number;
  gasMeterReading?: number;
  checklist: ChecklistEntry[];
  // 附件二:共同居住人(Lease.coOccupants,超8人截断)
  coOccupants: CoOccupantInfo[];
  // 合同条款数值(ContractSettings)
  penaltyMonths: number;
  overdueToleranceDays: number;
  cleaningFee: number;
  renewalNoticeDays: number;
  continuousStayDays: number;
  cumulativeStayDays: number;
  abandonedPropertyDays: number;
  nonRenewalNoticeDays: number;
  earlyTerminationNoticeDays: number;
  depositRefundWorkDays: number;
  electronicNoticeHours: number;
  // 附件五:费用规则文本(ContractSettings,默认"以实际发生为准")
  waterFeeRule: string;
  electricityFeeRule: string;
  gasFeeRule: string;
  otherFeeRule: string;
  // 甲方发起签署日期(签署页展示)
  launchDate: Date | string;
  // 补充条款(保留现有能力,正文末尾展示)
  extraTerms?: string;
}
