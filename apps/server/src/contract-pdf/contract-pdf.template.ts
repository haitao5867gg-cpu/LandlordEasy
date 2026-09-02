import { ContractFacilities, ContractPdfData } from './contract-pdf.types';

const FACILITIES: Array<[keyof ContractFacilities, string]> = [
  ['airConditioner', '空调'],
  ['refrigerator', '冰箱'],
  ['washingMachine', '洗衣机'],
  ['waterHeater', '热水器'],
  ['gasStove', '燃气灶'],
  ['television', '电视'],
  ['shower', '淋浴器'],
  ['rangeHood', '油烟机'],
  ['bed', '床'],
  ['table', '桌子'],
  ['chair', '椅子'],
  ['sofa', '沙发'],
];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: Date | string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
  }
  const matched = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return matched
    ? `${matched[1]}年${Number(matched[2])}月${Number(matched[3])}日`
    : String(value);
}

function parseDate(value: Date | string): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const matched = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!matched) return undefined;
  return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
}

function calculateLeaseYears(startValue: Date | string, endValue: Date | string): string {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end || end < start) return '';
  const inclusiveDays = (end.getTime() - start.getTime()) / 86_400_000 + 1;
  const years = inclusiveDays / 365.2425;
  const nearestInteger = Math.round(years);
  return Math.abs(years - nearestInteger) < 0.02
    ? String(nearestInteger)
    : years.toFixed(2).replace(/\.00$/, '');
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function field(value: unknown, width: string, className = ''): string {
  return `<span class="field ${className}" style="width:${width}">${escapeHtml(value)}</span>`;
}

