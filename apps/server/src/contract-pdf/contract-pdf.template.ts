import { ChecklistEntry, ContractPdfData } from './contract-pdf.types';

/**
 * M22 新标准合同模板(定稿文本: specs/contract-template/FINAL-TEMPLATE.md)。
 *
 * 页数确定性(微签固定坐标盖章的前提):
 * - 全文固定 8 页,每页 .page 固定 210x297mm + overflow hidden(沿用旧模板技术);
 * - 物品清单固定 12 行、共同居住人固定 8 行,不随数据变长;
 * - 签署页固定为最后一页(第 8 页),甲方自动章与乙方手写签名坐标锚定该页
 *   (见 real-weiqian.service.ts 的 LAUNCHER/RECEIVER 坐标常量,改版式必须同步改)。
 */

// 附件三固定物品行(与 ContractSettings.defaultItemChecklist 的标准项一致;GasCan 2026-09-20 打勾式设计)
const CHECKLIST_ROWS = [
  '空调',
  '冰箱',
  '洗衣机',
  '热水器',
  '燃气灶／电磁炉',
  '油烟机',
  '电视',
  '床及床垫',
  '桌椅',
  '沙发',
  '钥匙／门禁卡',
];

const CO_OCCUPANT_ROWS = 8; // 附件二固定行数(GasCan:同住人独立一页承载)

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: Date | string | null): string {
  if (value === null || value === undefined || value === '') return '　';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
  }
  const matched = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return matched
    ? `${matched[1]}年${Number(matched[2])}月${Number(matched[3])}日`
    : String(value);
}

function formatAmount(amount: number | undefined): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return '　';
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function field(value: unknown, width: string): string {
  return `<span class="field" style="width:${width}">${escapeHtml(value)}</span>`;
}

/** 把交接记录的 checklist 映射到固定 12 行:标准行按名称匹配(互相包含),
 * 命中即消费;未消费条目(含同名重复的第2条、自定义物品)全部汇总进"其他"行,
 * 不允许任何条目从PDF里静默消失(2026-09-20 Claude评审P2#3)。 */
function mapChecklist(checklist: ChecklistEntry[]): Array<{ quantity: string; condition: string }> {
  const consumed = new Set<ChecklistEntry>();
  const matches = (label: string, item: string) =>
    item.trim() === label || label.includes(item.trim()) || item.trim().includes(label.replace('／', ''));
  const rows = CHECKLIST_ROWS.map((label) => {
    const hit = checklist.find((entry) => !consumed.has(entry) && matches(label, entry.item));
    if (!hit) return { quantity: '—', condition: '—' };
    consumed.add(hit);
    return {
      quantity: hit.quantity === null || hit.quantity === undefined ? '有' : String(hit.quantity),
      condition: hit.condition ? hit.condition : '完好',
    };
  });
  const others = checklist.filter((entry) => !consumed.has(entry));
  const otherText = others.map((o) => `${o.item}×${o.quantity ?? 1}`).join('；');
  rows.push({ quantity: '—', condition: otherText ? escapeHtml(otherText.slice(0, 60)) : '—' });
  return rows;
}

function payCycleLabel(cycle: string): string {
  const map: Record<string, string> = {
    MONTHLY: '月付',
    QUARTERLY: '季付',
    YEARLY: '年付',
  };
  return map[cycle] ?? cycle;
}

