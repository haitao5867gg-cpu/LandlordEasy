# 前端页面规格(frontend-pages.md)

> 状态:v1 定稿 | 由 Claude 制定,Kiro 按此实现,不要偏离。有异议写 questions.md。
> 目的:后端 API 已全部就绪(见各 controller),这份文档把每个页面要展示什么、调哪个接口、怎么跳转定下来,避免前端自由发挥导致字段漏看或跟接口对不上。
> 视觉细节(间距、颜色、具体样式)不做规定,直接用 Vant 4 组件默认样式即可,不需要额外设计稿。

## 0. 全局约定

- **登录态**:mock 模式下,H5 打开时 URL 带 `?mock_openid=xxx`,前端拿这个值调 `POST /auth/landlord/login`(房东端)或 `POST /auth/tenant/login`(租客端)换 JWT,存 Pinia + localStorage;之后所有请求 header 带 `Authorization: Bearer <token>`。401 统一跳回登录页。真实微信授权接入后,这一步换成微信 code 换 openid,登录接口不变。
- **请求封装**:统一一个 axios 实例(拦截器加 token、统一错误 toast),不要每个页面各写一套。
- **批量优先**:requirements.md §9 明确"禁止逐间点击式交互设计",凡是列表页(房间、账单)都要有批量入口(批量建房已有 API,批量操作账单如无 API 先不做,不要为了"批量"硬造后端没有的接口)。
- **金额**:统一两位小数展示;**日期**:统一 `YYYY-MM-DD`。
- **状态字段展示**:后端返回的英文状态值(如 `VACANT`/`RENTED`/`PENDING`/`OVERDUE`/`PAID`/`CONFIRMED`)前端做一层中文映射,不要把英文原样显示给用户。
- **空态/加载态**:统一用 Vant 的 `van-empty` / `van-loading`,不要每页各写一套。

---

## 一、landlord-h5(房东端)

登录后进入,底部 Tabbar 建议四个入口:**工作台 / 房间 / 账单 / 我的**(系统设置、报表收进"我的")。

### 页面清单

| 路由 | 页面 | 核心接口 |
|---|---|---|
| `/login` | 登录 | `POST /auth/landlord/login` |
| `/` | 工作台首页 | `GET /dashboard/vacancy` `/expiring` `/overdue`,`GET /payments/pending` |
| `/rooms` | 房间列表 | `GET /rooms?buildingId=&status=` |
| `/rooms/batch-create` | 批量建房 | `POST /rooms/batch` |
| `/rooms/:id` | 房间详情 | `GET /rooms/:id` |
| `/leases/new` | 新签租约 | `POST /leases` |
| `/leases/:id` | 租约详情 | `GET /leases/:id`,`POST /leases/:id/end`,`POST /leases/:id/renew` |
| `/bills` | 账单列表 | `GET /bills?status=&leaseId=` |
| `/bills/:id` | 账单详情 | `GET /bills/:id`,`POST /bills/:id/items`,`POST /bills/:id/late-fee` |
| `/payments/pending` | 待确认收款 | `GET /payments/pending`,`POST /payments/:id/confirm`,`POST /payments/manual` |
| `/dashboard/vacancy` | 空置看板 | `GET /dashboard/vacancy` |
| `/dashboard/expiring` | 到期预警 | `GET /dashboard/expiring` |
| `/dashboard/overdue` | 逾期看板 | `GET /dashboard/overdue` |
| `/maintenance` | 维修记录 | `GET /maintenance`,`POST /maintenance` |
| `/expenses` | 支出管理 | `GET/POST/PUT/DELETE /expenses` |
| `/reports` | 经营报表 | `GET /dashboard/reports/monthly`,`GET /dashboard/reports/deposit-summary` |
| `/settings` | 系统设置 | `GET/PUT /admin/settings`,`POST /admin/qrcode-upload` |
| `/settings/landlords` | 白名单管理 | `GET/POST/PUT/DELETE /admin/landlords` |
| `/settings/buildings` | 楼栋管理 | `GET/POST/PUT/DELETE /buildings` |
| `/settings/room-types` | 房型模板管理 | `GET/POST/PUT/DELETE /room-types` |

