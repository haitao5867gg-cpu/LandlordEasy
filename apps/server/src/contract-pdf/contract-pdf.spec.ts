import { ContractPdfService } from './contract-pdf.service';
import { ContractPdfData } from './contract-pdf.types';
import { numberToChineseUppercase } from './number-to-chinese-uppercase';

jest.setTimeout(30_000);

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

describe('ContractPdfService', () => {
  it('使用真实 Puppeteer 生成带 PDF 文件头的非空 Buffer', async () => {
    const data: ContractPdfData = {
      landlordName: '测试甲方',
      landlordIdCard: '110101198001010011',
      landlordPhone: '13800000001',
      tenantName: '测试乙方',
      tenantIdCard: '110101199001010022',
      tenantPhone: '13800000002',
      propertyAddress: '测试市测试区测试街道 1 号 101 室',
      leaseStartDate: '2026-09-01',
      leaseEndDate: '2027-08-31',
      monthlyRent: 2_200.5,
      paymentCycle: '季付',
      depositAmount: 2_200,
      penaltyMonths: 1,
      overdueToleranceDays: 5,
      cleaningFee: 110,
      renewalNoticeDays: 30,
      electricityMeterReading: 123.4,
      waterMeterReading: 56.7,
      facilities: {
        airConditioner: true,
        refrigerator: true,
        washingMachine: true,
        waterHeater: true,
        gasStove: false,
        television: false,
        shower: true,
        rangeHood: true,
        bed: true,
        table: true,
        chair: true,
        sofa: false,
      },
      extraTerms: '除本合同约定外，无其他补充条款。',
      contractNumber: 'M19-TEST-001',
    };

    const pdf = await new ContractPdfService().generate(data);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
