// 住房租赁合同模板 V4 生成脚本：npm i docx && node build-v4.js v4-template.docx
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Footer, PageNumber, ShadingType, VerticalAlign, TableLayoutType, LevelFormat,
} = require('docx');

const SONG = { ascii: 'SimSun', eastAsia: 'SimSun', hAnsi: 'SimSun' };
const HEI = { ascii: 'SimHei', eastAsia: 'SimHei', hAnsi: 'SimHei' };
const SZ = 22; // 11pt
const LINE = 348; // 约1.45倍行距
const W = 9070; // A4 11906 - 左右边距 1418×2
const GRAY = 'F2F2F2';
const RULE = 'A6A6A6';

// **…** 标记重点提示（加粗）
function runs(text, o = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((s) => {
    const b = s.startsWith('**');
    return new TextRun({ text: b ? s.slice(2, -2) : s, bold: b || o.bold, font: o.font || SONG, size: o.size || SZ, color: o.color });
  });
}
const para = (text, o = {}) => new Paragraph({
  children: runs(text, o),
  alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { line: o.line || LINE, before: o.before || 0, after: o.after ?? 60 },
  keepNext: o.keepNext,
});

// 大标题（一、二、三）
const section = (text) => new Paragraph({
  children: [new TextRun({ text, font: HEI, size: 26, bold: true })],
  spacing: { before: 360, after: 160 },
  keepNext: true,
});
// 条标题：黑体 + 下方细线
const art = (text) => (artNo += 1, new Paragraph({
  children: [new TextRun({ text, font: HEI, size: 24, bold: true })],
  spacing: { before: 300, after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
  keepNext: true,
}));
// 款：用 Word 原生编号实现悬挂缩进（手机预览不认制表位，手写"1.+Tab"会错位），每条从1重新编号
let artNo = 0;
const numbering = {
  config: [
    { reference: 'item', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 420, hanging: 420 } }, run: { font: SONG, size: SZ } } }] },
    { reference: 'sub', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '（%1）', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 1080, hanging: 660 } }, run: { font: SONG, size: SZ } } }] },
  ],
};
const item = (_no, text, o = {}) => new Paragraph({
  children: runs(text),
  numbering: { reference: 'item', level: 0, instance: artNo },
  alignment: AlignmentType.JUSTIFIED,
  spacing: { line: LINE, after: o.after ?? 100 },
});
const sub = (_no, text) => new Paragraph({
  children: runs(text),
  numbering: { reference: 'sub', level: 0, instance: artNo },
  spacing: { line: LINE, after: 40 },
});

// 表格
const line = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const cell = (text, width, o = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  columnSpan: o.span,
  verticalAlign: VerticalAlign.CENTER,
  borders: { top: line, bottom: line, left: line, right: line },
  shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
  margins: { top: o.pad ?? 90, bottom: o.pad ?? 90, left: 140, right: 140 },
  children: (Array.isArray(text) ? text : [text]).map((t) => para(t, {
    font: o.hei ? HEI : SONG, align: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, after: 0, line: 300,
  })),
});
const table = (cols, rows) => new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED, rows });
const L = (t, w, span) => cell(t, w, { shade: GRAY, hei: true, span });

// ---------- 一、基本信息 ----------
const c4 = [1950, 1800, 3000, 2320];
const parties = table(c4, [
  new TableRow({ children: [L('', c4[0]), L('姓名', c4[1]), L('身份证号', c4[2]), L('联系电话', c4[3])] }),
  new TableRow({ children: [L('出租人（甲方）', c4[0]), cell('【甲方姓名】', c4[1]), cell('【甲方身份证号】', c4[2]), cell('【甲方联系电话】', c4[3])] }),
  new TableRow({ children: [L('承租人（乙方）', c4[0]), cell('【乙方姓名】', c4[1]), cell('【乙方身份证号】', c4[2]), cell('【乙方联系电话】', c4[3])] }),
  new TableRow({ children: [L('共同居住人', c4[0]), cell('【共同居住人姓名及身份证号；无则填“无”】', W - c4[0], { span: 3 })] }),
]);

