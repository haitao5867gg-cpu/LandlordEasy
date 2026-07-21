# Code Review 记录

Claude 审查 Kiro 的代码后在此记录意见,Kiro 处理完标记「已处理」。

## Review 1(2026-07-21,对照 commit 9c25e80 / M1~M6.0)

状态: 已处理(见 commit b46fb80,6条全部核实修复,tsc 0 错误 + jest 15/15 通过)

审查方式:clone 仓库 main 分支,逐模块读源码(受限于沙盒网络,pnpm install 未能在合理时间内跑完,没能执行自动化构建/测试,以下结论均来自人工代码审查,建议 Kiro 在本地跑一遍确认)。

### 需要处理的问题

1. **[2.3] AuditLogInterceptor 未生效**
   `apps/server/src/common/interceptors/audit-log.interceptor.ts` 逻辑写好了,但没有在任何地方注册——`main.ts` 只 `useGlobalInterceptors(new ResponseInterceptor())`,`app.module.ts` 也没把它加进 providers(`APP_INTERCEPTOR`),也没有 controller 单独 `@UseInterceptors()`。
   现状:写操作不会落 `audit_logs` 表,任务 2.3 实际未生效。
   建议:在 `app.module.ts` 用 `{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }` 全局注册,或在 main.ts 里挂上(注意它依赖 `PrismaService`,用 APP_INTERCEPTOR 方式更合适)。

2. **[4.3 / 4.5] 缺少单元测试**
   仓库里没有任何 `.spec.ts` / `.test.ts` 文件,jest 依赖和配置都在但未使用。任务清单里 4.3(账单引擎幂等 + 月末/跨年边界)、4.5(收款状态机)都写了"单元测试"但实际零覆盖。
   建议:至少给 `BillEngineService.generateBillsForLease`(幂等、月末 clamp、跨年)和 `PaymentsService.confirmOrReject`/`checkBillPaid`(状态流转、超额支付)补单测。

3. **[6.0] CSV 导入命令是空脚本引用**
   `apps/server/package.json` 里 `"import:init": "ts-node src/scripts/import.ts"`,但 `src/scripts/import.ts` 文件不存在,执行会直接报错「Cannot find module」。任务 6.0 完成说明写"CSV 导入命令框架已预留",实际连骨架文件都没有。
   建议:要么先把这个 npm script 删掉/注释掉避免误导,要么把 `src/scripts/import.ts` 的最小骨架(读 CSV → 校验 → dry-run 输出)先补上。

4. **[2.2] 房东白名单只在登录时校验,非实时**
   `LandlordGuard` 只解析 JWT 里的 `role` 字段,不会在每次请求时查库确认 `Landlord.isActive`。也就是说房东被移出白名单后,他手上已签发的 JWT(有效期 7 天)在过期前依然能访问房东端接口。
   即将开工的 6.2(白名单管理页)如果预期"移除立即生效",现在的实现做不到,需要 Guard 每次查库或引入更短 token 有效期 / 黑名单机制。请在 6.2 里一并考虑,或写进 questions.md 确认这是否是预期行为。

### 记录但不阻塞的小问题

5. **[1.4] 种子数据房间数与注释/任务清单不符**
   `prisma/seed.ts` 注释写"每栋75间",但循环是 5 层×13 间 + 1 层×12 间 = 77 间/栋,4 栋共 308 间,不是 tasks.md 里写的"300 间房"。不影响功能,顺手改一下注释和循环让数字对上即可。

6. **[5.1] 邀请码绑定的 openid 唯一约束边界情况**
   `Tenant.openid` 有 `@unique` 约束。如果同一个微信号先后绑定了两个"手机号不同但实际是同一人"的租客记录(`TenantApiService.bindInviteCode` 里 `tenant.update` 设置 openid),第二次会触发 Prisma 唯一约束冲突(P2002),目前没有 catch,会直接抛出未处理异常。概率低,建议加个友好报错提示"该微信号已绑定其他租客,请联系房东合并"。

### 确认没问题的部分(不用改)

- Prisma schema 14 个模型齐全,字段设计符合 design.md
- 账单引擎的幂等判断(`leaseId_periodStart` 唯一)、月末边界 clamp 逻辑正确
- 收款确认/驳回/手动记账流程符合状态机设计,`checkBillPaid` 用 `>=` 判断支持超额支付
- 租客端按租约状态过滤账单的逻辑(ACTIVE 全展示 / ENDED 未结清只展示未结清 / 结清后只读)符合 requirements §8
- 催租提醒的间隔计算(到期前3天/到期日/逾期每3天)正确
- `.env` 未泄露到仓库,`.gitignore` 配置正确
- 前端目前只有骨架页面,这点 Kiro 自己在完成说明里已如实注明,不算问题

