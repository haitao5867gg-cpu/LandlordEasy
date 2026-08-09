# Kiro CLI 使用笔记

> 给 Claude Code 自己维护的经验记录。每次用 Kiro CLI headless 模式跑完任务,顺手把有用的经验补充进来,尤其是踩过的坑和有效的 prompt 写法。不要让下一次调用重新摸索一遍。

## 基本信息(2026-08-09 迁移时记录,以官方文档为准)

- 登录方式:设备码登录(`kiro-cli login`),不是 API key。GasCan 已经在本机登录过,正常情况下不需要重新登录。
- Headless 调用语法(注意:prompt 是位置参数,不是 `--prompt` flag):
  ```
  kiro-cli chat --no-interactive --trust-all-tools "任务描述文字"
  kiro-cli chat --no-interactive --trust-tools=read,grep "只读性质的任务"
  ```
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

(目前是迁移前的空白记录,后续使用中发现的问题往这里加,格式建议:日期 + 现象 + 原因 + 应对方法)

## 好用的 prompt 写法

(后续积累)
