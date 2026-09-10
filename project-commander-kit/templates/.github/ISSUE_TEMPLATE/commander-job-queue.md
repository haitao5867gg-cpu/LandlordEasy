---
name: Commander job queue
about: Create the single Issue used as the Runner's job queue
title: "Commander job queue — do not close"
labels: []
---

This Issue is the control plane for the local Commander Runner.

**Rules**

- Only the **Commander** account posts jobs here. Jobs authored by the Executor
  account are ignored by construction.
- One comment = one fenced JSON object preceded by its schema marker, and
  nothing else. Surrounding prose makes the comment unparseable.
- Never edit a comment after posting. An edited comment invalidates its claim
  and produces a `REJECTED` terminal.
- Terminal records posted by the Executor are the authoritative state. A wake
  notice on a PR is only a hint and carries no authority.

See `PROTOCOLS.md` for the message schemas.

**Do not close this Issue.** `queue_issue` in the local config points at it.