### 关键页面详情

**`/` 工作台首页**
四张汇总卡片,点击跳对应看板:空置房数(→`/dashboard/vacancy`)、30天内到期数(→`/dashboard/expiring`)、逾期账单数(→`/dashboard/overdue`)、待确认收款数(→`/payments/pending`)。这是房东每天打开第一眼看的页面,数字要显眼。

**`/rooms` 房间列表**
顶部楼栋 Tab 切换(全部/A栋/B栋/C栋/D栋),状态筛选(全部/空置/已租),列表每行:房号、房型、状态标签(颜色区分空置=灰/已租=绿)、当前租客姓名(已租时)。右上角按钮进 `/rooms/batch-create`(批量建房,不要做"单个新增房间"的独立入口——300 间房场景下单条新增没有意义,`POST /rooms` 接口留给批量建房页面里"补录漏掉的个别房间"这种小需求用,不用单独开一个页面)。

**`/rooms/batch-create` 批量建房**
表单:选楼栋、选房型(可不选)、起始房号、结束房号,提交调 `POST /rooms/batch`。

**`/rooms/:id` 房间详情(requirements §3.9,最重要的聚合页)**
`GET /rooms/:id` 已经把当前租约(含租客/账单/支付/押金记录/交接记录)、历史租约、维修记录、关联支出、操作日志全聚合返回了,前端只需要分区展示,不用自己拼接多个接口。建议用 Tab 或分段展示:①当前状态(在租/空置,当前租客、当前欠费)②历史租约列表(每条可展开看该任的账单/押金)③维修记录 ④关联支出 ⑤操作日志。空置状态下顶部按钮"新签租约"→跳 `/leases/new?roomId=xx`;已租状态下按钮"查看租约"→跳 `/leases/:id`。

**`/leases/new` 新签租约**
表单字段严格对应 `CreateLeaseDto`:房间(带入,不可改)、租客姓名、手机号、身份证(可选)、起止日期、月租金、押金、付款周期(月付/季付/年付,默认月付)、附加费用项(可增删的 name+amount 列表,选了房型的话可以从房型默认费用项预填,允许改)、车牌号(可选)、佣金(可选)。提交后自动生成邀请码,展示出来提醒房东发给租客(可以做个"复制邀请码"按钮)。

**`/leases/:id` 租约详情**
展示租约信息+租客信息,账单列表(点进 `/bills/:id`),两个操作按钮:"退租"(弹表单填退租日/押金退还金额/扣款原因,调 `POST /leases/:id/end`)、"续签"(弹表单填新到期日/新租金,调 `POST /leases/:id/renew`)。

**`/bills` 账单列表**
Tab 分类:全部/待付(PENDING)/已付(PAID)/逾期(OVERDUE),每行显示房号+租客+期间+金额+状态。

**`/bills/:id` 账单详情**
费用项明细(租金+各附加费,含滞纳金)、支付记录列表(每笔的渠道/金额/时间/状态)。两个操作:"追加费用项"(表单 type+name+amount,调 `POST /bills/:id/items`)、"追加滞纳金"(默认金额=租金项金额,可改,调 `POST /bills/:id/late-fee`)——只在 OVERDUE 状态显示这个按钮。

**`/payments/pending` 待确认收款**
列表每行:租客/房号/金额/上报时间/凭证截图缩略图(点开看大图),两个按钮"确认"/"驳回"(调 `POST /payments/:id/confirm`,body `{action:'confirm'|'reject'}`)。页面顶部放"手动记账"入口(表单选账单+渠道现金/转账+金额+日期,调 `POST /payments/manual`),用于线下收现金的场景。

**`/reports` 经营报表**
月份选择器 + 楼栋筛选(可选全部),展示:应收/实收/收缴率(整体 + 按楼栋表格)、支出合计(按类目)、净收益、空置率+空置损失估算,底部押金总额(`GET /dashboard/reports/deposit-summary`,含收取/退还/扣除/结余四个数字)。这页信息密度最高,建议用卡片分区而不是一个大表格堆一起。

