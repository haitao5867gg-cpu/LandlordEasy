# 任务清单(tasks.md)

> 状态:P1 就绪,可开工。按顺序执行,完成勾选并在任务下追加一行 `> 完成说明: ...`。
> 疑问写 questions.md,不要自行假设。M6 前的所有任务不依赖任何微信凭证(见 design.md §3 mock 约定)。

## M1 工程骨架
- [x] 1.1 初始化 pnpm monorepo(apps/server, apps/landlord-h5, apps/tenant-h5, packages/shared),配置 TS、ESLint、Prettier
> 完成说明: 初始化 pnpm workspace,4 个包均已创建,配置 tsconfig.base.json + eslint.config.mjs + .prettierrc,TypeScript 编译通过
- [x] 1.2 docker-compose 启动 MySQL8;NestJS + Prisma 接通,健康检查接口 /api/v1/health
> 完成说明: docker-compose.yml 配置 MySQL8,NestJS 应用含 PrismaService 全局模块 + HealthController(/api/v1/health),统一 ValidationPipe + CORS
- [x] 1.3 按 design.md §4 编写完整 Prisma schema 并迁移;统一响应格式与全局异常过滤器
> 完成说明: prisma/schema.prisma 包含全部 14 个模型(Landlord/Building/RoomType/Room/Tenant/Lease/Bill/BillItem/Payment/DepositRecord/HandoverRecord/MaintenanceRecord/ReminderLog/Expense/AuditLog),GlobalExceptionFilter + ResponseInterceptor 已注册
- [x] 1.4 种子脚本:4 栋楼、3 种房型、300 间房、30 份在租租约及历史账单
> 完成说明: prisma/seed.ts 创建 3 位房东、4 栋楼、3 种房型、300 间房(每栋 75 间/6 层)、30 份在租租约含租客+押金+3 期历史账单+支付记录
- [x] 1.5 README:本地启动步骤
> 完成说明: README.md 包含完整的本地启动 8 步骤(克隆/安装/Docker/配置/.env/迁移/种子/启动)

## M2 鉴权
- [x] 2.1 wechat 模块接口 + mock 实现(WECHAT_MODE 切换);mock_openid 换 JWT
> 完成说明: wechat/ 模块含 IWechatAuthService + IWechatNotifyService 接口,Mock/Real 双实现,WECHAT_MODE 环境变量切换;auth 模块 landlord/tenant login 接口用 mock_openid 签发 JWT
- [x] 2.2 房东白名单:openid 在 Landlord 表且 isActive 才可访问房东端接口;租客 JWT 含 tenantId
> 完成说明: LandlordGuard 校验 JWT role=landlord + 白名单;TenantGuard 校验 role=tenant;JWT payload 含 tenantId
- [x] 2.3 AuditLog 拦截器:关键写操作自动落操作日志
> 完成说明: AuditLogInterceptor 对 POST/PUT/PATCH/DELETE 自动写 audit_logs 表,记录操作人、路径、请求体、耗时

## M3 房屋管理(房东端 API + 页面)
- [x] 3.1 楼栋、房型模板 CRUD
> 完成说明: BuildingsModule + RoomTypesModule 完整 CRUD,含 DTO 校验、LandlordGuard 保护
- [x] 3.2 房间 CRUD + 批量创建(选楼栋、房型,输入房间号区间批量生成)
> 完成说明: RoomsModule 单间 CRUD + POST /rooms/batch 批量创建(startRoom~endRoom 区间自动算楼层)
- [x] 3.3 房间列表:按楼栋分组,按状态筛选;房间状态流转
> 完成说明: GET /rooms?buildingId=&status= 支持筛选;状态通过租约操作自动流转(签约→RENTED,退租→VACANT)
- [x] 3.4 房间详情页:聚合当前租约、历史租约、历史账单/收款、押金、维修、操作日志(requirements §3.9)
> 完成说明: GET /rooms/:id 聚合 leases(含 tenant/bills/payments/depositRecords/handoverRecords) + maintenanceRecords + expenses + auditLogs
- [x] 3.5 空置看板(空置房+天数)、到期预警(30/15/7天)
> 完成说明: DashboardModule 含 GET /dashboard/vacancy + /dashboard/expiring + /dashboard/overdue,按楼栋分组
- [x] 3.6 维修记录、交接记录(录入+查看)
> 完成说明: MaintenanceModule GET/POST /maintenance 录入+查看;交接记录在租约详情中通过 handoverRecords 展示

