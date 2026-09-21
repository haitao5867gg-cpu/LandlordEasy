import { ContractPdfService } from './contract-pdf.service';
import { ContractPdfData, ContractPdfData as Data } from './contract-pdf.types';
import { numberToChineseUppercase } from './number-to-chinese-uppercase';
import { buildContractHtml } from './contract-pdf.template';

jest.setTimeout(60_000);

function baseData(): Data {
  return {
    contractNumber: 'LD-2026-0990',
    landlordName: '测试甲方',
    landlordIdCard: '110101198001010011',
    landlordPhone: '13800000001',
    tenantName: '测试乙方',
    tenantIdCard: '110101199001010022',
    tenantPhone: '13800000002',
    propertyAddress: '上海市嘉定区鸿翼人才公寓Q栋101室',
    leaseStartDate: '2026-09-21',
    leaseEndDate: '2027-09-20',
    monthlyRent: 2_200.5,
    paymentCycle: 'MONTHLY',
    depositAmount: 2_200,
    payeeName: '占秀英',
    advancePaymentDays: 3,
    handoverDate: '2026-09-21',
    checklist: [],
    coOccupants: [],
    penaltyMonths: 1,
    overdueToleranceDays: 5,
    cleaningFee: 110,
    renewalNoticeDays: 30,
    continuousStayDays: 30,
    cumulativeStayDays: 90,
    abandonedPropertyDays: 30,
    nonRenewalNoticeDays: 30,
    earlyTerminationNoticeDays: 30,
    depositRefundWorkDays: 3,
    electronicNoticeHours: 24,
    maxOccupantsPerRoom: 2,
    rentOverdueTerminateDays: 15,
    disguisedSubletDays: 15,
    waterFeeRule: '以实际发生为准',
    electricityFeeRule: '以实际发生为准',
    otherFeeRule: '以实际发生为准',
    launchDate: '2026-09-20',
    extraTerms: '',
  };
}

describe('numberToChineseUppercase', () => {
  it.each([
    [0, '零元整'],
    [100, '壹佰元整'],
    [1_000, '壹仟元整'],
    [2_200.5, '贰仟贰佰元伍角'],
    [12.34, '壹拾贰元叁角肆分'],
    [50_001.06, '伍万零壹元零陆分'],
    [100_000_000.01, '壹亿元零壹分'],
  ])('把 %s 转换为 %s', (amount, expected) => {
    expect(numberToChineseUppercase(amount)).toBe(expected);
  });

  it('拒绝负数和非有限数字', () => {
    expect(() => numberToChineseUppercase(-1)).toThrow(RangeError);
    expect(() => numberToChineseUppercase(Number.NaN)).toThrow(RangeError);
  });
});

describe('ContractPdfService(M22 新模板)', () => {
  it('同住人超8人:附件二截断但正文摘要用真实人数(评审P2#3)', () => {
    const data = {
      ...baseData(),
      coOccupants: Array.from({ length: 12 }, (_, i) => ({
        name: `同住人${i + 1}号`,
        idCard: '310101199001011234',
        phone: '13800001111',
      })),
    };
    const html = buildContractHtml(data, numberToChineseUppercase(data.monthlyRent));
    expect(html).toContain('共12人，详见附件二');
    expect(html).not.toContain('共8人');
  });

  it('同名重复物品:第一条进标准行,第二条不丢失进"其他"(评审P2#3)', () => {
    const data = {
      ...baseData(),
      checklist: [
        { item: '空调', quantity: 1, condition: '完好' },
        { item: '空调', quantity: 1, condition: '卧室另一台' },
        { item: '智能门锁', quantity: 1, condition: '完好' },
      ],
    };
    const html = buildContractHtml(data, numberToChineseUppercase(data.monthlyRent));
    // 第一条空调被标准行消费;第二条必须出现在"其他"汇总里,不允许静默消失
    expect(html).toContain('空调×1；智能门锁×1');
  });

  it('生成带 PDF 文件头的非空 Buffer', async () => {
    const pdf = await new ContractPdfService().generate(baseData());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it.each([
    ['空清单无同住人', baseData()],
    [
      '满清单+同住人+长姓名+补充条款',
      {
        ...baseData(),
        tenantName: '欧阳龙傲天炸裂职业生涯测试超长姓名',
        checklist: [
          { item: '空调', quantity: 1, condition: '完好' },
          { item: '热水器', quantity: 1, condition: '新' },
          { item: '床', quantity: 1, condition: '完好' },
          { item: '智能门锁', quantity: 1, condition: '完好' },
          { item: '扫地机器人', quantity: 2, condition: '备注很长很长很长很长很长很长' },
        ],
        coOccupants: [
          { name: '张同住', idCard: '310101199001015678', phone: '13800001111' },
          { name: '李同住', idCard: '310101199001015678', phone: '13800002222' },
        ],
        extraTerms: '乙方承诺不饲养宠物；如需安装额外电器须事先告知甲方并承担相应电费。',
      },
    ],
    [
      '同住人超8人截断',
      {
        ...baseData(),
        coOccupants: Array.from({ length: 12 }, (_, i) => ({
          name: `同住人${i + 1}号`,
          idCard: '310101199001011234',
          phone: '13800001111',
        })),
      },
    ],
  ])('页数确定性:模板固定9页(%s)', async (_name, data) => {
    const html = buildContractHtml(data, numberToChineseUppercase(data.monthlyRent));
    // HTML 层:固定9个 .page 分节(2026-09-22新合同:正文3+附件5+签署页1)
    expect((html.match(/class="page/g) ?? []).length).toBe(9);
    const pdf = await new ContractPdfService().generate(data);
    // PDF 层:根 /Pages 的 /Count 必须是8(Chrome 未压缩该对象;若压缩则退化断言文件头)
    const text = pdf.toString('latin1');
    const counts = [...text.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...counts)).toBe(9);
  });
});