const k = [1950, 2810, 1500, 2810];
const terms = table(k, [
  new TableRow({ children: [L('房屋地址', k[0]), cell('【房屋坐落】（整间出租，仅用于居住）', W - k[0], { span: 3 })] }),
  new TableRow({ children: [L('租赁期限', k[0]), cell('【租赁起始日】至【租赁届满日】', W - k[0], { span: 3 })] }),
  new TableRow({ children: [L('月租金', k[0]), cell(['￥【月租金小写】元', '（大写：【月租金大写】元）'], k[1]), L('支付周期', k[2]), cell('【支付周期】', k[3])] }),
  new TableRow({ children: [L('押金', k[0]), cell('￥【押金金额】元', k[1]), L('收款人', k[2]), cell('【收款人姓名】', k[3])] }),
  new TableRow({ children: [L('付款时间', k[0]), cell(['首期租金和押金：【首期支付截止日】前付清', '之后每期租金：当期届满前【提前支付天数】日支付下一期'], W - k[0], { span: 3 })] }),
]);

// ---------- 二、合同条款 ----------
const clauses = [
  art('第一条　房屋与交付'),
  item('1.', '本房屋仅用于居住，居住人限于乙方及上表所列共同居住人，总人数不超过【单间人数上限】人。乙方不得将房屋用于经营、办公或仓储。'),
  item('2.', '甲方于【租赁起始日】交付房屋。双方按附件《房屋交接清单》逐项确认设施状况，作为入住和退房时核对的依据。'),

  art('第二条　租金与费用'),
  item('1.', '乙方按上表约定的时间和金额，将租金、押金付至上表所列收款人。收款人或收款方式变更的，以甲方书面通知为准；乙方收到通知前按原方式支付的，视为已经支付。'),
  item('2.', '租金为不含税价格。乙方需要开具发票的，**因开票产生的税费由乙方承担**。'),
  item('3.', '水、电采用预付充值方式：水费【水费计费规则】，电费【电费计费规则】；网络及其他费用【其他费用规则】。政府调整水、电价格的，按调整后的价格执行。'),

  art('第三条　押金'),
  item('1.', '押金用于担保乙方履行本合同，不计利息，不能抵作租金。'),
  item('2.', '租期届满或合同解除后，乙方交还房屋并结清费用的，甲方应在【押金退还天数】个工作日内退还押金，并提供扣款明细。'),
  item('3.', '**以下款项可以从押金中扣除**：乙方未付的租金、费用和赔偿款，本合同约定的违约金、清洁费，以及处理遗留物品的合理费用。**押金不足以抵扣的，乙方应当补足。**'),
  item('4.', '房屋及设施的自然老化和正常损耗，不从押金中扣除。'),

  art('第四条　安全管理'),
  item('1.', '**严禁在室内、楼道及公共区域停放电动车，或为电动车及其电池充电。**'),
  item('2.', '不得私拉乱接电线、超负荷用电；不得损坏或挪用消防设施；不得在楼道堆放杂物、堵塞消防通道；不得存放易燃易爆等危险物品；不得高空抛物。'),
  item('3.', '乙方应遵守公寓管理规定，按规定办理居住登记，配合依法进行的安全检查。'),
  item('4.', '乙方应照看好共同居住人、访客及未成年人的安全。因乙方一方（含共同居住人、访客）的过错造成人身、财产损害的，由乙方承担责任；因甲方过错造成的，由甲方承担责任。'),
  item('5.', '钥匙、门禁卡遗失的，乙方应及时告知甲方，补配或换锁费用由乙方承担。'),

  art('第五条　维修与改动'),
  item('1.', '房屋主体及甲方提供的设施非因乙方原因损坏的，由甲方负责维修，甲方接到报修后应及时处理。甲方需要入户检查、维修的，应提前通知乙方，漏水、火灾等紧急情况除外。'),
  item('2.', '因乙方使用不当或过错造成损坏的，**维修费用由乙方承担，并在维修完成时当场支付**；无法修复的，按同类物品市场价格扣除合理折旧后赔偿。因乙方原因造成漏水等给他人造成损失的，由乙方赔偿。'),
  item('3.', '未经甲方书面同意，乙方不得改动房屋结构及设施、增设隔断或改动水电线路；擅自改动的，应恢复原状并赔偿损失。'),
  item('4.', '乙方自行添置的物品，退房时可以带走。已固定安装在房屋上、拆除可能损坏房屋的，应提前通知甲方，经甲方同意后再拆除；造成损坏的，应予修复。'),

  art('第六条　转租与同住'),
  item('1.', '未经甲方书面同意，乙方不得将房屋全部或部分转租、转借他人。'),
  item('2.', '未列入本合同的人员连续居住超过【连续居住天数】日的，乙方应告知甲方并补充登记为共同居住人，居住总人数不得超过第一条约定的上限。'),

  art('第七条　违约与解除'),
  item('1.', '乙方逾期支付租金的，甲方可以催告支付；自应付之日起超过【逾期可解除天数】日仍未付清的，**甲方有权书面通知解除合同，乙方应支付相当于【违约金月数】个月租金的违约金**。'),
  item('2.', '乙方有下列情形之一，经甲方书面要求在合理期限内改正而不改正，或者情节严重、危及消防及人身安全的，**甲方有权解除合同，乙方应支付相当于【违约金月数】个月租金的违约金**：', { after: 40 }),
  sub('（1）', '擅自转租、转借；'),
  sub('（2）', '超员居住；'),
  sub('（3）', '改变房屋用途，或利用房屋从事违法活动；'),
  sub('（4）', '违反第四条安全管理规定；'),
  sub('（5）', '擅自改动房屋结构，或故意损坏房屋设施。'),
  item('3.', '乙方提前退租的，应提前【提前退租通知天数】日书面通知甲方，**并支付相当于【违约金月数】个月租金的违约金**。', { after: 100 }),
  item('4.', '甲方无正当理由提前收回房屋的，应提前【提前退租通知天数】日书面通知乙方，退还押金，并支付相当于【违约金月数】个月租金的违约金。'),
  item('5.', '合同提前终止的，租金按实际居住天数结算，乙方已付但未居住期间的租金，扣除乙方应付款项后退还。'),

  art('第八条　续租与退房'),
  item('1.', '乙方需要续租的，应在租期届满前【续租通知天数】日向甲方提出，双方协商一致后重新签订合同。'),
  item('2.', '租期届满或合同解除后，乙方应在届满之日或解除通知载明的日期前搬离，按原状返还房屋和设施，交还钥匙和门禁卡，结清费用。退房时应保持房内整洁，否则甲方可以收取清洁费【清洁费金额】元。'),
  item('3.', '**乙方逾期不搬离的，按日租金（月租金÷30）支付占用期间的房屋使用费。**'),
  item('4.', '合同解除后乙方拒不搬离或者失联的，**甲方可以在公证机构或者两名以上无利害关系人见证下，对房内物品清点、拍照录像后另行存放，并收回房屋**，由此产生的合理费用由乙方承担。'),
  item('5.', '乙方搬离后遗留的物品，经甲方通知后【遗留物保管天数】日内仍未取回的，**视为乙方放弃，甲方可以自行处置**。'),

  art('第九条　征收与不可抗力'),
  item('1.', '因政府征收、拆迁、规划调整或不可抗力等非双方原因致使本合同无法履行的，合同终止，双方互不承担违约责任。甲方应尽可能提前通知乙方，租金按实际居住天数结算，剩余租金和押金退还乙方。'),
  item('2.', '房屋征收补偿归房屋权利人所有；乙方自有财产的搬迁损失等依法应由乙方获得的补偿除外。'),

  art('第十条　其他'),
  item('1.', '上表所列电话是双方的联系方式。按该电话发送的短信、微信通知，发出满24小时视为送达。一方变更电话应及时告知对方；未告知的，按原电话发送的通知视为送达。'),
  item('2.', '本合同以电子签名方式签订，附件是本合同的组成部分。未尽事宜依照法律法规执行，或由双方另行书面约定。'),
  item('3.', '补充条款：【补充条款内容；无则填“无”】'),
];

