# Kiro CLI 使用笔记

> 给 Claude Code 自己维护的经验记录。每次用 Kiro CLI headless 模式跑完任务,顺手把有用的经验补充进来,尤其是踩过的坑和有效的 prompt 写法。不要让下一次调用重新摸索一遍。

## 基本信息(2026-08-09 迁移时记录,以官方文档为准)

- 登录方式:设备码登录(`kiro-cli login`),不是 API key。GasCan 已经在本机登录过,正常情况下不需要重新登录。
- Headless 调用语法(注意:prompt 是位置参数,不是 `--prompt` flag):
  ```
  kiro-cli chat --no-interactive --trust-all-tools "任务描述文字"
  kiro-cli chat --no-interactive --trust-tools=fs_read "只读性质的任务"
  ```
  **注意**:`--trust-tools` 后面接的是新版 capability 名字(`fs_read`/`fs_write`/`shell`/`web_fetch`/`web_search`/`mcp`/`subagent`/`skill`/`power`),**不是** `read`/`grep` 这种旧名字(官方文档 `/docs/permissions/` 页面本身也提到 `--trust-all-tools`/`--trust-tools` 是 legacy flag,细节要看 `/docs/cli/2x-reference`,但实测本机装的 2.16.2 版本 `kiro-cli chat --help` 里这两个 flag 仍然存在且正常工作,直接以 `--help` 输出为准,不要死磕文档)。只读试跑验证过 `--trust-tools=fs_read` 有效:能读文件、能用内置的 grep/搜索能力,但不会写文件,`git status` 确认真的没有改动。
- 交互模式:`kiro-cli`(不带 `--no-interactive`)进入 TUI,适合需要人工盯着的探索性任务,一般不用在自动化流程里
- 排障:`kiro-cli doctor` 检查环境;日志路径见官方文档(macOS: `$TMPDIR/kiro-log/kiro-chat.log`)
- 官方文档:
  - Headless 模式:https://kiro.dev/docs/cli/headless/
  - CLI 命令参考:https://kiro.dev/docs/reference/cli-commands/
  - 权限/信任模型:https://kiro.dev/docs/permissions/
  - Setup:https://kiro.dev/docs/cli/setup/

## 使用原则

- 常规编码任务(按 spec 写代码、修 bug):可以 `--trust-all-tools`,提高效率
- 涉及生产部署/服务器配置/数据库/密钥的任务:不要一刀切放行,逐步授权或先看 Plan 再执行
- 每次调用前先给它清楚的上下文:指向具体的 `specs/tasks.md` 任务编号,或者直接把任务描述贴进 prompt,不要只说"继续做下一个任务"这种模糊指令
- Kiro 跑完自己会写委托说明或者复述做了什么，**这些自述不能直接当作验收依据**,必须按 `COLLABORATION.md`「最低验证门槛」独立跑一遍检查

## Token 成本管理(重要)

Kiro 自己内部推理消耗的 token 算在 Kiro 自己的订阅额度上,跟 Claude Code 无关、也看不见。**Claude Code 真正要付出成本的,是 `kiro-cli` 命令打印到 stdout/stderr 的那部分文字**——这部分内容会作为 Bash 工具调用的结果,整段进入 Claude Code 自己的上下文。如果 Kiro 输出比较啰嗦(每一步工具调用都打印),不加控制地直接读入上下文会很快把 token 花在无意义的地方。

建议做法:
```bash
kiro-cli chat --no-interactive --trust-all-tools "任务描述" > /tmp/kiro-run-$(date +%s).log 2>&1
echo "exit code: $?"
```
把完整输出重定向到日志文件,不要让它直接刷进对话上下文。跑完之后**优先用 `git status`/`git diff --stat`/`git diff` 加上独立的 tsc/测试/浏览器验证去判断结果**,这些信息量小、也更可靠(不是 Kiro 自己说了算)。只有验证发现问题、需要排查原因时,才回头去翻那份日志文件的具体内容,不要每次都全文读一遍。

## 踩过的坑

- **2026-08-09,`.kiro/settings/lsp.json` 自动生成**:Kiro CLI 第一次在某个目录跑,会在那个目录下自动建一个 `.kiro/settings/lsp.json`(各语言 language server 的通用默认配置样板,内容不含任何项目相关信息或密钥),类似 Claude Code 的 `.claude/`。这个不该提交,已经加进项目根目录 `.gitignore` 的 IDE 分区。以后如果换到别的目录跑 Kiro CLI,留意一下是不是也需要补这条 gitignore。
- **CLI 版本 vs 文档描述可能对不上**:`kiro.dev/docs/permissions/` 页面主要讲的是新版 capability 权限模型(`fs_read`/`fs_write`/`shell` 等 YAML 规则),但实际装的 `kiro-cli chat --help` 里 `--trust-all-tools`/`--trust-tools=<TOOL_NAMES>` 这两个 flag 是实打实存在且正常工作的。**调用前建议先跑一遍 `kiro-cli chat --help` 核对真实支持的 flag,不要完全照官方文档抄,版本之间可能有出入。**

## 好用的 prompt 写法

- **精确圈定"能改哪些文件、不能碰什么",比笼统描述任务效果好很多**。实测(2026-08-09,10.8 任务):prompt 里明确写"只改 A、B 两个文件,不要碰 C/D/E,不要连接生产服务器,不要真的执行部署",Kiro 完整遵守了,`git status` 复核确认没有超出范围的改动。
- **遇到不确定的设计决策(比如"这一步要不要区分环境"),明确要求"想清楚讲讲你的理解,不确定就写进总结里让我来判断,不要自己猜测直接改",比放任它自由发挥或者不给任何指引都好**。实测 10.8 任务里让 Kiro 判断 `prisma migrate deploy` 要不要按 prod/dev 分流,它按要求没有擅自改动,并且在总结里准确指出了"当前实现下 dev 部署会误触发生产库迁移"这个隐患,原文写的分析是对的——之后我把这个具体问题单独开了第二轮任务修复,验证下来 Kiro 给的修复方案(用 Node 原生 `--env-file` 解析,而不是手写 shell 正则)也是稳妥的写法,避开了历史上 MySQL 密码含 `#` 被截断的坑(见 questions.md Q3)。
- **同一个任务分阶段拆成多轮独立的 headless 调用是可行的**,不需要用 `--resume`——只要每一轮 prompt 里把足够的背景信息(前一轮做了什么、这一轮具体要修什么)写清楚,Kiro 能正确衔接,不会因为"看不到上一轮对话"就乱猜上下文。
