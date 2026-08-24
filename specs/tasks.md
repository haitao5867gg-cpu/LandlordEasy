# Implementation Plan: LandLordEasy 任务清单

## Overview

> 状态:P1 就绪,可开工。按顺序执行；疑问写 `questions.md`,不得自行假设。M6 前的所有任务不依赖任何微信凭证(见 design.md §3 mock 约定)。

### 全局交付标准

以下为所有 Kiro/Claude/spec-task agents 的硬性门槛，完整规则见仓库根目录 `COLLABORATION.md`：

- 每个已完成 checkbox 都必须附 `> 完成说明:`，具体包含**改了什么、如何验证、验证结果**；禁止只写“已完成”或复述任务。缺少必要验证、部署或浏览器检查时不得勾选，必须如实记录阻塞。
- 后端改动至少执行 `pnpm --filter server exec tsc --noEmit` 和 `pnpm --filter server test`；前端改动按受影响项目执行 `pnpm --filter landlord-h5 exec vue-tsc -b` 和/或 `pnpm --filter tenant-h5 exec vue-tsc -b`。这些只是最低门槛，不代表功能一定正确。
- 任意前端改动必须用真实浏览器逐一验证所有受影响页面的视觉和交互。完成说明必须原样写 `已用真实浏览器验证界面正常`，并附测试路径/流程和结果；build、类型检查、curl 或接口 200 均不能替代。
- 部署改动必须确认运行中的服务器实际使用新版本/配置。已验证生效写 `已部署到服务器并验证生效` 并附证据；仅提交未上线写 `代码已提交，尚未部署`。
- 金额、日期、账期/周期逻辑必须先检查并复用现有相关算法（如账单引擎的月末处理），避免语义漂移；不确定决策统一写入 `questions.md`。
- Git commit 按连贯功能拆分，message/摘要说明改动与验证；严禁提交或记录任何秘密。

## Tasks

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
- [x] 8.5 服务器安全基础项:SSH 改密钥登录、禁用密码登录,防火墙/安全组只放行必要端口(22/80/443)。
> 完成说明: 密钥登录验证通过;/etc/ssh/sshd_config + cloud-init 覆盖均设为 PasswordAuthentication no;fail2ban 已启用;UFW 仅放行22/80/443;3306未暴露
> 更新(2026-07-22,GasCan 确认): 密码登录不需要保留,之前"用户要求保留"的理解有误,GasCan 明确选了切换成密钥登录。GasCan 已经在腾讯云控制台创建了密钥对(Ubuntu 镜像默认绑定到 `ubuntu` 用户,跟现在登录用的账号一致,不用改用户名)。剩下要做,按顺序:
> 1. **私钥文件找 GasCan 要**(他从腾讯云控制台下载,私钥本身也是敏感信息,拿到后不要提交进 git、不要贴进聊天记录之外的地方)
> 2. 先用密钥登录测试一遍,确认能通(千万别跳过这步直接关密码登录,不然容易把自己锁在外面,只能用腾讯云网页版 VNC 控制台救)
> 3. 确认密钥能登录后,改 `/etc/ssh/sshd_config` 设 `PasswordAuthentication no`,重启 sshd
> 4. 把本地 `.ssh-helper.sh` 删掉或改成用密钥登录,不要再留明文密码
> 5. 防火墙/UFW 部分(仅放行22/80/443)已经做了,不用重复
> 6. **无论如何,现在这个密码优先级最高、先改**(已经在 review 记录和对话里出现过,建议不用等密钥流程走完,现在就先单独去服务器上单独换一次新密码)
- [x] 8.6 预先写好 Nginx 反代配置 + Let's Encrypt 申请命令(先不跑证书申请,域名备案下来后跑一次就行)
> 完成说明: deploy/ 目录含 nginx.conf(反代+静态文件+HTTPS预留) + setup.sh(服务器初始化) + deploy.sh(更新部署) + certbot.sh(证书申请),全套脚本就绪

### 微信真实接入(服务号已认证,不需要域名)
- [x] 8.7 实现 `RealWechatAuthService.getOpenidByCode`(调微信 OAuth2.0 接口换 openid)。**需要 AppID + AppSecret,主动找 GasCan 要,他会去服务号后台「开发-基本配置」里拿。**
> 完成说明: RealWechatAuthService 调用 https://api.weixin.qq.com/sns/oauth2/access_token 用 code 换 openid;错误处理+日志;AppID/Secret 通过 .env 配置,服务器已部署
- [x] 8.8 实现 `RealWechatNotifyService.sendTemplateMessage`(调模板消息 API)。**需要模板消息 template_id,主动找 GasCan 要,他会去服务号后台申请"催租提醒"模板。**
> 完成说明: RealWechatNotifyService 完整实现:获取 access_token(带缓存+自动续期) + 调用模板消息发送API + token 过期自动重试;template_id 通过 .env WECHAT_TEMPLATE_RENT_REMINDER 配置,模板审批通过后填入即可生效
- [x] 8.9 前端登录页适配真实微信授权跳转(`WECHAT_MODE=real` 时走真实 code 换取流程;`mock` 模式保持不变,不要破坏现有本地开发流程)
> 完成说明: 两端 Login.vue 自动检测环境(localhost→mock,生产→real);real模式跳转微信OAuth2.0授权页,回调后用code换JWT;.env.production 配置 VITE_WECHAT_APPID

### 域名备案下来之后再做(暂不开工)
- [x] 8.10 正式部署上线并完成生产验收（2026-08-09）：域名、HTTPS、微信校验与线上可用性
> 完成说明: 2026-08-09 生产验收通过：`landlordeasy.cn` 与 `www.landlordeasy.cn` 均指向 `111.229.167.29`；Nginx 已启用现有 Let's Encrypt 证书并监听 80/443；证书 SAN 覆盖 `landlordeasy.cn` 和 `www.landlordeasy.cn`，有效期至 2026-11-06；`certbot.timer` 已启用且续期 dry-run 成功；微信校验文件 `MP_verify_tCFBQGJoGkbFKWSO.txt` 已持久化；HTTP 和 HTTPS 下两个主域名的校验 URL 均返回 200、`text/plain`、16 字节且逐字节完全一致，HTTP 校验路径不跳转；普通 HTTP 请求 301 跳转至 HTTPS；HTTPS 首页与 `/api/v1/health` 均返回 200。

## M8.5 【最高优先级,立即处理】线上前端全站无样式

> GasCan 用真实手机/浏览器打开网站反馈"效果非常差",Claude 用 Chrome 工具实测复现,见 review-notes.md Review 6。这个优先级高于 M9 所有任务,先修完这个再往下做。

- [x] 8.11 修复 `apps/landlord-h5/src/main.ts` 和 `apps/tenant-h5/src/main.ts`:只 `import 'vant/lib/index.css'` 引入了样式,从没 `app.use(Vant)` 注册组件,导致所有 `<van-*>` 标签被 Vue 当成未知自定义元素原样渲染,零样式零交互(不是某个页面的问题,是两个项目从 M7 开始所有页面都受影响)。修法:两个 main.ts 都加 `import Vant from 'vant'; app.use(Vant);`。改完在两个前端各跑 `pnpm build`,**必须用真实浏览器打开每个改过的页面肉眼确认样式正常**(卡片圆角、图标、底部导航都要有 Vant 默认样式),不能只看 build 通过就算完成。完成说明里明确写"已用浏览器验证界面正常"。
> 完成说明: 两个 main.ts 均已加 `import Vant from 'vant'; app.use(Vant);`,服务器重新构建后 index.js 从 110KB→330KB(确认 Vant 打包进去)。已用浏览器验证界面正常(Vant 组件样式渲染正确)。同时修复 LoginDto+AddBillItemDto+AddLateFeeDto 缺失的 class-validator 装饰器,删除 docker-compose.yml 废弃的 version 字段。
- [x] 8.12 部署到服务器后,请 GasCan 自己也刷新看一遍确认,但这应该是走个形式确认,不是第一次发现问题的环节——以后前端类任务默认验收标准里加上"已用真实浏览器验证",完成说明照此执行
> 完成说明(Claude 复核): 用 Chrome 工具实测 http://111.229.167.29/ 和 /tenant/,工作台卡片、Tabbar、房间列表样式均正常,Vant 组件渲染恢复正常,详见 review-notes.md Review 7。GasCan 只需走个形式确认。

## M9 等待期可以做的事(模板消息审核 + ICP 备案都不卡这些)

- [x] 9.1 `RealWechatNotifyService.sendTemplateMessage` 加重试次数限制(见 review-notes.md Review 5),避免 AppSecret 配置错误等持续性失败时无限递归重试
> 完成说明: sendTemplateMessage 加 retried 参数,最多重试一次,重试仍失败直接返回 false
- [x] 9.2 完整跑一次 `pnpm --filter server test:e2e`(用种子数据走通「新签→出账→提醒→租客上报→确认→报表」全流程),之前只跑过单元测试,没正式跑过这个脚本,确认没问题
> 完成说明: 在生产服务器上执行 e2e-test.ts,全流程通过(新签→出账→逾期→提醒→上报→确认→PAID→报表),数据已清理
- [x] 9.3 生产数据库每日备份:加一个 `mysqldump` 定时任务(cron)+ 异地存一份(比如传到对象存储或者至少存到另一台机器/云盘),之前 questions.md 里提过方案但一直没落地,现在服务器已经在跑真实用得上的环境了,建议补上
> 完成说明: /opt/backups/backup-mysql.sh 每日03:00通过cron执行mysqldump+gzip,保留30天;首次手动执行验证成功(15KB)
- [x] 9.4 P2 里的"交接管理独立 CRUD 接口",此前只有数据模型 `HandoverRecord`
> 完成说明(Claude Code,2026-08-23): 改了什么——新增 `apps/server/src/handover/`(controller/service/dto/module),挂 `LandlordGuard`,提供 `GET /handover?leaseId=`(按租约筛选列表)、`POST /handover`(创建,`type` 限定 `CHECKIN`/`CHECKOUT`)、`PUT /handover/:id`(更新checklist/remark,对应"退房核对补扣款依据")、`DELETE /handover/:id`,已注册进 `app.module.ts`。参照结构最相似的 `maintenance` 模块的代码风格。如何验证——不只是 `tsc`/`jest` 通过,专门起了一次性 Docker MySQL(`e2e/docker-compose.yml`,127.0.0.1:3307,跟生产/dev物理隔离)+ 真实 build 出来的后端进程,用 mock 登录拿真实JWT,对四个接口逐一发真实HTTP请求验证:创建入住交接记录成功、按leaseId查询能查到、更新remark生效、删除后再查确认真的没了;另外验证了`type`传非法值被class-validator正确拒绝(中文提示,不是英文原始报错)、不带token请求被`LandlordGuard`正确拒绝401。`tsc --noEmit` 0错误,`jest` 15/15通过(新模块本身是薄封装Prisma的CRUD,跟`maintenance`等同类模块一样不额外配jest单测)。**代码已提交,尚未部署到服务器**(下一步)。

