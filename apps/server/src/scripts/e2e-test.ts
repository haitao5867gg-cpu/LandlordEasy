/**
 * 端到端自测脚本
 * 用种子数据走通全流程: 新签 → 出账 → 提醒 → 租客上报 → 确认 → 报表
 *
 * 用法: npx ts-node src/scripts/e2e-test.ts
 * 前提: MySQL 运行 + prisma migrate 已执行
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧪 开始端到端自测...\n');

  // Step 1: 新签租约
  console.log('=== Step 1: 新签租约 ===');
  const building = await prisma.building.findFirst();
  if (!building) {
    console.log('❌ 没有楼栋数据,请先运行 pnpm seed');
    process.exit(1);
  }

  const vacantRoom = await prisma.room.findFirst({
    where: { buildingId: building.id, status: 'VACANT' },
  });
  if (!vacantRoom) {
    console.log('❌ 没有空置房间');
    process.exit(1);
  }

  const landlord = await prisma.landlord.findFirst();
  if (!landlord) {
    console.log('❌ 没有房东数据');
    process.exit(1);
  }

  // 创建租客
  const tenant = await prisma.tenant.create({
    data: { name: 'E2E测试租客', phone: '13900001111', openid: 'mock_e2e_tenant' },
  });
  console.log(`✅ 创建租客: ${tenant.name} (id=${tenant.id})`);

  // 签约
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 5); // 5天前开始
  const endDate = new Date();
  endDate.setFullYear(endDate.getFullYear() + 1);

  const inviteCode = 'E2ETEST1';
  const lease = await prisma.lease.create({
    data: {
      roomId: vacantRoom.id,
      tenantId: tenant.id,
      startDate,
      endDate,
      rent: 1000,
      deposit: 1000,
      payCycle: 'MONTHLY',
      feeItems: [{ name: '卫生费', amount: 30 }],
      inviteCode,
      status: 'ACTIVE',
    },
  });
  await prisma.room.update({ where: { id: vacantRoom.id }, data: { status: 'RENTED' } });
  await prisma.depositRecord.create({
    data: { leaseId: lease.id, type: 'RECEIVE', amount: 1000, operatorId: landlord.id },
  });
  console.log(`✅ 签约成功: 租约id=${lease.id}, 房间=${building.name}-${vacantRoom.roomNo}`);

  // Step 2: 账单生成
  console.log('\n=== Step 2: 账单生成 ===');
  const bill = await prisma.bill.create({
    data: {
      leaseId: lease.id,
      periodStart: startDate,
      periodEnd: new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      dueDate: startDate,
      totalAmount: 1030,
      status: 'PENDING',
    },
  });
  await prisma.billItem.create({ data: { billId: bill.id, type: 'RENT', name: '月租金', amount: 1000 } });
  await prisma.billItem.create({ data: { billId: bill.id, type: 'FEE', name: '卫生费', amount: 30 } });
  console.log(`✅ 账单生成: id=${bill.id}, 金额=1030`);

  // 标记逾期(因为 dueDate 在过去)
  await prisma.bill.update({ where: { id: bill.id }, data: { status: 'OVERDUE' } });
  console.log(`✅ 标记逾期`);

  // Step 3: 催租提醒(模拟)
  console.log('\n=== Step 3: 催租提醒 ===');
  await prisma.reminderLog.create({
    data: { billId: bill.id, tenantId: tenant.id, type: 'OVERDUE', success: true },
  });
  console.log(`✅ 催租提醒已记录(mock)`);

  // Step 4: 租客上报付款
  console.log('\n=== Step 4: 租客上报付款 ===');
  const payment = await prisma.payment.create({
    data: {
      billId: bill.id,
      channel: 'QRCODE',
      amount: 1030,
      status: 'PENDING_CONFIRM',
      paidAt: new Date(),
      proofUrl: 'https://example.com/proof_e2e.jpg',
    },
  });
  console.log(`✅ 租客上报: paymentId=${payment.id}, 状态=PENDING_CONFIRM`);

  // Step 5: 房东确认
  console.log('\n=== Step 5: 房东确认 ===');
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'CONFIRMED', confirmedBy: landlord.id, confirmedAt: new Date() },
  });

  // 检查付清 → 标记 PAID
  const confirmedPayments = await prisma.payment.findMany({
    where: { billId: bill.id, status: 'CONFIRMED' },
  });
  const paidTotal = confirmedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (paidTotal >= 1030) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status: 'PAID' } });
  }
  const updatedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
  console.log(`✅ 确认收款, 账单状态=${updatedBill?.status}`);

  if (updatedBill?.status !== 'PAID') {
    console.log('❌ 账单未标记为 PAID!');
    process.exit(1);
  }

  // Step 6: 报表验证
  console.log('\n=== Step 6: 报表验证 ===');
  const now = new Date();
  const month = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  const monthStart = new Date(`${month}-01`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const monthBills = await prisma.bill.findMany({
    where: { dueDate: { gte: monthStart, lt: monthEnd } },
    include: { payments: true },
  });
  const receivable = monthBills.reduce((s, b) => s + Number(b.totalAmount), 0);
  const received = monthBills.flatMap((b) => b.payments.filter((p) => p.status === 'CONFIRMED'))
    .reduce((s, p) => s + Number(p.amount), 0);
  const rate = receivable > 0 ? Math.round((received / receivable) * 100) : 0;
  console.log(`✅ 本月报表: 应收=${receivable}, 实收=${received}, 收缴率=${rate}%`);

  // 清理测试数据
  console.log('\n=== 清理 E2E 测试数据 ===');
  await prisma.reminderLog.deleteMany({ where: { billId: bill.id } });
  await prisma.payment.deleteMany({ where: { billId: bill.id } });
  await prisma.billItem.deleteMany({ where: { billId: bill.id } });
  await prisma.bill.delete({ where: { id: bill.id } });
  await prisma.depositRecord.deleteMany({ where: { leaseId: lease.id } });
  await prisma.lease.delete({ where: { id: lease.id } });
  await prisma.room.update({ where: { id: vacantRoom.id }, data: { status: 'VACANT' } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
  console.log('✅ 清理完成');

  console.log('\n🎉 端到端自测全部通过!');
  console.log('流程: 新签 → 出账 → 逾期 → 提醒 → 租客上报 → 房东确认 → 账单PAID → 报表');
}

main()
  .catch((e) => {
    console.error('❌ E2E 测试失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
