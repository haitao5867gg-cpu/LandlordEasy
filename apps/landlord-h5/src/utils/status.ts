/** 状态中文映射 */

export const roomStatusMap: Record<string, string> = {
  VACANT: '空置',
  RENTED: '已租',
  MAINTENANCE: '维修中',
};

export const billStatusMap: Record<string, string> = {
  PENDING: '待付',
  PAID: '已付',
  OVERDUE: '逾期',
  CANCELED: '已取消',
};

export const paymentStatusMap: Record<string, string> = {
  PENDING_CONFIRM: '待确认',
  CONFIRMED: '已确认',
  REJECTED: '已驳回',
};

export const paymentChannelMap: Record<string, string> = {
  QRCODE: '收款码',
  WECHATPAY: '微信支付',
  CASH: '现金',
  TRANSFER: '转账',
};

export const leaseStatusMap: Record<string, string> = {
  ACTIVE: '在租',
  ENDED: '已退租',
};

export const payCycleMap: Record<string, string> = {
  MONTHLY: '月付',
  QUARTERLY: '季付',
  YEARLY: '年付',
};