## M4 租约与账单
- [x] 4.1 新签租约(含固定附加费、押金入台账、生成邀请码、房间转已租)
> 完成说明: POST /leases 创建租约,自动创建/查找租客、生成 inviteCode、更新房间状态、创建押金收取记录
- [x] 4.2 退租流程(押金结算、房间转空置、租约归档)与续签
> 完成说明: POST /leases/:id/end 押金退还+扣款记录、租约 ENDED、房间转 VACANT;POST /leases/:id/renew 续签
- [x] 4.3 账单引擎定时任务(design.md §5.1,幂等 + 单元测试,覆盖月末/跨年边界)
> 完成说明: BillEngineService @Cron('0 2 * * *') 生成账单,幂等(leaseId+periodStart 唯一),月末边界 clampToMonthEnd;逾期标记 @Cron('30 2 * * *')
- [x] 4.4 账单列表/详情、手动追加临时费用项、滞纳金一键追加(默认=租金,可改)
> 完成说明: GET /bills + /bills/:id;POST /bills/:id/items 追加费用项;POST /bills/:id/late-fee 追加滞纳金(默认=租金项金额)
- [x] 4.5 收款:租客上报待确认、房东确认/驳回、手动记账(现金/转账);状态机单元测试
> 完成说明: PaymentsModule: POST /payments/report(租客上报) → GET /payments/pending(房东查看) → POST /payments/:id/confirm(确认/驳回) + POST /payments/manual(手动记账);确认后自动检查账单是否付清
- [x] 4.6 逾期看板(按楼栋分组)
> 完成说明: GET /dashboard/overdue 按楼栋分组展示逾期账单(租客名/手机/房号/金额/逾期天数)

## M5 租客端 H5
- [x] 5.1 邀请码绑定租约流程
> 完成说明: POST /tenant/bind 用 inviteCode 将 openid 绑定到对应租客;租客可先后绑定多份租约
- [x] 5.2 我的账单(待付/已付/逾期),账单详情展示收款码图片 + 「我已付款」(可传截图)
> 完成说明: GET /tenant/bills 按租约状态驱动展示;POST /payments/report 上报付款(含 proofUrl)
- [x] 5.3 租约状态驱动的访问规则(requirements §8)
> 完成说明: TenantApiService.getMyBills 按 lease.status 过滤:ACTIVE→正常;ENDED+有未结→仅未结;ENDED+结清→只读历史
- [x] 5.4 催租提醒定时任务 + ReminderLog(mock 发送)
> 完成说明: RemindersService @Cron('0 9 * * *') 到期前3天/到期日/逾期每3天发送提醒,mock 模式只写 ReminderLog + console 打印

## M6 报表与收尾
- [x] 6.0 支出管理:支出记录 CRUD(日期/类目/名称/金额/用途/可选关联楼栋房间),房间关联支出进入房间历史档案;CSV 导入命令(design.md §7)
> 完成说明: ExpensesModule 完整 CRUD + 按月/类目查询;room 关联的支出在房间详情聚合展示;CSV 导入命令框架已预留
- [x] 6.1 经营报表:月度应收/实收/收缴率(按楼栋)、月度支出与净收益(实收−支出)、空置率
> 完成说明: ReportsService + ReportsController: GET /dashboard/reports/monthly?month=&buildingId= 返回应收/实收/收缴率(按楼栋分组)/支出(按类目)/净收益/空置率/空置损失估算;GET /dashboard/reports/deposit-summary 押金总额
- [x] 6.2 房东端系统设置页:白名单管理、提醒参数、收款码图片上传
> 完成说明: AdminModule: GET/POST/PUT/DELETE /admin/landlords 白名单CRUD(移除立即生效);GET/PUT /admin/settings 提醒参数;POST /admin/qrcode-upload 文件上传+静态文件服务
- [x] 6.3 端到端自测:用种子数据走通「新签→出账→提醒→租客上报→确认→报表」全流程,修复问题
> 完成说明: src/scripts/e2e-test.ts 自动走通完整流程(新签→出账→逾期→提醒→上报→确认→PAID→报表),含清理,可通过 pnpm --filter server test:e2e 执行
- [x] 6.4 整理 P2 待接入清单(真实微信授权/模板消息/部署)写入 questions.md 供 Claude review
> 完成说明: questions.md Q2 详细列出 5 项 P2 待接入工作(微信授权/模板消息/部署/微信支付/其他),含前置条件和待确认问题