---

## Review 2(2026-07-21,对照 commit aad1cd9,M7 前端 7.1~7.15)

状态: 待处理

审查方式:这次是在你本地实际使用的项目文件夹里直接审查(不是隔离沙盒 clone),`node_modules` 现成,`tsc`/`vue-tsc`/`jest` 都实跑了。后端 `tsc --noEmit` 0 错误,`jest` 15/15 通过,无回归。`test:e2e` 需要连 MySQL,这次环境没有 Docker,没跑,建议 Kiro 自己在本地跑一次 `pnpm --filter server test:e2e` 确认。

### 需要处理的问题(有一条比较严重,建议优先修)

1. **【严重】租客付款上报页在真实场景下会直接把租客踢下线** (`apps/tenant-h5/src/views/PayBill.vue` 第 54 行)
   页面用 `http.get(`/bills/${route.params.id}`)` 去拿账单详情,但 `GET /bills/:id` 是挂在 `BillsController` 上的,整个 controller 是 `@UseGuards(LandlordGuard)` 保护的,只认 `role: 'landlord'` 的 JWT。租客的 JWT 是 `role: 'tenant'`,请求会被 `LandlordGuard` 拒绝返回 401。而 `tenant-h5` 的 `http.ts` 响应拦截器把所有 401 都当"登录已过期"处理,直接清 token 跳回登录页——也就是说,租客点进任何一张账单准备"我已付款"的时候,都会被强制退出登录,这个核心流程现在是完全不通的。
   这是我自己在 `frontend-pages.md` 里没写清楚"账单详情数据从哪来"埋下的坑,不全怪 Kiro,但必须优先修。
   建议修法:不要单独请求 `/bills/:id`,改成从 `MyBills.vue` 已经拿到的 `GET /tenant/bills` 数据里找对应 id 的账单(跳转时用路由 `state`/`query` 带过去,或者在 `PayBill.vue` 里重新调 `GET /tenant/bills` 再本地 `find`),不要碰任何 `LandlordGuard` 保护的接口。

2. **landlord-h5 生产构建会直接失败** (`apps/landlord-h5/src/views/dashboard/Overdue.vue` 第 8 行)
   `vue-tsc -b` 报错:`error TS2322: Type 'number' is not assignable to type 'string'`,原因是 `v-for="(items, bName) in data.buildings"` 里 `bName` 被推断出 `number` 的可能类型,直接 `:title="bName"` 类型对不上。同样是"按楼栋分组"的 `Vacancy.vue` 用了 `` :title="`${bName}(...)`" ``(模板字符串强制转 string)所以没报错——两个页面写法不一致导致的。
   建议:把 `Overdue.vue` 第 8 行改成 `` :title="`${bName}`" `` 或 `:title="String(bName)"`,跟 `Vacancy.vue` 保持一致写法。这个不修,`pnpm --filter landlord-h5 build` 是过不了的。

### 记录但不阻塞的问题

3. **手动记账表单要求房东手输账单数据库 ID** (`PendingPayments.vue`)
   "手动记账"弹窗里"账单ID"是一个裸的数字输入框,房东(家人,非技术背景)不可能知道某张账单在数据库里的 id 是多少,这个功能现在等于摆设。建议改成搜索/选择账单(比如按房号+租客搜),或者从账单详情页带着 billId 跳转过来一个"手动记账"入口,而不是只在待确认收款页放一个孤立的手动记账弹窗。

4. **房间详情页看不到"当前欠费"** (`RoomDetail.vue`)
   `frontend-pages.md` 里"当前状态"一栏要求直接展示当前欠费情况,现在页面只列了当前租约,要看欠了多少得再点进租约详情。不是 bug,信息都在(`GET /rooms/:id` 已经把 bills 一起返回了),建议顺手在基本信息区加一行"当前欠费:¥xxx"汇总,不用再点一层。

### 顺带一提(不算代码问题)

- 这两轮 Kiro 的提交在 git 里显示的作者是 `Claude Review <claude-review@landlordeasy.local>`,不是 Kiro 自己的身份——因为我第一次在这个共享文件夹里 `git config user.name` 时设的是仓库级别(没加 `--global`),Kiro 那边的 git 客户端读到的也是这份仓库配置。不影响代码本身,但如果你们在意提交记录里谁改了什么,建议在这个仓库里把 `user.name`/`user.email` 改回 Kiro 自己的身份(`git config user.name "Kiro"` 这种,仓库级别设置一次就行)。

### 确认没问题的部分(不用改)