export function buildContractHtml(data: ContractPdfData, rentUppercase: string): string {
  const startDate = formatDate(data.leaseStartDate);
  const endDate = formatDate(data.leaseEndDate);
  const rent = formatAmount(data.monthlyRent);
  const deposit = formatAmount(data.depositAmount);
  const facilities = FACILITIES.map(
    ([key, label]) => `<span class="facility">${escapeHtml(label)}（${data.facilities[key] ? '✓' : '　'}）</span>`,
  ).join('');
  const meter = (value: number | undefined, empty = '') =>
    value === undefined ? empty : formatAmount(value);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 210mm; margin: 0; padding: 0; }
  body { color: #111; font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 9.2px; line-height: 1.38; }
  .page { position: relative; width: 210mm; height: 297mm; padding: 8mm 11mm; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  h1 { height: 11mm; margin: 0; text-align: center; font-family: SimSun, "Songti SC", "Noto Serif CJK SC", serif; font-size: 20px; letter-spacing: 4px; line-height: 11mm; }
  h2 { height: 14mm; margin: 0; text-align: center; font-family: SimSun, "Songti SC", "Noto Serif CJK SC", serif; font-size: 19px; letter-spacing: 2px; line-height: 14mm; }
  .contract-no { position: absolute; top: 8mm; right: 11mm; width: 48mm; height: 6mm; overflow: hidden; white-space: nowrap; text-align: right; font-size: 9px; }
  .field { display: inline-block; height: 4.5mm; line-height: 4.5mm; padding: 0 1mm; overflow: hidden; white-space: nowrap; text-overflow: clip; vertical-align: bottom; border-bottom: .25mm solid #333; }
  .party { height: 6mm; overflow: hidden; white-space: nowrap; }
  .parties { height: 14mm; }
  .intro { height: 11mm; overflow: hidden; text-indent: 2em; }
  .clause { overflow: hidden; }
  .clause-title { font-weight: 700; }
  .clause p { margin: 0; text-indent: 2em; }
  .clause-1 { height: 16mm; }
  .clause-2 { height: 9mm; }
  .clause-3 { height: 43mm; }
  .clause-4 { height: 31mm; }
  .clause-5 { height: 23mm; }
  .clause-6 { height: 43mm; }
  .facilities { display: inline-block; width: 153mm; height: 8mm; overflow: hidden; vertical-align: top; }
  .facility { display: inline-block; width: 25.4mm; height: 4mm; white-space: nowrap; }
  .signature-grid { height: 21mm; display: grid; grid-template-columns: 1fr 1fr; gap: 13mm; padding-top: 2mm; }
  .signature-box { position: relative; height: 18mm; border-top: .25mm solid #999; padding-top: 2mm; overflow: hidden; }
  .signature-date { position: absolute; left: 0; bottom: 0; }
  .receipt { height: 30mm; border-top: .3mm solid #333; padding-top: 1.5mm; overflow: hidden; }
  .receipt-title { height: 6mm; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
  .receipt-line { height: 5mm; overflow: hidden; white-space: nowrap; }
  .commitment-intro { height: 14mm; overflow: hidden; text-indent: 2em; }
  .commitments { height: 214mm; overflow: hidden; }
  .commitment { height: 23.2mm; margin: 0; overflow: hidden; text-indent: 2em; font-size: 11px; line-height: 1.7; }
  .commitment-signature { position: absolute; right: 14mm; bottom: 15mm; width: 72mm; height: 24mm; padding-top: 2mm; border-top: .25mm solid #999; font-size: 11px; }
  .blank-sign { display: inline-block; width: 42mm; height: 10mm; vertical-align: bottom; }
</style>
</head>
<body>
<section class="page contract-page">
  <div class="contract-no">No. ${field(data.contractNumber ?? '', '30mm')}</div>
  <h1>房屋租赁合同</h1>
  <div class="parties">
    <div class="party">出租人（甲方）：${field(data.landlordName, '31mm')} 身份证号：${field(data.landlordIdCard, '54mm')} 电话：${field(data.landlordPhone, '35mm')}</div>
    <div class="party">承租人（乙方）：${field(data.tenantName, '31mm')} 身份证号：${field(data.tenantIdCard, '54mm')} 电话：${field(data.tenantPhone, '35mm')}</div>
  </div>
  <div class="intro">根据《中华人民共和国民法典》、《中华人民共和国城市房地产管理法》及其他有关法律规定，在平等、自愿、协商一致的基础上，甲、乙双方就下列房屋的租赁达成如下协议：</div>

  <div class="clause clause-1"><span class="clause-title">第一条　房屋基本情况</span><p>因乙方居住需求，甲方现将坐落于${field(data.propertyAddress, '93mm')}的房屋（用途：☑住宅 □合仓 □办公室）出租给乙方使用。甲方必须保证该房屋权属清晰，同时保证乙方租赁期内对该房屋的使用权。</p></div>
  <div class="clause clause-2"><span class="clause-title">第二条　租赁期限</span><p>租用期限从${field(startDate, '34mm')}至${field(endDate, '34mm')}，租期${field(calculateLeaseYears(data.leaseStartDate, data.leaseEndDate), '12mm')}年。</p></div>
  <div class="clause clause-3"><span class="clause-title">第三条　租金约定</span>
    <p>1. 该房屋月租金人民币${field(rentUppercase, '48mm')}（小写：${field(rent, '20mm')}元），该租金不含税费，相关税费由承租人另行承担，租金按${field(data.paymentCycle, '15mm')}支付，乙方负责在每次房租到期前3天缴纳下次房租给甲方。如乙方拖欠租金超过${field(data.overdueToleranceDays, '9mm')}天，甲方有权通知乙方立即解除合同，乙方应向甲方赔偿${field(data.penaltyMonths, '9mm')}个月租金作为违约金。房间内的物品由甲方进行打包清理，费用由乙方承担。</p>
    <p>2. 租赁期内水、电、燃气、网络、暖气、物业、卫生等费用均由乙方承担，乙方预付押金${field(deposit, '20mm')}元整。等租赁期满，甲乙双方结清所有费用后，多余押金退还乙方，押金不计利息。</p>
    <p>3. 租赁期间乙方不得中途退房，如需退房，需提前一个月通知甲方，并赔偿甲方${field(data.penaltyMonths, '9mm')}个月的房屋租金作为违约金。</p>
  </div>
  <div class="clause clause-4"><span class="clause-title">第四条　房屋安全管理、双方权利与义务</span>
    <p>1. 乙方不得在房屋内、楼道或其他公共区域为电动车及其电池充电，不得私拉电线；因违规充电造成的一切损失和法律责任由乙方承担。</p>
    <p>2. 乙方不得利用承租房屋从事违法经营及其他违法犯罪活动，由此产生的一切后果由乙方自行承担，甲方有权立即解除合同。</p>
    <p>3. 租赁期间乙方应妥善使用水、电、燃气及室内设施，做好防火、防盗等安全工作；因乙方使用、管理不当造成的人身或财产损失由乙方自行承担。</p>
    <p>4. 因城市规划、拆迁、征收等不可归责于甲乙双方的原因致使合同无法继续履行的，本合同终止，双方按实际使用期间结清租金及各项费用。</p>
  </div>
  <div class="clause clause-5"><span class="clause-title">第五条　违约责任</span>
    <p>1. 未经甲方书面同意，乙方不得擅自改动房屋主体结构及固定设施；造成损坏的，应负责恢复原状或照价赔偿。</p>
    <p>2. 未经甲方书面同意，乙方不得将房屋转租、转借或变相交由他人使用，否则甲方有权解除合同并追究乙方违约责任。</p>
    <p>3. 甲方无正当理由提前收回房屋的，应退还乙方剩余租金和押金，并按一个月房屋租金向乙方承担违约责任。</p>
  </div>
  <div class="clause clause-6"><span class="clause-title">第六条　其他条款</span>
    <p>1. 租赁期满或解除后，退房清洁费${field(formatAmount(data.cleaningFee), '16mm')}元，乙方遗留物品视为丢弃，由甲方自行处置。</p>
    <p>2. 乙方需要续租的，应提前${field(data.renewalNoticeDays, '10mm')}天向甲方提出，经双方协商一致后另行续签。</p>
    <p>3. 自租房日起电表底数${field(meter(data.electricityMeterReading), '18mm')}；水表底数${field(meter(data.waterMeterReading), '18mm')}；天然气底数${field(meter(data.gasMeterReading, '无'), '18mm')}。</p>
    <p>4. 屋内主要设施：<span class="facilities">${facilities}</span></p>
    <p>5. 其他补充条款：${field(data.extraTerms ?? '', '147mm')}</p>
    <p>6. 本合同附件与正文具有同等法律效力；合同一式两份，甲、乙双方各执一份；因履行本合同发生争议，协商不成的，由甲方所在地人民法院管辖。</p>
  </div>

  <div class="signature-grid">
    <div class="signature-box">甲方签字（按手印）：<span class="blank-sign"></span><div class="signature-date">日期：　　　　年　　月　　日</div></div>
    <div class="signature-box">乙方签字（按手印）：<span class="blank-sign"></span><div class="signature-date">日期：　　　　年　　月　　日</div></div>
  </div>
  <div class="receipt">
    <div class="receipt-title">房屋租金／押金收据</div>
    <div class="receipt-line">收到承租人从${field(startDate, '33mm')}至${field(endDate, '33mm')}房屋租金人民币大写${field(rentUppercase, '42mm')}。</div>
    <div class="receipt-line">小写：${field(rent, '24mm')}元，另收押金${field(deposit, '24mm')}元整（押金不计利息），特此收据。</div>
    <div class="receipt-line">收款人签字：<span class="blank-sign"></span>日期：　　　　年　　月　　日</div>
  </div>
</section>

<section class="page commitment-page">
  <h2>租赁房屋安全责任承诺书</h2>
  <div class="commitment-intro">为保障租赁房屋及居住人员安全，承诺人已认真阅读房屋租赁合同及本承诺书，自愿作出如下承诺，并承担违反承诺所产生的全部责任：</div>
  <div class="commitments">
    <p class="commitment">一、严格履行房屋租赁合同及物业管理相关约定，自觉接受出租人和有关管理部门依法进行的安全检查，对发现的安全隐患及时整改。</p>
    <p class="commitment">二、安全、节约用水，不擅自改装供水管线和用水设施；离开房屋时检查并关闭水龙头和总阀，因使用不当造成漏水、浸水等损失的，自愿承担相应责任。</p>
    <p class="commitment">三、安全用电，不私拉乱接电线，不超负荷使用电器，不使用不合格电器；严禁在室内、楼道及公共区域为电动车或电池充电，离开房屋时关闭不必要的电源。</p>
    <p class="commitment">四、安全用气，正确使用燃气灶具及燃气设施，保持通风，不擅自拆改燃气管线；发现泄漏立即关闭阀门、开窗通风并联系专业人员处理，严禁动用明火。</p>
    <p class="commitment">五、保持室内及公共区域环境卫生，生活垃圾按规定分类、投放，不在楼道堆放杂物，不占用或堵塞消防通道、安全出口。</p>
    <p class="commitment">六、爱护房屋主体结构、装修和配套设施，不擅自拆改、损坏；发现设施故障或安全隐患及时告知出租人，因故意或使用不当造成损坏的负责修复或赔偿。</p>
    <p class="commitment">七、遵守社会公德，文明居住，不制造影响他人正常生活的噪声，不酗酒滋事，不与邻里发生恶意冲突，共同维护良好居住秩序。</p>
    <p class="commitment">八、严禁高空抛物，不攀爬、翻越窗户、阳台及公共区域护栏；妥善照看未成年人及其他需要照护的人员，防止坠落等安全事故。</p>
    <p class="commitment">九、遵守国家法律法规，不在房屋内存放易燃、易爆、有毒、管制器具及其他违禁物品，不利用房屋从事违法犯罪活动；违反本承诺造成的一切后果由承诺人承担。</p>
  </div>
  <div class="commitment-signature">承诺人签字：<span class="blank-sign"></span><br>日期：　　　　年　　月　　日</div>
</section>
</body>
</html>`;
}