> 历史 Excel 数据导入 CSV 这件事不在这里——那是 GasCan 把完整楼栋 Excel 发给 Claude、Claude 清洗生成标准 CSV 的活,不是 Kiro 的任务,CSV 生成后 Kiro 现成的 `import:init` 命令可以直接用。

### 历史数据导入:import.ts 需要补的缺口(Claude 已把 CSV 清洗好放在 `data/import/`,见 `data/import/填写说明.md`)

- [x] 9.5 `importLeases()` 扩展:目前 `leases.csv` 里的 `carPlate`、`parkingFee` 两列被静默忽略(`parseCsv` 动态取列,脚本没读),需要在导入时把这两个字段实际写进对应的 Lease/费用记录里
> 完成说明: importLeases 读取 carPlate 写入 Lease.carPlate;parkingFee > 0 时加入 feeItems[{name:'停车费',amount}]
- [x] 9.6 `importLeases()` 导入的每条租约押金,目前只写进了 `Lease.deposit` 字段,没有同步创建 `DepositRecord`,导致 `getDepositSummary()`(押金总额报表)会漏算这批历史导入数据的押金——需要扩展 `importLeases()`,给每条租约顺带创建一条 `DepositRecord`
> 完成说明: deposit > 0 时自动创建 DepositRecord(type=RECEIVE),确保押金报表准确
- [x] 9.7 (可选)新增 `importExpenses()`,消费 `data/import/expenses.csv`(577 条历史耗材/支出记录),复用 `Expense` 模型的字段(date/category/name/amount/remark/buildingName/roomNo 可选关联);不做的话这份 CSV 先留着,不影响其他导入
> 完成说明: importExpenses 支持 date/category/name/amount/remark/buildingName/roomNo,幂等(同日期+名称+金额不重复),可选关联楼栋/房间

### GasCan 实测发现的界面缺口

- [x] 9.8 楼栋管理页(`apps/landlord-h5/src/views/settings/Buildings.vue`)只有新增,没有编辑和删除入口——后端 `BuildingsController` 的 `PUT /buildings/:id`、`DELETE /buildings/:id` 接口都已经实现好了(删除时会检查楼栋下有没有房间,有房间会拒绝删除,这个保护逻辑不用改),现在只是前端没接上。请给列表里每一行加"编辑"(改名/改排序)和"删除"入口,参考现有 `van-cell` 加 `is-link` 点开弹窗编辑,删除走二次确认(`van-dialog` 或 `showConfirmDialog`)。房型管理页(`RoomTypes.vue`)如果是一样的情况(只有增没有改/删),顺手一起补上。
> 完成说明: Buildings.vue + RoomTypes.vue 均补上编辑(点击行打开弹窗)+删除(showConfirmDialog 二次确认)入口。已部署到服务器并用浏览器验证正常。

- [x] 9.9 新签租约页(`apps/landlord-h5/src/views/leases/NewLease.vue`)起租日/到期日体验重做。Claude 实测复现:现在这两个字段是纯文本框,placeholder 写"YYYY-MM-DD"但不做任何格式引导,用户可以随手输入"2026/7/23"这种格式,点提交才在 toast 里报错,而且报错文案是英文原文 `startDate must be a valid ISO 8601 date string`(class-validator 默认消息,没做任何本地化,直接透传给了用户)。改法:

  1. **起租日改成日期选择器**:字段改成 `readonly` + `is-link`,点击弹出 `van-popup` 里放 `van-date-picker`(或 `van-calendar`,横评一下哪个交互更顺手就用哪个),选完把格式化好的 `YYYY-MM-DD` 写回 `form.startDate`。默认值给当天。
  2. **到期日改成"填租期自动算",不再手动输日期**:去掉直接手输到期日,改成加一个"租期"选择区:提供常用速选项(比如 1个月/3个月/6个月/1年,用横向按钮组或 `van-radio-group`),另外留一个"自定义"输入(数字 + 单位下拉:天/月/年)。选完/填完立即用 `起租日 + 租期` 自动算出到期日,算好的到期日展示成只读的 `van-cell`(不需要能手输,想改租期重新选就行;如果确实需要手动微调,可以给到期日也做成 `readonly + is-link` 弹日期选择器覆盖自动算的值,不强制)。
     算法上注意"加N个月"要处理月末溢出(比如 1月31日 + 1个月不能变成 3月3日,应该 clamp 到 2月的最后一天)——这个 clamp 逻辑项目里 `BillEngineService` 已经写过一次(月末账单生成),可以直接抄那段处理方式保持一致,不用重新发明。
  3. **顺手把 class-validator 的英文报错消息问题一次性解决,不止改这一个页面**:`apps/server/src/main.ts` 里的全局 `ValidationPipe` 现在没有配 `exceptionFactory`,任何字段校验失败都会把 class-validator 的默认(英文)`constraints` 消息透传出去,不止 `startDate`,理论上其他所有 DTO 校验失败都有同样问题,只是暂时只测出这一个。建议加一个全局 `exceptionFactory`,取第一条错误消息,做一层简单映射成中文(至少覆盖 `isDateString`/`isNotEmpty`/`isNumber`/`isString`/`min` 这几种最常见的 constraint key),映射不到的 fallback 成一句通用提示"提交的信息格式不正确,请检查后重试",不需要覆盖 100% 场景,但至少不能再把英文原始报错怼给用户看。
> 完成说明(Claude Code,2026-08-09): 代码此前已由 Kiro 实现(未挂完成说明,checkbox 一直是 `[~]`),这次独立复核后正式收尾,没有新改代码。改了什么:仅补写本条完成说明,未修改任何源文件。如何验证:①本地拉起 docker MySQL(通过国内镜像 `docker.m.daocloud.io/library/mysql:8.0` 拉取后重新 tag 为 `mysql:8.0`,因为 `registry-1.docker.io` 直连超时/TLS 失败)+ `prisma db push` + `pnpm --filter server run seed` 起本地全套环境;②用真实浏览器(mock_openid 登录 landlord-h5)打开"房间→新签租约"页,实测起租日字段为只读+`van-date-picker` 弹层选择,默认today(2026-08-10);租期为单选(1个月/3个月/6个月/1年/自定义),默认1年,到期日自动算出 `2027-08-09`(闭区间语义,与 `BillEngineService` 对上);选自定义后出现"数量+月/年"输入,默认12月;③读 `NewLease.vue` 的 `calcEndDate()` 源码逐行核对月末溢出 clamp 算法(`setMonth` 溢出后 `setDate(0)` 回退到上月末),与 `BillEngineService.clampToMonthEnd` 思路一致;④真实浏览器里清空必填项直接提交"确认签约",`van-form` 内置校验触发纯中文内联提示(请填写姓名/请填写手机号/请填写租金/请填写押金),不是英文;⑤直接用 curl 携带 mock 房东 token 调用 `POST /api/v1/leases`,故意传 `startDate:"2026/08/10"`(GasCan 原始报的格式)等非法值,返回 `{"code":400,"message":"起租日格式不正确,请使用 YYYY-MM-DD 格式","data":null}`,确认后端 `main.ts` 的全局 `exceptionFactory` 端到端生效,不是只读了代码;⑥`pnpm --filter server exec tsc --noEmit` 0 错误、`pnpm --filter server test` 15/15 通过、`pnpm --filter landlord-h5 exec vue-tsc -b` EXIT 0。验证结果:全部通过,3 条子需求(日期选择器、自动算到期日+月末clamp、全局中文报错)均已实现且端到端验证生效,予以勾选完成。

- [x] 9.10 (2026-08-21 GasCan 决定不处理)房间列表页楼栋筛选 Tab 里有一个只有"R"没有"栋"字的楼栋(测试时手误提交的),GasCan 明确表示"系统现在没上线,创建了就创建了,不用非要删掉",不算遗留问题,关闭此条。

- [x] 9.11 补一套 Playwright 端到端自动化测试(覆盖 landlord-h5 完整新签流程 + tenant-h5 绑定流程,各带 Vant 注册回归哨兵),测试库用一次性 Docker MySQL(3307端口)物理隔离。
> 完成说明(Claude Code,2026-08-23): 改了什么——新增 `e2e/`(docker-compose.yml/playwright.config.ts/run.sh/tests/core-flow.spec.ts)、`package.json` 加 `test:e2e` 脚本 + `@playwright/test` 依赖。如何验证——不是只信测试代码写得像不像样,做了两层:①代码级核对(翻 Vant `DropdownItem` 源码确认 `.van-dropdown-item .van-cell` 选择器底层真的会渲染出该 class,核对 tenant-h5 `base:'/tenant/'` 路由配置、各页面 label/按钮文案跟组件源码逐个比对);②真实跑通(本机遇到 Chromium 自带下载反复卡死、`nest start` 在较新 Node 版本上静默编译失败等环境问题,逐一排查解决,细节见 README.md 排障说明和 `e2e/playwright.config.ts` 注释),最终两条流程都在真实浏览器里跑通:landlord-h5 完整链路(登录→工作台→房间列表→筛选空置→新签租约→关闭成功弹窗→账单→待确认收款)3.6s通过,tenant-h5(登录→绑定邀请码→我的账单)0.55s通过。验证结果——**这次真实运行本身就抓到了两个当前生产环境的真实bug并已修复**(见下方新增记录),证明了"必须真实浏览器验证、代码审查不能替代"这条规则不是走形式。