**`/settings` 系统设置**
三块:提醒参数(到期前几天提醒、逾期间隔几天,表单数字输入,调 `PUT /admin/settings`)、收款码图片(上传组件调 `POST /admin/qrcode-upload`,上传后预览)、白名单管理入口(跳 `/settings/landlords`)。

**`/settings/landlords` 白名单管理**
房东列表(姓名/openid/启用状态),增加房东(表单 openid+姓名)、编辑姓名、禁用(软删除,不能禁用自己,后端已做这个校验,前端接口报错时直接把后端错误信息 toast 出来就行)。

---

## 二、tenant-h5(租客端)

租客通过服务号菜单或模板消息链接打开,整体应该是"越少越好"的单线流程,不需要 Tabbar。

### 页面清单

| 路由 | 页面 | 核心接口 |
|---|---|---|
| `/login` | 登录/绑定 | `POST /auth/tenant/login`,`POST /tenant/bind` |
| `/` | 我的账单 | `GET /tenant/bills` |
| `/leases` | 我的租约(多租约时用) | `GET /tenant/leases` |
| `/bills/:id/pay` | 付款上报 | `POST /payments/report` |

### 关键页面详情

**`/login` 登录/绑定**
mock 模式下带 `?mock_openid=xxx` 自动登录。登录后调 `GET /tenant/leases`(或看登录接口返回的 `bound` 字段)判断是否已绑定过租约:未绑定 → 显示"输入邀请码"表单,调 `POST /tenant/bind`;已绑定 → 直接跳 `/`。

**`/` 我的账单**
`GET /tenant/bills` 返回的是"按租约分组的账单列表",按 requirements §8 的规则前端要正确处理三种情况:①`readonly:false` 且租约 ACTIVE → 正常显示全部账单,可操作;②`readonly:false` 且租约 ENDED(即接口已经帮忙过滤成只剩未结清的)→ 显示"该房源已退租,以下为未结清账单",仍可点进去付款;③`readonly:true` → 显示"当前无在租房源"提示 + 历史账单只读列表,不出现付款按钮。如果租客绑定了多份租约(同一人先后租过不同房间),顶部要有租约切换器,不要把多份租约的账单混在一个列表里让人分不清是哪个房间的。

**`/bills/:id/pay` 付款上报**
展示收款码图片 + 账单金额,表单:实付金额(默认等于账单金额,可改,对应部分支付场景)、付款日期、上传截图(可选),提交调 `POST /payments/report`。提交后按钮变灰/显示"待房东确认",不能重复提交同一账单的上报(除非上一笔被驳回)。

**⚠️ 收款码图片来源需要后端补一个接口** —— 见下方「后端小缺口」第 1 条,这个页面暂时拿不到图片 URL,先按接口设计把 UI 搭好,等后端加了接口再接。

---

## 三、发现的后端小缺口(建议一并交给 Kiro 处理,不算前端的活但会卡前端页面)

写这份文档梳理接口时发现两个小缺口,后端已有的接口覆盖不到,建议 Kiro 顺手补一下,别等前端写到这一步才发现卡住:

1. **租客端拿不到收款码图片。** `qrcodeImageUrl` 只能从 `GET /admin/settings` 拿,这个接口在 `LandlordGuard` 后面,租客端过不去。付款页(`/bills/:id/pay`)需要展示收款码图。建议加一个 `GET /tenant/qrcode`(挂 `TenantGuard` 或者干脆不设防,反正只是一张图片 URL,不敏感),只返回 `{ qrcodeImageUrl }`。

2. **绑定邀请码后 JWT 没刷新,拿不到新 tenantId。** 首次登录时 `Tenant` 表里还没有这个 openid 对应的记录,所以登录换到的 JWT 里 `tenantId` 是空的;调完 `POST /tenant/bind` 之后,`Tenant.openid` 才被设上,但用户手里那个 JWT 还是绑定前签发的旧的,`tenantId` 依然是空,直接拿它去调 `GET /tenant/bills` 会报"未绑定租约"。前端要绕过去的话得在 bind 成功后重新调一次登录接口换新 token,多一次网络往返还容易被漏掉。建议更省事的做法:`POST /tenant/bind` 成功后直接在响应里带一个刷新过的新 JWT,前端替换掉本地存的 token 就行,不用多跳一次登录。
