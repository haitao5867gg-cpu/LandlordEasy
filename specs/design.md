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
- **Lease** 租约:id, roomId, tenantId, startDate, endDate, rent, deposit, payCycle(MONTHLY/QUARTERLY/YEARLY), feeItems(JSON, 固定附加费), status(ACTIVE/ENDED), inviteCode(唯一), endedAt?, endReason?
- **Bill** 账单:id, leaseId, periodStart, periodEnd, dueDate, status(PENDING/PAID/OVERDUE/CANCELED), totalAmount(冗余=items合计)
- **BillItem** 账单费用项:id, billId, type(RENT/FEE/LATE_FEE/OTHER), name, amount
- **Payment** 支付记录:id, billId, channel(QRCODE/WECHATPAY/CASH/TRANSFER), amount, status(PENDING_CONFIRM/CONFIRMED/REJECTED), proofUrl?, paidAt, confirmedBy?(landlordId), confirmedAt?
- **DepositRecord** 押金台账:id, leaseId, type(RECEIVE/REFUND/DEDUCT), amount, reason?, operatorId
- **HandoverRecord** 交接:id, leaseId, type(CHECKIN/CHECKOUT), checklist(JSON), remark
- **MaintenanceRecord** 维修:id, roomId, date, content, cost, operatorId
- **ReminderLog** 提醒记录:id, billId, tenantId, type(PRE/DUE/OVERDUE), sentAt, channel, success
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

### 5.3 收款闭环(阶段一)
租客点「我已付款」→ 创建 Payment(PENDING_CONFIRM, channel=QRCODE, 可传截图)→ 房东端待确认列表 → 确认后 Payment=CONFIRMED,账单实收累计 ≥ 应收则 Bill=PAID。房东也可直接为账单录入 CASH/TRANSFER 支付(直接 CONFIRMED)。

### 5.4 滞纳金
房东在逾期账单上一键「追加滞纳金」:新增 BillItem(type=LATE_FEE, amount 默认=该账单租金项金额, 可修改),更新 totalAmount。

### 5.5 租客端访问规则
JWT 内含 tenantId;接口只返回该租客自己租约的数据。UI 按租约状态:ACTIVE→正常;ENDED 且有未结账单→仅展示可支付的未结账单;ENDED 且结清→只读历史。

## 6. API 约定

REST,前缀 /api/v1,统一响应 `{code, message, data}`。分组:auth、buildings、room-types、rooms、tenants、leases、bills、payments、dashboard(逾期看板/空置看板/到期预警/报表)、admin(白名单、系统配置)。具体端点 Kiro 按需求自行设计,遵循 RESTful 惯例即可。

## 7. 工程约定

- 提交信息:`feat|fix|docs|chore: 描述`,每完成一个 task 至少一次提交并 push
- 后端核心业务(账单引擎、滞纳金、收款状态机)必须有单元测试;账期滚动的边界(月末、跨年)必须覆盖
- 种子脚本 `pnpm seed`:生成 4 栋楼、3 种房型、300 间房、若干租约与账单,供自测和演示
- docker-compose 一键起 MySQL;README 写清本地启动步骤
