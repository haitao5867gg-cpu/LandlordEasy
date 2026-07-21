import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

async function main() {
  console.log('🌱 开始填充种子数据...');

  // 清理已有数据(开发环境)
  await prisma.auditLog.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.handoverRecord.deleteMany();
  await prisma.depositRecord.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.billItem.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.room.deleteMany();
  await prisma.roomType.deleteMany();
  await prisma.building.deleteMany();
  await prisma.landlord.deleteMany();

  // 房东(3位)
  const landlords = await Promise.all([
    prisma.landlord.create({ data: { openid: 'mock_landlord_001', name: '张大海' } }),
    prisma.landlord.create({ data: { openid: 'mock_landlord_002', name: '张小明' } }),
    prisma.landlord.create({ data: { openid: 'mock_landlord_003', name: '张丽华' } }),
  ]);
  console.log(`✅ 创建 ${landlords.length} 位房东`);

  // 4栋楼
  const buildings = await Promise.all([
    prisma.building.create({ data: { name: 'A栋', sort: 1 } }),
    prisma.building.create({ data: { name: 'B栋', sort: 2 } }),
    prisma.building.create({ data: { name: 'C栋', sort: 3 } }),
    prisma.building.create({ data: { name: 'D栋', sort: 4 } }),
  ]);
  console.log(`✅ 创建 ${buildings.length} 栋楼`);

  // 3种房型
  const roomTypes = await Promise.all([
    prisma.roomType.create({
      data: {
        name: '标准单间',
        description: '约20㎡,独立卫浴,配基本家具',
        defaultRent: 800,
        defaultDeposit: 800,
        defaultPayCycle: 'MONTHLY',
        defaultFeeItems: JSON.parse('[{"name":"卫生费","amount":30}]'),
        furnitureList: JSON.parse('["床","衣柜","桌椅","热水器","空调"]'),
      },
    }),
    prisma.roomType.create({
      data: {
        name: '大单间',
        description: '约30㎡,独立卫浴+阳台,配齐家具家电',
        defaultRent: 1200,
        defaultDeposit: 1200,
        defaultPayCycle: 'MONTHLY',
        defaultFeeItems: JSON.parse('[{"name":"卫生费","amount":30}]'),
        furnitureList: JSON.parse('["床","衣柜","桌椅","热水器","空调","冰箱","洗衣机"]'),
      },
    }),
    prisma.roomType.create({
      data: {
        name: '一室一厅',
        description: '约45㎡,独立客厅+卧室+卫浴+阳台',
        defaultRent: 1800,
        defaultDeposit: 1800,
        defaultPayCycle: 'MONTHLY',
        defaultFeeItems: JSON.parse('[{"name":"卫生费","amount":30},{"name":"停车费","amount":100}]'),
        furnitureList: JSON.parse('["床","衣柜","桌椅","沙发","茶几","热水器","空调","冰箱","洗衣机","电视"]'),
      },
    }),
  ]);
  console.log(`✅ 创建 ${roomTypes.length} 种房型`);

  // 300间房(每栋75间,6层,每层12-13间)
  const rooms: { id: number; buildingId: number }[] = [];
  for (const building of buildings) {
    for (let floor = 1; floor <= 6; floor++) {
      const roomsPerFloor = floor <= 5 ? 13 : 12; // 最高层少1间 = 75间/栋
      for (let num = 1; num <= roomsPerFloor; num++) {
        const roomNo = `${floor}${num.toString().padStart(2, '0')}`;
        // 按比例分配房型: 60%标准单间, 30%大单间, 10%一室一厅
        let roomTypeId: number;
        const rand = Math.random();
        if (rand < 0.6) roomTypeId = roomTypes[0].id;
        else if (rand < 0.9) roomTypeId = roomTypes[1].id;
        else roomTypeId = roomTypes[2].id;

        const room = await prisma.room.create({
          data: {
            buildingId: building.id,
            roomNo,
            floor,
            roomTypeId,
            status: 'VACANT',
          },
        });
        rooms.push({ id: room.id, buildingId: building.id });
      }
    }
  }
  console.log(`✅ 创建 ${rooms.length} 间房`);

  // 30份在租租约 + 租客
  const leaseCount = 30;
  const selectedRooms = rooms.sort(() => Math.random() - 0.5).slice(0, leaseCount);

  for (let i = 0; i < leaseCount; i++) {
    const room = selectedRooms[i];
    const tenant = await prisma.tenant.create({
      data: {
        name: `租客${(i + 1).toString().padStart(3, '0')}`,
        phone: `138${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      },
    });

    const startDate = randomDate(new Date('2025-06-01'), new Date('2026-06-01'));
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const rent = [800, 1000, 1200, 1500, 1800][Math.floor(Math.random() * 5)];

    const lease = await prisma.lease.create({
      data: {
        roomId: room.id,
        tenantId: tenant.id,
        startDate,
        endDate,
        rent,
        deposit: rent,
        payCycle: 'MONTHLY',
        feeItems: JSON.parse('[{"name":"卫生费","amount":30}]'),
        status: 'ACTIVE',
        inviteCode: generateInviteCode(),
      },
    });

    // 更新房间状态
    await prisma.room.update({
      where: { id: room.id },
      data: { status: 'RENTED' },
    });

    // 押金记录
    await prisma.depositRecord.create({
      data: {
        leaseId: lease.id,
        type: 'RECEIVE',
        amount: rent,
        operatorId: landlords[Math.floor(Math.random() * 3)].id,
      },
    });

    // 生成历史账单(最近3期)
    for (let period = 0; period < 3; period++) {
      const periodStart = new Date(startDate);
      periodStart.setMonth(periodStart.getMonth() + period);
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      periodEnd.setDate(periodEnd.getDate() - 1);

      if (periodStart > new Date()) break; // 不生成未来账单

      const bill = await prisma.bill.create({
        data: {
          leaseId: lease.id,
          periodStart,
          periodEnd,
          dueDate: periodStart,
          status: period < 2 ? 'PAID' : 'PENDING',
          totalAmount: rent + 30, // 租金 + 卫生费
        },
      });

      await prisma.billItem.create({
        data: { billId: bill.id, type: 'RENT', name: '月租金', amount: rent },
      });
      await prisma.billItem.create({
        data: { billId: bill.id, type: 'FEE', name: '卫生费', amount: 30 },
      });

      // 已付账单创建支付记录
      if (period < 2) {
        await prisma.payment.create({
          data: {
            billId: bill.id,
            channel: ['QRCODE', 'CASH', 'TRANSFER'][Math.floor(Math.random() * 3)],
            amount: rent + 30,
            status: 'CONFIRMED',
            paidAt: new Date(periodStart.getTime() + Math.random() * 5 * 24 * 60 * 60 * 1000),
            confirmedBy: landlords[Math.floor(Math.random() * 3)].id,
            confirmedAt: new Date(
              periodStart.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000,
            ),
          },
        });
      }
    }
  }
  console.log(`✅ 创建 ${leaseCount} 份在租租约(含租客、押金、历史账单)`);

  console.log('🎉 种子数据填充完成!');
}

main()
  .catch((e) => {
    console.error('种子脚本执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
