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

状态: 已处理(见 commit 4ca6c75,3条全部核实修复。`vue-tsc -b` 两个前端 + `tsc --noEmit` 后端全部 EXIT 0,`jest` 15/15 通过,`git ls-files` 确认构建产物已清干净)

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

---

## Review 4(2026-07-22,对照 commit 90cc0e7 + ed07a4e,M8 的 8.4~8.6 + 8.9)

状态: 待处理

审查方式:这次服务器是真实公网机器了,我直接对 `http://111.229.167.29` 发了几个真实请求验证(不是只看代码),另外读了 `deploy/` 下的脚本和 `docker-compose.yml`。

### 【高优先级,已用真实请求验证】租客端 H5 实际上没有部署成功

`curl http://111.229.167.29/tenant/` 返回的页面标题是"房东管理",内容是 landlord-h5 的登录页,不是 tenant-h5。也就是说租客现在打开这个地址,看到的是房东端的登录页。

原因:`apps/tenant-h5/vite.config.ts` 没有配 `base: '/tenant/'`,`apps/tenant-h5/src/router/index.ts` 的 `createWebHistory()` 也没传 base path。tenant-h5 打包出来的 `index.html` 里资源路径都是按部署在根路径 `/` 算的,但 `deploy/nginx.conf` 把它挂在 `/tenant/` 子路径下(`alias` + `try_files ... /tenant/index.html`)。两边路径约定对不上,`alias`+`try_files` 这种写法在 nginx 里正确的 fallback 应该是相对路径,现在很可能是请求落回了 `location /` 从而拿到了 landlord-h5 的页面。

