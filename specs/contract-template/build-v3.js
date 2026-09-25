const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, BorderStyle, Footer, PageNumber, ShadingType, PageBreak,
} = require('docx');

const FONT = { ascii: 'SimSun', eastAsia: 'SimSun', hAnsi: 'SimSun' };
const HEI = { ascii: 'SimHei', eastAsia: 'SimHei', hAnsi: 'SimHei' };
const SZ = 21; // 五号 10.5pt
const LINE = 300; // ~1.25 倍行距

// 文本里用 **…** 标记加粗（格式条款重点提示）
function runs(text, opts = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((s) => {
    const bold = s.startsWith('**');
    return new TextRun({ text: bold ? s.slice(2, -2) : s, bold: bold || opts.bold, font: opts.font || FONT, size: opts.size || SZ });
  });
}
const p = (text, o = {}) => new Paragraph({
  children: runs(text, o),
  alignment: o.align || AlignmentType.JUSTIFIED,
  indent: o.indent === false ? undefined : { firstLine: o.firstLine ?? 0 },
  spacing: { line: LINE, before: o.before || 0, after: o.after || 0 },
  keepNext: o.keepNext,
});
const art = (title) => p(title, { font: HEI, before: 100, after: 20, keepNext: true });
const item = (text) => p(text);

const W = 9638; // A4 宽 11906 - 左右边距各 1134
const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
function cell(text, width, o = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: 'EDEDED', color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
    children: [p(text, { font: o.hei ? HEI : FONT, align: o.center ? AlignmentType.CENTER : AlignmentType.LEFT })],
  });
}
function table(cols, rows, headShade = false) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((r, i) => new TableRow({
      children: r.map((t, j) => cell(t, cols[j], {
        shade: (headShade && i === 0) || (!headShade && j === 0),
        hei: (headShade && i === 0) || (!headShade && j === 0),
        center: headShade && (i === 0 || j === 1),
      })),
    })),
  });
}