- 路由清单跟 `frontend-pages.md` 完全对上,该有的页面都在
- `http.ts` 请求封装(token 拦截 + 401 跳转 + 统一错误 toast)、Pinia auth store、登录页 mock_openid 自动登录,landlord-h5/tenant-h5 两边写法一致、逻辑正确
- 新签租约表单字段跟 `CreateLeaseDto` 完全对应,附加费用项可动态增删,签约后邀请码展示+复制
- 退租/续签弹窗字段对应 `EndLeaseDto`/`RenewLeaseDto`,逻辑正确
- 账单详情的追加费用项/追加滞纳金(仅 OVERDUE 显示)、待确认收款的确认/驳回/凭证图预览,都正确
- 租客端 `MyBills.vue` 对 requirements §8 三种访问状态(在租/退租未结清/结清只读)和多租约切换处理正确
- `POST /tenant/bind` 成功后前端正确用返回的新 token 替换本地 token(7.15 那个坑真的堵上了)
- 后端补的 `GET /tenant/qrcode` 和 `bind` 返回新 JWT,实现方式正确,`jest` 无回归

---

## Review 3(2026-07-21,对照 commit 793aec3,Review 2 的修复)

状态: 待处理

审查方式:同样在本地文件夹直接跑 `vue-tsc -b`(两个前端)+ `tsc --noEmit` + `jest`(后端)。

### 结论:4 条里 3 条修好了,1 条修复本身带来了新的编译错误

1. ✅ **严重的 401 退登录问题真的修好了**——`PayBill.vue` 现在从 `GET /tenant/bills` 里按 id 找账单,不再碰 `LandlordGuard` 保护的接口,逻辑对。
2. ✅ `Overdue.vue` 的 `:title` 类型错误已修,`landlord-h5` 的 `vue-tsc -b` 现在能跑通了(EXIT 0)。
3. ✅ `RoomDetail.vue` 加了"当前欠费"汇总,逻辑正确(汇总 ACTIVE 租约下 PENDING/OVERDUE 账单金额)。
4. ⚠️ **手动记账**:在 `BillDetail.vue` 里加了新的入口(带 billId,不用手输,这块修对了),但**旧的 `PendingPayments.vue` 里那个要求手输"账单ID"的手动记账弹窗没有删掉**,两个入口现在同时存在,旧的那个还是一样不好用。建议干脆把 `PendingPayments.vue` 里的手动记账入口去掉,统一走账单详情页那个新的,不然容易让人（包括以后接手的人)搞不清该用哪个。

### 新问题:这次修复本身引入了一个编译错误(建议下一轮优先修)

**`tenant-h5` 编译失败**(`vue-tsc -b` EXIT 1):
```
src/views/PayBill.vue(59,23): error TS2352: Conversion of type 'AxiosResponse<any, any, {}>' to type 'any[]' may be a mistake...
```
第 59 行 `const allLeases = leasesData as any[];`——`http.get()` 的返回值类型是 `AxiosResponse<any,...>`,直接转成 `any[]` 属于"类型不够重叠"的强制转换,TS 不允许。逻辑本身没问题(拦截器运行时确实返回的是数组),纯粹是类型标注问题。
建议改成 `leasesData as unknown as any[]`,或者更干净的写法:`const [leasesData, qrRes]: [any, any] = await Promise.all([...])`,跟这个项目里其他页面(比如 `MyBills.vue`)保持同样的 `as any` 写法习惯。这个不修,`pnpm --filter tenant-h5 build` 过不了。

### 顺手提一句:仓库里混进了一些不该提交的生成文件

这次提交(以及更早的 M1 那次)把几个构建产物提交进了 git:`apps/server/tsconfig.tsbuildinfo`、`apps/landlord-h5/vite.config.js`+`.d.ts`(+`.map`)、`apps/tenant-h5/vite.config.js`+`.d.ts`(+`.map`)、两边的 `tsconfig.node.tsbuildinfo`。这些都是本地跑 `tsc`/`vite` 时自动生成的文件,不该进版本库(每次构建内容都会变,徒增无意义的 diff)。建议:
```
git rm --cached apps/server/tsconfig.tsbuildinfo apps/*/tsconfig.node.tsbuildinfo apps/*/vite.config.js apps/*/vite.config.d.ts apps/*/vite.config.d.ts.map apps/*/vite.config.js.map
```
然后在 `.gitignore` 里加一行 `*.tsbuildinfo` 和 `vite.config.js` / `vite.config.d.ts*`(前提是项目里 `vite.config.ts` 才是手写的源文件,这几个 `.js`/`.d.ts` 都是编译出来的)。不紧急,不影响功能,但越晚清理 diff 越难看。

### 确认没问题的部分

- 后端 `tsc --noEmit` 0 错误,`jest` 15/15 通过,无回归
