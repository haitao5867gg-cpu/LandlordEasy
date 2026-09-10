# Protocols

Every message is **one fenced JSON object preceded by a schema marker, and
nothing else**. Surrounding prose makes the comment unparseable and is rejected.

## `COMMANDER_JOB_V1` — AI provider job

Posted by the **Commander** account to the queue Issue.

````
COMMANDER_JOB_V1
```json
{
  "schema": "COMMANDER_JOB_V1",
  "job_id": "3abae900-31a4-4f29-908f-dc3b37528d6f",
  "repository": "owner/name",
  "queue_issue": 17,
  "target_sha": "2ba3f3d4ea4cd22c33becca47b0fe460bbad9107",
  "worktree_id": "job-3abae900-31a4-4f29-908f-dc3b37528d6f",
  "runner_id": "project-macmini-01",
  "worker": "claude",
  "model": "claude-sonnet-5",
  "profile": "repo_read",
  "assigned": "REL-001",
  "prompt": "Audit the diff; report findings.",
  "timeout_seconds": 900,
  "output_limit_bytes": 262144,
  "expected_evidence": "findings; file:line references",
  "quality_gate": "none"
}
```
````

| Field | Rule |
|---|---|
| `job_id` | UUID, globally exactly-once |
| `worktree_id` | must equal `"job-" + job_id` — derived, never free-form |
| `target_sha` | exact lowercase 40-hex; a ref name is refused |
| `worker` / `model` | from the allowlist, enabled, and capable of the profile |
| `profile` | `repo_read` \| `repo_write_test` \| `repo_delivery` |
| `quality_gate` | `none` for `repo_read`; a real enabled gate otherwise |
| `prompt` | ≤ 12 000 chars, no control characters. **Ordinary punctuation — `;` `\|` `&&` backticks — is allowed and is not a rejection reason.** |
| `human_approval_ref` | required for `repo_delivery`, forbidden otherwise |

## `COMMANDER_OPERATION_V1` — controlled local operation

````
COMMANDER_OPERATION_V1
```json
{
  "schema": "COMMANDER_OPERATION_V1",
  "job_id": "…uuid…",
  "repository": "owner/name",
  "queue_issue": 17,
  "target_sha": "…40 hex…",
  "worktree_id": "job-…uuid…",
  "runner_id": "project-macmini-01",
  "operation_id": "ops001_mysql_probe",
  "timeout_seconds": 120,
  "output_limit_bytes": 16384,
  "expected_evidence": "rows=0; tables=22",
  "human_approval_ref": "issue-21 owner approval"
}
```
````

There is deliberately **no** command, argv, path, environment, URL, worker,
model, or prompt field. The job picks an ID; the owner's config supplies the
argv. `target_sha` must be exact-allowlisted or the current head of an
owner-approved branch.

## Provider response contract

The provider must return exactly one JSON object:

```json
{"status": "ok", "summary": "…", "evidence": ["…"], "usage": "optional",
 "nonce": "<the attempt nonce stated in the prompt, copied verbatim>",
 "verdict": { "…optional COMMANDER_VERDICT_V1, see below…" }}
```

| Field | Bound |
|---|---|
| `status` | `ok` or `blocked` |
| `summary` | non-empty; **length never rejects**: > 4 000 chars is excerpted for the Issue and kept whole in the artifact; > 200 000 is refused as pathological |
| `evidence` | list of ≤ 200 non-empty strings, each ≤ 4 000 chars |
| `usage` | optional, ≤ 200 chars |
| `nonce` | **required on the live path**; any contract-shaped object without this attempt's nonce is ignored |
| `verdict` | optional; if present must be a valid `COMMANDER_VERDICT_V1` or the whole answer is invalid |

The parser is tolerant about **packaging** and strict about **content**: the
object may be bare, in a ```` ```json ```` fence, embedded in prose, or wrapped
in a Claude `--output-format json` envelope (which is unwrapped, and its
`total_cost_usd` recorded as usage).

If parsing fails, the run is **not lost**. Raw bytes were persisted before
parsing; recover with:

```bash
python3 commander_runner.py --config <config> renormalize --job <uuid>
```

which re-parses locally, writes the artifact for the recovered attempt, and
reports `provider_calls: 0`. Records that predate nonces need the explicit
`--allow-legacy-without-nonce` switch and report `nonce_verified: false`.

## `COMMANDER_VERDICT_V1` — structured review outcome (consumed by plans)

```json
{"verdict": "accept|revise|reject|blocked", "p0": 0, "p1": 2,
 "code_changed": true, "exact_sha_verified": "<40 hex or null>",
 "recommended_transition": "<plan step id or stop>"}