建议修复(两种选一种):
1. **推荐**:给 tenant-h5 配 `base: '/tenant/'`(vite.config.ts)+ `createWebHistory('/tenant/')`(router),重新 build,nginx 的 `try_files` fallback 也顺手确认一下写法(用 `alias` 时 `try_files` 里的路径不应该带 location 的前缀,建议改成 `try_files $uri $uri/ /tenant/index.html =404;` 之外,更保险的做法是 `location /tenant/ { alias .../dist/; try_files $uri $uri/ @tenant_fallback; } location @tenant_fallback { rewrite ^ /tenant/index.html break; root ...; }` 这种,或者干脆两个前端各用一个独立的 server_name / 端口,子路径这种做法对 SPA 来说坑比较多。
2. **更省事**:两个 H5 各自用一个二级域名(比如 `landlord.你的域名.com` / `tenant.你的域名.com`),都跑在根路径 `/`,不用改 base path,nginx 配置也更简单,以后调试也不容易搞混。域名还在备案,现在改这个方案完全来得及。

不管选哪种,现在这套部署配置线上验证下来是有问题的,租客端等于没上线。

### 【安全,请找用户确认】SSH 保留了密码登录,而且明文密码目前在本地文件里

8.5 的完成说明写"SSH密码登录保留(用户要求)"——如果这真的是 GasCan 主动要求保留密码登录,那是他的选择,但既然服务器现在暴露在公网,建议至少确认装了 fail2ban 之类的东西防暴力破解,单纯密码认证挂在公网 22 端口风险不低。如果这不是 GasCan 本人的要求(比如理解有误),应该按 8.5 原计划改成密钥登录 + 禁用密码。

另外,本地仓库根目录有个 `.ssh-helper.sh`(已正确 `.gitignore`,没有进 git,这点做得对),里面是一个 expect 脚本,**明文写了服务器的 SSH 密码**。这个文件我这次 review 读到了内容,也就是说这个密码已经出现在这次会话记录里——不管密码本身强度如何,只要密码在任何聊天记录/日志里出现过,都建议当作已泄露处理,尽快去服务器上换一个新密码。

### 【建议关注,我这边网络环境验证不了,请 Kiro 登录确认】docker-compose.yml 里的默认密码

`docker-compose.yml` 里 MySQL 是硬编码的示例密码(`root123` / `landlord123`),这份文件在公开仓库里,任何能看到仓库的人都知道这两个默认密码。8.4 的完成说明说生产环境的 MySQL 容器已经跑起来了——如果直接复用了这份 `docker-compose.yml` 没改密码,生产库的密码实际上是公开的。
请 Kiro 登录服务器确认两件事:①生产环境的 MySQL 密码是不是已经换成了跟仓库里不一样的强密码(建议通过服务器上单独的 `.env` 或 docker-compose 的环境变量覆盖,不要动仓库里这份当"生产配置");②`ufw status` 确认 3306 端口确实没有被放行到公网(`setup.sh` 里只放了 22/80/443,理论上应该没问题,但建议登录进去亲眼确认一下,不要只靠"应该没问题"）。

### 确认没问题的部分

- `http://111.229.167.29/api/v1/health` 真实请求验证通过,返回 `{"status":"ok","database":"connected"}`,后端+数据库确实是通的
- landlord-h5 的 Login.vue 真实微信授权适配写得对:`localhost`/带 `mock_openid` 自动走 mock,其他情况跳转 `https://open.weixin.qq.com/connect/oauth2/authorize`,`scope=snsapi_base` 静默授权选得对(不需要用户点确认),回调后正确处理 `code` 换 token;tenant-h5 逻辑一致
- `.env.production` 里只放了 `VITE_WECHAT_APPID` 占位符(`YOUR_APPID_HERE`),AppID 本身不算敏感信息(公开可见也没关系),没有把 AppSecret 之类真正敏感的东西塞进前端 env,这点是对的
- `deploy/setup.sh`/`deploy.sh`/`certbot.sh` 脚本逻辑合理,UFW 只放行 22/80/443
- `.ssh-helper.sh` 正确进了 `.gitignore`,没有提交到 git(密码本身要不要紧是另一回事,见上面)

---

## Review 4 处理进度核查(2026-07-22,对照 commit 41ccb92)

状态: 待处理(1条代码修对了但线上没生效,1条部分完成,1条待确认)

同样用真实请求核查,不只看代码/commit message。

### ⚠️ 代码修复是对的,但线上还没生效——租客端现在打开还是显示房东端

`apps/tenant-h5/vite.config.ts` 加了 `base: '/tenant/'`,`router/index.ts` 改成了 `createWebHistory('/tenant/')`,这两处代码修复本身是对的。但我刚才用两个不同的 URL(含随机参数排除缓存干扰)重新请求了 `http://111.229.167.29/tenant/`,拿到的还是标题"房东管理"的页面,跟修复前一模一样。
说明代码改完之后,**服务器上没有重新构建+部署**——`git push` 只是把代码更新到了仓库,线上跑的还是旧的 dist 文件,而且 nginx 配置(`deploy/nginx.conf` 里的改动)也得手动同步到服务器的 `/etc/nginx/sites-available/` 才会生效,这两步都得登录服务器自己做,不会自动发生。
请 Kiro 登录服务器执行一遍 `deploy/deploy.sh`(或者手动 `git pull` + `pnpm --filter tenant-h5 build` + 把新 `nginx.conf` 复制过去 + `nginx -t && systemctl reload nginx`),弄完之后我会再验证一次。

### 🟡 安全加固完成了一部分

密码已经换了、装了 fail2ban,这两点做得好,处理了最紧急的问题。SSH 改密钥登录还在等 GasCan 给私钥文件,这个不算 Kiro 没做,是流程正常卡在需要用户配合的那一步。

### ❓ MySQL 默认密码这条,只确认了端口没暴露,密码本身有没有换不清楚

commit message 写"确认3306未暴露公网",这个我认,但 Review 4 原本问的是两件事:①3306 没暴露(确认了)②生产环境 MySQL 密码是不是已经换成跟仓库里 `docker-compose.yml` 不一样的强密码。第二件事目前不确定是否处理了,commit message 没提。就算端口没对外开放,生产库如果还在用 `root123`/`landlord123` 这种谁都能在 GitHub 上看到的默认密码,还是建议换掉,多一层保险(比如以后万一防火墙规则被误改,至少密码那道防线还在)。麻烦 Kiro 确认一下。

---

## 复核(2026-07-22,对照 commit 2f217fc)

**8.5 SSH 密钥登录:确认完成,做得很仔细。** 密钥验证通过、`sshd_config` 和 `cloud-init` 都设了 `PasswordAuthentication no`(连 cloud-init 重启会覆盖 sshd_config 这个坑都想到了,细节到位)、`.ssh-helper.sh` 删了、`.gitignore` 加了 `*.pem`。这条可以放心关掉了。

**上一轮说的"租客端部署没生效"是我搞错了,更正一下:**
GasCan 自己用浏览器打开 `http://111.229.167.29/tenant/` 显示是对的(租客端),但我这边用工具重复测同一个地址却一直显示房东端,一度以为是没重新部署。后来追查发现是我这边的请求工具在处理 `/tenant/`(末尾带斜杠、后面没有具体文件名)这种 URL 时,没有把这个斜杠原样传过去,变成了 `/tenant`(不带斜杠)——直接测 `http://111.229.167.29/tenant/index.html` 返回的确实是"租客端",证明部署其实是成功的,是我的验证方式有问题,不是 Kiro 没部署。这里更正,抱歉造成的来回。

不过这个也顺带暴露一个真实的、优先级不高的小问题:nginx 的 `location /tenant/` 只精确匹配带斜杠的路径,`/tenant`(不带斜杠)这个请求会落到 `location /` 上,显示成房东端而不是 404 或自动跳转。真实场景里如果有人手动敲网址漏了斜杠、或者以后菜单链接配置里少打一个 `/`,会看到不该看到的页面。建议顺手在 nginx 里加一条 `location = /tenant { return 301 /tenant/; }` 之类的规则堵上,不紧急,有空处理就行。

**MySQL 生产密码是否已经从仓库默认值换掉这条,仍然待确认**,这个我没法自己验证,还是需要 Kiro 登录确认一下。

---

## Review 5(2026-07-22,对照 commit ce94ff5 + 80f7c5c + 3acb97c)

状态: 待处理(1个小问题,不紧急)

MySQL 密码那条这次确认了(commit message:已从默认 `landlord123` 换成强密码),`/tenant` 301 跳转也补上了,上一轮两条都处理完了。

`tsc --noEmit` 0 错误,`jest` 15/15 通过,无回归。`RealWechatAuthService`/`RealWechatNotifyService`(8.7/8.8)代码读下来逻辑正确:OAuth2.0 换 openid 的错误处理对,access_token 缓存+提前5分钟过期的处理对,`.env.example` 只放占位符没有真实密钥泄露。

一个小问题不紧急,建议顺手改:`RealWechatNotifyService.sendTemplateMessage` 里 access_token 过期(errcode 40001/42001)会清空缓存后**递归调用自己重试**,但没有限制重试次数——如果是 AppSecret 配置错了这种持续性失败(不是单纯 token 过期),会一直递归重试下去,一条提醒消息可能长时间挂着不返回,拖慢当天的催租提醒任务整体进度。建议加个参数(比如 `retried: boolean = false`)限制最多重试一次,重试还失败就直接返回 false。

M8 到这里基本收尾了,只剩 8.10(正式上线)卡在 ICP 备案,不是代码问题。

---

## Review 6(2026-07-22,GasCan 实测反馈"效果非常差",真实浏览器复现)

状态: 待处理(【严重】,全站级问题,优先级最高,先修这个再看别的)

这次是第一次用真实浏览器(不是 curl/web_fetch)打开 `http://111.229.167.29/`,之前所有验证都只测了"HTTP 状态码 200"和"tsc/jest 通过",没人真正拿浏览器看过页面渲染出来是什么样——这是我这边流程上的疏漏,以后每轮涉及前端的 review 我都会加一步真实打开页面看,不能只看接口返回。

### 【严重,全站级】Vant 组件库从未注册,所有页面上的 van-* 组件全部渲染失败

GasCan 的截图显示打开网站只有裸文字"工作台房间账单我的",没有任何卡片、图标、样式。我用浏览器复现后确认:

- 静态资源(JS/CSS)全部 200 正常加载,`/api/v1/dashboard/*` 等接口也全部 200 有正常数据返回——后端和网络都没问题
- 打开控制台看渲染出的真实 DOM,发现类似这样的结构:
  ```html
  <van-nav-bar title="工作台"></van-nav-bar>
  <van-cell-group inset>
    <van-cell title="空置房间" is-link value="270"></van-cell>
    ...
  </van-cell-group>
  <van-tabbar>
    <van-tabbar-item to="/" icon="home-o">工作台</van-tabbar-item>
    ...
  </van-tabbar>
  ```
  `<van-nav-bar>`、`<van-cell>`、`<van-tabbar>` 等标签原样出现在 DOM 里,没有被 Vue 解析成真正的组件——Vue 遇到不认识的标签会当成"自定义元素"直接渲染原样标签,不会报错,也不会应用 Vant 的任何内部逻辑和 class,页面上当然什么样式都没有。

- 根因:`apps/landlord-h5/src/main.ts` 和 `apps/tenant-h5/src/main.ts` 里只 `import 'vant/lib/index.css'` 引入了样式表,**从来没有 `app.use(Vant)` 或者任何形式注册 Vant 组件**。CSS 文件本身是加载成功的(浏览器网络面板里 200,内容也是真的 Vant CSS),但 CSS 里定义的选择器(比如 `.van-cell`)在页面上根本找不到对应的元素,因为 Vue 渲染出来的标签压根不是组件转译后的那些 div/class 结构,是原样的 `<van-cell>` 标签。样式表加载成功和组件能不能用是两件独立的事,这个项目只做了前一半。

- 这不是某一个页面的 bug,是**两个前端项目从 M7 开始所有页面的 van-* 用法全部没生效**,包括登录页、工作台、房间列表、账单、租客端所有页面——因为问题出在最底层的 app 初始化,不是某个 .vue 文件写错了。之前所有 review(包括我自己)一直只验证 `vue-tsc -b` 编译通过 + curl 接口 200,没有真的用浏览器看过渲染结果,所以这个问题一直没被发现,一直"看起来做完了"实际全站都是裸标签。

- **修复方式(两个前端都要改,改法一样)**:
  ```ts
  // main.ts
  import Vant from 'vant';
  import 'vant/lib/index.css';

  const app = createApp(App);
  app.use(Vant);   // 加这一行,注册全部 Vant 组件
  app.use(createPinia());
  app.use(router);
  app.mount('#app');
  ```
  这是全量注册(简单直接,项目这个规模不需要按需引入优化包体积)。改完在两个前端各跑一次 `pnpm build`,然后**一定要用真实浏览器打开页面肉眼看一遍**,确认卡片、图标、底部导航栏都有正常的 Vant 样式(圆角卡片、灰底、图标),不能只看 build 有没有报错。

### 关于"怎么保证以后不用 GasCan 当测试员"——建议加一道"视觉验收"关卡

GasCan 提了一个很合理的要求:**结果给到他之前,应该已经自测过,不该让他来发现这种问题。** 这次的教训是:`tsc`/`vue-tsc`/`jest`/`curl` 全绿,但页面实际是坏的——这几种验证方式互相都测不到"页面渲染出来长什么样"这件事。以后任何涉及前端页面的任务,验收标准里必须加一条:

1. Kiro 自己在本地 `pnpm build` + `pnpm preview`(或者直接部署到服务器后)**用真实浏览器打开每一个改动过的页面,肉眼确认样式和交互都正常**,再在完成说明里写"已用浏览器验证界面正常",不能只写"build 通过"
2. 我这边以后对前端相关的改动,review 时会用 Chrome 工具真实打开页面看一遍(不只是 curl 接口),这个已经在这次 review 里补上了,以后常态化
3. 建议:GasCan 收到"做完了"消息后,理想情况下应该是走个形式确认一下大方向对不对,而不是承担"第一个发现明显 bug 的人"这个角色——这次这种全站级的显眼问题,理应在到达 GasCan 之前就被拦下来

---

## Review 7(2026-07-22,对照 commit e0bf939,验证 Review 6 修复 + Q3 处理情况)

状态: 已处理(Vant 问题确认修复且线上生效;DTO/version 已处理;9.5~9.7 历史数据导入功能已实现)

这次验证方式:`tsc --noEmit`(server)+ `vue-tsc -b`(两个前端)全部 EXIT 0,`jest` 15/15 通过;**并且用 Chrome 工具实际打开了线上 `http://111.229.167.29/` 和 `/tenant/`,肉眼确认渲染正常**——工作台四张汇总卡片(空置房间/30天内到期/逾期账单/待确认收款)带图标和圆角样式正常展示,底部 Tabbar 图标+高亮色正常,点进"房间"列表楼栋 Tab、状态筛选、已租/空置状态标签样式全部正常;tenant-h5 登录页标题+副标题+蓝色圆角按钮样式正常。**Review 6 那个全站级问题确认修复,而且已经部署到了线上,不是只改了代码没生效。**

### 逐项确认

1. ✅ 8.11 Vant 注册:两个 `main.ts` 都加了 `app.use(Vant)`,线上实测样式恢复正常
2. ✅ DTO 排查:`bills.controller.ts` 的 `AddBillItemDto`/`AddLateFeeDto` 补了装饰器,加上上一轮已修的 `LoginDto`,目前排查到的都处理了
3. ✅ docker-compose.yml 的 `version` 字段已删除
4. ✅ 9.5:`importLeases()` 现在会把 `carPlate` 写入 `Lease.carPlate`,`parkingFee` 转成 `feeItems` 里的一条"停车费"记录——读了 Prisma schema 确认 `Lease.carPlate`/`feeItems` 字段本来就存在,写法对得上
5. ✅ 9.6:每条导入租约的押金现在会同步创建一条 `DepositRecord`(type: RECEIVE),这样报表里的押金总额不会漏算这批历史数据
6. ✅ 9.7:新增了 `importExpenses()`,读 `expenses.csv`,按"日期+名称+金额"三者相同判定幂等(重跑不会重复插入),可选关联楼栋/房间,金额<=0或没有name的行会跳过,逻辑合理

### 顺带确认一件事(不是 bug,只是提醒)

线上"房间管理"页面现在显示的楼栋还是 `A栋/B栋/C栋/D栋`(种子数据),不是 `Q栋/R栋/S栋`——说明历史数据 CSV 还没有真正跑 `import:init` 导入到生产库,这是正常的,因为 `leases.csv` 里的租客姓名/电话还等 GasCan 手动填,填完再导入即可,不用现在处理。

M8.5、Q3、9.5~9.7 这一轮全部验证通过,没有遗留问题。

---

## Review 8(2026-07-22,对照 commit dbba2be,验证 9.8 + GasCan 实测反馈的两个问题)

状态: 9.8 已处理;新发现的租约日期体验问题已写成 9.9 派给 Kiro

### ✅ 9.8 楼栋/房型编辑删除:实测通过

浏览器实点"设置→楼栋管理",编辑弹窗、删除二次确认都正常;顺手测了一下删除有房间的楼栋,返回的是"该楼栋下有房间,无法删除"的中文提示(400),不再是裸的 500,dbba2be 这个修复也验证了。

### 🆕 GasCan 反馈问题1:新签租约起租日/到期日体验差——已复现,已写成 9.9

实测复现:两个日期字段是纯文本框,输入"2026/7/23"这种非标准格式提交后,弹出的报错是英文原文 `startDate must be a valid ISO 8601 date string`,跟 GasCan 描述的完全一致。这不是个例,是全局 `ValidationPipe` 没配 `exceptionFactory` 导致的,理论上所有 DTO 校验失败都有同样的英文透传风险。已经把"起租日改日期选择器 + 到期日改成按租期自动算 + 全局校验报错中文化"写成 9.9,派给 Kiro,细节和实现建议见 tasks.md。

### 🆕 顺手一提:房间筛选 Tab 里有个孤立的"R"楼栋

不是 bug,是测试数据——大概率是 GasCan 自己在楼栋管理页测新增功能时手误提交了个没写完的名字。写进了 tasks.md 9.10,提醒 GasCan 自己去删/改名,不用 Kiro 处理。

### 关于"能不能用 AI 测试代替一个个点"——这次顺手做了个示范

这次为了复现问题1,我直接用 Chrome 工具走了一遍:房间列表→点进房间详情→新签租约→填表→故意输入不规范日期提交→截图看到报错。这个过程本身就是"AI 帮忙测"的一种形式,不需要额外的第三方工具,我在这个会话里就能做。已经在聊天里跟 GasCan 说明了两种可行方案(我做一次性系统性走查 / Kiro 补一套 Playwright 自动化回归测试),两者互补,不冲突。

---

## Review 9(2026-07-28,整体代码质量审查,环境隔离之前)

状态: 完成,无阻塞性问题,若干建议供 GasCan 决定优先级

审查方式:不是对照单个 commit 的增量 review,是一次全仓库的整体质量抽查——通读后端所有 controller/service、Prisma schema、前端关键页面,重点核对了最近几轮改动(9.9 租约日期重做、9.10 房间列表筛选持久化)的正确性,并且专门看了一遍跟"环境隔离"直接相关的配置管理现状。`tsc --noEmit`(server)+ `vue-tsc -b`(两个前端)EXIT 0,`jest` 15/15 通过。

### 好消息:核心业务逻辑这次抽查下来是扎实的

- **9.9 的到期日计算跟账单引擎的语义对上了,这个细节容易错但 Kiro 处理对了。** `NewLease.vue` 里"到期日 = 起租日+租期-1天"(比如 7/23 起 1 年期 → 次年 7/22 到期),我特意去查了 `BillEngineService.generateBillsForLease` 的循环条件 `periodStart < endDate`,验证了 `endDate` 在整个系统里的语义就是"租客在住的最后一天"(闭区间),不是"下一租期开始日"。两边对得上,不会因为差一天导致最后一个月账单算错或漏算。这种跨文件的隐性契约很容易踩坑,这次没踩。
- 月末溢出处理(1/31 + 1个月 → 2/28)在前端 `calcEndDate` 里跟后端 `BillEngineService.clampToMonthEnd` 用的是同一个思路(`setMonth` 溢出后用 `setDate(0)` 回退),没有各写各的、逻辑不一致。
- `GlobalExceptionFilter` 兜底正确,不会把堆栈信息泄露给前端,未预期的异常统一回一句"服务器内部错误"。

### 需要注意的问题

1. **【建议尽快,不难改】未捕获异常没有留服务端日志**
   `GlobalExceptionFilter`(`apps/server/src/common/filters/http-exception.filter.ts`)兜底返回"服务器内部错误"是对的,但 catch 到非 `HttpException` 的意外错误时没有任何 `Logger.error()` 记录——线上真出现 500,除了前端看到一句"服务器内部错误",服务器这边什么痕迹都留不下,排查全靠猜。建议在 `catch()` 里,对不是 `HttpException` 的分支加一行 `this.logger.error(exception)`,把堆栈打到服务器日志里(PM2 能看到),不影响返回给前端的内容。

2. **【环境隔离前必须先看这条】前端 API 地址是写死的相对路径,没有环境变量支撑**
   `apps/landlord-h5/src/utils/http.ts` 和 `tenant-h5` 同款文件里 `baseURL: '/api/v1'` 是硬编码的相对路径,现在能跑是因为 nginx 把前端和后端反代到了同一个域名/IP 下。这个设计本身没错,但意味着**现在项目里没有任何"这是 dev 环境 / 这是 staging / 这是 prod"的显式配置概念**,前端永远假设"跟自己同源就是后端"。如果环境隔离的方案里包含"前后端分开部署、不同环境用不同域名或端口"这种情况,现在的写法会直接不工作,需要提前决定好方案(加 `VITE_API_BASE_URL` 之类的环境变量,`.env.development`/`.env.staging`/`.env.production` 分开配)。这个我建议放到接下来聊环境隔离的时候一起定,不用现在单独改。

3. **【环境隔离前也建议看一眼】后端环境变量是散落读取的,没有启动时校验**
   `process.env.XXX` 分散在 7 个文件里直接读(`main.ts`、`wechat/` 几个 service、`reminders.service.ts`、`tenant-api.service.ts`、`auth.service.ts`),没有用 NestJS 官方的 `@nestjs/config` 做集中管理,更没有启动时校验"必需的环境变量是否都配了"。现在的后果是:比如 `WECHAT_APPID` 没配,不会在服务启动时报错,而是等到真的有人点击微信登录那一刻才在运行时炸出来。如果接下来要维护多套环境(dev/staging/prod),环境变量只会越来越多,建议引入 `@nestjs/config` + 一个简单的校验(哪怕只是启动时检查几个关键变量是否为空,不用上重量级的 schema 校验库),环境切错、漏配的时候能在启动阶段就发现,而不是等用户触发时才发现。

4. **【记录为技术债,不紧急】测试覆盖率低,只覆盖了两块核心逻辑**
   仓库里只有 2 个 `.spec.ts`(`bill-engine.service.spec.ts`、`payments.service.spec.ts`),`leases.service.ts`(新签/退租/续签,押金结算这些资金相关的核心逻辑)、`auth` 的守卫逻辑、`tenant-api.service.ts` 都没有单测。之前 review 1 就提过这个,一直没有系统性补,现在功能越堆越多,补测试的成本也在往上涨。不阻塞现在的开发,但建议不要无限期往后拖——9.11 那个 Playwright E2E 补的是前端交互层,跟后端 service 层的单元测试是两回事,两个都需要。

5. **【记录为技术债,现在体量完全不需要处理】Prisma schema 没有加任何 `@@index`**
   `Room.status`、`Bill.status`、`Bill.dueDate`、`Lease.status`、`Lease.endDate` 这些高频筛选字段(空置看板、逾期看板、到期预警、账单引擎每天扫描)现在都是全表扫描。以你们现在 130~300 间房、几年账单量的规模,MySQL 全表扫描完全没有性能问题,这条纯粹是"以后如果规模涨到几千间房再考虑"级别的记录,现在不用动。

6. **【小问题,不影响功能】`dashboard.service.ts` 的空置看板有轻微 N+1 查询**
   `getVacancyBoard()` 对每个空置房间单独查一次"最后一条已结束租约"来算空置天数(`vacantRooms.map(async room => ...)`),房间数一多会打出等量的独立 SQL。现在 130~300 间房级别,这个量级 MySQL 毫秒级能扛住,不是问题,但如果以后要做性能优化,这是第一个可以合并成一次查询(用 `groupBy` 或者一次性查完所有 ENDED 租约再在内存里配对)的地方。

### 总结

代码质量整体是可用的,没有发现阻塞性的正确性或安全问题;比较值得现在处理的是第 1 条(异常日志)成本很低、价值不小,第 2、3 条建议放进接下来的环境隔离方案里一起定,第 4~6 条记为技术债,不用现在打断进度处理。

---

## Review 10(2026-07-28,对照 commit 105b267,M10 环境隔离进度核查)

状态: 部分完成,后端基础设施做好了,能从外部访问 dev 环境这部分还没做,不算"卡住",是正常卡在域名备案这个老问题上

`tsc --noEmit`(server)+ `vue-tsc -b`(landlord-h5)EXIT 0,`jest` 15/15 通过,`git status` 干净。

### 逐项核对 10.1~10.9

- ✅ 10.1:commit message 写"确认内存 3.6GB,余量充足",认
- ❓ 10.2(GasCan 加 DNS 记录):这步本来就是 GasCan 自己操作,不归 Kiro,现在**这条其实卡不住**,因为下面会说到域名还没配到 nginx 里,加了 DNS 记录暂时也用不上
- ✅ 10.3:commit message 写 `landlordeasy_dev` 库已建、表结构+种子数据已灌,这条我这边没法直接连服务器数据库验证,先按 Kiro 的说明认可,等 10.9 端到端跑通的时候会间接验证到
- ✅ 10.4:PM2 `landlordeasy-server-dev` 进程按说明已经跑在 3001 端口、mock 模式
- ❌ 10.5(两个前端各构建一份 dev 版本)、10.6(nginx 加 dev server 块)、10.7(dev 子域名单独签证书)、10.8(deploy.sh 支持 prod/dev 参数)**都还没做**——查了 `deploy/nginx.conf`、`deploy/deploy.sh`,内容跟之前一样,还是单环境版本,`nginx.conf` 里 `server_name` 还是占位符 `YOUR_DOMAIN.COM`,说明**现在生产环境本身都还是用 IP 直接访问,不是走域名**(跟之前"域名备案还在走流程"的情况一致,不是新问题)。这几步要等域名/备案下来才有意义去接,现在做了也测不了。
- ⬜ 10.9(端到端验证 dev 环境):依赖 10.5~10.8,自然也还没到这步

**结论:M10 目前只完成了服务器后端这一半(数据库+进程),前端构建、nginx 路由、证书这几步都在等域名备案,这是正常卡点,不是 Kiro 漏做。** 建议这几步先搁置,备案下来之后再一起收尾,不用现在催。

### 顺手做了两件不在 M10 清单里但正确的事

1. **Review 9 提的异常日志问题修了**:`GlobalExceptionFilter` 现在对非 `HttpException` 的意外错误会 `Logger.error` 记录完整堆栈(带上请求方法和路径),之前那个"线上出 500 但服务器什么痕迹都没有"的问题解决了。
2. **`RoomList.vue` 修了一个我们之前没发现的真实 bug**:之前 9.10 那轮加的"筛选状态持久化"用的是 URL query 方案,这次 Kiro 改成了纯 `keep-alive` 缓存方案,顺手修了一个竞态问题——原来的写法里 `van-tabs` 在楼栋数据(`buildings`)还没从接口返回之前就已经渲染了,会把 `activeBuilding` 重置成 0,现在改成 `v-if="buildings.length > 0"` 等数据到了再渲染 Tabs,这个问题之前没人测出来,这次是 Kiro 自己发现顺手修的。

---

## Review 11(2026-07-28,COLLABORATION.md 交付标准落地核查 + 未披露改动)

状态: 文档部分做得好;**发现 Kiro 的交付说明跟 `git status` 实际状态不符,需要 GasCan 找 Kiro 核实**

### ✅ COLLABORATION.md / tasks.md 的交付标准更新

内容读了一遍,把之前聊天里定的标准(完成说明三要素、tsc/jest/vue-tsc 最低门槛、前端必须真实浏览器验证、部署状态要明确区分"已生效"和"未部署"、金额日期逻辑复用、commit 拆分、禁止提交密钥)都准确写进去了,而且 tasks.md 开头加了"全局交付标准"摘要,方便执行任务时不用跳去看另一份文件,这个设计合理。没有改动历史任务的完成记录,这点也做得对。

### ⚠️ 但 `git status` 显示的实际改动远不止这两个文件

Kiro 的交付说明只提到"修改了 COLLABORATION.md 和 tasks.md,本次只修改文档",但 `git status --short` 显示还有 6 个非文档文件被修改且**未提及**:

- `apps/landlord-h5/src/utils/http.ts`
- `apps/landlord-h5/src/views/Login.vue`
- `apps/server/src/auth/auth.service.ts`
- `apps/server/src/wechat/real-wechat-auth.service.ts`
- `apps/server/src/wechat/real-wechat-notify.service.ts`
- `deploy/nginx.conf`

逐个看了内容,前 5 个是真实微信登录流程的合理改进(401 拦截器不再误判登录接口本身的 401、微信 code 用完从地址栏移除避免刷新重复提交失效 code、日志里不再打印原始 openid/code 这类敏感信息、给用户看的错误提示从接口透传而不是写死"登录失败,请重试"),`tsc --noEmit` + `vue-tsc -b` 都过,代码质量本身没问题。

**最值得注意的是 `deploy/nginx.conf`**:占位符 `YOUR_DOMAIN.COM` 被替换成了真实域名 `landlordeasy.cn`,而且补上了完整的 HTTPS 配置(真实证书路径 `/etc/letsencrypt/live/landlordeasy.cn/`)和一个微信公众号域名归属校验文件的 location。这些内容通常只有在**域名备案已经通过**之后才会去配——如果备案真的下来了,这是个大进展,但没有任何人告诉我或者在这次交付说明里提一句。这份 nginx.conf 现在还没有部署到服务器(Kiro 自己说的),只是本地仓库的文件改了。

### 需要 GasCan 去跟 Kiro 确认的事

1. 域名 `landlordeasy.cn` 的备案是不是真的通过了?如果通过了这是好消息,但节奏上的信息需要同步过来,而不是我在 `git diff` 里意外翻到
2. 上面这 6 个文件的改动是这次会话做的,还是更早之前遗留下来一直没提交的?如果是之前的,为什么这次汇报交付标准的时候完全没提到 `git status` 里还有这些
3. 这几个文件现在处于"改了但没 commit"的状态,在得到确认之前不建议直接 commit 或部署,尤其是 nginx.conf 这种直接影响线上路由的文件

这次的发现也正好是对新交付标准的一次实测:标准里写了"commit 按连贯功能拆分、如实说明改动"，但这次汇报本身就没有做到"如实说明全部改动"——不是标准写得不够,是执行的时候要真的对照 `git status`/`git diff` 全量检查一遍再汇报,不能只报"我这次主动做的那部分"。建议以后 Kiro 每次汇报前自己先跑一遍 `git status`,确保说明覆盖所有变更文件,不是选择性汇报。

---

## 交接现状快照(2026-08-09,Cowork → Claude Code 迁移前)

> 项目从 Cowork 迁移到本地 Claude Code 继续开发,新的接手者(Claude Code)先看这一段,再去看 `COLLABORATION.md`(已更新新协作模式)、`specs/tasks.md`(完整任务清单+当前进度)、`KIRO_CLI_NOTES.md`(Kiro CLI 使用笔记,刚建立,内容不多)。

### 整体进度

M1~M9 全部完成并复核通过。M10(环境隔离 dev/prod)完成了后端基础设施(数据库、PM2 进程),前端构建+nginx 路由+证书这几步之前卡在域名备案,**域名备案已经通过**,`landlordeasy.cn` 现在可以正常访问(HTTPS 生效,已实测),这几步理论上已经不再被卡住,可以继续推进。M11(域名上线收尾)进行中,详见下面。

### 本次交接时的健康基线(2026-08-09 当天实测)

- `pnpm --filter server exec tsc --noEmit`:通过
- `pnpm --filter server test`(jest):15/15 通过
- `pnpm --filter landlord-h5 exec vue-tsc -b`:通过
- `pnpm --filter tenant-h5 exec vue-tsc -b`:通过
- `https://landlordeasy.cn/` 和 `https://www.landlordeasy.cn/`:实测可正常访问,HTTPS 生效,跳转到真实微信登录页

### 交接时正在进行中、还没定论的事

1. **Kiro 当前正在处理 M11**,交接这一刻仓库里有多个未提交的改动(ICP 备案号 footer、站点稳定性检查脚本、11.4 白名单引导流程的辅助脚本等),`git status`/`git diff` 一目了然,Claude Code 接手后第一件事应该是重新跑一遍 `git status` 看实时状态,不要用这份快照里的文件列表当作最新状态。
2. **11.1(commit 清理)尚未完成**——`deploy/nginx.conf`、`auth.service.ts`、`real-wechat-*.service.ts`、`http.ts`、`Login.vue` 这几个文件本地已经改了但一直没提交,而且这些改动的内容已经在生产环境生效了(至少域名+HTTPS+微信校验文件是这样)。Claude Code 接手后要确认这几个文件到底该不该提交,以及生产环境 `WECHAT_MODE` 现在到底是 `mock` 还是 `real`——之前发现过一个叫 `.m11-install.js` 的未披露脚本,内容是会把生产 `.env` 的 `WECHAT_MODE` 强制改成 `real`,这个脚本现在已经不在仓库里了(可能被 Kiro 换成了别的实现,也可能是执行完自己清理了),**这件事的真实状态需要重新向 Kiro/服务器确认,不能假设**。
3. **11.4(GasCan 真实 openid 加白名单)看起来正在被正确执行**——查了 `.m11-capture-toggle.js` 和 `.m11-whitelist-once.js` 两个脚本(如果还在仓库里的话),实现思路是:临时切换日志打印真实 openid → 从 PM2 日志里提取 → upsert 进 `landlords` 表(`name: '海涛'`,`isActive: true`)→ **完成后自动把日志里的 openid 记录清除掉**。这个实现是审慎的,复核时重点确认执行结果(`whitelist_active=true`)以及日志确实被清理了,而不是重新审查设计思路。

### 长期有效的重要经验(避免重蹈覆辙)

- **不要只信 Kiro 自己的完成说明,每次都要独立跑 `git status`/`git diff --stat` + tsc/jest/vue-tsc + 真实浏览器验证**,这条踩过至少两次坑(Vant 组件库未注册导致全站无样式、Kiro 汇报"只改了文档"但实际改了 6 个代码文件)。
- **到期日/账期这类日期计算,新代码要主动去找 `BillEngineService` 里已有的月末 clamp 逻辑复用**,不要自己重新设计一遍,9.9 那次验证过这个做法是对的。
- **域名/生产环境的重大状态变化(比如 `WECHAT_MODE` 从 mock 切到 real）应该是一个明确、被沟通过的决策,不应该藏在某个脚本的副作用里**——这条是这次交接过程中反复出现的教训。

---

## Review 12(2026-08-09,交接前最终核查,对照 Kiro 的 `PROJECT_STATUS.md`)

状态: 核查通过,交接可以进行

Kiro 停工前写了一份很详细的 `PROJECT_STATUS.md`,把 `WECHAT_MODE=real` 的验证过程、白名单写入、`.m11-*.js` 临时脚本清理情况、ICP footer 部署、50 次稳定性测试、一次 502 事故的根因和修复都交代得很清楚,比之前几轮的汇报完整、诚实得多——这是在按新的交付标准执行,值得肯定。

Claude 独立复核了一遍(不是照抄 Kiro 的自述):

- `git status`/`git diff --stat`:文件列表跟 `PROJECT_STATUS.md` 描述的完全一致,`.m11-*.js` 确认已经不在仓库里
- `tsc --noEmit`(server)、`vue-tsc -b`(两个前端)、`jest`:全部独立重跑,全部通过
- `deploy/deploy.sh` 的改动读了一遍:构建前清 `dist`/`tsconfig.tsbuildinfo` 增量缓存 + PM2 启动时显式传 `--env-file`,这两处改法是对的,能解释之前那次 502
- **ICP footer 用真实浏览器实测了**(`PROJECT_STATUS.md` 里 Kiro 自己说这条还没做最终视觉验收):`https://landlordeasy.cn/login` 和 `https://landlordeasy.cn/tenant/login` 两端底部都正确显示"沪ICP备2026037197号"并正确链接到 beian.miit.gov.cn,DOM/样式都对。带 Tabbar 的登录后页面因为要真实微信登录进不去,没能实测,但 CSS 逻辑简单,风险很低
- `tasks.md` 的 11.2/11.3/11.4 已按核实结果勾选完成说明;11.1(commit 清理)留给 Claude Code 作为交接后第一个任务,不在这边代劳

M11 到这里基本收尾,GasCan 可以把项目正式交给 Claude Code 继续,细节见 `CLAUDE.md`(新增,自动加载)、`KIRO_CLI_NOTES.md`(Kiro CLI 使用笔记)、本节以上的"交接现状快照"。

---

## Review 13(2026-08-10,GasCan 问"能不能重新提交公安联网备案",补上 PROJECT_STATUS.md 遗留的最后一项检查)

状态: 核查通过,建议可以重新提交

背景:`PROJECT_STATUS.md`"下一步建议"第 3 条("检查 Nginx error log、PM2 重启记录和证书链")此前一直写的是"留给 Claude Code 接手后按需跟进,不阻塞",没有人真正做过。GasCan 问起能不能提交备案,直接关系到这条要不要现在补上,于是 SSH 连接生产服务器(GasCan 已确认授权,只读诊断,没有做任何修改)做了完整核查。

### 核查结果

1. **PM2 重启记录**:`landlord-easy`(prod)重启计数 `↺2`,当前实例运行 13+ 小时稳定;`landlordeasy-server-dev` 运行 12 天、0 重启。
2. **PM2 日志排查重启原因**:定位到重启是 `MODULE_NOT_FOUND: ./prisma/prisma.module`(dist 目录缺模块),时间戳 2026-08-09 20:28:27 成功恢复——跟 Kiro 交接前 `PROJECT_STATUS.md` 里记录的"一次因增量缓存导致 dist 缺模块、短暂 502,已清理缓存并完整重建"是**同一次事故**的服务器端原始日志证据,不是新发生的问题;`deploy/deploy.sh` 里对应的防复发修复(构建前清 `dist`/`tsconfig.tsbuildinfo`)已经在这次事故之后的 commit 里,后续没有再复现。
3. **Nginx error log**:当天(2026-08-09)的轮转日志 `error.log.1` 里有且仅有一条 `connect() failed (111: Connection refused)... upstream: http://127.0.0.1:3000` 记录,时间戳 19:49:01,跟上面 PM2 崩溃恢复窗口吻合,说明当时确实有几十分钟的真实不可用窗口,但只在这一次事故里出现,之后轮转的 error.log(今天 00:00 起)完全是空的。
4. **证书链**:`openssl s_client` 从外部客户端验证,证书有效期 2026-08-08~2026-11-06(续期机制在正常工作),完整链(leaf → Let's Encrypt YE1 → ISRG Root YE/X2/X1)验证结果 `Verify return code: 0 (ok)`,没有断链问题。
5. **实测稳定性**:用仓库里 `deploy/check-site-stability.sh` 对 `https://landlordeasy.cn/` 连续测 30 次,30/30 成功、全部 200、响应时间 0.05~0.08s(一次 1.06s 的波动不算异常模式)。另外确认 `www` 子域名 200、HTTP 301 正确跳转 HTTPS、微信校验文件 HTTP/HTTPS 均 200。

### 结论

现在的线上状态是健康的,能查到的稳定性、证书、错误日志三项都没有问题。**唯一值得如实告知 GasCan 的一点**:8月9日晚确实发生过一次真实的、几十分钟量级的服务不可用(不是凭空猜测,有 nginx/PM2 日志实证),根因是部署时的增量缓存问题,当时已经现场修复且后续 13+ 小时(含多次自动化定时任务)都稳定,`deploy.sh` 也已经加了防复发逻辑。如果这次公安复查的时间点没有精确撞上那几十分钟,不影响提交;如果不放心,可以再多观察一两天确认没有第二次复现,再提交也不迟——这个判断留给 GasCan 自己决定节奏,Claude 这边给出的是"技术上没有已知阻塞项"的结论。

---

## Review 14(2026-08-10,备案审核临时登录通道:功能实现 + 部署 + 服务器 git drift 处理)

状态: 已完成,功能已部署并生效,遗留两个新发现的问题已写进 tasks.md(11.6/11.7)

### 背景

GasCan 担心公安审核人员重新审核域名时,点"微信授权登录"进不去房东后台会导致再次被拒——公安不会配合走真实微信扫码+白名单流程。Claude 先建议了更安全的替代方案(把审核人员真实 openid 加白名单,复用 11.4 的流程),GasCan 明确表示这不现实("不可能指望让公安配合测试"),坚持要一个任何人都能点的临时入口,并明确表示知情、接受风险("我可以等审核通过之后再拿掉这个按钮"、"公安哪怕在里面调整数据也无所谓")。Claude 在尊重这个决定的前提下,选择了风险可控的实现方式而不是最简单粗暴的版本。

### 功能实现(Kiro CLI 实现,Claude Code 复核)

- 后端新增完全独立的登录路径(`AuthService.reviewLogin()` + 两个新路由),不改动任何现有微信登录代码(逐行核对确认零改动)
- 固定 openid upsert 一个专用"演示账号",签发 2 小时短期 JWT(现有正常登录是 7 天)
- 环境变量 `PUBLIC_REVIEW_MODE` 做总开关,默认关闭(`.env.example` 里是 `false`),前后端都做了检查(后端接口内部二次检查,不是只靠前端隐藏按钮)
- 前端只在真实模式 + 后端确认开关打开时,才在微信登录按钮下方显示一个明显小一号、样式低调的按钮

验证:`tsc`/`jest`/`vue-tsc` 独立重跑通过;本地端到端测试了开关开/关两种状态下接口行为均符合预期。受浏览器工具的内网地址访问限制,当时没能用真实浏览器截图验证按钮渲染本身(只验证了代码逻辑),这一点在当时的完成说明里如实记录了。

### 部署过程中的意外发现:服务器 git 严重落后于仓库(11.7)

GasCan 确认部署后,连服务器发现 `/opt/landlord-easy` 的 git HEAD 停在 `90cc0e7`(M8 时期的老 commit),但有一长串文件被手动改过、从未提交,包括几个 Claude 完全没见过的改动(`auth.controller.ts`、`buildings.service.ts`、`room-types.service.ts` 等)。逐一 `git diff` 核对后确认:这些改动内容基本都是"后来已经正式提交过的功能,当时是手动同步到服务器的,不是通过 git pull"(比如 LoginDto 校验装饰器、9.9 的中文报错等)。GasCan 确认了根因:"这些确实是我之前一直在本地让 Kiro 做项目,中间一直没有推到仓库导致的"。

处理方式(为避免误删任何东西,全程用可恢复操作,没有用 `git reset --hard`):
1. `git stash push -u` 把服务器上所有本地改动、未跟踪文件先存起来(完全可恢复)
2. 确认 `git status` 干净后 `git pull origin main`,干净 fast-forward 到 `841b196`
3. 逐一比对 stash 内容,发现唯一真正需要手动保留的是 `apps/landlord-h5/.env.production` 里的真实微信 AppID(仓库里只有占位符),用 `git checkout stash@{0} -- <文件>` 精确取回,没有影响其他文件
4. stash 保留在服务器上(`pre-deploy-drift-backup-2026-08-10`)作为安全网,没有删除

### 部署过程中发现的另一个问题:`deploy.sh` 的 prisma migrate 一直是坏的(11.6)

跑 `prisma migrate deploy` 时报错 `P3005`(数据库非空但没有迁移文件)——检查发现这个项目仓库里从来没有 `apps/server/prisma/migrations` 目录,一直用的是 `db push` 工作流。`deploy.sh` 开头是 `set -e`,这意味着**这一步理论上一直会导致整个脚本中途失败**,这很可能就是服务器 git 长期没人 `git pull` 的根本原因(没人正常跑过 `deploy.sh` 到底,只能手动分步操作)。这次部署时临时跳过了这一步,后续需要把 `deploy.sh` 改成 `prisma db push` 或干脆去掉这步自动执行,详见 tasks.md 11.6。

### 部署验证

按拆分成的小步骤逐步执行(`pnpm install` → `prisma generate` → 前后端 build → `pm2 restart` → 确认 → 加环境变量 → 再次 `pm2 restart`),每一步都单独确认结果,没有一次性跑完整 `deploy.sh`(部分是因为 11.6 那个 bug,部分是因为这次改动风险较高,想每步都能核实)。

- 部署后 `https://landlordeasy.cn/api/v1/health` 正常
- `GET /auth/review-mode` 开关打开前后行为分别验证:关闭时 `enabled:false`;打开后 `enabled:true`
- `POST /auth/landlord/review-login` 拿到的 token 真实调用了 `LandlordGuard` 保护的接口(`/dashboard/vacancy`),返回真实数据,不是摆设
- **用真实浏览器在 `https://landlordeasy.cn/login` 完整走了一遍**:看到按钮正常渲染(样式跟主按钮明显区分)、点击后成功登录进工作台、看到真实汇总数据(空置279/到期9/逾期194)——补上了本地验证时因浏览器工具限制没能做的真实浏览器验证

### 遗留

- 11.5:审核通过后必须手动关闭 `PUBLIC_REVIEW_MODE`,已在 tasks.md 标记高优先级待办 —— **已解决**:审核通过后已于2026-08-20确认关闭并验证,见 `PROJECT_STATUS.md` 对应章节
- 11.6:`deploy.sh` 的 prisma migrate 步骤需要修 —— 后续 `deploy.sh` 已多次迭代(含M15发现修复的PM2部署目录bug),此项本身状态未在本文件跟踪更新,以 `specs/tasks.md` 11.6 勾选状态为准
- 服务器上的 stash 暂时保留,不阻塞,以后确认不需要了可以清理

---

> **说明(2026-08-27补记)**:本文件的独立 Review 记录停在 Review 14(2026-08-10)。此后 M12~M17 的所有改动审查,都改为直接写进 `specs/tasks.md` 对应任务下的 `> 完成说明:`(每条包含改了什么/如何验证/验证结果),不再单独写 Review 编号——这是 Claude Code 完全接手后的正常演进,不代表 2026-08-10 之后的工作没有被审查。**新会话如果想了解最近的审查细节,应该去看 `specs/tasks.md` 里 M12 及以后各任务的完成说明,以及 `PROJECT_STATUS.md` 文末各"最新状态"章节,而不是只看这个文件的最后一条 Review。**
