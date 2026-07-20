# 项目状态总结(2026-07-20)

> 本文件供任何新会话的 Claude / Kiro 快速恢复上下文。仓库是唯一信息源。

## 项目是什么
LandlordEasy 房屋收租系统。嘉定公寓,4~5 栋自建楼约 300 间房(现有 Excel 覆盖 Q/R/S 三栋 130 间),整套出租,3 位房东(家人)共同管理。房东端手机 Web,租客端微信服务号 H5,先跑通「出租→账单→提醒→收款→对账」闭环。

## 协作方式
- 用户(GasCan)只与 Claude 讨论;Claude 维护 specs/ 与 review/;Kiro(Windows, Opus 4.6)按 specs/tasks.md 开发并推送;疑问走 questions.md。规则详见 COLLABORATION.md
- Claude 在 Cowork 中用仓库所有者的 fine-grained PAT 推拉(token 由用户每次会话提供,不入库);Kiro 走协作者邀请或另发 PAT
- Claude 沙盒只通 github.com HTTPS,SSH/Gitee/api.github.com 均不通

## 已定稿(specs/ 三件套,commit 6e0205b)
- requirements.md:需求 v1(含房型模板、房间历史档案、支出管理、租客访问规则、滞纳金默认=当期租金等)
- design.md:NestJS+Prisma+MySQL / Vue3+Vant monorepo;微信能力全部 mock 隔离,无凭证可完成 P1
- tasks.md:M1~M6 共 26 个任务,Kiro 从第一个未勾选任务顺序开发

## 关键业务决策记录
收款码+人工确认先行,微信支付商户号为阶段二;账期按各合同起租日独立滚动;押金按租约单谈;附加费含清洁费/停车费(含车牌);佣金记录在租约;支出管理对应现有「耗材」表,报表算净收益;数据只归档不删除+操作日志;历史 Excel 由 Claude 清洗成 CSV 导入(待办)

## 用户待办
1. 跟 Kiro 说开工(拉仓库、读 COLLABORATION.md)
2. 服务号注册认证(有公司资质,300元/年)
3. 腾讯云轻量服务器(上海,包年)+ 域名 + ICP 备案(2~4 周,尽早)
4. 补录租客姓名/手机号(其余基础数据从 Excel 导入)
5. 阶段二前:申请微信支付商户号
6. GitHub 上邀请 Kiro 的账号为仓库协作者

## 下一步(Claude)
- Kiro 完成 M1~M2 后做首次 review(写 review/review-notes.md)
- 用户提供完整楼栋 Excel 后,清洗生成 data/import/ 标准 CSV
