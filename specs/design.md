# 技术设计文档(design.md)

> 状态:v1 定稿 | 由 Claude 制定,Kiro 按此实现,不要偏离。有异议写 questions.md。

## 1. 总体架构

单体应用 + 前后端分离,pnpm monorepo:

```
apps/
  server/        # 后端 API(NestJS)
  landlord-h5/   # 房东端手机 Web(Vue3)
  tenant-h5/     # 租客端公众号 H5(Vue3)
packages/
  shared/        # 前后端共享的类型定义、枚举、工具
```

约 300 间房、低并发,明确不做:微服务、消息队列、Redis(第一版)、分布式任何东西。

## 2. 技术选型

| 层 | 选型 |
|---|---|
| 后端 | Node.js 20 + TypeScript + NestJS + Prisma ORM |
| 数据库 | MySQL 8(开发环境可用 Docker;Prisma migrate 管理表结构) |
| 定时任务 | @nestjs/schedule(账单生成、催租提醒) |
| 前端 | Vue 3 + Vite + TypeScript + Vant 4(移动端 UI)+ Pinia |
| 鉴权 | 微信网页授权换 openid → 签发 JWT;房东白名单校验 |
| 部署 | 待定(需域名+备案+HTTPS+服务器,不阻塞开发);先保证 docker-compose 一键起本地环境 |

## 3. 外部依赖 Mock 约定(重要)

开发期没有公众号 appid、没有微信支付、没有服务器。所有微信能力必须隔离在 `server/src/wechat/` 模块的接口后面,提供两套实现,用环境变量 `WECHAT_MODE=mock|real` 切换:

- `WechatAuthService`:mock 模式下,前端带 `?mock_openid=xxx` 即视为完成微信授权
- `WechatNotifyService`(模板消息):mock 模式下只写数据库表 `reminder_log` + 控制台打印,不真正发送
- 支付阶段二暂不实现,只留 `PaymentChannel` 枚举位

因此 Kiro 在无任何微信凭证的情况下可完成全部 P1 开发与自测。

## 4. 数据模型(Prisma schema 核心)

字段可按实现需要微调,实体与关系不得改变。所有表含 createdAt/updatedAt,业务表不做物理删除(用 status 归档)。

- **Landlord** 房东:id, openid(唯一, mock 期可为手机号), name, isActive
- **Building** 楼栋:id, name, sort
- **RoomType** 房型模板:id, name, description, defaultRent, defaultDeposit, defaultPayCycle, defaultFeeItems(JSON: [{name, amount}]), furnitureList(JSON)
- **Room** 房间:id, buildingId, roomNo, floor, roomTypeId, status(VACANT/RENTED/MAINTENANCE), rentOverride?, photos(JSON), remark;唯一约束(buildingId, roomNo)
- **Tenant** 租客:id, openid?(绑定后填), name, phone, idCard?
- **Lease** 租约:id, roomId, tenantId, startDate, endDate, rent, deposit, payCycle(MONTHLY/QUARTERLY/YEARLY), feeItems(JSON, 固定附加费如清洁费/停车费), carPlate?, commission?(佣金/中介费), status(ACTIVE/ENDED), inviteCode(唯一), endedAt?, endReason?
- **Bill** 账单:id, leaseId, periodStart, periodEnd, dueDate, status(PENDING/PAID/OVERDUE/CANCELED), totalAmount(冗余=items合计)
- **BillItem** 账单费用项:id, billId, type(RENT/FEE/LATE_FEE/OTHER), name, amount
- **Payment** 支付记录:id, billId, channel(QRCODE/WECHATPAY/CASH/TRANSFER), amount, status(PENDING_CONFIRM/CONFIRMED/REJECTED), proofUrl?, paidAt, confirmedBy?(landlordId), confirmedAt?
- **DepositRecord** 押金台账:id, leaseId, type(RECEIVE/REFUND/DEDUCT), amount, reason?, operatorId
- **HandoverRecord** 交接:id, leaseId, type(CHECKIN/CHECKOUT), checklist(JSON), remark
- **MaintenanceRecord** 维修:id, roomId, date, content, cost, operatorId
- **ReminderLog** 提醒记录:id, billId, tenantId, type(PRE/DUE/OVERDUE), sentAt, channel, success
- **Expense** 支出:id, date, category(自由文本或字典), name, amount, remark?, buildingId?, roomId?, operatorId
- **AuditLog** 操作日志:id, operatorId, action, entityType, entityId, detail(JSON), createdAt

关系要点:Room 1-N Lease(历史);Lease 1-N Bill;Bill 1-N Payment;Tenant 1-N Lease(可回头再租)。房间详情页聚合 = 按 roomId 串起以上所有表。

## 5. 核心业务逻辑

### 5.1 账单引擎
- 每日 02:00 定时任务:扫描 ACTIVE 租约,若下一账期开始日 ≤ 今天+7天 且该账期账单不存在,则生成账单(租金 + 租约 feeItems)
- 账期按 startDate 滚动(月付:每月同日;跨月末取月末)。dueDate = 账期开始日
- 幂等:同租约同账期唯一,重复跑不重复生成
- 每日任务同时把过期未付账单置为 OVERDUE

### 5.2 催租提醒
- 每日 09:00 定时任务:到期前3天 / 到期日 / 逾期每3天,调 WechatNotifyService,写 ReminderLog
- 参数(3天等)放系统配置表或 .env,可调

