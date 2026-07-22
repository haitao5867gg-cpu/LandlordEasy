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
