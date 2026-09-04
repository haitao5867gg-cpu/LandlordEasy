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
- **ContractSigningTask** 电子签约记录(2026-08-31新增,2026-09-01改为微签平台调整字段,M19):id, leaseId, type(NEW/RENEW), sceneValue(微信场景值,唯一,用于关注/扫描事件回调匹配), qrCodeImage(关注二维码图片,data URI或存储路径), waterMeterReading?/electricityMeterReading?/gasMeterReading?(Decimal,可选), facilities(JSON,固定12项设施的勾选状态,对应合同"屋内主要设施"栏), extraTerms?(补充条款自由文本), status(PENDING_SCAN/FOLLOWED/CREATED/SIGNED/EXPIRED), weiqianBId?(微签互签业务ID,发起签署后才有), weiqianShortCode?(微签互签短链码,组签署链接用), signedPdfUrl?, signedAt?, createdAt
- **ContractSettings** 合同签约全局配置(2026-09-01新增,单例表,M19):id, landlordName, landlordIdCard, landlordPhone(合同甲方固定信息,不因租约而变), defaultPenaltyMonths(默认违约金月数), defaultOverdueDays(默认逾期容忍天数), defaultCleaningFee(默认退房清洁费), defaultRenewNoticeDays(默认续租提前通知天数), updatedAt

关系要点:Room 1-N Lease(历史);Lease 1-N Bill;Bill 1-N Payment;Lease 1-N ContractSigningTask(每次新签/续签各一条,**不会互相覆盖**,即使 `renew` 直接 `update` 同一条 Lease 记录,签约记录本身独立留存);Tenant 1-N Lease(可回头再租)。房间详情页聚合 = 按 roomId 串起以上所有表,含 ContractSigningTask 历史。

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

### 5.6 合同电子签约(2026-08-31立项,2026-09-01改用微签平台重新设计)

> **平台变更记录**:最初选定腾讯电子签,深入设计后发现API接入需购买专业版超预算,e签宝/爱签/法大大逐一排查也都不满足预算(¥2000以内)。改用**微签**(上海复园电子科技有限公司,`www.weiqian.com.cn`,按份计费¥1.7/份),GasCan已用体验额度实测确认可用。API文档存档于 `docs/微签API文档.md`(**这份是从聊天附件转存的,原始.doc不入库**);合同模板结构(不含真实租客个人信息)存档于 `docs/合同模板结构.md`。下面的设计基于这两份文档 + 与微签技术人员的问答确认(2026-09-01)。

**平台**:微签,密钥(`WEIQIAN_APP_ID`/`WEIQIAN_APP_SECRET`/`WEIQIAN_COMPANY_ID`/`WEIQIAN_SEAL_ID`)已配置在dev服务器 `.env.dev`(体验额度测试用,`WEIQIAN_MODE=mock`起步)。签名算法:公共参数(不含Sign、不含文件流)按参数名ASCII升序排序拼接成`Key=Value&...`,用`AppSecret`做`HMAC-SHA256`再`Base64`编码,放进请求头`Sign`;`AppId`/`Timestamp`(毫秒级,15分钟有效)/`AuthMode`(固定`Signature`)一并放请求头,业务参数放`Data`(JSON字符串)。测试环境 `http://forwave.picp.net:8888/openapi/v1/`,正式环境 `https://www.weiqian.com.cn:8887/openapi/v1/`。

**新增环境变量模式**:仿照 `WECHAT_MODE`/`PAYMENT_MODE`,新增 `WEIQIAN_MODE=mock|real`。

**数据模型变更**:
- `Tenant.idCard` **维持 `String?` 可空**——查过dev(679条)和生产(681条)历史Tenant记录,idCard 100%为NULL,这是从未采集过的历史数据,无法回填真实身份证号,收紧成数据库层必填既不可行也没必要。改为只在**应用层**(DTO + 前端表单)对新建/编辑租约强制必填+格式校验(11位手机号、15或18位身份证号含X),对历史数据不做追溯要求。
- 新增 `ContractSettings` 单例配置表:甲方(出租人)姓名/身份证号/电话(合同上甲方信息固定不变,不因租约而变) + 违约金月数/逾期容忍天数/清洁费/续租提前通知天数四项默认值(系统设置页配置,发起签约时可按需覆盖)
- `ContractSigningTask` 新增 `extraTerms`(补充条款自由文本,可空)
- `ContractSigningTask.status` 状态机在 PENDING_SCAN 和 CREATED 之间补一个 **FOLLOWED**(已关注公众号,待房东发起签署)——原设计是"一关注就自动创建签署任务",但这次 GasCan 描述的是"我可以发起签署"这个主动动作,所以拆成两步:关注只是解锁"发起签署"按钮(避免二维码生成了没人扫、白白占坑),真正调用微签(消耗额度)由房东主动点击触发
- 房屋用途字段合同上写死"住宅",不建模