const body = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: '住房租赁合同', font: HEI, size: 36, bold: true })] }),
  p('合同编号：【合同编号】', { align: AlignmentType.RIGHT, after: 80 }),

  table([1900, W - 1900], [
    ['出租人（甲方）', '【甲方姓名】　身份证号：【甲方身份证号】　电话：【甲方联系电话】'],
    ['承租人（乙方）', '【乙方姓名】　身份证号：【乙方身份证号】　电话：【乙方联系电话】'],
    ['共同居住人', '【共同居住人姓名及身份证号；无则填“无”】'],
    ['租赁房屋', '【房屋坐落】（整间出租，用途：住宅）'],
    ['租赁期限', '自【租赁起始日】起至【租赁届满日】止'],
    ['租金', '每月人民币【月租金大写】元（￥【月租金小写】元）；支付周期：【支付周期】'],
    ['押金', '人民币￥【押金金额】元'],
    ['收款人', '【收款人姓名】'],
  ]),

  p('根据《中华人民共和国民法典》等法律法规，甲、乙双方在平等、自愿、协商一致的基础上，就上述房屋租赁事宜订立本合同。', { before: 100 }),

  art('第一条　房屋与用途'),
  item('1. 甲方为本房屋的转租出租人，已取得房屋所有权人同意转租的书面文件；本合同租期不超过甲方对本房屋享有租赁权的期限。'),
  item('2. 本房屋仅用于居住，居住人限于乙方及上表所列共同居住人，总人数不超过【单间人数上限】人。乙方不得将房屋用于经营、办公、仓储，不得以本房屋地址办理工商注册登记。'),
  item('3. 甲方于【租赁起始日】交付房屋。双方按附件《房屋交接清单》逐项确认设施状况，并拍照或录像留存，作为交接和退房时核对的依据。'),

  art('第二条　租金与费用'),
  item('1. 乙方应在每期租金到期前【提前支付天数】日支付下一期租金；首期租金和押金应于【首期支付截止日】前付清。款项付至上表所列收款人；收款人或收款方式变更的，以甲方书面通知为准，乙方收到通知前按原方式支付的视为有效支付。'),
  item('2. **租金为不含税价格。乙方需要开具发票的，因开票产生的税费由乙方承担。**'),
  item('3. 水、电采用预付充值方式，水费按【水费计费规则】、电费按【电费计费规则】计收；网络及其他费用按【其他费用规则】执行。政府调整公用事业价格的，按调整后的价格执行。'),

  art('第三条　押金'),
  item('1. 押金用于担保乙方履行本合同，不计利息，不得抵作租金。'),
  item('2. **租期届满或合同解除后，乙方交还房屋并结清费用的，甲方应在【押金退还天数】个工作日内退还押金。甲方可以从押金中扣除：乙方未付的租金和费用、本合同约定的违约金、乙方原因造成损坏的维修赔偿费用、退房清洁费【清洁费金额】元，以及处理遗留物品的合理费用；扣除时应向乙方提供明细。押金不足以抵扣的，乙方应当补足。**'),
  item('3. 房屋及设施的自然老化和正常损耗，不得从押金中扣除。'),

  art('第四条　安全管理'),
  item('1. **严禁在室内、楼道及公共区域停放电动车或为电动车及其电池充电。**'),
  item('2. 乙方不得私拉乱接电线、超负荷用电，不得损坏或挪用消防设施，不得在楼道堆放杂物或堵塞消防通道，不得存放易燃易爆及其他违禁物品，不得高空抛物。'),
  item('3. 乙方应遵守公寓管理规定和街道、派出所等部门的要求，按规定办理居住登记，配合依法进行的安全检查。'),
  item('4. 乙方应照看好共同居住人、访客及未成年人的安全。因乙方或其共同居住人、访客的过错（包括违反本条规定）造成本人或他人人身、财产损害的，由乙方承担责任；因甲方过错造成的，由甲方承担责任。'),
  item('5. 乙方应妥善保管钥匙和门禁卡；遗失的应及时告知甲方，补配或换锁费用由乙方承担。'),

  art('第五条　维修与改动'),
  item('1. 房屋主体及甲方提供的设施非因乙方原因损坏的，由甲方负责维修；乙方应及时报修并配合甲方入户维修。甲方需要入户检查、维修的，应提前通知乙方，发生漏水、火灾等紧急情况的除外。'),
  item('2. 因乙方使用不当或过错造成房屋、设施损坏的，由乙方负责修复；无法修复的，按同类物品市场价格扣除合理折旧后赔偿。因乙方原因造成漏水等致使他人受损的，由乙方承担赔偿责任。'),
  item('3. 未经甲方书面同意，乙方不得改动房屋结构及设施、增设隔断、改动水电线路；擅自改动的，应恢复原状并赔偿损失。乙方自行添置的物品，退房时可以带走，拆除造成损坏的应予修复。'),

  art('第六条　转租与同住'),
  item('1. 未经甲方书面同意，乙方不得将房屋全部或部分转租、转借他人。'),
  item('2. 本合同未列明的人员在房屋内连续居住超过【连续居住天数】日的，乙方应告知甲方并补充登记为共同居住人，居住总人数不得超过第一条约定的上限。'),

  art('第七条　违约与解除'),
  item('1. **乙方逾期支付租金的，甲方可以催告乙方支付；自应付之日起超过【逾期可解除天数】日仍未付清的，甲方有权书面通知解除合同，乙方应支付相当于【违约金月数】个月租金的违约金。**'),
  item('2. **乙方有下列情形之一，经甲方书面要求在合理期限内改正而不改正，或者情节严重、危及消防及人身安全的，甲方有权解除合同，乙方应支付相当于【违约金月数】个月租金的违约金：（1）擅自转租、转借；（2）超员居住；（3）改变房屋用途或利用房屋从事违法活动；（4）违反第四条安全规定；（5）擅自改动房屋结构或故意损坏房屋设施。**'),
  item('3. **乙方提前退租的，应提前【提前退租通知天数】日书面通知甲方，并支付相当于【违约金月数】个月租金的违约金。**'),
  item('4. 甲方无正当理由提前收回房屋的，应提前【提前退租通知天数】日书面通知乙方，退还剩余租金和押金，并支付相当于【违约金月数】个月租金的违约金。'),

  art('第八条　续租与退房'),
  item('1. 乙方需要续租的，应在租期届满前【续租通知天数】日向甲方提出，双方协商一致后重新签订合同。'),
  item('2. **租期届满或合同解除后，乙方应在届满之日或解除通知载明的日期前搬离，交还钥匙和门禁卡，结清费用。逾期不搬离的，按日租金（月租金÷30）支付占用期间的房屋使用费。**'),
  item('3. **合同解除后乙方拒不搬离或者失联的，甲方可以在公证机构或者两名以上无利害关系人见证下，对房内物品清点、拍照录像后另行存放并收回房屋，由此产生的合理费用由乙方承担。**'),
  item('4. **乙方搬离后遗留的物品，经甲方通知后【遗留物保管天数】日内仍未取回的，视为乙方放弃，甲方可以自行处置。**'),

  art('第九条　征收与不可抗力'),
  item('1. 因政府征收、拆迁、规划调整或不可抗力等非双方原因致使本合同无法履行的，合同终止，双方互不承担违约责任；甲方应尽可能提前通知乙方，按实际居住天数结算租金，退还剩余租金和押金。'),
  item('2. 因甲方与房屋所有权人之间的租赁关系提前终止致使本合同无法继续履行的，按本合同第七条第4款处理。'),

  art('第十条　通知及其他'),
  item('1. 上表所列电话号码是双方的联系和通知方式。通知可以通过当面、电话、短信或微信（含签约时核验的微信账号）发出，短信、微信发出满24小时即视为送达。一方变更联系方式应及时告知对方，未告知的，按原联系方式发出的通知视为送达。'),
  item('2. 本合同以电子签名方式签订，电子签名与手写签名具有同等法律效力。附件是本合同的组成部分。'),
  item('3. 因本合同发生争议，双方应先协商；协商不成的，向房屋所在地人民法院起诉。'),
  item('4. 本合同未尽事宜，依照有关法律法规执行，或者由双方另行书面约定。'),
  item('5. 补充条款：【补充条款内容；无则填“无”】'),

  p('**特别提示：甲方已提示乙方重点阅读本合同中加粗的条款（涉及税费、押金扣除、违约金、合同解除、物品处置等）。乙方确认已阅读并理解全部条款。**', { before: 120 }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W / 2, W / 2],
    rows: [new TableRow({
      children: ['甲方（出租人）', '乙方（承租人）'].map((who) => new TableCell({
        width: { size: W / 2, type: WidthType.DXA },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        children: [
          p(`${who}签名：`, { before: 200, after: 300 }),
          p('签署日期：以电子签名记录为准'),
        ],
      })),
    })],
  }),

  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: '附件　房屋交接清单', font: HEI, size: 28, bold: true })] }),
  p('房屋：【房屋坐落】　　交付日期：【交付时间】', { after: 60 }),
  p('水电说明：水、电采用预付充值方式（即充即用），按各户独立账户余额计费，入住时无需抄录表底数。', { after: 80 }),
  table([3200, 1500, W - 4700], [
    ['物品名称', '数量', '状况／备注'],
    ...['空调', '冰箱', '洗衣机', '热水器', '电磁炉', '油烟机', '电视', '床及床垫', '桌椅', '沙发', '钥匙／门禁卡', '其他'].map((n) => [n, '', '']),
  ], true),
  p('未提供的物品在“数量”栏填“—”。交接时双方对房屋及物品拍照或录像留存。', { before: 60 }),
  p('甲方交付确认、乙方接收确认：随本合同电子签名一并确认。', { before: 60 }),
];

const doc = new Document({
  creator: 'LandlordEasy',
  title: '住房租赁合同（V3）',
  styles: { default: { document: { run: { font: 'SimSun', size: SZ } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '住房租赁合同（模板V3·2026年9月）　第 ', size: 16, font: FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
            new TextRun({ text: ' 页／共 ', size: 16, font: FONT }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 }),
            new TextRun({ text: ' 页', size: 16, font: FONT }),
          ],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then((b) => fs.writeFileSync(process.argv[2] || 'out.docx', b));
