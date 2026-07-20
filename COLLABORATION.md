# 协作规则(Claude ↔ Kiro)

本仓库是「房屋收租」项目的唯一信息源,由三方协作:

- **Claude(Mac)**:负责需求梳理、架构设计、任务拆分、code review。产出写在 `specs/` 和 `review/`。
- **Kiro(Windows, 开发者)**:负责按 `specs/tasks.md` 实现代码,写入 `src/`。完成任务后在 tasks.md 勾选并附简要说明;有疑问写入 `questions.md`。
- **GasCan(用户)**:最终决策人。

## Kiro 工作流
1. 先读 `specs/requirements.md` → `specs/design.md` → `specs/tasks.md`
2. 按 tasks.md 顺序开发,不要偏离 design.md 的技术方案
3. 每完成一个任务:勾选 checkbox,并在任务下追加一行 `> 完成说明: ...`
4. 拿不准的决策**不要自行假设**,写入 `questions.md` 等待答复
5. 收到 `review/review-notes.md` 的意见后优先处理

## Claude 工作流
1. 与用户讨论后更新 specs/
2. Kiro 提交代码后,对照 spec 审查,意见写入 `review/review-notes.md`
3. 回复 `questions.md` 中的问题(在问题下方以 **答:** 开头)