### 5.3 收款闭环(2026-08-27更新:M18在线支付,取代原阶段一收款码流程)

**保留不变**:房东手动记账入口(`POST /payments/manual`),直接创建 Payment(channel=CASH/TRANSFER, status=CONFIRMED),`checkBillPaid` 判断累计已确认金额 ≥ 应收则 Bill=PAID。这条路径完全不受本次改动影响。

**下线**:原「我已付款」人工上报 + 房东确认流程(`channel=QRCODE`, `status=PENDING_CONFIRM` → 房东 `POST /payments/:id/confirm`)。租客端 `PayBill.vue` 的收款码/截图上传 UI 整体替换为下方在线支付流程。

**新增:在线支付**
- `Payment.channel` 新增 `ALIPAY`(`WECHATPAY` 已在原 schema 预留);新增 `outTradeNo`(系统生成的商户订单号,唯一索引,用于幂等)、`gatewayTradeNo`(网关返回的交易流水号,可空,回调时写入)
- 只支持整单支付,创建订单时金额固定为 `bill.totalAmount`,不接受前端传入自定义金额
- **PAYMENT_MODE(mock/real)**:仿照 `WECHAT_MODE` 的模式,新增环境变量 `PAYMENT_MODE=mock|real`。mock 模式下「创建订单」直接返回假的支付参数/二维码内容,不真实调用微信/支付宝接口;「模拟支付成功」提供一个仅 mock 模式可用的测试接口,直接触发回调处理逻辑,方便 dev 环境联调前端流程,不依赖真实商户资质。real 模式才真实调用微信/支付宝官方接口。

**微信支付(JSAPI)**
1. `POST /payments/wechat/create-order`:后端调微信统一下单 API(real 模式)或返回 mock 参数,创建 Payment(`channel=WECHATPAY`, `status=PENDING`, 记录 `outTradeNo`),返回前端拉起支付所需的 JSAPI 参数
2. 前端调用 `WeixinJSBridge.invoke('getBrandWCPayRequest', ...)` 拉起微信支付弹窗
3. `POST /payments/wechat/notify`:微信支付回调,验签后按 `outTradeNo` 查到对应 Payment,幂等更新为 `CONFIRMED`(同一 `outTradeNo` 只处理一次,重复回调直接返回成功不重复处理),`confirmedBy` 留空表示系统自动确认,随后走 `checkBillPaid`

**支付宝(当面付,受微信内置浏览器拦截支付宝跳转限制,采用二维码方案)**
1. `POST /payments/alipay/create-order`:调支付宝当面付预下单接口(`alipay.trade.precreate`,real 模式)或返回 mock 二维码内容,创建 Payment(`channel=ALIPAY`, `status=PENDING`),返回二维码图片内容(前端渲染为 `<van-image>` 展示,租客截图后用支付宝 App 扫码支付)
2. `POST /payments/alipay/notify`:支付宝异步通知回调,验签(RSA)后按 `outTradeNo` 幂等更新 Payment 为 `CONFIRMED`,走 `checkBillPaid`

**手动催缴(M18新增,与5.2自动催租提醒共用基础设施)**
- `POST /bills/:id/remind`:单笔立即催,复用 `ReminderLog` 的当天防重复判断(同一账单当天已发送过则拒绝,提示"今天已经催过了")
- `POST /bills/batch-remind`:批量催,传 billId 数组,逐个走上面同一逻辑,单笔失败不影响其他笔
- 复用 5.2 已有的 `WechatNotifyService`(mock/real)和模板消息(`WECHAT_TEMPLATE_RENT_REMINDER`),不新增模板
- `ReminderLog` 增加 `source` 字段(`AUTO`/`MANUAL`)区分触发来源,便于房东端展示催缴历史

### 5.4 滞纳金
房东在逾期账单上一键「追加滞纳金」:新增 BillItem(type=LATE_FEE, amount 默认=该账单租金项金额, 可修改),更新 totalAmount。

### 5.5 租客端访问规则
JWT 内含 tenantId;接口只返回该租客自己租约的数据。UI 按租约状态:ACTIVE→正常;ENDED 且有未结账单→仅展示可支付的未结账单;ENDED 且结清→只读历史。

## 6. API 约定

REST,前缀 /api/v1,统一响应 `{code, message, data}`。分组:auth、buildings、room-types、rooms、tenants、leases、bills、payments、dashboard(逾期看板/空置看板/到期预警/报表)、admin(白名单、系统配置)。具体端点 Kiro 按需求自行设计,遵循 RESTful 惯例即可。

## 7. 工程约定

- 提交信息:`feat|fix|docs|chore: 描述`,每完成一个 task 至少一次提交并 push
- 后端核心业务(账单引擎、滞纳金、收款状态机)必须有单元测试;账期滚动的边界(月末、跨年)必须覆盖
- CSV 导入命令 `pnpm import:init -- <dir>`:从 data/import/ 下的标准 CSV(buildings/room_types/rooms/leases,格式见 CSV 表头,由 Claude 提供)一次性导入初始数据,幂等可重跑
- 种子脚本 `pnpm seed`:生成 4 栋楼、3 种房型、300 间房、若干租约与账单,供自测和演示
- docker-compose 一键起 MySQL;README 写清本地启动步骤
