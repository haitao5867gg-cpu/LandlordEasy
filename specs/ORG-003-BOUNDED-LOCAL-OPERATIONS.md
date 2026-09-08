# ORG-003 — Bounded Local Rehearsal Operations

Priority: release-control enablement. Status: **IMPLEMENTED / CANARY PENDING**. Owner: Commander. Acceptance requires independent review, green CI, safe Mac mini activation and a separately dispatched canary.

## Objective and boundary

Extend the accepted ORG-002 Mac mini Runner with a second, strictly bounded queue type for owner-configured local synthetic rehearsal operations. This is not a remote shell and does not create a Production, Tencent Cloud, SSH, deployment, real-database, provider, payment, OAuth, e-sign or real-user path. Existing `COMMANDER_JOB_V1` behavior and provider/profile controls remain unchanged.

## `COMMANDER_OPERATION_V1`

The comment must consist of the marker and exactly one fenced JSON object. Required fields are:

- `schema`, equal to `COMMANDER_OPERATION_V1`;
- UUID `job_id`, fixed `repository`, `queue_issue`, `runner_id`, exact lowercase `target_sha`, and `worktree_id` derived as `job-` plus the UUID;
- owner-enabled `operation_id`;
- `timeout_seconds` and `output_limit_bytes`, each no greater than both the global cap and the operation definition cap;
- bounded inert `expected_evidence` and non-empty `human_approval_ref` audit text.

Unknown or missing fields are rejected. The schema has no worker, model, prompt, quality gate, command, argv, environment, path, URL, free-form arguments or failover field. Shell-fragment patterns in audit text are rejected.

The Runner applies the existing distinct Commander/Executor identities, exact author, queue, content hash, atomic claim, replay protection, single-runner lease, crash recovery and terminal-state controls. Executor-authored job-shaped comments are ignored. An edited claimed comment is rejected.

## Owner-only registry

The mode-0600 local config contains `enabled_operations` and `operation_definitions`. Repository content and queue comments cannot activate or redefine operations. Each definition fixes:

- a complete direct argv whose executable and helper/Docker paths are absolute;
- implemented `read_only` mode;
- an exact target-SHA allowlist;
- bounded timeout and output maxima;
- a mandatory clean-worktree postcondition;
- a bounded description safe for doctor/status output.

Shells, env wrappers, relative executables, missing helpers, unknown operations, arbitrary modes, partial runtime manifests and enabled operations without healthy definitions fail closed. The operation subprocess receives only a minimal internally derived environment and never inherits proxy, SSH, cloud, Docker-routing, provider credential or arbitrary shell variables.

## Initial operation: `ops001_mysql_probe`

This is the only implemented and enableable operation. It is bound to candidate `104de1521cf194c9dc76ccca52741f05a75f1180` and creates a new detached, clean exact-SHA worktree which is preserved on failure.

The dedicated helper filters only Docker project `landlordeasy_ops001` and service `mysql`, requires exactly one running healthy container, image `mysql:8.0` at the accepted immutable image ID, exactly one loopback host binding from the approved host port to `3306/tcp`, tmpfs at `/var/lib/mysql`, and zero Docker volumes. It derives the trusted home from the local POSIX user record and connects only through that home's exact `.docker/run/docker.sock`, after proving the endpoint is a non-symlink Unix socket owned by the effective user and contained by the trusted home. Mutable Docker contexts, inherited `DOCKER_HOST`/`DOCKER_CONTEXT`, proxy-based routing, and TCP/SSH endpoints are never used. `HostConfig.Tmpfs` must contain exactly `/var/lib/mysql`; `Mounts` may be empty (the Docker Desktop representation) or contain only the matching tmpfs entry, and every bind, volume, additional mount, extra tmpfs key, or ambiguity blocks execution.

Only one fixed `docker exec` is permitted, invoking the MySQL client directly with tracked synthetic credentials and fixed read-only SQL. It reads server version, current database and the count of application base tables (excluding Prisma migration metadata). It requires MySQL 8, the expected synthetic database and 22 application tables. Docker version, filtered listing, inspection, and exec failures use distinct inert categories without exposing child output. It never constructs create/start/stop/restart/remove/pull/build/prune, schema, seed, dump, restore or SQL-write commands and does not inspect unrelated containers, images, networks, volumes or databases.

Output must be exactly one normalized JSON object with `status`, bounded `summary`, and bounded `evidence`. Raw bounded output remains owner-only locally. Public lifecycle evidence is normalized and redacted; secrets, credentials, paths, identities, IPs, environment dumps, row data and object-wide configuration are not emitted. Operations have one attempt only and never call or fail over to Kiro, Copilot or Claude.

## Verification and activation

Offline tests cover the strict schema and injection rejection, registry validation, target binding, author/replay/hash/crash controls, timeout/output/process cleanup, minimal environment, clean pre/postconditions, output validation/redaction, provider isolation, every Docker/MySQL identity and storage mismatch, mutation-command rejection, and atomic two-file runtime manifest installation. They use mocks only and never contact GitHub, Docker, databases, model services or LaunchAgents.

Activation requires independent Claude security/architecture and Copilot mechanical reviews with no P0/P1, green CI on the exact Draft PR head, a stopped Runner, owner-only backups, atomic installation of both hashed runtime files, an owner-only config enabling only this operation, green doctor/health and a 75-second no-replay observation. This phase ends at `READY_FOR_COMMANDER_OPERATION_CANARY`; only a later Commander-authored queue comment may run the real probe.

Production remains **NO-GO**. Any mismatch leaves forensic worktrees intact and requires fail-closed stop or verified rollback.