// ---------- 三、签署 ----------
// 提示框和签名区不用表格：手机预览会把"无边框"表格画出黑框、并按内容缩窄
const box = { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 6 };
const notice = new Paragraph({
  children: runs('重要提示：本合同中加粗的内容涉及税费、押金扣除、维修付款、违约金、合同解除及物品处置，甲方已提示乙方重点阅读。乙方确认已阅读并理解全部条款。', { size: 20 }),
  shading: { type: ShadingType.CLEAR, fill: GRAY, color: 'auto' },
  border: { top: box, bottom: box, left: box, right: box },
  spacing: { line: 320, after: 360 },
});
const signLine = (who) => [
  new Paragraph({
    spacing: { line: LINE, before: 240, after: 80 },
    children: [
      new TextRun({ text: `${who}签名：`, font: HEI, size: SZ }),
      new TextRun({ text: '_'.repeat(28), size: SZ, color: '808080' }),
    ],
  }),
  para('签署日期：以电子签名记录为准', { size: 20, color: '595959', after: 120 }),
];
const signs = [...signLine('甲方（出租人）'), ...signLine('乙方（承租人）')];

// ---------- 附件 ----------
const a = [3400, 1500, W - 4900];
const handover = table(a, [
  new TableRow({ tableHeader: true, children: [L('物品名称', a[0]), L('数量', a[1]), L('状况／备注', a[2])] }),
  ...['空调', '冰箱', '洗衣机', '热水器', '电磁炉', '油烟机', '电视', '床及床垫', '桌椅', '沙发', '钥匙／门禁卡', '其他']
    .map((n) => new TableRow({ children: [cell(n, a[0]), cell('', a[1], { center: true }), cell('', a[2])] })),
]);