**合同PDF生成**(新增能力,`docs/合同模板结构.md` 记录了完整字段清单):按 HTML 模板 + 动态字段替换生成,用 **Puppeteer** 渲染成 PDF——选它不是因为轻,是因为微签的接收方/发起方盖章都是**固定坐标**(0-1000区间,不支持关键字定位),模板必须像素级可复现,HTML/CSS 在固定 viewport 下渲染是最容易保证这一点的方式。模板设计要点:所有变长字段(姓名/地址/金额大写等)必须用固定高度容器,不能让内容溢出挤动后续元素坐标。金额需要"数字转中文大写"工具函数(新增)。

**触发流程**:
1. 房东在租约详情页点「生成电子签约」,弹窗填写水电表底数(可选)+屋内设施勾选(12项固定选项,对应合同原文)+补充条款(可选自由文本)+四项默认条款数值(预填 `ContractSettings` 默认值,可覆盖)——**水电表/设施/补充条款挂在 `ContractSigningTask` 上,不是 `Lease` 字段**,提交后创建一条 `ContractSigningTask`(status=PENDING_SCAN),调微信「生成带参数二维码」接口(复用19.2已有能力,场景值关联这条记录),返回二维码图片供房东截图转发。**这一步不调用微签API,不消耗额度**。
2. 微信「关注事件」/「扫描事件」webhook(复用19.2已有的 mock/real 分层):按场景值查到对应 `ContractSigningTask`,若状态是 PENDING_SCAN → 更新为 **FOLLOWED**,通过「客服消息」提示租客"房东会尽快发起签约,请留意后续消息";若场景值未匹配(已用过/过期/普通关注无场景值),走默认欢迎语兜底。
3. 房东在租约详情页看到状态变 FOLLOWED 后,点「发起签署」:
   - 系统按模板生成合同PDF(Puppeteer)
   - 调微签 `eachSign/upload` 上传PDF拿 `bId`
   - 调微签 `eachSign/create` 创建互签任务:`launcherSignRule` 配置好 `sealId` 让发起方(我方/房东)自动盖章,不需要人工操作;`receiverDTOS` 填租客手机号(`account`)+姓名+身份证号,`authType=2`(实名认证,微签确认过法律效力更高);`expiresTime` 设合理有效期;`finishSignJumpPage` 指向tenant-h5的签约完成页
   - 拿到 `shortCode`,组出签署链接;通过微信「客服消息」+ 微签 `isSendSmsToReceiver` 短信**两个渠道一起发**给租客
   - 更新 status=CREATED,记录 `weiqianBId`/`weiqianShortCode`
4. 租客打开链接完成实名认证+签署(只需租客单方签字,出租人甲方信息固定不变,不做变量)
5. **签署状态确认**(微签没有真正的服务端webhook,只有客户端跳转带参数,不能当作唯一凭证,做法参考支付回调的"不轻信客户端参数、服务端主动核实"原则):
   - 租客签完浏览器跳转到 `finishSignJumpPage` → 后端立即尝试调 `eachSign/download` 核实文件是否已生成
   - 同时有后台定时轮询兜底(类似 `BillEngineService` 的定时任务模式),对所有还处于CREATED状态、超过一定时间没有确认完成的任务,定期重试 `download`
   - 核实拿到有效PDF后:更新 `ContractSigningTask.status=SIGNED`,下载文件存到系统 `uploads` 目录(不依赖每次都去微签取),记录 `signedPdfUrl`、`signedAt`
   - **自动绑定**:用关注/扫描事件里拿到的openid写入该 Lease 关联 Tenant 的 openid 字段;若该 Tenant 已绑定其他openid,不静默覆盖,记录异常留待房东人工核实
6. 房东端租约详情页展示签约进度(PENDING_SCAN/FOLLOWED/CREATED/SIGNED),SIGNED 状态下提供在线预览(PDF)+下载入口

**本轮范围**:先做成功路径最小可用版本;租客拒签、签署链接过期、房东撤销重新发起这几个边界状态本轮不做,留待下一轮迭代。

