import { NotifyPayload } from '../wechat/wechat-notify.interface';

interface RentReminderBill {
  id: number;
  totalAmount: unknown;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  lease: {
    room: {
      roomNo: string;
      building: {
        name: string;
        property: { name: string };
      };
    };
  };
}

/** 租客端与 API 同站部署；去掉 API 前缀即可得到 H5 站点 origin。 */
export function buildTenantBillPayUrl(billId: number): string | undefined {
  const publicBaseUrl = process.env.SERVER_PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl) return undefined;

  const origin = publicBaseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${origin}/tenant/bills/${billId}/pay`;
}

export function buildRentReminderMessage(
  bill: RentReminderBill,
  openid: string,
  templateId: string,
): NotifyPayload {
  const room = bill.lease.room;
  const url = buildTenantBillPayUrl(bill.id);

  return {
    openid,
    templateId,
    ...(url ? { url } : {}),
    data: {
      amount3: { value: `${bill.totalAmount}` },
      time4: {
        value: `${bill.periodStart.toISOString().split('T')[0]}~${bill.periodEnd.toISOString().split('T')[0]}`,
      },
      thing5: { value: '房租账单' },
      thing7: {
        value: `${room.building.property.name}${room.building.name}${room.roomNo}`,
      },
      time10: { value: bill.dueDate.toISOString().split('T')[0] },
    },
  };
}