```

Parsed when present, refused when malformed, copied into the terminal record.
A plan step that completes with a verdict produces the outcome token
`verdict.<accept|revise|reject|blocked>`, which the plan's edge table may key
on. The Runner never derives an action from natural language: a verdict is
either this shape or it does not exist.

## `COMMANDER_PLAN_V1` — deterministic follow-up chain (PR B)

````
COMMANDER_PLAN_V1
```json
{
  "schema": "COMMANDER_PLAN_V1",
  "plan_id": "<uuid>",
  "repository": "owner/repo", "queue_issue": 17, "runner_id": "<runner_id>",
  "authorization_ref": "<owner approval record>",
  "max_steps": 4,
  "steps": [
    {"id": "s1", "kind": "operation", "operation_id": "rel001_mysql_suite",
     "target": {"branch": "fix/rel001-cross-type-approval"},
     "timeout_seconds": 900, "output_limit_bytes": 65536,
     "expected_evidence": "suite summary", "human_approval_ref": "<ref>",
     "on": {"ok": "s2", "*": "stop"}},
    {"id": "s2", "kind": "job", "worker": "claude", "model": "claude-sonnet-5",
     "profile": "repo_read", "quality_gate": "none",
     "target": {"from_step": "s1"},
     "prompt": "Review the diff at {resolved_sha} … return COMMANDER_VERDICT_V1",
     "timeout_seconds": 1200, "output_limit_bytes": 262144,
     "expected_evidence": "verdict",
     "on": {"verdict.accept": "stop", "*": "stop"}}
  ]
}
```
````

Rules, all enforced at parse time (a violation is a `REJECTED` record):

- `max_steps` ≤ 10; step ids are unique `[a-z][a-z0-9_]{0,15}`.
- Each step is a complete `COMMANDER_JOB_V1` / `COMMANDER_OPERATION_V1` minus
  the identity fields. The Runner derives `job_id = uuid5(plan_id, step_id)`,
  `worktree_id`, `assigned = plan:<plan_id>:<step_id>`, and validates the
  result with exactly the posted-job validation. Every boundary (exact SHA,
  profile, gate, nonce, allowlists) is therefore inherited, not re-implemented.
- `target` is exactly one of `{"sha": <40 hex>}`, `{"branch": <name>}`
  (resolved to the origin head at execution time and pinned), or
  `{"from_step": <earlier id>}` (the SHA that step actually ran at). The
  literal `{resolved_sha}` in a job prompt is replaced by the pinned SHA.
- `on` keys are limited to `ok`, the eight stop classes, `verdict.<x>` and
  `*`; `*` is mandatory. Values are a **later** step id or `stop`. Edges
  cannot point backwards, so a plan cannot loop and runs each step at most once.
- `SAFETY_STOP` / `HUMAN_APPROVAL_REQUIRED` (policy `FAIL_CLOSED`) ignore the
  edge table: the plan ends with `action_required=true` and a
  `USER_ACTION_REQUIRED_V1` record.
- A plan is not "ambiguous" after a crash: it resumes from its current step.
  Only the step that was mid-flight is closed as `FAILED`
  (`UNCLASSIFIED_FAILURE`), and the edge table decides what follows.

Each step posts its own terminal record; the plan posts one
`COMMANDER_PLAN_RUNNER_V1 <STATE>` record (`job=<plan_id>`) that embeds a
`USER_UPDATE_V1` block and is the single owner notification for the run:

```
COMMANDER_PLAN_RUNNER_V1 COMPLETED|FAILED
job=<plan_id>
plan=<plan_id>
runner=<runner_id>
authorization_ref=<ref>
steps=s1:ok,s2:verdict.accept
stop_class=<CLASS|NONE>
policy=<POLICY|NONE>
action_required=true|false
reason=<one line>
USER_UPDATE_V1
plan=<plan_id>
result=completed|stopped|action_required
steps=…
```

## Owner-facing records on the Evidence Issue (PR B)

With `evidence_issue` configured, **every** Executor record (`CLAIMED`,
terminals, `REJECTED`, plan records, and the three below) is posted there;
the queue Issue carries only Commander intent. Without it, everything stays
on the queue Issue as before.

`CURRENT_USER_STATUS` — one pinned comment, rewritten in place (the only
`PATCH` the Runner performs, and only on this comment id) after every terminal
and at least every `heartbeat_interval_seconds`. A reader needs this one
comment to know whether the runner is alive and what is open:

```
CURRENT_USER_STATUS
updated_at=<UTC>
runner=<runner_id>
last_poll=<UTC|never>
heartbeat_interval_seconds=600
open_action_required=[<decision uuids>]
pending=terminals:0 wakes:0 rejections:0 notifications:0
recent=
- <UTC> COMPLETED <job uuid> <link>
```

`updated_at` older than about twice the heartbeat means the runner is down;
the Runner cannot say "stale" about itself.

`USER_ACTION_REQUIRED_V1` — appended once per `FAIL_CLOSED` terminal, listed
in `open_action_required` until acknowledged. Repetition is allowed;
omission is not.

```
USER_ACTION_REQUIRED_V1
decision=<uuid5(job_id, "user-action")>
job=<job uuid>            (plan=<plan uuid> when it came from a plan step)
stop_class=<SAFETY_STOP|HUMAN_APPROVAL_REQUIRED>
policy=FAIL_CLOSED
runner=<runner_id>
record=<link to the terminal>
required=owner decision; the runner will not retry or continue on its own
resolve_with=COMMANDER_ACK_V1
decision=<uuid>
```

`COMMANDER_ACK_V1` — posted by the Commander **on the queue Issue** to close a
decision. Fixed shape, nothing to interpret; it resolves the decision and does
nothing else (any follow-up is a new job or plan):

```
COMMANDER_ACK_V1
decision=<uuid>
```

## Operator commands

| Command | Purpose |
|---|---|
| `renormalize --job <uuid> [--allow-legacy-without-nonce]` | re-parse persisted raw output; zero provider calls |
| `rebuild-claims --confirm` | after local state loss, re-seed claims from the queue's Executor terminal records so nothing replays |
| `relink-launchagent --confirm` | point launchd at `runtime_dir/current/…` after the first transactional install (backs up the plist) |
| `doctor` | last poll and its freshness, comment high-water mark, queue readability, active job/attempt, outbox depths (terminals, wakes, rejections, notifications), open user actions, status comment, evidence-issue reachability, notification channel, LaunchAgent consistency, runtime provenance, token scopes |
| `notify-test --confirm` | queue one test notification and drain it through the configured channel (without `--confirm`: report the channel's health) |

## Terminal records (posted by the Executor)

```
COMMANDER_RUNNER_V1 <STATE>
job=<uuid>
worker=<w>  model=<m>  profile=<p>
sha=<40 hex>
runner=<runner_id>
evidence=provider=…; model=…; attempts=N; attempt_id=<uuid>;
         stop_class=<CLASS>; quality_gate=…; exit=N; duration=Ns; <excerpt>
         artifact=attempt-N.md
         artifact_sha256=<64 hex>