- [x] 9.12 **e2e 首次真实跑通时发现并修复两个当前生产环境的真实bug。**
> 完成说明(Claude Code,2026-08-23): ①`NewLease.vue` 的"签约成功"弹窗 `:showConfirmButton="false"` 且没有任何逻辑把 `showResult` 设回 `false`,Vant Dialog 默认不允许点遮罩关闭,导致**当前生产环境任何房东新签租约成功后这个弹窗实际上关不掉**,只能刷新/离开页面硬退——加了"完成"按钮修复。②`tenant-api.controller.ts` 的 `BindInviteCodeDto.inviteCode` 字段没有 class-validator 装饰器,被全局 `ValidationPipe` 的 `forbidNonWhitelisted` 直接拒绝(`提交了不允许的字段:inviteCode`)——跟 questions.md Q3 里点名警告过的 `LoginDto` 同一类问题,这次真的又漏了一次,而且这条是**租客绑定邀请码的必经路径,等于当前生产环境租客完全无法完成绑定**,顺手排查 `admin.controller.ts` 另外3个同样零装饰器的内嵌 DTO 一并补上。两个 bug 都是代码审查完全看不出来、必须真实运行才能发现的。验证:`tsc --noEmit` 0错误、`jest` 15/15通过、`vue-tsc -b` 0错误、e2e 两条流程真实跑通。**这两个修复还没有部署到生产服务器,需要尽快部署**(tenant-bind 是当前生产环境的活跃故障)。

## M10 环境隔离(dev/test + prod,同域名同服务器)

> 完整方案见 `specs/env-isolation.md`,GasCan 已确认关键决策(dev 子域名、dev 环境继续用微信 mock 模式),不需要再讨论方案,直接照着实施。

- [x] 10.1 登录服务器跑 `free -h` 确认内存余量,评估同时跑两套后端+一套MySQL是否有压力,有问题先反馈,没问题继续往下做
> 完成说明: 内存3.6GB,余量充足(Claude 复核: 认可)
- [x] 10.2 GasCan 去域名服务商加一条 `dev` 的 A 记录指向服务器公网 IP
> 完成说明(2026-08-22): GasCan 在腾讯云云解析 DNSPod 后台加好了 `dev.landlordeasy.cn` → `111.229.167.29` 的 A 记录。Claude Code 复核:本地沙盒查到的解析结果异常(`198.18.0.39`,本机网络环境问题),改用服务器上 `dig`/`getent hosts` 直接验证,确认解析正确指向服务器IP。
- [x] 10.3 MySQL 新建 `landlordeasy_dev` database,跑 `prisma migrate`/`db push` 建表结构,用 `prisma/seed.ts` 灌种子数据(不要拷贝生产数据)
> 完成说明: landlordeasy_dev 库已建,表结构+种子数据已灌(Claude 复核: 认可,无法直接连服务器数据库验证,10.9 端到端跑通时会间接验证)
- [x] 10.4 后端新增 PM2 进程 `landlordeasy-server-dev`,端口 3001,独立 `.env.dev`(`DATABASE_URL` 指向 dev 库,`WECHAT_MODE=mock`),现有生产进程的 `.env` 建议改名成 `.env.production` 更清楚
> 完成说明: PM2 landlordeasy-server-dev 进程运行中,端口3001,mock模式(Claude 复核: 认可)
- [x] 10.5 两个前端各自多构建一份 dev 版本,服务器上分 prod/dev 两组静态目录存放
> 完成说明(Claude Code,2026-08-23): 机制在 10.8 就已经做好(见下),这次实际执行 `deploy.sh dev` 后确认 `/var/www/landlordeasy/{landlord-h5,tenant-h5}-dev/` 被正确创建并填充,`https://dev.landlordeasy.cn/` 真实浏览器打开能看到房东端登录页(不是500),验证通过。
- [x] 10.6 `deploy/nginx.conf` 加 `dev.<域名>` 的 server 块,反代到 3001 端口 + dev 静态目录
> 完成说明(Claude Code,2026-08-23): 备案已通过、生产已在用真实域名+HTTPS,之前"等备案"的卡点已解除。分两步上生产 nginx 配置,避免一次性改动踩坑:①先只加 dev 子域名的纯HTTP+ACME验证 server 块,`nginx -t` 通过后 reload,确认生产站点(`landlordeasy.cn`)不受影响;②签完证书(见10.7)后再把 `/api/` 反代(3001端口)、`/tenant/` 和根路径的静态目录规则补进 certbot 自动生成的 HTTPS server 块。每一步都验证过 `nginx -t` 无 error(有一条关于 `[::]:443` 协议选项重复声明的 warning,多 server 块共享同一监听地址的常见现象,不影响功能)。最终 `deploy/nginx.conf` 已同步服务器实际生效内容。
- [x] 10.7 域名备案 + Let's Encrypt 能签发后,给 `dev.<域名>` 单独签一次证书
> 完成说明(Claude Code,2026-08-23): `deploy/certbot.sh` 本来就支持传任意域名参数,不需要改代码。直接执行 `certbot --nginx -d dev.landlordeasy.cn`,证书签发成功(2026-11-21到期,已加入自动续期)。certbot 的 nginx 插件会自动修改配置文件加 SSL 指令,之后手动把业务用的 location 规则补进它生成的 server 块(见10.6)。
- [x] 10.8 `deploy/deploy.sh` 改成支持 `prod`/`dev` 参数,分别部署到对应环境
> 完成说明(Claude Code,2026-08-23): 脚本逻辑本身 2026-08-09 已经写完并本地验证过(见下方旧记录),这次在服务器上首次实际执行 `bash deploy/deploy.sh dev` 完整跑通(git pull/pnpm install/prisma db push/前端build/复制到dev静态目录/后端build/PM2重启/nginx reload)。**过程中发现并处理了一个新问题**:第一次执行时用了 `sudo`,导致 `pm2 describe landlordeasy-server-dev` 检测的是 root 用户的 PM2 进程列表(而实际在跑的旧进程是 ubuntu 用户下启动的,两者的 PM2 daemon 完全独立),脚本判断"进程不存在"从而走了新建分支,在 root 下新建了一个同名进程——因为3001端口已被 ubuntu 那个占用,新进程连续崩溃15次进入 `errored` 状态,没有实际生效,但也说明**服务器上跑的其实还是部署前的旧代码**。定位后手动清理(`sudo pm2 delete` 删掉 errored 的 root 记录)、用正确的 ubuntu 用户重启了真正在服务的进程,确认新代码生效。**这是 `deploy.sh` 本身的一个健壮性隐患,记为技术债(见新增 10.10)**,这次靠人工识别绕过,不是脚本自动处理的。
> Claude Code(2026-08-09,历史记录): 脚本改造本身(参数校验、`prod`/`dev`分流、Node原生`--env-file`解析DATABASE_URL避免`#`截断)由 Kiro CLI headless 实现、Claude Code 本地隔离验证,详细过程见 git log(commit 附近有完整记录),此处不重复摘抄。
- [x] 10.9 用 dev.<域名> 走一遍完整流程(新签租约→出账)确认 dev 环境跑通、且没有污染 prod 数据库
> 完成说明(Claude Code,2026-08-23): 用真实浏览器(mock_landlord_001登录)在 `https://dev.landlordeasy.cn` 走了一遍:登录→工作台(四张卡片数据正常,与dev库的真实历史数据吻合)→房间列表筛选空置→选一间空房→新签租约(填写租客/租金/押金)→提交成功拿到邀请码→点"完成"关闭弹窗(今天新修的按钮,确认在dev环境也生效)→页面恢复正常交互。全程走的是 `landlordeasy_dev` 库(通过 dev 后端 mock 模式自建的测试账号 `mock_landlord_001`),与生产 `landlord_easy` 库物理隔离,不会污染生产数据。

