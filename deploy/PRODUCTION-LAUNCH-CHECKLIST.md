# 生产上线清单(M22+安全修复链,2026-09-21启用)

> 上线唯一触发条件:**GasCan 明确说"推"**。在此之前生产环境(/opt/landlord-easy,main分支c3b5b2d)一行不动。
> 执行人:ZCode。每一项执行后都要留下证据,不能只看"命令跑完了"。

## A. 前置条件(缺一项就不能开始)

- [ ] GasCan 在 dev 完成真人签署验证(微签实名+签字→回调token自动确认路径)并认可体验
- [ ] GasCan 购买微签生产服务,提供生产凭证:WEIQIAN_APP_ID / WEIQIAN_APP_SECRET / WEIQIAN_COMPANY_ID / WEIQIAN_SEAL_ID / WEIQIAN_API_BASE_URL(正式环境 https://www.weiqian.com.cn:8887/openapi/v1/) / WEIQIAN_SIGN_BASE_URL(要问微签正式环境接收人签署页域名前缀,测试环境是 forwave.picp.net:8888)
- [ ] 生产数据库最新备份已打(deploy前跑 /opt/backups/backup-mysql.sh,校验gzip完整性)

## B. GasCan 本人在微信侧要做的事(代码够不到的,容易忘)

- [ ] 公众号后台"消息推送"服务器配置的 URL 从 dev 地址改成 `https://landlordeasy.cn/api/v1/wechat/event`(Token/EncodingAESKey/明文模式不变),改完重新保存验证
- [ ] 公众号自定义菜单"房东端/租客端"两个按钮 URL 从 dev.landlordeasy.cn 改成 landlordeasy.cn(9/20记录:当前指向dev)
- [ ] 微签账号完成企业认证(否则合同PDF带"未企业认证仅供测试"水印)

## C. 代码与数据(我来)

1. 合并 `claude/landlord-easy-sec-001-verify-469878`(HEAD含M22全部)到 main——合并前在 main worktree 重跑全量:tsc/jest 263例/两端vue-tsc
2. 生产服务器 /opt/landlord-easy:git pull(不通就走 git bundle+scp 老办法)
3. `prisma db push`(新增:co_occupants表、contract_settings新字段、ContractSigningTask.signCallbackToken;全部为无损新增,历史行NULL安全)
4. 生产 .env 追加(rel-002 fail-fast:缺了直接拒绝启动,这是故意的):
   - WEIQIAN_MODE=real + 上面6个WEIQIAN变量 + SERVER_PUBLIC_BASE_URL=https://landlordeasy.cn/api/v1
   - WECHAT_TOKEN(与公众号后台"消息推送"配置一致,事件webhook签名校验依赖它)
   - PDF_CHROME_EXECUTABLE_PATH(见第5步)
5. **生产服务器装PDF生成依赖**(M19.6记录,dev装过生产从未装过,不装电子签必崩):
   - `@puppeteer/browsers` 下载 Chrome for Testing 到 /home/ubuntu/chrome-for-testing/(参考 dev 的装法)+ 12个运行时库(libatk/libcairo/libpango/libgbm等)
   - `sudo apt-get install fonts-noto-cjk`(中文字体,不装合同PDF标题乱码)
   - .env.example 注释里有完整步骤
6. deploy.sh prod(注意:先清 dist+tsbuildinfo 两个缓存——今晚踩过只清一个导致缺模块的坑)
7. 验证:服务器git log -1哈希=本地、健康检查200、PM2 unstable_restarts=0、**真实浏览器**走一遍登录

## D. 上线后冒烟(我来,全部真实操作)

- [ ] 房东真实登录→工作台数据正常(与上线前生产数据对得上)
- [ ] 新建测试房源→新签租约(强制先交接生效)→生成电子签约→**生产环境第一份真实微签合同**→签署二维码可展示
- [ ] GasCan 本人真实签署一份(消耗1份生产额度)→回调token自动确认→PDF可下载、红章落位正确
- [ ] 测试数据清理,房间状态复位
- [ ] 公众号真实关注事件→FOLLOWED流转(webhook现在指向生产了)
- [ ] 微信支付现有功能冒烟(¥0.01不再需要,看账单页正常即可)

## E. 已知非阻塞事项(上线后处理,别忘)

- dev 环境还停在 WECHAT_MODE=real(2026-09-20晚为GasCan测试切的),后续按需切换
- 历史明文PII数据迁移(744bc5e的遗留,GasCan拍板后做)
- Playwright e2e 套件未本地实跑(M20遗留缺口)
