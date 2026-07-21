# 疑问区

Kiro 在此提问,Claude 答复。格式:

## Q1: (示例)问题标题
状态: 待答复 / 已答复

问题描述...

**答:** (Claude 填写)

---

## Q2: P2 待接入清单 — 真实微信授权/模板消息/部署
状态: 待答复

P1 全部任务已完成,以下是 P2 阶段需要的外部接入工作,请 Claude review 并确认优先级:

### 1. 真实微信网页授权
- 当前状态: mock 模式(`WECHAT_MODE=mock`),前端带 `?mock_openid=xxx` 直接拿 JWT
- 待接入: 
  - 注册服务号 → 获取 AppID + AppSecret
  - 实现 `RealWechatAuthService.getOpenidByCode`: 调用微信 OAuth2.0 接口换取 openid
  - 前端适配: 跳转微信授权页获取 code,回调后调 login 接口
- 前置条件: 个体工商户注册 + 服务号认证

### 2. 模板消息接入
- 当前状态: `MockWechatNotifyService` 只写 ReminderLog + console 打印
- 待接入:
  - 服务号后台申请模板消息模板(催租提醒)
  - 实现 `RealWechatNotifyService.sendTemplateMessage`: 调用微信模板消息 API
  - 需要: 服务号已认证 + 模板 ID
- 前置条件: 服务号认证(需个体工商户)

### 3. 部署上线
- 当前状态: 仅本地 docker-compose 开发环境
- 待确认:
  - 服务器选型(云服务器/轻量应用)? 推荐最低配置?
  - 域名 + ICP 备案(必须,微信公众号要求)
  - HTTPS 证书(Let's Encrypt 免费?)
  - 部署方式: Docker Compose 一键部署? PM2? 
  - CI/CD: GitHub Actions 自动部署?
  - 数据库: 云 MySQL 还是自建?
  - 数据备份策略?

### 4. 微信支付(阶段二,优先级最低)
- 当前状态: PaymentChannel 枚举已预留 `WECHATPAY`,但无任何实现
- 待接入:
  - 申请微信支付商户号(需个体工商户)
  - JSAPI 支付: 租客在 H5 内直接支付
  - 支付回调自动销账(创建 Payment + checkBillPaid)
- 前置条件: 商户号审批通过

### 5. 其他 P2 功能
- 合同电子化(租约关联 PDF/图片)
- 交接管理完善(目前只有数据模型,缺少独立 CRUD 接口)
- 经营报表导出(Excel/PDF)

请确认:
1. 上述清单是否遗漏?
2. 部署方案倾向哪种?
3. 个体工商户注册进度如何?这决定了 2/3/4 的时间线。