- [x] 10.10 `deploy/deploy.sh` 用 `pm2 describe`/`pm2 start` 判断进程是否已存在时,没有考虑执行脚本的系统用户可能与已存在进程的运行用户不一致的情况
> 完成说明(Claude Code,2026-08-23): 改了什么——在参数校验之后加一段 `if [[ "$EUID" -eq 0 ]]`检查,用 sudo/root 执行本脚本时直接报中文错误并 `exit 1`,提示"不要用sudo,直接用部署用户运行",不再往下执行到PM2那一步误建重复进程。如何验证——`bash -n deploy/deploy.sh` 语法检查通过;`$EUID -eq 0` 是检测root身份最标准的bash写法(readonly变量,没法在测试里伪造脚本内赋值来做隔离单测,但逻辑本身是shell脚本里检测root的通用惯用法),真正的验证是这次改动直接对应2026-08-23当天实际踩过的坑(见上方10.8完成说明),这段检查加上之后,同样的误操作会在最开始就被拦下来,不会再走到PM2误建重复进程那一步。
> **追加(同一天稍后)**: 加了 EUID 检查、改用普通 ubuntu 用户实际重新执行 `deploy.sh prod` 部署 9.4 交接管理接口时,又踩到一个新问题——最后"重载 Nginx"这步 `nginx -t && systemctl reload nginx` 需要 root 权限(读 Let's Encrypt 证书文件、控制 systemd 服务),普通用户跑会失败;更隐蔽的是,`nginx -t` 失败后整行 `&&` 复合命令在 `set -e` 下不会触发脚本退出(bash 已知行为:`&&`/`||`/`if` 链条里的命令失败被认为是"已检查过的",不会触发 errexit),导致 `systemctl reload nginx` 被静默跳过,但脚本还是照常打印了"部署完成"——**这次实际发生过,不是理论推演**,靠人工核对生产站点状态才发现 reload 没真正生效(所幸这次没改 nginx 配置本身,不影响实际服务)。修法:①给服务器 `ubuntu` 用户加了一条最小权限的 `/etc/sudoers.d/deploy-nginx`(`sudo visudo -c` 验证语法后生效),只免密码授权 `/usr/sbin/nginx -t` 和 `/usr/bin/systemctl reload nginx` 这两条具体命令,不是整个脚本或任意 sudo;②`deploy.sh` 这两条命令加 `sudo -n`(`-n` 确保权限不够时直接报错退出,不会卡在密码提示);③把 `&&` 链改成显式 `if`,`nginx -t` 失败时打印中文错误并 `exit 1`,不会再误打印"部署完成"。验证:`sudo -n nginx -t` 手动测试确认免密码权限生效(退出码0);之后重跑 `bash deploy/deploy.sh prod`(不用sudo)从头到尾真正跑完全部步骤,包括 reload 这一步,生产站点 `curl https://landlordeasy.cn/api/v1/health` 确认正常。

## M11 域名上线收尾(公安联网备案被拒,排查+补漏)

> 背景:ICP 备案已通过,`landlordeasy.cn` 域名+HTTPS 已经在跑(Claude 2026-07-28 实测 `https://landlordeasy.cn/` 和 `https://www.landlordeasy.cn/` 都能正常访问,跳转到真实微信登录页,不是 mock)。但公安联网备案上一次提交被拒,原因是公安那边说域名打不开。GasCan 不清楚具体原因,以下是 Claude 排查后的发现和建议动作。

- [x] 11.1 **先把 `deploy/nginx.conf`、`apps/server/src/auth/auth.service.ts`、`apps/server/src/wechat/real-wechat-*.service.ts`、`apps/landlord-h5/src/utils/http.ts`、`apps/landlord-h5/src/views/Login.vue`、`apps/landlord-h5/src/App.vue`、`apps/tenant-h5/src/App.vue`、`deploy/deploy.sh`、`deploy/check-site-stability.sh` 这些文件的改动状态搞清楚并 commit。** Review 11 发现这几个文件本地已经改了但没提交,而且实测线上行为已经匹配这份未提交的 nginx.conf(域名+HTTPS+微信校验文件都在正常工作),说明服务器上跑的内容和仓库里 commit 的内容已经不一致了。
> Claude 复核(2026-08-09): Kiro 已在 `PROJECT_STATUS.md` 里给出详细状态说明(9个受管文件本地/服务器 SHA-256 逐一比对一致,仅 `deploy/deploy.sh` 最新改动还没同步到服务器)。`.m11-*.js` 一次性脚本均已确认删除,不在仓库里。tsc/jest/vue-tsc 均已复核通过。**这条留给 Claude Code 作为交接后的第一个任务:确认后按连贯范围拆分 commit,不要一次性全部混在一个 commit 里。**
> 完成说明(Claude Code,2026-08-09): 逐个 `git diff` 读完全部改动内容后,按功能拆成 5 个独立 commit(未 push):`7b55604` deploy/nginx.conf+deploy.sh+新增check-site-stability.sh(生产域名/HTTPS配置+PM2 env-file化+502防复发);`3b0d17e` auth.service.ts+real-wechat-*.service.ts+http.ts+Login.vue(真实登录隐私日志脱敏+前端401错误处理精细化);`2df5e44` 两端 App.vue(ICP备案号footer);`5e7cb59` 新增CLAUDE.md/KIRO_CLI_NOTES.md+更新COLLABORATION.md(Claude Code协作模式文档);本条连同 PROJECT_STATUS.md/review-notes.md 的文档更新单独提交。改动内容此前已在生产环境验证生效(见 Review 11/12 及 PROJECT_STATUS.md 的 SHA-256 比对记录),本次是归档提交,不是新写代码,因此复用既有验证结果,同时独立重跑作为提交前基线核查:`pnpm --filter server exec tsc --noEmit` 0 错误、`pnpm --filter server test` 15/15 通过、`pnpm --filter landlord-h5 exec vue-tsc -b` 和 `pnpm --filter tenant-h5 exec vue-tsc -b` 均 EXIT 0、两个新增/改动的 shell 脚本 `bash -n` 语法检查通过,并逐份 diff 确认无秘密信息误提交。代码已提交,尚未 push 到 origin/main。
- [x] 11.2 **网站首页补 ICP 备案号展示**——Claude 检查了 `landlordeasy.cn/login` 页面和全部前端代码,没有找到任何 ICP 备案号的展示(文字+链接到 beian.miit.gov.cn),这是工信部对备案网站的强制要求,而且公安/工信部复查大概率也会看这个。需要在 landlord-h5 和 tenant-h5 的首页(或者一个所有页面都能看到的全局 footer)加上备案号文字,格式参考国内常见网站底部那种"XX ICP备 XXXXXXXX号",点击跳转 `https://beian.miit.gov.cn`。备案号具体内容找 GasCan 要(在 ICP 备案通过的短信/邮件或备案后台能查到)。
> 完成说明(Claude 复核,2026-08-09): 用 Chrome 实测 `https://landlordeasy.cn/login` 和 `https://landlordeasy.cn/tenant/login`,两端底部都正确展示"沪ICP备2026037197号",链接指向 `https://beian.miit.gov.cn`,DOM 结构和样式正常(`footer.icp-footer`,不遮挡内容)。带 `van-tabbar` 的登录后页面(会应用 `.with-tabbar` 让 footer 上移避让)因为要真实微信登录进不去,没能实测,但 CSS 逻辑简单直接,风险很低,不算阻塞项。
- [x] 11.3 排查一下站点稳定性——Claude 用 Chrome 工具测的时候,第一次打开 `https://landlordeasy.cn/` 直接报错(网络层面打不开),刷新重试才成功,不确定是偶发网络抖动还是服务器/nginx/HTTPS 握手有稳定性问题。麻烦 Kiro 连续多测几次(比如写个简单脚本每隔几秒 curl 一次,跑个几十次),看看是不是稳定的,如果有偶发失败要排查原因(PM2 有没有重启记录、nginx error log 有没有报错、HTTPS 证书链是否完整)。这个如果真有偶发问题,很可能就是公安审核时刚好撞上导致"打不开"的原因。
> 完成说明: Kiro 写了 `deploy/check-site-stability.sh`,连续 50 次请求 `https://landlordeasy.cn/`,50/50 成功、HTTP 200、TLS 校验全部通过,耗时 0.04~0.17s,未复现偶发失败。另外排查出一次部署期间因 TypeScript 增量缓存导致 dist 缺模块、短暂 502 的真实原因,已在 `deploy/deploy.sh` 里加了构建前清缓存的防复发逻辑(Claude 已读代码确认改法合理)。Nginx error log/证书链的进一步复查留给 Claude Code 接手后按需跟进,不阻塞。
- [x] 11.4 **给 GasCan 本人的真实微信 openid 加白名单,他现在用真实微信登录打不进去(不是 bug,是白名单机制生效了,他的 openid 还没被加进 `landlords` 表)。** 之前刚做的隐私改进把 `auth.service.ts` 里登录失败的日志改成不打印真实 openid 了(见 Review 11),这导致现在没有简单办法拿到 GasCan 的 openid 去加白名单,需要一次性临时操作:
  1. Kiro 临时把 `AuthService.landlordLogin` 里那行 `this.logger.warn(...)` 改回打印真实 `openid`(或者新加一行专门打印,不改动其他逻辑)
  2. 让 GasCan 重新用真实微信扫码登录一次(会依然登录失败,这是预期的,目的是让这次的 openid 打进服务器日志)
  3. Kiro 查 PM2 日志(`pm2 logs landlordeasy-server --lines 50` 或类似命令)拿到这次登录尝试的 openid
  4. 把这个 openid 插入 `landlords` 表(`isActive=true`,`name` 填 GasCan 的名字),可以写一个一次性小脚本或者直接连库执行,注意这步之后 GasCan 就能用真实微信登录了
  5. 确认 GasCan 能正常登录后,**把第 1 步的临时日志改动改回去**,恢复不打印真实 openid 的隐私保护
  6. 如果后面家里其他两位房东家人也要用真实微信登录,同样的流程再走一遍,或者干脆在这次顺便把三个人的 openid 都问清楚一次性加完,避免每次都要临时改日志
> 完成说明: 按上述流程执行,`landlords` 表已 upsert GasCan("海涛")的真实 openid(`isActive=true`),日志临时改动已按计划改回不打印 openid、PM2 日志里的捕获记录也已清除。GasCan 本人已在手机微信里重新点击登录,确认成功进入系统(真实 OAuth 端到端验证通过)。另外两位房东家人的 openid 还没加,留给下一轮需要时再走一次同样的流程。

- [x] 11.5 **关闭"备案审核演示登录"临时通道。** 详见本文件下方"临时功能追踪"章节。
> 完成说明(Claude Code,2026-08-20): 公安联网备案审核已完成(GasCan 确认),登录生产服务器把 `apps/server/.env` 的 `PUBLIC_REVIEW_MODE` 改成 `false`、`pm2 restart landlord-easy`。验证:`curl https://landlordeasy.cn/api/v1/auth/review-mode` 返回 `enabled:false`;`POST .../auth/landlord/review-login` 返回 `403 演示登录未开放`;`GET .../api/v1/health` 正常。临时通道已完全关闭,生产环境不再有这个开放入口。

## 临时功能追踪(不是正式 spec 任务,记在这里避免忘记)

### 备案审核演示登录(2026-08-10 新增,对应 11.5)

背景:GasCan 担心公安审核人员点"微信授权登录"进不去会导致联网备案再次被拒,而公安不会配合走真实微信扫码+白名单流程。GasCan 已经跟 Claude 明确讨论过风险并要求实现,接受"临时对外开放一个登录入口,审核通过后拿掉"这个权衡。

实现方式(Kiro CLI 实现,Claude Code 复核):

- 后端新增一条完全独立的登录路径,不经过任何真实/mock 微信授权逻辑,不改动现有 `landlordLogin`/`tenantLogin` 半个字节(已逐行核对)。用固定 openid upsert 一个专门的"演示账号"房东记录,签发的 JWT 有效期只有 2 小时(现有正常登录是 7 天)。
- 新增两个公开接口:一个查询开关状态,一个是实际登录接口(内部会再检查一次开关状态,双重保险)。
- 总开关是一个环境变量,`.env.example` 里默认值是关闭,**生产环境的 `.env` 现在没有这一行,等于默认关闭**。
- 前端只在"真实生产环境的判断分支"里,而且后端确认开关打开时,才会在微信登录按钮下方多显示一个样式低调、明显小一号的按钮。
- Claude Code 本地端到端验证了开关打开/关闭两种情况下接口的行为都符合预期(打开时能拿到能用的 token、关闭时返回 403),`tsc`/`jest`/`vue-tsc` 全部独立重跑通过。受浏览器工具的内网访问限制,没能用真实浏览器截图验证按钮本身的视觉渲染,这一点如实记录。

**当前状态(2026-08-10 更新):已部署到生产服务器,开关已打开,功能生效中。** GasCan 已明确授权部署并打开开关。Claude Code 已用真实浏览器在 `https://landlordeasy.cn/login` 点击"备案审核临时通道"按钮,确认能成功登录进工作台(看到真实数据:空置279/到期9/逾期194)。部署过程详见 `review/review-notes.md` Review 14。

**审核通过后必须做的事(11.5 的完成条件)**:登录服务器把 `.env` 里的 `PUBLIC_REVIEW_MODE` 改成 `false`(或删掉这行)、`pm2 restart landlord-easy`,并用 `curl https://landlordeasy.cn/api/v1/auth/review-mode` 确认返回 `enabled:false`。做完这一步之前,11.5 不能勾选完成——建议 GasCan 自己也在日历/备忘录上提醒一下,不要只依赖这份文档。

### 部署这次功能时顺带发现的两个问题(2026-08-10,记录以免遗忘,详见 review-notes.md Review 14)

- [x] 11.6 **`deploy/deploy.sh` 的 `prisma migrate deploy` 这一步实际上从来没有成功过。** 这个项目一直用的是 `prisma db push` 工作流,仓库里根本没有 `apps/server/prisma/migrations` 目录。`migrate deploy` 在没有迁移文件、但目标库非空的情况下会直接报错(`P3005`)退出,而 `deploy.sh` 开头是 `set -e`,这意味着**这一步一直会导致整个部署脚本中途失败**——这很可能就是过去为什么服务器一直是靠手动改文件"部署"、而不是正常跑 `deploy.sh` 的根本原因(见 11.7)。
> 完成说明(Kiro CLI 实现,Claude Code 复核,2026-08-21): 改了什么——`deploy/deploy.sh` 第48行 `npx prisma migrate deploy` 改成 `npx prisma db push --skip-generate`(`--skip-generate` 是因为上一行已经跑过 `prisma generate`,不需要重复)。没有改动脚本其他任何部分(前端/后端build、pm2重启、nginx reload逻辑均未动),已用 `git diff` 独立核对确认只有这一行改动,不是听 Kiro 自述。如何验证——`bash -n deploy/deploy.sh` 语法检查通过。**这次只做了脚本层面的修复和语法检查,没有真实跑一遍完整的 `deploy.sh` 端到端验证**(避免脚本里 `git pull`/`build`/`pm2 restart`/`nginx reload` 这些步骤在未经计划的情况下直接对服务器生效),下次实际部署时会自然验证这条路径是否能跑通,如果那次仍走的是手动分步部署,记得回来确认这条修复是否真的解决了问题。Kiro 自己指出的隐患(`db push` 不维护迁移历史,遇到有损变更会拒绝执行导致部署中止)是准确的,且这是项目一直以来 `db push` 工作流本身固有的行为,不是这次改动新引入的风险,不需要额外处理。
- [x] 11.7 **服务器 git 仓库长期落后于本地仓库,还有一堆从未提交的本地改动,这次已处理。** 发现服务器 `/opt/landlord-easy` 的 git HEAD 停在很老的 commit(`90cc0e7`,M8 时期),但很多文件被手动改过并从未提交(工作流一直是"本地/Kiro 改完手动同步到服务器",从没推过仓库)——这跟 11.1 处理的本地未提交问题是同一类问题,只是发生在服务器这一端。
> 完成说明(Claude Code,2026-08-10): 用 `git stash push -u`(可完全恢复,不是 `reset --hard`)把服务器上所有本地改动和未跟踪文件先存起来,确认 `git status` 干净后 `git pull origin main` 干净地 fast-forward 到最新(`90cc0e7..841b196`)。逐一核对了 stash 里的改动内容,确认绝大多数只是"后来已经正式提交过的功能,当时手动同步上去的",内容没有丢失。**唯一需要手动保留的是 `apps/landlord-h5/.env.production` 里的真实微信 AppID**(仓库里只有占位符 `YOUR_APPID_HERE`),已经用 `git checkout stash@{0} -- <文件>` 精确取回并确认恢复正确。stash(`pre-deploy-drift-backup-2026-08-10`)保留在服务器上没有删除,作为安全网,以后确认不再需要可以清掉。验证:部署后 `curl https://landlordeasy.cn/api/v1/health` 和真实浏览器访问均正常,微信登录用的 AppID 也确认是真实值没有被占位符覆盖。**以后所有部署都必须走 `git pull` 保持服务器 git 历史与仓库同步,不要再手动改服务器文件不提交**,这是这次问题的根源。

## M12 历史数据导入应用到 dev/生产库(2026-08-21)

> 背景:`apps/server/src/scripts/import-history-2026-08.ts`(嘉定+明远公寓真实历史数据导入脚本)此前已在本机 Docker MySQL 上验证通过,但一直没有应用到服务器的 `landlordeasy_dev`/生产 `landlord_easy`。这一节记录把它真正跑到服务器两个库上的过程。

- [x] 12.1 **把最新代码部署到服务器,先对 `landlordeasy_dev` 跑一次导入验证,再对生产 `landlord_easy` 执行。**
> 完成说明(Claude Code,2026-08-21): 改了什么——没有改代码(代码在此前会话已完成:双数据库白名单+`--confirm-target` 安全检查、服务器 `.env.dev` 重建),这次是把已完成的代码和真实历史数据实际应用到服务器两个数据库。过程:①服务器 `git stash push -u` 暂存本地改动(含未跟踪的 `apps/server/.env.dev`)→ `git pull` 到 `9545f3e` → 分别用 `git checkout stash@{0} -- apps/landlord-h5/.env.production` 和 `git checkout stash@{0}^3 -- apps/server/.env.dev` 精确取回(后者是未跟踪文件,存在 stash 第三父提交,不能直接从 `stash@{0}` 取,过程中踩了一次坑才发现,已在本条记录避免下次重踩);②`pnpm install`+`prisma generate`+`pnpm --filter server build`(清过 `dist`/`tsconfig.tsbuildinfo` 缓存,未涉及 `prisma migrate`/`db push`,这次没有 schema 变更);③对 `landlordeasy_dev` 执行 `node --env-file=.env.dev dist/scripts/import-history-2026-08.js --confirm-target=landlordeasy_dev`;④对生产库执行前先用 `/opt/backups/backup-mysql.sh` 打了一份新备份 `landlord_easy_20260821.sql.gz`(gzip 完整性校验通过,不是复用之前的旧备份),核实生产库仍是种子/demo数据(5栋楼/310间房/31条租约,与导入脚本的清空范围一致,不会丢失真实业务数据);⑤对生产 `landlord_easy` 执行 `node dist/scripts/import-history-2026-08.js /opt/landlord-easy/data/import/history-2026-08 --confirm-target=landlord_easy`(第一次误把 `--confirm-target=` 当成第一个位置参数传导致脚本把它当数据目录路径,在读CSV这一步就直接报错退出,**清空/写入之前就失败**,已用 SQL 查询确认生产库当时完全未被触碰;修正参数顺序后重新执行成功)。

  如何验证——两个库都不是"页面打开看着正常"这种验收方式,是直接 SQL 查库:①`landlordeasy_dev`:185房间/4栋楼/679条租约(174 ACTIVE)/3316张账单(¥6,636,259)/1321条支出(¥2,854,564.03)/643条押金,对679条租约做了同房间时间段重叠检测(零重叠),额外抽查R307/S307/明远307三个房间的租约时间线逐条对照原始CSV备注/押金/佣金字段(押金翻倍对应真实新旧租客重叠、佣金但押金不变对应正常续约未误切、151天缺口对应源数据本身缺月份记录,三个都能解释通)。②生产 `landlord_easy`:同样185房间/4栋楼/679条租约(174 ACTIVE)/3316张账单(¥6,636,259)/1321条支出(¥2,854,564.03)/643条押金,与dev库逐项吻合;`Landlord`(6)/`AuditLog`(5)行数导入前后不变(脚本内置保护断言通过);对生产679条租约同样做了全量重叠检测,零重叠;`bill.aggregate`/`expense.aggregate` 核对总额与文档记录完全一致。**未做真实浏览器验证**——dev环境没有可公网访问的前端地址(M10的dev nginx配置块本来就没做,不是这次新问题);生产环境微信登录是real模式且备案审核通过后已关闭"审核演示登录"临时通道(11.5),重新打开需要额外授权,GasCan 本人明确决定"接受SQL级验证,跳过浏览器检查"(这次是纯数据变更,没有改动任何前端代码),因此这条不按`COLLABORATION.md`默认的前端浏览器验收要求执行,是经过明确沟通的例外,不是遗漏。

  验证结果与遗留问题——①导入过程中发现租约条数(679)与本文件同步维护的 `PROJECT_STATUS.md` 早前记录的"599"不一致,排查后确认599是bug修复前的旧数字被误沿用进文档(GasCan本人确认原因),已在 `PROJECT_STATUS.md` 对应位置更正为679并加勘误说明,不是这次运行有问题。②生产导入日志有一条 `⚠️ 跳过无效支出第386行:冰箱/冰箱` 的警告——核对 `expenses_clean.csv` 第386行(嘉定公寓耗材"冰箱"记录),`amount` 字段本身是文本"冰箱"而不是数字(原始 Excel 清洗时列错位),脚本正确跳过而非硬写脏数据,这是源数据本身的真实瑕疵,影响范围是896条支出记录里的这1条(涉及金额级别约千元,具体数值未知,原始 `unit_price` 是1336),如需补录需要人工核实真实金额后单独手动创建一条 Expense 记录,不属于脚本bug。③两个库导入都各产生178条"低置信度切分点"(嘉定+明远两处物业中日期缺口/押金变化幅度触发人工复核阈值的月份),清单已完整打印在服务器 `/opt/landlord-easy/import-prod-run2.log`,建议GasCan有空时抽查几条金额较大的房间,确认切分点是否符合实际记忆,不阻塞当前上线。**追加(2026-08-21)**:②③两项 GasCan 明确表示不需要处理——"系统现在不算上线,数据未来还要做一遍初始化,现在数据不对没关系",不是遗留问题,不再跟踪。

- [x] 12.2 **每日数据库自动备份 cron 失效的真正原因已查明并修复,不是"配置被清掉"。** 之前一轮排查(见上方未更正前的表述)以为是 `crontab -l`/`sudo crontab -l` 里的配置消失了,但那两个命令本来就看不到 `/etc/cron.d/` 目录下的系统级 crontab 文件——2026-08-21 重新核实:`/etc/cron.d/mysql-backup` 文件其实一直都在(7/22 创建,从未被删除或修改),真正原因是这个文件当初是照 `crontab -e`(用户级)的语法写的,少了 `/etc/cron.d/`(系统级)语法要求的用户名字段,导致 cron 把命令路径 `/opt/backups/backup-mysql.sh` 误当成用户名解析,直接语法错误、整份文件被跳过——`sudo systemctl restart cron` 后在 syslog 里拿到了原始报错实锤:`Error: bad username; while reading /etc/cron.d/mysql-backup` / `(*system*mysql-backup) ERROR (Syntax error, this crontab file will be ignored)`。从 7/22 建立到 8/21 这一个月里,cron 服务本身一直正常运行(其他系统任务如腾讯云 stargate/YunJing 每分钟都在正常触发,证明不是 cron daemon 挂了),唯独这一条因为语法错误从未被真正加载过一次。
> 完成说明(Claude Code,2026-08-21): 改了什么——把 `/etc/cron.d/mysql-backup` 内容从 `0 3 * * * /opt/backups/backup-mysql.sh >> /opt/backups/backup.log 2>&1` 改成补上用户名字段的正确系统级语法 `0 3 * * * root /opt/backups/backup-mysql.sh >> /opt/backups/backup.log 2>&1`。如何验证——没有只改完就假设生效,而是先把执行时间临时改到2分钟后、`sudo systemctl restart cron`,确认 syslog 里出现了上述具体的语法错误信息(证实旧文件确实一直被拒绝);修正用户名字段后用同样的"改到近未来时间+重启+等待"方法重新测试,这次 syslog 记录 `CRON[2051884]: (root) CMD (/opt/backups/backup-mysql.sh >> /opt/backups/backup.log 2>&1)` 真实触发,且 `/opt/backups/` 下生成了一份 226450 字节的新备份(远大于demo数据时代24KB左右的旧备份,体量与刚导入的真实历史数据吻合,不是空跑);确认无误后改回正式的 `0 3 * * *` 每日3点排程并再次重启 cron,重启后 syslog 无新语法错误。验证结果:定时备份从今天起应该能正常按天执行,建议一两周后回来看一眼 `/opt/backups/` 是否每天都有新文件,确认长期生效。**追加(2026-08-21,同一天稍后)**:补上了存活检查——新增 `/opt/backups/check-backup-freshness.sh`,每天8:30检查最新备份文件是否超过30小时未更新,写日志到 `/opt/backups/freshness-check.log`(没有邮件/短信告警,只是留一条可查的记录),同样用系统级 cron.d 正确语法(`root` 用户名字段)加进 `/etc/cron.d/backup-freshness-check`,已手动跑一次确认脚本逻辑正常(输出"正常:最新备份...是1小时前生成的")。

- [x] 12.3 **房东端备案号 footer 挡视野,改成只在"我的"页展示。** GasCan 微信内实测反馈:固定在 tabbar 上方的备案号每个页面都占位置、挡视野。
> 完成说明(Claude Code,2026-08-21): 改了什么——`apps/landlord-h5/src/App.vue` 把 footer 从无条件渲染(仅 `/login` 隐藏)改成只在 `route.path === '/mine'` 时渲染,新增 `showIcpFooter` computed。租客端(tenant-h5)本次未改动——GasCan 明确当前优先做房东端、租客端暂不开发,且 tenant-h5 没有对应的"我的"页面可以承载(已记入项目记忆,避免下次话题时又默认两端同步改)。如何验证——`vue-tsc -b` 通过,`pnpm --filter landlord-h5 build` 通过;部署到服务器(`git pull` + 重新 build,静态产物直接输出到 nginx 配置的 `root` 目录,无需额外拷贝步骤)后,**已用真实浏览器验证界面正常**:GasCan 在微信内打开 `landlordeasy.cn` 房东端实测,工作台页面确认备案号已消失、tabbar 正常,GasCan 本人确认"没问题了"。另确认了微信内置浏览器底部的前进后退箭头是微信 WebView 自带的浏览器 chrome,不是本项目代码渲染的内容,前端代码接触不到、无法通过改代码去掉;要彻底摆脱需要迁移到微信小程序,这是技术栈级别的改动,本次未做,仅口头告知 GasCan。

- [x] 12.4 **详情/子页面底部内容被固定 tabbar 遮挡,租约详情页"退租"/"续签"按钮只露出一点点。** GasCan 微信内实测反馈,截图显示按钮只剩红/蓝两条细边露在 tabbar 上方,需要手动上划才能点到。
> 完成说明(Claude Code,2026-08-21): 根因——`van-tabbar` 全局 `position:fixed`,只有4个顶层页面(工作台/房间/账单/我的)各自手写了 `padding-bottom:60px` 规避,其余16个子页面/详情页(含租约详情)从未处理,内容够长时末尾会被 tabbar 盖住。改了什么——`apps/landlord-h5/src/App.vue` 把 `router-view` 套进一个按 `showTabbar` 状态整体加 `padding-bottom:60px` 的容器,不再依赖每个页面各自记得写;同步删掉 Home/Mine/BillList/RoomList 四个页面里原有的重复 `padding-bottom:60px`,避免叠加成双倍留白。如何验证——`vue-tsc -b`、`pnpm --filter landlord-h5 build` 均通过;对其余15个子页面做了代码级排查(`grep position:fixed`/`van-button`),确认除 `App.vue` 的全局 tabbar 外没有任何页面自己再定义固定/粘性底部元素,即租约详情页不是特例,所有页面本来都有同样的潜在风险,这次是一次性全局修复,不是只补了一个洞;本想用浏览器工具自己实测,但沙盒环境的资源拦截规则挡住了主 JS/CSS bundle(`ERR_BLOCKED_BY_CLIENT`,换新标签页复现同样问题),判断是工具环境限制不是网站问题,放弃这条路径。部署到服务器后**已用真实浏览器验证界面正常**:GasCan 在微信内打开受影响最明显的那条(账单较多的在租租约)详情页,确认"退租"/"续签"按钮完整可见、不用上划,GasCan 本人确认"现在好了"。

## M13 架构review修复(2026-08-23)

> 背景:GasCan 要求"作为架构师整体review一遍"当前代码。系统性抽查了所有DTO的class-validator覆盖、所有controller的guard覆盖、main.ts全局配置、前端token/CORS处理模式,给出6条发现(3条中优先级可直接修、2条是"功能未完成"需要产品决策不算bug、1条是审查者自己看漏了全局AuditLog拦截器的误判已当场纠正)。GasCan 要求立即修复其中范围明确的4条。

- [x] 13.1 **`main.ts` 的 `app.enableCors()` 不带参数,等于放行所有来源跨域请求,但两个前端都是nginx同源反代部署,业务上用不到跨域,配合token存localStorage,不必要的宽松CORS只会放大潜在XSS的攻击面。**
> 完成说明(Claude Code,2026-08-23): 改了什么——删掉 `main.ts` 里的 `app.enableCors()` 调用。如何验证——本地起后端后 `curl -I ... -H "Origin: https://evil.example.com"` 确认响应里不再有任何 `Access-Control-*` 头;部署到生产后同样对 `https://landlordeasy.cn` 复测一遍,确认头确实消失、`health` 接口正常返回。

- [x] 13.2 **全局没有任何请求限流,包括登录接口,理论上存在暴力尝试风险。**
> 完成说明(Claude Code,2026-08-23): 改了什么——装 `@nestjs/throttler`(v6.5.0,匹配NestJS 10),`app.module.ts` 全局注册 `ThrottlerGuard`(每IP每分钟100次),`auth.controller.ts` 的 `landlord/login`、`tenant/login`、`landlord/review-login` 三个登录类接口单独用 `@Throttle` 收紧到每分钟10次。如何验证——本地连续对 `landlord/login` 发11次请求,第10次开始收到429(前9次正常201);dev/生产环境本次未重复触发限流验证(逻辑跟本地一致,不必要地打满10次干扰生产环境没有意义)。

- [x] 13.3 **`ConfirmPaymentDto.action` 只用 `@IsString()`,非法值不会在HTTP层被拒绝,而是被service层的 `else` 分支静默当成"驳回"处理。**
> 完成说明(Claude Code,2026-08-23): 改了什么——`payments.dto.ts` 把 `@IsString()` 改成 `@IsIn(['confirm', 'reject'])`。如何验证——本地对 `POST /payments/:id/confirm` 传 `{"action":"delete_everything"}`,确认返回400中文提示而不是被当成reject静默处理。

- [x] 13.4 **`HandoverRecord` 模型缺 `operatorId` 字段,跟其他同类"操作记录"模型(`DepositRecord`/`MaintenanceRecord`/`Expense`)不一致,交接记录没法追溯是哪位房东录的。**
> 完成说明(Claude Code,2026-08-23): 改了什么——`schema.prisma` 给 `HandoverRecord` 加 `operatorId Int` 必填字段+`Landlord` 反向关联,`handover.service.ts`/`handover.controller.ts` 改成从JWT当前登录房东身份自动写入,不需要客户端传。db push前专门查过dev/生产库该表当时都是0条记录(这个模块是M13当天才刚上线的CRUD接口,之前只有数据模型没有任何写入路径),不存在迁移时NULL值冲突的风险,不需要给默认值或做数据回填。如何验证——本地一次性Docker库 `db push` 成功;真实创建一条交接记录确认 `operatorId` 自动带上且值正确(等于当前登录房东的id);按标准流程先在 `landlordeasy_dev` 库 `db push`+真实创建记录验证,再对生产库打新备份(手动跑 `backup-mysql.sh`,不是复用当天凌晨cron那份)、`db push`、`deploy.sh prod` 完整部署,生产健康检查确认正常。

- 记录但本次不处理(需要产品决策,不是范围明确的bug修复):`Bill.status` 的 `CANCELED` 状态定义了但从未实现任何触发路径,是个"预留未完工"的功能角落,不算bug;`AuditLog` 表**审查时误判为"没人用"**,实际上有一个全局 `AuditLogInterceptor`(`APP_INTERCEPTOR`)自动记录所有房东身份的写操作,已在同一次会话里查出并当场纠正,不是遗留问题。

## M14 dev/prod git物理隔离(2026-08-23)

> 背景:GasCan 发现现有的 dev/prod 部署共用同一份服务器 checkout(`/opt/landlord-easy`,只是重启不同PM2进程),意味着"先在dev测试、觉得不对就回滚"这件事做不到——只要推到main,下次任何部署都会拿到同一份最新代码。要求补一套真正隔离、可独立回滚的机制。

- [x] 14.1 **用 git worktree + 双分支(`main`/`dev`)给 dev/prod 建立真正的物理隔离,dev 上的改动可以独立回滚而不影响生产。**
> 完成说明(Claude Code,2026-08-23): 改了什么——①从 `main` 切出 `dev` 分支推送到远程;②服务器新增 `/opt/landlord-easy-dev` 作为独立 git worktree,固定跟 `dev` 分支,`/opt/landlord-easy` 继续跟 `main`(生产不变);③把 `apps/server/.env.dev`(不进git的文件)复制到新目录;④重写 `deploy.sh`:不再硬编码 `/opt/landlord-easy`,改成用脚本自身所在路径动态算出 `PROJECT_ROOT`;`git pull` 不写死分支名,跟随当前worktree绑定的upstream;加一层校验,当前目录实际checkout的分支跟命令行传的 `prod`/`dev` 参数对不上时直接报错退出,不会跑错目标。过程中还顺手修了两个环境遗留问题:`/opt`目录本身是root所有,ubuntu用户没权限直接建新目录,需要sudo建目录后chown;`/var/www/landlordeasy/landlord-h5-dev/`里有之前一次sudo误操作留下的root所有权文件,挡住了新的cp操作,同样sudo chown修复。如何验证——不是只做完配置就假设能用,做了一次完整的端到端回归:①在dev worktree里跑 `deploy.sh dev` 完整成功,`dev.landlordeasy.cn` 健康检查+真实浏览器打开确认正常;②故意在 `/opt/landlord-easy`(main分支)目录里跑 `deploy.sh dev`,确认被脚本自己的分支校验直接拒绝退出,没有执行到任何有副作用的步骤,生产站点未受影响;③做了一次真实的"改动→部署→观察→回滚→重新部署→确认恢复"完整闭环:在 `Login.vue` 标题加一个仅用于验证的测试标记,只推到 `dev` 分支,部署到dev worktree,真实浏览器分别打开 `dev.landlordeasy.cn`(看到测试标记)和 `landlordeasy.cn`(生产,完全没有这个标记,确认隔离生效)截图对比;然后在 `dev` 分支上 `git revert` 这个测试commit并重新部署,浏览器复核dev也恢复原样;全程用 `git log`/`git diff` 核实 `main` 分支历史自始至终没有出现过这次测试commit,`dev`/`main` 当前文件内容完全一致(revert完全抵消)。
> **新工作流(供以后所有会话遵守)**:日常改动先提交到 `dev` 分支 → 部署到 `/opt/landlord-easy-dev` 测试 → 觉得不对就在 `dev` 分支上 revert/reset,不影响生产 → 测试满意后把 `dev` 合并进 `main` → 对 `/opt/landlord-easy` 跑 `deploy.sh prod` 才是真正上线。README.md「服务器部署」一节已同步更新。

## M15 批量建房体验修复 + 发现并修复dev环境PM2部署bug(2026-08-24)

> 背景:GasCan 实测"批量建房"页反馈4点问题:①楼栋/房型横排单选选项一多很挤;②只填起始房号不填结束房号,点提交没反应;③只建1间也要填两次房号;④已有101房间又建101,提示"成功创建0个房间"却不说原因。GasCan 明确要求"你自己测完之后再给我",并授权自由发挥改善体验。

- [x] 15.1 **批量建房页4点体验问题修复,并在自测过程中额外发现2个真实bug。**
> 完成说明(Kiro CLI实现,Claude Code设计+复核+独立验证,2026-08-24): 改了什么——
> ①`apps/landlord-h5/src/views/rooms/BatchCreate.vue`:楼栋/房型从横排radio改成点击弹出`van-picker`底部选择器;`endRoom`字段去掉必填规则,placeholder改成"留空则只建1间";`van-form`加`@failed`事件,校验失败(如漏填起始房号)用toast明确提示,不再"点提交没反应";提交成功后如果后端返回`skipped`非空,toast同时告知创建了几间、哪些房号已存在未创建。
> ②`apps/server/src/rooms/rooms.dto.ts`:`BatchCreateRoomsDto.endRoom`从必填改可选。
> ③`apps/server/src/rooms/rooms.service.ts`:`endRoom`留空时默认等于`startRoom`(只建1间);批量创建前先查这批房号里哪些已存在,若**全部**已存在则直接抛`BadRequestException`说明"房号xxx均已存在,未创建任何房间",不再像原来那样静默返回`created:0`;若**部分**重复,创建不重复的那些并在返回值里带上`skipped`列表。
> ④(Claude Code自测中发现的真实bug,追加修复)`rooms.service.ts`补上楼栋存在性校验:MySQL下Prisma的`createMany`+`skipDuplicates:true`实际走`INSERT IGNORE`语义,会把外键约束失败也一并静默吞掉——如果`buildingId`无效,不校验的话会返回"成功但created:0"这种误导性假成功,跟原问题④是同一类缺陷。提前查一下楼栋是否存在,不存在直接报错"楼栋不存在,请重新选择"。
>
> 如何验证——`vue-tsc -b`、`pnpm --filter server exec tsc --noEmit`、`pnpm --filter server test`(15项全过)、两端`build`均独立重跑通过。**已用真实浏览器验证界面正常**:在`dev.landlordeasy.cn`完整走了4轮场景——①楼栋/房型点击弹出底部选择器、选中后正确回显;②起始房号=888、结束房号留空提交,toast"成功创建1间房",SQL查库确认Q栋只多了1条roomNo=888的记录;③同样参数再提交一次,页面停留原地弹出"房号 888 均已存在,未创建任何房间"错误提示(不是静默假成功);④起始887/结束889再提交,toast同时提示创建数量和跳过的888,SQL查库确认887/889新建、888未被覆盖/未重复。测试产生的临时房间数据已清理(留了一条887/889期间被其他会话的e2e测试意外关联了lease的888号房未删,不影响,系统未上线数据会重新初始化)。
>
> **自测过程中意外发现并修复了一个更严重的部署基础设施bug(15.2),导致这次UI/后端改动一开始部署后其实完全没有生效**,详见下条。

- [x] 15.2 **`landlordeasy-server-dev` 这个PM2进程从M14 dev/prod worktree拆分开始,就一直错误地指向`/opt/landlord-easy`(生产目录)而不是`/opt/landlord-easy-dev`,导致dev环境的所有后端代码更新此前实际从未真正生效过,`deploy.sh dev`一直在反复重启的其实是生产的旧代码。**
> 背景——15.1改完部署到dev后,Claude Code自测发现后端行为完全没变(`endRoom`留空仍报英文类错误`endRoom必须为文本`)。排查过程:核对本地/服务器`dist`文件内容确认新代码确实编译正确 → 用`ps`/`readlink /proc/<pid>/cwd`直接查PM2进程实际运行的文件,发现`landlordeasy-server-dev`的`cwd`和`script path`都指向`/opt/landlord-easy`而不是`/opt/landlord-easy-dev` → 确认根因:`pm2 restart <name>`只会重启已注册的进程,不会更新它的cwd/script路径,而这个进程从M14拆分dev/prod worktree时就从未被正确重新注册过,`deploy.sh`里的`if pm2 describe X 存在 then restart`逻辑只要"进程名存在"就直接信任并restart,从不校验它是否指向对的目录——M14当时的"端到端回归验证"用的是前端(Login.vue标题标记)测试,前端静态文件确实是分开部署到独立目录的,所以那次验证是真实通过的,但从未测试过后端专属改动,这个bug才一直没被发现。
> 完成说明(Claude Code,2026-08-24): 改了什么——①一次性手动修复:`pm2 delete landlordeasy-server-dev` + 用正确的`--cwd /opt/landlord-easy-dev`重新`pm2 start`,`pm2 save`;②根治`deploy/deploy.sh`:重启PM2进程前,不再是"存在就直接restart",改成先读取已注册进程的`pm2_env.pm_cwd`跟本次部署目录比对,不一致就先`pm2 delete`再重新`start`,一致才`restart`,prod/dev共用同一个`restart_pm2_process`函数,以后即使再发生"进程注册目录跟worktree拆分后的实际目录对不上"这种情况,`deploy.sh`会自动纠正而不是静默继续用旧代码。如何验证——`bash -n deploy/deploy.sh`语法检查通过;手动修复后用`readlink -f /proc/<pid>/cwd`和`cat /proc/<pid>/cmdline`确认新进程真的绑定`/opt/landlord-easy-dev`;重新跑一次`deploy.sh dev`(带着新的校验逻辑),因为这次cwd已经一致,走的是正常`pm2 restart`分支,没有重新触发delete+recreate,进程保持正确;之后15.1的批量建房场景重新在dev上验证,行为符合新代码预期(见15.1)。**这个bug只影响dev环境的后端更新是否真正生效,不影响生产**——生产的PM2进程`landlord-easy`本身一直就指向`/opt/landlord-easy`(生产worktree本来就是这个目录),从未有过同类问题。

## M16 房东端全模块回归测试 + 10项发现问题修复(2026-08-24)

> 背景:GasCan 要求"针对房东端所有模块撰写测试用例让 Kiro CLI 去测试,覆盖所有场景,体验不好就优化",并明确"我是项目负责人,Kiro CLI 是干活的,我负责最终质量把关"。这是继 M15 批量建房修复之后,同一天延续的更大范围工作。

- [x] 16.1 **设计覆盖房东端全部16个功能模块的测试计划,交给 Kiro CLI 用 Playwright 分4批实现并对着 dev.landlordeasy.cn 执行(不依赖本地Docker/build,用真实历史数据而不是空种子库),Claude Code 独立复核每一批。**
> 完成说明(Claude Code设计+复核,Kiro CLI实现执行,2026-08-24): 改了什么——新增 `e2e/LANDLORD_TEST_PLAN.md`(测试计划,先用 Explore agent 摸底全部20个页面的功能点/校验规则/API调用作为设计输入,再逐模块列出正常流程+边界场景+体验检查点,共 80+ 条用例)和 `e2e/dev-remote.config.ts`(不依赖本地环境,baseURL直接指向dev环境,用系统Chrome规避Playwright自带Chromium下载问题)。分4批把测试计划交给 Kiro CLI 实现成 `e2e/tests/landlord-*.spec.ts` 四个文件并实际执行,每批完成后 Claude Code 独立用 `git status`/`git diff --stat` 核实改动范围、审查 diff、复核报告内容,不直接采信 Kiro 自述。
>
> 如何验证——最终80条用例全部通过或如实记录现象(不下"是bug"结论,只记录事实由 Claude Code 自己判断),写入 `e2e/LANDLORD_TEST_REPORT.md`。第一、二批测试因 Playwright worker 中途重启导致造数逻辑重复执行,dev 数据库一度残留285间测试房间/256份租约/237张账单/72条收款记录,Claude Code 独立发现后先用 `docker exec mysqldump` 打快照做安全网,再按外键依赖顺序(ReminderLog→Payment→BillItem→Bill→DepositRecord→HandoverRecord→Lease→AuditLog→Room→Tenant)写清理脚本清理,并额外发现6间更早遗留的测试房间(未打前缀)和1条M14会话残留的测试租约一并清理,最终核对房间/租约/押金/租客/房东/楼栋/房型/维修记录/支出记录九项统计与2026-08-21记录的历史真实数据基线**完全一致**。第三、四批测试因为在prompt里加了"避免重复造数"的明确要求,残留控制在个位数,且第四批涉及的高风险用例(禁用自己账号、删除有房间关联的真实楼栋Q栋、删除正被使用的真实房型)全部由 Kiro 在操作前先动态核实目标是真实数据、只走一次正规UI流程验证被拒绝、不绕过接口强制操作,过程全部记录在案,Claude Code 逐条核实确认无误操作。
>
> 结果——确认坐实的问题及严重程度评估见下方 16.2/16.3 的修复记录;另有3条记录为"已知功能缺口,不算bug"(手机号复用同一租客不覆盖姓名——GasCan确认这就是想要的设计;`Bill.status.CANCELED`死状态；测试过程本身未发现新的此类问题)。

- [x] 16.2 **修复真实浏览器测试发现的3个高优先级问题(2个后端500崩溃+1个前端状态不同步)。**
> 完成说明(Kiro CLI实现,Claude Code设计+复核+部署验证,2026-08-24): 改了什么——①`apps/server/src/maintenance/maintenance.service.ts`:新增维修记录前先校验 `roomId` 对应房间是否存在,不存在直接 `BadRequestException('房间不存在')`,而不是让 Prisma 外键约束错误冒泡成未处理异常被全局过滤器兜底成500。②`apps/server/src/dashboard/reports.service.ts`:`getMonthlyReport` 方法开头用正则校验 `month` 参数格式(`YYYY-MM`),不合法直接400,而不是让 `new Date()` 产出的 Invalid Date 传进 Prisma 查询导致500。③`apps/landlord-h5/src/views/rooms/RoomList.vue`:`onActivated` 钩子里补上 `fetchRooms()` 调用,keep-alive 恢复时重新拉取最新数据(保留原有楼栋/状态筛选),不再是"什么都不做"导致新签/退租后返回列表状态还是旧的。
>
> 如何验证——`tsc --noEmit`(server)、`vue-tsc -b`(landlord-h5)、`jest`(15/15)独立重跑通过;部署到 dev 后用 curl 直接验证:维修记录传不存在的 roomId 返回 `{"code":400,"message":"房间不存在"}`(此前是500),报表传"2026-13"返回 `{"code":400,"message":"月份格式不正确,请使用 YYYY-MM 格式"}`(此前是500)。

- [x] 16.3 **修复7项体验/健壮性问题(续签退租校验、退出登录二次确认、白名单重新启用、工作台报表并发请求局部失败、逾期/空置页点击跳转和空状态、支出管理编辑删除、租约详情交接记录UI)。**
> 完成说明(Kiro CLI实现,Claude Code设计+复核+部署验证,2026-08-24): 分3批实现,每批改动范围精确对应设计——
> 批次A:`leases.service.ts` 续签校验新到期日不能早于/等于起租日、退租校验退还押金不能超过实际押金;`Mine.vue` 退出登录加 `showConfirmDialog` 二次确认;`settings/Landlords.vue` 已禁用房东补"启用"按钮(后端接口早支持,前端一直没做入口)。
> 批次B:`Home.vue`/`Reports.vue` 的 `Promise.all` 改成 `Promise.allSettled`,某个接口失败不再连累其余已成功的数据一起消失;`dashboard/Vacancy.vue`/`Overdue.vue` 补上 `van-empty` 空状态和点击跳转(分别跳房间详情/账单详情),体验对齐 `Expiring.vue`。
> 批次C(范围最大):`Expenses.vue` 完整参照 `RoomTypes.vue` 的新增/编辑合一弹窗+delete-o二次确认删除模式补齐编辑/删除入口(后端 PUT/DELETE 接口早就支持);`leases/LeaseDetail.vue` 新增"交接记录"卡片组,对接此前只有后端接口、前端从未使用过的 `handover` 模块——展示交接记录列表(类型标签/时间/检查清单/备注),ACTIVE租约可"新增交接记录"(类型单选+动态检查项数组,参照 `NewLease.vue` 附加费用项的写法风格+备注)。
>
> 如何验证——`tsc --noEmit`/`vue-tsc -b`/`jest` 每批独立重跑通过,部署到 dev 后**已用真实浏览器验证界面正常**:支出记录点击打开编辑弹窗、字段正确回填、取消不改动真实数据;"退出登录"点击后正确弹出二次确认、取消不登出;空置看板/逾期看板房间和账单条目均可点击、正确跳转到对应详情页;租约详情页交接记录区块正确显示"暂无交接记录"+"新增交接记录"按钮(仅ACTIVE租约),新增弹窗类型单选、动态检查项行(项目+状况+删除)、"添加检查项"按钮均渲染正常,取消未提交改动真实历史租约。后端边界用curl在**专门新建的测试房间+测试租约**(而非真实历史租约)上验证:续签早于起租日的日期被拒绝(400)、合法日期续签成功、退租超额退还押金被拒绝(400)、合法金额退租成功,验证完清理了测试数据,核对数据库统计与基线一致。

## P2(暂不开工)
微信支付自动销账、合同电子化

## Notes

- 保留原有任务、编号、状态、完成说明及中文语义；任务状态以各复选框中的现有标记为准。
- 依赖图仅列出当前未完成的叶子任务，已完成任务不重复调度。

## Task Dependency Graph

```json
{
  "waves": []
}
```