### 5.7 租客自助流程 M21:退租违约/换租/在线报修 + 房东群发通知(2026-09-05)

**数据模型**:新增4张表——`RepairRequest`(leaseId/tenantId/roomId/description/status[SUBMITTED→IN_PROGRESS→RESOLVED]/landlordNote/resolvedCost/resolvedBy/resolvedAt)、`LeaseTerminationRequest`(leaseId/tenantId/requestedMoveOutDate/reason/status[PENDING/APPROVED/REJECTED]/suggestedPenalty/finalPenalty/landlordNote/resolvedBy/resolvedAt)、`RoomTransferRequest`(leaseId旧租约/tenantId/preferredRoom/reason/status/targetRoomId/newLeaseId新租约,leaseId和newLeaseId都指向Lease,用具名relation区分)、`Announcement`(title/content/propertyId可空/createdBy/successCount/failCount)。

**核心编排逻辑(`leases.service.ts`,大量复用已有方法而非重新实现)**:
- 违约金计算:`月租金 × 该租约最近一次ContractSigningTask.penaltyMonths(没有则用ContractSettings.defaultPenaltyMonths)`,只是"建议值",房东审批时可覆盖成`finalPenalty`。
- 退租批准 = 调用既有`endLease()`(depositRefund=max(0,押金-违约金),depositDeductReason记录违约金),若违约金超过押金,额外调用新增的私有方法`createAdHocBill()`生成一张一次性账单(periodStart用搬离日,冲突时顺延一天重试,避免撞`@@unique([leaseId,periodStart])`)。
- 换租批准 = 调用既有`endLease()`结束旧租约 → 调用既有`create()`用同一租客手机号在目标房间开新租约(`create()`本身按手机号查找/复用Tenant,不会产生重复记录)→ 调用既有`createContractSigningTask()`(这个方法内部本来就会在tenant.openid已绑定时自动触发`launchContractSigningTaskInternal`——M20.4已经做的能力,这里白捡)。**没有发明任何新的微签调用逻辑**,纯粹是编排三个已验证过的方法。
- 报修完成时若填了`resolvedCost>0`,顺手创建一条`MaintenanceRecord`,跟房东手动记录的维修台账口径统一。
- 群发通知:按`propertyId`(可选)过滤出`openid不为空`且有`ACTIVE`租约的Tenant,逐个调用`IWechatCustomerServiceService.sendTextMessage`,如实统计`successCount`/`failCount`存档,不做重试也不假装100%送达。

**前端**:landlord-h5新增`Applications.vue`(三tab统一入口,工作台卡片带待处理数量角标)+`settings/Announcements.vue`(群发通知,复用现有公寓切换器选择范围);tenant-h5新增`LeaseServices.vue`(挂在`/leases/:id/services`,三个子表单+各自的历史/状态展示,不是分成三个路由)。

**范围内的产品判断(供后续接手参考)**:
- 换租不允许租客直接选目标房间,只能填自由文本"期望房间"——房源具体分布/租金不适合对所有租客公开,目标房间由房东在审批时从空置房间选择。
- 三类申请不接入新的微信模板消息(会卡在申请审核,M18/M19已经吃过这个亏),先用"房东进App看待办列表"模式;群发通知同理走客服消息不走模板消息。GasCan已知晓这个决定,后续需要时可以再补模板消息申请。

## 6. API 约定

REST,前缀 /api/v1,统一响应 `{code, message, data}`。分组:auth、buildings、room-types、rooms、tenants、leases、bills、payments、dashboard(逾期看板/空置看板/到期预警/报表)、admin(白名单、系统配置)。具体端点 Kiro 按需求自行设计,遵循 RESTful 惯例即可。

## 7. 工程约定

- 提交信息:`feat|fix|docs|chore: 描述`,每完成一个 task 至少一次提交并 push
- 后端核心业务(账单引擎、滞纳金、收款状态机)必须有单元测试;账期滚动的边界(月末、跨年)必须覆盖
- CSV 导入命令 `pnpm import:init -- <dir>`:从 data/import/ 下的标准 CSV(buildings/room_types/rooms/leases,格式见 CSV 表头,由 Claude 提供)一次性导入初始数据,幂等可重跑
- 种子脚本 `pnpm seed`:生成 4 栋楼、3 种房型、300 间房、若干租约与账单,供自测和演示
- docker-compose 一键起 MySQL;README 写清本地启动步骤
