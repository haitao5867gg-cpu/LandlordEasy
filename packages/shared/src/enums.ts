/** 房间状态 */
export enum RoomStatus {
  VACANT = 'VACANT',
  RENTED = 'RENTED',
  MAINTENANCE = 'MAINTENANCE',
}

/** 租约状态 */
export enum LeaseStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

/** 付款周期 */
export enum PayCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

/** 账单状态 */
export enum BillStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELED = 'CANCELED',
}

/** 账单费用项类型 */
export enum BillItemType {
  RENT = 'RENT',
  FEE = 'FEE',
  LATE_FEE = 'LATE_FEE',
  OTHER = 'OTHER',
}

/** 支付渠道 */
export enum PaymentChannel {
  QRCODE = 'QRCODE',
  WECHATPAY = 'WECHATPAY',
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
}

/** 支付状态 */
export enum PaymentStatus {
  PENDING_CONFIRM = 'PENDING_CONFIRM',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

/** 押金记录类型 */
export enum DepositType {
  RECEIVE = 'RECEIVE',
  REFUND = 'REFUND',
  DEDUCT = 'DEDUCT',
}

/** 交接类型 */
export enum HandoverType {
  CHECKIN = 'CHECKIN',
  CHECKOUT = 'CHECKOUT',
}

/** 提醒类型 */
export enum ReminderType {
  PRE = 'PRE',
  DUE = 'DUE',
  OVERDUE = 'OVERDUE',
}

/** 微信模式 */
export enum WechatMode {
  MOCK = 'mock',
  REAL = 'real',
}
