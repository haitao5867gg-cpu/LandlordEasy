# Code Review 记录

Claude 审查 Kiro 的代码后在此记录意见,Kiro 处理完标记「已处理」。

## Review 1(2026-07-21,对照 commit 9c25e80 / M1~M6.0)

状态: 待处理

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