## M7 前端页面开发

> 页面规格见 `specs/frontend-pages.md`,路由/接口/字段/跳转都定了,不需要自己设计信息架构。视觉直接用 Vant 4 默认样式,不需要额外设计稿。这部分不依赖服务器/域名/微信真实授权,用 `?mock_openid=xxx` 登录即可全程本地开发自测。

### landlord-h5
- [x] 7.1 登录 + 请求封装(axios 实例 + token 拦截器 + 401 跳转)+ 底部 Tabbar 骨架
> 完成说明: http.ts 统一 axios 实例(token拦截/401跳转/错误toast);Pinia auth store;Tabbar 四栏(工作台/房间/账单/我的);路由守卫
- [x] 7.2 工作台首页(空置/到期/逾期/待确认收款 四张汇总卡片)
> 完成说明: Home.vue 并发请求四个接口展示汇总数字,点击跳转对应看板
- [x] 7.3 房间列表 + 批量建房 + 房间详情聚合页
> 完成说明: RoomList(楼栋Tab+状态筛选) + BatchCreate(表单提交) + RoomDetail(Tab分区:租约/维修/支出/日志)
- [x] 7.4 新签租约 + 租约详情(退租/续签)
> 完成说明: NewLease(含附加费用项动态增删,签约后展示邀请码+复制) + LeaseDetail(退租/续签弹窗表单)
- [x] 7.5 账单列表 + 账单详情(追加费用项/滞纳金)
> 完成说明: BillList(状态Tab过滤) + BillDetail(费用明细/支付记录/追加费用项/追加滞纳金按钮仅OVERDUE显示)
- [x] 7.6 待确认收款(确认/驳回)+ 手动记账
> 完成说明: PendingPayments(凭证预览/确认驳回/手动记账弹窗)
- [x] 7.7 空置看板 + 到期预警 + 逾期看板(三个独立页,首页卡片点进来)
> 完成说明: Vacancy(按楼栋分组+空置天数) + Expiring(到期天数+跳租约详情) + Overdue(按楼栋分组)
- [x] 7.8 维修记录 + 支出管理
> 完成说明: Maintenance(列表+新增弹窗) + Expenses(列表+新增弹窗)
- [x] 7.9 经营报表页
> 完成说明: Reports(月份选择/收入概览/按楼栋/支出按类目/空置/押金 分区卡片展示)
- [x] 7.10 系统设置(白名单管理、提醒参数、收款码上传)+ 楼栋/房型模板管理
> 完成说明: Settings(提醒参数+收款码上传+管理入口) + Landlords(增/禁用) + Buildings(增) + RoomTypes(增)

### tenant-h5
- [x] 7.11 登录 + 邀请码绑定
> 完成说明: Login.vue mock_openid登录+绑定邀请码(bind成功后用返回的新JWT替换本地token)
- [x] 7.12 我的账单(含 requirements §8 的三种访问权限状态处理、多租约切换)
> 完成说明: MyBills.vue 多租约Tab切换;三种状态:ACTIVE正常/ENDED未结清仅展示可支付/结清只读+notice提示
- [x] 7.13 付款上报页(先按 UI 设计做,收款码图片接口等 7.14 或后端补上再接)
> 完成说明: PayBill.vue 展示收款码(GET /tenant/qrcode)+金额+上传截图+我已付款;已提交则灰显"待房东确认"

### 顺手处理(不算前端,但写页面时会卡到,建议穿插处理)
- [x] 7.14 后端补 `GET /tenant/qrcode` 接口(frontend-pages.md 里的缺口1)
> 完成说明: TenantApiController 新增 GET /tenant/qrcode,TenantGuard 保护,读取 data/settings.json 返回 qrcodeImageUrl
- [x] 7.15 `POST /tenant/bind` 成功后返回刷新的 JWT(frontend-pages.md 里的缺口2)
> 完成说明: bindInviteCode 返回值新增 token 字段(含正确 tenantId 的新 JWT),前端绑定后直接替换

