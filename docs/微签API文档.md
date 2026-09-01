# 微签 SAAS Web API 接口说明（上海复园电子科技有限公司，v1.0.0）

> 来源：GasCan 于 2026-09-01 提供的 `微签SAAS web api接口文档v1.0.0.doc`，用 macOS `textutil` 转文本后人工整理。存进仓库是为了避免会话压缩后丢失，原始 doc 不入库。技术支持邮箱 `support@forwave.com`，电话 021-65654240 转技术支持。

## 环境

- 测试环境 `apiUrl`：`http://forwave.picp.net:8888/openapi/v1/`
- 正式环境 `apiUrl`：`https://www.weiqian.com.cn:8887/openapi/v1/`
- 接入前需向复园商务人员获取 `AppId` + `AppSecret`（AppSecret 严禁泄露）
- PC 端后台"系统管理-应用管理"可查公司ID(`cId`)，"系统管理-签章管理"可查发起方印章ID(`sealId`)

## 鉴权（每次请求都要做）

请求头：`AppId` / `Timestamp`（毫秒级时间戳，15分钟内有效，防重放）/ `AuthMode`（固定值 `Signature`）/ `Sign`。业务参数放在 `Data` 里（JSON字符串，字节流类参数除外）。

签名算法：
1. 公共请求参数（不含Sign，不含文件流）按参数名 ASCII 升序排序
2. 拼接成 `Key=Value` 并用 `&` 连接
3. 用 `AppSecret` 对拼接串做 `HMAC-SHA256`，结果再 `Base64` 编码

请求方法一律 POST；`Content-Type` 用 `application/x-www-form-urlencoded`，涉及文件流的接口用 `multipart/form-data`。

公共响应格式：`{code, msg, data, timestamp}`，`code=10000` 表示成功。

## 接口调用流程（"互签"体系）

1. `eachSign/upload` 上传待签文件 → 拿到文件业务ID `bId`（文件本身，比如我方生成好的合同PDF）
2. （可选）`http://forwave.picp.net:8089/views/common/seal_position.html` 获取盖章位置坐标，用于第3步
3. `eachSign/create` 创建互签任务：
   - 单人签署 → 返回 `bId`（互签业务ID）+ `shortCode`（互签短链码）
   - 多人签署 → 返回 `shortCode` + `childShortUrl`（含多个 `bId`）
4. 发起人（我方/房东）通过 `eachSign/getSignPage` 签章；接收人（租客）直接打开 `http://forwave.picp.net:8888/q/{shortCode}`（测试环境域名，**正式环境这个签署页面链接的域名前缀文档没给，需要问技术人员**）完成签章，不需要额外调接口
5. 接收人签完根据配置跳转指定页面
6. `eachSign/download` 下载已签署文件；`eachSign/deleteFile` 删除文件

## 关键接口字段

### `eachSign/create`（创建互签任务）核心参数
- `launchAccount`/`cId`：发起者账号/公司ID
- `fBIds`：发起者文件业务ID列表（第1步上传拿到的 `bId`，附带 `fileName`）
- `rType`：接收者类型（1个人/2公司）
- `authType`：接收者授权类型（**1手机验证码 / 2实名认证** —— 法律效力、需要的字段不同，需要跟GasCan/微签确认选哪种）
- `isSendSmsToReceiver`：互签链接是否由微签直接短信发给接收人（默认不发）
- `expiresTime`：互签过期时间（13位时间戳）
- `finishSignJumpPage` + `parm`：接收者签完后跳转的页面+携带参数（可以用来跳回tenant-h5的"签署成功"页）
- `receiverDTOS[]`：接收者信息，`account`（接收者账号，**大概率是手机号，需要确认**）/`rName`（姓名）/`idCard`（身份证号，可空）/`rCName`（公司名，可空）
- `positionDTOS[]`：接收人指定盖章位置坐标（x/y/pageNum，0-1000区间）
- `launcherSignRule[]`：**发起方（我方/房东）的自动盖章规则**——`autosealType`（1单页/2多页/3首次关键字盖章）+ `sealId`（预先在PC后台配置好的印章ID）+ 坐标/页数。**这个字段意味着发起方可以配置成全自动盖章，不需要人工操作**，正好匹配"只要求租客单方实名签署、房东名义写死"的设计意图——但需要向技术人员确认：配置好`launcherSignRule`后，创建任务时是否就自动完成发起方盖章，还是仍需调用`eachSign/getSignPage`触发。

### 其他接口
- `eachSign/upload`：`file`（二进制流）→ 返回文件业务ID
- `eachSign/getSignPage`：`signType`(basicFileType/eachSignType) + `fBId`或`bBId` + `account`/`password` → 返回签章页面
- `eachSign/download` / `eachSign/deleteFile`：都只需要 `bId`

## 错误码

`10000`成功；`10001`系统异常；`10002`签名错误；`10003`请求频繁；`10004`参数超长；`10005`重复请求；`10006`参数非法；`10007`参数为空；`10008`请求超时(签名15分钟)；`10100`AppId不合法；`10101`时间戳不合法；`10102`鉴权模式不合法；`13001`不支持的文件类型；`13002`文件不存在。用户/部门管理相关错误码（`11xxx`/`12xxx`）跟本项目暂时无关，不展开。

## 这次设计还需要跟微签技术人员确认的问题（GasCan转达用）

1. **回调/webhook机制**：整份文档完全没提"签署完成后微签主动通知第三方系统"这件事。请问是否支持webhook回调？如果支持，回调URL怎么配置（后台填还是接口传参）、回调payload格式、怎么验签？如果不支持，有没有专门的"查询签署状态"接口（文档里没看到，只有下载文件接口）？—— **这是最关键的缺口，直接决定19.5/19.6怎么实现，其他问题都可以先按合理假设做、日后微调，这条不确认清楚没法往下走。**
2. `launcherSignRule`配置好自动盖章规则后，创建互签任务时发起方（我方/房东）这一侧是否就自动完成盖章，不需要额外调用`eachSign/getSignPage`？我们希望发起方全程不需要人工操作。
3. `receiverDTOS.account`具体填什么格式？是手机号吗？跟`isSendSmsToReceiver`是配套的吗？
4. `authType`两种方式（手机验证码/实名认证）在法律效力上有什么区别？租房合同这种场景推荐哪种？
5. 正式环境接收人签署页面的域名前缀是什么（测试环境是`http://forwave.picp.net:8888/q/{shortCode}`，正式环境文档没给）？
6. 我方PDF模板每次生成的文本长度不完全一致（姓名、地址等字段长度不同），`positionDTOS`固定坐标盖章会不会错位？接收方是否也支持"关键字定位盖章"（发起方的`autosealType`里有"首次关键字盖章"这个选项，接收方有没有类似能力）？
7. 我方生成的合同PDF文件规格（页面大小、DPI等）有没有要求？
