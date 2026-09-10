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

## `COMMANDER_VERDICT_V1` — structured review outcome (defined, not yet consumed)

```json
{"verdict": "accept|revise|reject|blocked", "p0": 0, "p1": 2,
 "code_changed": true, "exact_sha_verified": "<40 hex or null>",
 "recommended_transition": "<plan step id or stop>"}
```

Parsed when present, refused when malformed, copied into the terminal record.
**Nothing acts on it in this release.** PR B's plan executor will read this
shape to choose the next step; the Runner never derives an action from natural
language.

## Operator commands

| Command | Purpose |
|---|---|
| `renormalize --job <uuid> [--allow-legacy-without-nonce]` | re-parse persisted raw output; zero provider calls |
| `rebuild-claims --confirm` | after local state loss, re-seed claims from the queue's Executor terminal records so nothing replays |
| `relink-launchagent --confirm` | point launchd at `runtime_dir/current/…` after the first transactional install (backs up the plist) |
| `doctor` | last poll and its freshness, comment high-water mark, queue readability, active job/attempt, outbox depths, LaunchAgent consistency, runtime provenance, token scopes |

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