const body = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: '住房租赁合同', font: HEI, size: 40, bold: true })] }),
  para('合同编号：【合同编号】', { align: AlignmentType.RIGHT, after: 120, size: 20 }),

  section('一、基本信息'),
  parties,
  para('', { after: 120 }),
  terms,
  para('甲、乙双方根据《中华人民共和国民法典》等法律法规，在平等、自愿的基础上，就上述房屋租赁事宜订立本合同。', { before: 200, after: 0 }),

  section('二、合同条款'),
  ...clauses,

  section('三、签署'),
  notice,
  ...signs,

  new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: '附件　房屋交接清单', font: HEI, size: 30, bold: true })] }),
  table([1950, W - 1950], [
    new TableRow({ children: [L('房屋地址', 1950), cell('【房屋坐落】', W - 1950)] }),
    new TableRow({ children: [L('交付日期', 1950), cell('【交付时间】', W - 1950)] }),
    new TableRow({ children: [L('水电', 1950), cell('预付充值、即充即用，按各户独立账户余额计费，入住时无需抄表。', W - 1950)] }),
  ]),
  para('', { after: 160 }),
  handover,
  para('说明：未提供的物品在“数量”栏填“—”。', { before: 160, size: 20 }),
  para('甲方交付确认、乙方接收确认：随本合同电子签名一并确认。', { size: 20 }),
];

const doc = new Document({
  creator: 'LandlordEasy',
  title: '住房租赁合同（V4）',
  numbering,
  styles: { default: { document: { run: { font: 'SimSun', size: SZ } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1418, right: 1418, footer: 600 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '住房租赁合同（模板V4）　', size: 16, font: SONG, color: '808080' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: SONG, color: '808080' }),
          ],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then((b) => fs.writeFileSync(process.argv[2] || 'v4-template.docx', b));