```

States: `CLAIMED`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `REJECTED`.

`REJECTED` is its own terminal state and carries `stop_class` and `reason`. A
job addressed to this runner that fails validation always produces one — it is
never skipped silently.

## Wake notice (optional, advisory only)

```
COMMANDER_WAKE_V1
job=<uuid>
terminal_issue=<n>
terminal_comment=<id>
state=<STATE>
runner=<runner_id>
```

At-least-once, deduplicated by job UUID in the outbox. **It carries no
authority.** The Commander must reconstruct state from the queue Issue; a wake
is only a nudge to go look.

## Invariants

0. A comment addressed to this runner that cannot be claimed (re-posted job
   UUID, edited comment) or that carries a newer protocol version becomes a
   `REJECTED` record, never an exception and never silence.
1. One job UUID → at most one terminal record, forever.
2. Retries create new `attempt_id`s; the job UUID is never reused as an
   execution identity.
3. Terminal intent is committed to SQLite **before** any GitHub post; failed
   posts redeliver rather than re-run.
4. An edited queue comment invalidates its claim and yields `REJECTED`.
5. Authority lives in owner config. A comment can only select from what is
   already enabled.
6. The queue cursor is a monotonic comment-id high-water mark. Every comment
   is examined at most once; an empty local state facing a queue with terminal
   history refuses to serve until `rebuild-claims` runs.
7. Paid attempts are charged on dispatch, per reset window, whether or not
   they succeed or report a price.
8. A plan transition is a table lookup on a token the Runner itself produced.
   No natural language, no condition expression, no LLM is ever consulted.
9. `FAIL_CLOSED` always ends a plan with an open `USER_ACTION_REQUIRED_V1`,
   whatever the edge table says.
10. The owner notification never carries evidence, summaries or secrets:
    state, short id, stop class, link. The recipient lives only in the
    0600 config and is never read from a comment.