export function buildContractHtml(data: ContractPdfData, rentUppercase: string): string {
  const startDate = formatDate(data.leaseStartDate);
  const endDate = formatDate(data.leaseEndDate);
  const rent = formatAmount(data.monthlyRent);
  const deposit = formatAmount(data.depositAmount);
  const cleaningFee = formatAmount(data.cleaningFee);
  const meter = (value: number | undefined) =>
    value === undefined || value === null ? '未抄见' : formatAmount(value);
  const rows = mapChecklist(data.checklist ?? []);
  const allCoOccupants = data.coOccupants ?? [];
  // 截断进附件二,但正文摘要必须用真实人数——否则合同文本给出错误事实(评审P2#3)
  const coOccupants = allCoOccupants.slice(0, CO_OCCUPANT_ROWS);
  const coOccupantHeadline =
    allCoOccupants.length === 0 ? '无' : `共${allCoOccupants.length}人，详见附件二`;
  const coRows = Array.from({ length: CO_OCCUPANT_ROWS }, (_, i) => {
    const c = coOccupants[i];
    return `<tr><td class="idx">${i + 1}</td><td>${c ? escapeHtml(c.name) : ''}</td><td>${c ? escapeHtml(c.idCard) : ''}</td><td>${c ? escapeHtml(c.phone) : ''}</td></tr>`;
  }).join('');
  const extraTerms = (data.extraTerms ?? '').trim().slice(0, 200);
  const n = (v: number | undefined) => (v === undefined || v === null ? '　' : String(v));
  const handoverDate = formatDate(data.handoverDate);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 210mm; margin: 0; padding: 0; }
  body { color: #111; font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 9.2px; line-height: 1.55; }
  .page { position: relative; width: 210mm; height: 297mm; padding: 10mm 12mm; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  h1 { height: 12mm; margin: 0 0 2mm; text-align: center; font-family: SimSun, "Songti SC", "Noto Serif CJK SC", serif; font-size: 20px; letter-spacing: 4px; line-height: 12mm; }
  h2 { height: 12mm; margin: 0 0 3mm; text-align: center; font-family: SimSun, "Songti SC", "Noto Serif CJK SC", serif; font-size: 16px; letter-spacing: 2px; line-height: 12mm; }
  .contract-no { position: absolute; top: 10mm; right: 12mm; font-size: 9px; }
  .field { display: inline-block; height: 4.6mm; line-height: 4.6mm; padding: 0 1mm; overflow: hidden; white-space: nowrap; text-overflow: clip; vertical-align: bottom; border-bottom: .25mm solid #333; }
  .info-block { margin-bottom: 3mm; }
  .info-row { height: 5.6mm; overflow: hidden; white-space: nowrap; }
  .info-label { display: inline-block; width: 22mm; font-weight: 700; }
  .clause-title { font-weight: 700; }
  .clause p { margin: 0 0 1.2mm; text-indent: 2em; }
  .no-indent { text-indent: 0 !important; }
  .break-page-2 { height: 2mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: .3mm solid #555; padding: 1.2mm 2mm; text-align: center; font-weight: 400; overflow: hidden; }
  th { background: #f2f2f2; font-weight: 700; }
  .checklist td { height: 7.4mm; }
  .co-table td { height: 8.2mm; }
  .meters { margin: 2mm 0 3mm; }
  .meter-row { height: 6mm; }
  .note { font-size: 8.4px; color: #444; margin: 1.5mm 0 2mm; }
  .confirm-line { margin-top: 4mm; height: 6mm; }
  .sig-page-intro { text-indent: 2em; margin: 0 0 8mm; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 10mm; }
  .sig-block { min-height: 34mm; }
  .sig-block .sig-name { height: 6mm; white-space: nowrap; overflow: hidden; }
  .sig-block .sig-line { position: relative; margin-top: 20mm; height: 10mm; border-top: .25mm solid #999; font-size: 8.6px; color: #333; padding-top: 1mm; }
  .attachments-note { position: absolute; bottom: 12mm; left: 12mm; right: 12mm; font-size: 8.6px; color: #444; }
</style>
</head>
<body>

<!-- 第1页:信息区+第一~四条 -->
<section class="page">
  <div class="contract-no">合同编号：${field(data.contractNumber ?? '', '40mm')}</div>
  <h1>住房租赁合同</h1>
  <div class="info-block">
    <div class="info-row"><span class="info-label">出租人（甲方）</span>${field(data.landlordName, '34mm')}　身份证号：${field(data.landlordIdCard, '52mm')}　手机号：${field(data.landlordPhone, '34mm')}</div>
    <div class="info-row"><span class="info-label">承租人（乙方）</span>${field(data.tenantName, '34mm')}　身份证号：${field(data.tenantIdCard, '52mm')}　手机号：${field(data.tenantPhone, '34mm')}</div>
    <div class="info-row"><span class="info-label">共同居住人</span>${field(coOccupantHeadline, '60mm')}</div>
    <div class="info-row"><span class="info-label">租赁房屋</span>${field(data.propertyAddress, '92mm')}　出租范围：${field('房屋全部', '22mm')}</div>
    <div class="info-row"><span class="info-label">房屋用途</span>住宅。乙方仅可用于本人及本合同列明共同居住人的合法居住，不得用于经营、办公、仓储或其他非居住用途。</div>
    <div class="info-row"><span class="info-label">租赁期限</span>自${field(startDate, '30mm')}起至${field(endDate, '30mm')}止；交付时间：${field(startDate, '26mm')}；退还时间：届满日或合同解除日（以实际交接为准）。</div>
  </div>

  <div class="clause"><span class="clause-title">第一条　房屋基本情况与交付</span>
    <p>1. 甲方应于约定交付时间将符合居住使用条件的房屋交付乙方。双方以附件三《房屋及物品交接单》确认房屋状况、表底、物品、钥匙、门禁及影像资料。</p>
    <p>2. 用于出租的范围不得包含厨房、卫生间、阳台、过道、地下储藏室、车库等非居住空间的单独居住出租；租住人数及人均面积应符合届时适用的法律、法规和地方标准。</p>
  </div>
  <div class="clause"><span class="clause-title">第二条　租金 支付与税务</span>
    <p>1. 月租金为人民币${field(rentUppercase, '48mm')}元（小写：￥${field(rent, '20mm')}元）。租金支付周期为${field(payCycleLabel(data.paymentCycle), '14mm')}；乙方应于每一支付周期届满前${field(n(data.advancePaymentDays), '9mm')}日支付下一周期租金。首期租金为人民币￥${field(rent, '18mm')}元，支付截止日为${field(startDate, '26mm')}。</p>
    <p>2. 乙方应将租金、押金及其他应付款支付至甲方指定的收款人${field(data.payeeName, '26mm')}。收款人或收款方式如有变更，甲方应及时通知乙方，经双方确认后适用变更后的收款方式。</p>
    <p>3. 付款时乙方应备注“房号＋费用项目＋对应期间”。银行、支付机构交易记录、签约平台账单及电子收据可作为付款和结算依据；双方另有相反证据的除外。</p>
    <p>4. 甲方依法承担其法定纳税申报义务。乙方如需发票或其他税务协助，双方在附件五明确办理方式及实际费用安排；任何约定均不免除法定纳税义务。</p>
  </div>
  <div class="clause"><span class="clause-title">第三条　押金 费用与结算</span>
    <p>1. 乙方应于${field(startDate, '26mm')}前支付租赁保证金人民币￥${field(deposit, '20mm')}元。保证金不计利息，不当然抵作最后一期租金。</p>
    <p>2. 水、电、燃气、网络、物业、卫生及其他费用的承担项目、计价方式、结算周期和表底，以附件五为准。甲方应提供合理的结算依据或账单记录。</p>
    <p>3. 乙方完成退房交接且双方费用结清后，甲方应于${field(n(data.depositRefundWorkDays), '9mm')}个工作日内退还剩余保证金。甲方仅可就本合同明确约定且实际发生的下列项目扣减：未付租金或费用、约定违约金、乙方原因造成的修复费用、约定或实际发生的清洁费用、按本合同处理遗留物的合理费用。甲方应向乙方提供结算明细；余额退至乙方指定账户。</p>
  </div>
  <div class="clause"><span class="clause-title">第四条　使用 维修与安全管理</span>
    <p>1. 乙方应安全、合理使用房屋及附属设施，遵守物业管理规约和消防、燃气、治安等规定。乙方不得私拉乱接水、电、燃气线路；不得在室内、楼道及公共区域为电动车或其电池充电；不得损坏、拆除或停用消防设施。</p>
    <p>2. 未经甲方书面同意，乙方不得改变房屋用途、拆改室内设施、改动承重结构或其他结构、增设隔断、违法增设卫浴、将房屋转租、转借或变相交由他人长期使用。</p>
    <p>3. 除本合同列明共同居住人外，乙方不得擅自增加长期共同居住人。连续居住超过${field(n(data.continuousStayDays), '9mm')}日或累计超过${field(n(data.cumulativeStayDays), '9mm')}日者，视为长期共同居住人，但经甲方同意的正常短期访客除外。</p>
    <p>4. 甲方负责非因乙方原因产生的房屋主体、固有设施及依法应由出租人承担的维修；乙方应及时通知甲方。乙方因使用、保管不当造成损坏或人身、财产损失的，应承担相应修复、赔偿责任。</p>
  </div>
</section>

<!-- 第2页:第五~九条+补充条款 -->
<section class="page">
  <div class="break-page-2"></div>
  <div class="clause"><span class="clause-title">第五条　违约 催告与解除</span>
    <p>1. 乙方未按约支付租金或其他到期费用的，甲方可通过约定方式书面催告乙方在${field(n(data.overdueToleranceDays), '9mm')}日内支付；逾期仍未支付的，甲方有权解除合同，并要求乙方承担未付费用、约定违约金及依法可主张的实际损失。</p>
    <p>2. 乙方存在擅自转租、违规隔断、超员居住、擅自改变用途、违法活动、严重扰民、严重危及消防或人身安全、故意损坏房屋设施等违约行为的，甲方有权书面催告其在${field(n(data.overdueToleranceDays), '9mm')}日内改正；违约行为不能补救、严重危及安全或逾期未改正的，甲方有权解除合同。</p>
    <p>3. 合同解除应以书面解除通知送达乙方为准。甲方不得以换锁、断水断电、擅自进入或其他违法方式迫使乙方腾退。乙方应在解除通知约定的合理期限内完成退房交接。</p>
  </div>
  <div class="clause"><span class="clause-title">第六条　提前退租 到期退房与遗留物</span>
    <p>1. 乙方确需提前退租的，应至少提前${field(n(data.earlyTerminationNoticeDays), '9mm')}日通知甲方。乙方应支付相当于${field(n(data.penaltyMonths), '9mm')}个月租金的违约金，优先从已付保证金中扣除；保证金不足以覆盖违约金的，不足部分由乙方补足；保证金高于违约金的，剩余部分退还乙方。乙方未按期通知的，甲方可依法主张由此增加的实际损失。</p>
    <p>2. 租赁期届满或合同解除后，乙方应按约交还房屋、物品、钥匙、门禁及结清费用。乙方逾期未交还的，应按日租金标准支付占用期间费用，并承担甲方因此产生的合理损失。</p>
    <p>3. 乙方遗留物品的，甲方应以约定方式通知乙方领取，并对物品清点、拍照或录像留证。乙方自通知送达之日起${field(n(data.abandonedPropertyDays), '9mm')}日内未领取的，甲方可在合理范围内处置；保管、搬运、处置费用可从保证金中扣减，不足部分由乙方承担。法律规定不得处置的物品除外。</p>
  </div>
  <div class="clause"><span class="clause-title">第七条　征收 出售 续租与不可归责事由</span>
    <p>1. 因城市规划、征收、拆迁、司法查封、行政限制或其他不可归责于双方的原因，致使房屋无法继续居住使用的，本合同终止。双方按实际使用期间结清租金、费用和保证金；法律规定或补偿方案另有规定的，从其规定。</p>
    <p>2. 甲方拟在期满后继续出租的，乙方在同等条件下依法享有优先承租权。甲方不再续租的，应至少于期满前${field(n(data.nonRenewalNoticeDays), '9mm')}日通知乙方。</p>
    <p>3. 不可抗力应指不能预见、不能避免且不能克服的客观情况。受影响一方应及时通知并提供合理证明；双方按实际影响协商履行、减免、暂停或解除。因任一方违法、过错或房屋不合规导致的影响，不适用本款免责。</p>
  </div>
  <div class="clause"><span class="clause-title">第八条　通知送达 电子签名与数据留存</span>
    <p>1. 双方确认，甲方联系电话${field(data.landlordPhone, '32mm')}、乙方联系电话${field(data.tenantPhone, '32mm')}及本合同电子签约时核验的微信身份，为双方业已确认的有效通知渠道。任何一方变更联系方式的，应及时通知对方；未及时告知导致的送达风险由其自行承担。</p>
    <p>2. 催缴、整改、解除、交接、结算等通知可通过电话、当面口头告知、短信、微信或电子邮件等方式送达，并应留存通知内容、发送时间、发送对象及送达状态。其中电话及当面口头告知即时送达；短信、微信或电子邮件发送至双方确认的联系方式，且未收到明确失败或退回提示的，于发送后${field(n(data.electronicNoticeHours), '9mm')}小时视为送达。</p>
    <p>3. 双方同意采用依法有效的电子签名方式完成实名认证、签署意愿确认和电子签名。本合同、附件、签署证书、签署日志、身份核验记录、可信时间记录、合同哈希值及电子签约服务留存的操作记录，共同构成双方订立和履行本合同的电子证据。双方均可下载、保存和打印完整电子合同。</p>
    <p>4. 经双方完成电子签名的最终合同文本为原件。未经双方依法确认，任何一方不得擅自修改；合同哈希值和签署时间以电子签约服务留存的记录为准。</p>
  </div>
  <div class="clause"><span class="clause-title">第九条　甲方声明 个人信息 附件与争议解决</span>
    <p>1. 甲方声明其对本房屋享有所有权，或者已依法取得房屋权利人及上游出租人（如适用）的书面授权或书面转租同意，有权出租、管理并签署本合同。甲方应将相应权利依据以附件一载明的方式留存；涉及隐私信息的，可按法律规定脱敏。</p>
    <p>2. 双方同意对为签署、履行、备案、房屋管理、安全管理、纠纷处理所必需的身份信息、联系方式、支付及居住信息进行必要处理。任何一方不得超出必要范围使用、泄露或向无关第三方提供。</p>
    <p>3. 本合同附件与正文具有同等法律效力。附件包括：附件一《出租权利依据确认》、附件二《共同居住人确认》、附件三《房屋及物品交接单》、附件四《租赁房屋安全责任承诺书》、附件五《费用及押金结算规则》。</p>
    <p>4. 因履行本合同发生争议，双方应先协商；协商不成的，向房屋所在地有管辖权的人民法院提起诉讼。</p>
  </div>
  ${extraTerms ? `<div class="clause"><span class="clause-title">补充条款</span><p>${escapeHtml(extraTerms)}</p></div>` : ''}
</section>

<!-- 第3页:附件一 -->
<section class="page">
  <h2>附件一　出租权利依据确认</h2>
  <p style="text-indent:2em; margin:8mm 0;">甲方确认其以受托管理人身份签署本合同，对出租范围具有合法、持续的出租及管理权。</p>
  <div class="confirm-line">甲方确认：（随主合同电子签署一并确认）</div>
</section>

<!-- 第4页:附件二 共同居住人确认(独立一页) -->
<section class="page">
  <h2>附件二　共同居住人确认</h2>
  <div class="info-row" style="margin:4mm 0;"><span class="info-label">承租人</span>${field(data.tenantName, '40mm')}</div>
  <p class="no-indent" style="margin:2mm 0 3mm; font-weight:700;">共同居住人名单</p>
  <table class="co-table">
    <tr><th style="width:10mm;">序号</th><th style="width:26mm;">姓名</th><th style="width:52mm;">身份证号</th><th style="width:34mm;">联系电话</th></tr>
    ${coRows}
  </table>
  ${coOccupants.length === 0 ? '<p class="note">无共同居住人。</p>' : ''}
  <p style="margin:4mm 0 0;"><span style="font-weight:700;">居住规则确认</span></p>
  <p style="text-indent:2em;">共同居住人知悉并遵守本合同关于安全、居住人数、不得转租及不得违法使用房屋的约定。</p>
  <div class="confirm-line">承租人确认：（随主合同电子签署一并确认）</div>
</section>

<!-- 第5页:附件三 房屋及物品交接单 -->
<section class="page">
  <h2>附件三　房屋及物品交接单</h2>
  <div class="meters">
    <div class="meter-row">交付日期及时间：${field(handoverDate, '40mm')}</div>
    <div class="meter-row">水表底数：${field(meter(data.waterMeterReading), '30mm')}　　电表底数：${field(meter(data.electricityMeterReading), '30mm')}　　燃气表底数：${field(meter(data.gasMeterReading), '30mm')}</div>
  </div>
  <table class="checklist">
    <tr><th style="width:52mm;">物品名称</th><th style="width:26mm;">数量</th><th>完好情况／备注</th></tr>
    ${CHECKLIST_ROWS.map(
      (label, i) =>
        `<tr><td>${label}</td><td>${rows[i].quantity}</td><td>${rows[i].condition}</td></tr>`,
    ).join('')}
    <tr><td>其他</td><td>—</td><td>${rows[rows.length - 1].condition}</td></tr>
  </table>
  <p class="note">未交付的项目标注“—”；未列明物品汇总于“其他”栏。</p>
  <div class="confirm-line">甲方交付确认：（随主合同电子签署一并确认）　乙方接收确认：（随主合同电子签署一并确认）</div>
</section>

<!-- 第6页:附件四 安全责任承诺书 -->
<section class="page">
  <h2>附件四　租赁房屋安全责任承诺书</h2>
  <p style="text-indent:2em; margin:3mm 0;">承诺人已阅读本合同，自愿承诺在居住期间遵守下列要求，并对因本人或共同居住人违反本承诺所造成的损失依法承担相应责任：</p>
  <p style="text-indent:2em;">1. 遵守房屋租赁合同、物业管理规约和依法进行的安全检查，发现隐患及时告知并配合整改。</p>
  <p style="text-indent:2em;">2. 安全、节约用水，不擅自改装供水管线和设施；因使用不当造成漏水、浸水等损失的，承担相应责任。</p>
  <p style="text-indent:2em;">3. 安全用电，不私拉乱接，不超负荷使用电器；严禁在室内、楼道及公共区域为电动车或电池充电。</p>
  <p style="text-indent:2em;">4. 安全用气，正确使用燃气设施，发现泄漏立即关闭阀门、开窗通风并联系专业人员，严禁动用明火。</p>
  <p style="text-indent:2em;">5. 不在楼道及公共区域堆放杂物，不占用或堵塞消防通道、安全出口。</p>
  <p style="text-indent:2em;">6. 爱护房屋结构、装修和配套设施，发现故障或隐患及时告知甲方。</p>
  <p style="text-indent:2em;">7. 文明居住，不实施扰民、违章搭建、高空抛物、侵占公共通道等行为。</p>
  <p style="text-indent:2em;">8. 妥善照看未成年人及其他需照护人员，防止坠落等安全事故。</p>
  <p style="text-indent:2em;">9. 不存放易燃易爆、有毒或法律法规禁止的物品，不利用房屋从事违法犯罪活动。</p>
  <div class="confirm-line">承诺人：（随主合同电子签署一并确认）</div>
</section>

<!-- 第7页:附件五 费用及押金结算规则 -->
<section class="page">
  <h2>附件五　费用及押金结算规则</h2>
  <div class="info-block" style="margin-top:6mm;">
    <div class="info-row"><span class="info-label">月租金及周期</span>${field(rent, '22mm')}元；${field(payCycleLabel(data.paymentCycle), '16mm')}</div>
    <div class="info-row"><span class="info-label">保证金</span>${field(deposit, '22mm')}元；退还期限：${field(n(data.depositRefundWorkDays), '9mm')}个工作日</div>
    <div class="info-row"><span class="info-label">水费</span>${field(data.waterFeeRule, '90mm')}</div>
    <div class="info-row"><span class="info-label">电费</span>${field(data.electricityFeeRule, '90mm')}</div>
    <div class="info-row"><span class="info-label">燃气费</span>${field(data.gasFeeRule, '90mm')}</div>
    <div class="info-row"><span class="info-label">网络及物业等</span>${field(data.otherFeeRule, '90mm')}</div>
    <div class="info-row"><span class="info-label">清洁费</span>${field(cleaningFee, '18mm')}元；适用条件：乙方退租交接时</div>
    <div class="info-row"><span class="info-label">扣减明细</span>通过本合同第八条约定的通知渠道发送</div>
  </div>
  <div class="confirm-line">甲方确认：（随主合同电子签署一并确认）　乙方确认：（随主合同电子签署一并确认）</div>
</section>

<!-- 第8页:签署页(全文最后一页,微签盖章/签名坐标锚定此页) -->
<section class="page">
  <h2>签　署　页</h2>
  <p class="sig-page-intro">双方确认已完整阅读、理解并同意本合同正文及全部附件的内容。双方签署后，本合同及附件共同生效。</p>
  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-name">甲方（出租人）</div>
      <div>姓名：${field(data.landlordName, '34mm')}</div>
      <div>身份证号：${field(data.landlordIdCard, '50mm')}</div>
      <div>联系电话：${field(data.landlordPhone, '34mm')}</div>
      <div class="sig-line">甲方签署（发起方通过电子签约平台自动盖章）；签署时间：${escapeHtml(formatDate(data.launchDate))}</div>
    </div>
    <div class="sig-block">
      <div class="sig-name">乙方（承租人）</div>
      <div>姓名：${field(data.tenantName, '34mm')}</div>
      <div>身份证号：${field(data.tenantIdCard, '50mm')}</div>
      <div>联系电话：${field(data.tenantPhone, '34mm')}</div>
      <div class="sig-line">乙方签署（以电子签约平台留存的电子签名为准）；签署时间：以电子签约平台记录为准</div>
    </div>
  </div>
  <div class="attachments-note">附件一《出租权利依据确认》／附件二《共同居住人确认》／附件三《房屋及物品交接单》／附件四《租赁房屋安全责任承诺书》／附件五《费用及押金结算规则》，随本合同一并签署生效。</div>
</section>

</body>
</html>`;
}