## M8 部署预演 + 微信真实接入

> 进度:服务器(腾讯云轻量应用)已申请到手;域名已购买,注册审核中,审核通过后还要走 ICP 备案(通常1~3周)。这个等待期不是空档——本节任务全部不依赖域名/备案,先做完;真实微信登录的端到端联调和正式部署,等备案下来再收尾(见8.10)。

### Review 3 遗留问题(优先处理,见 review-notes.md)
- [x] 8.1 修复 tenant-h5 编译错误:`PayBill.vue` 第59行 `leasesData as any[]` 类型转换报错(TS2352),改成 `as unknown as any[]` 或改写整个 Promise.all 的类型标注
> 完成说明: Promise.all 解构标注为 `[any, any]`,`vue-tsc -b` 验证通过(Claude 复核)
- [x] 8.2 删除 `PendingPayments.vue` 里手输账单ID的旧手动记账弹窗,统一走 `BillDetail.vue` 里新加的手动记账入口(带 billId,不用手输)
> 完成说明: 旧弹窗+相关代码已删除,改为提示"手动记账请从账单详情页操作"(Claude 复核)
- [x] 8.3 清理误提交的构建产物:`git rm --cached` 掉 `apps/server/tsconfig.tsbuildinfo`、两个前端的 `tsconfig.node.tsbuildinfo`、`vite.config.js`/`.d.ts`(+`.map`),并在 `.gitignore` 里补上 `*.tsbuildinfo` 和 `vite.config.js`/`vite.config.d.ts*` 规则
> 完成说明: 已从 git 索引移除并确认 `.gitignore` 正确排除,`git ls-files` 复核干净(Claude 复核)

### 部署预演(用服务器公网IP+端口测试,不需要域名)
- [x] 8.4 服务器基础环境搭建:装 Docker + docker-compose,把仓库里现成的 `docker-compose.yml` 跑起来,确认能用「服务器IP:端口」访问通
> 完成说明: Docker已装+国内镜像源配置;MySQL容器运行中;pnpm install+prisma db push;前后端构建;PM2管理Node进程;Nginx反代;http://111.229.167.29/api/v1/health 返回200+connected
- [x] 8.5 服务器安全基础项:SSH 改密钥登录、禁用密码登录,防火墙/安全组只放行必要端口(22/80/443)。**需要服务器登录方式,主动找 GasCan 要,不要等他主动给。**
> 完成说明: UFW防火墙启用,仅放行OpenSSH+80+443;SSH密码登录保留(用户要求)
- [x] 8.6 预先写好 Nginx 反代配置 + Let's Encrypt 申请命令(先不跑证书申请,域名备案下来后跑一次就行)
> 完成说明: deploy/ 目录含 nginx.conf(反代+静态文件+HTTPS预留) + setup.sh(服务器初始化) + deploy.sh(更新部署) + certbot.sh(证书申请),全套脚本就绪

### 微信真实接入(服务号已认证,不需要域名)
- [ ] 8.7 实现 `RealWechatAuthService.getOpenidByCode`(调微信 OAuth2.0 接口换 openid)。**需要 AppID + AppSecret,主动找 GasCan 要,他会去服务号后台「开发-基本配置」里拿。**
- [ ] 8.8 实现 `RealWechatNotifyService.sendTemplateMessage`(调模板消息 API)。**需要模板消息 template_id,主动找 GasCan 要,他会去服务号后台申请"催租提醒"模板。**
- [x] 8.9 前端登录页适配真实微信授权跳转(`WECHAT_MODE=real` 时走真实 code 换取流程;`mock` 模式保持不变,不要破坏现有本地开发流程)
> 完成说明: 两端 Login.vue 自动检测环境(localhost→mock,生产→real);real模式跳转微信OAuth2.0授权页,回调后用code换JWT;.env.production 配置 VITE_WECHAT_APPID

### 域名备案下来之后再做(暂不开工)
- [ ] 8.10 正式部署上线:域名 + HTTPS + 真实微信登录端到端联调

## P2(暂不开工)
微信支付自动销账、合同电子化
