#!/usr/bin/env python3
"""Local Commander Runner — ORG-002 bounded development-job executor.

No shell is used.  All outbound commands are explicit argv arrays and all
GitHub calls are limited to the configured queue issue.
"""
from __future__ import annotations

import argparse
import contextlib
import dataclasses
import datetime as dt
import hashlib
import json
import os
import plistlib
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

SCHEMA = "COMMANDER_JOB_V1"
PROFILES = frozenset({"repo_read", "repo_write_test", "repo_delivery"})
WORKERS = frozenset({"kiro", "copilot", "claude"})
MODEL_ALLOWLIST = {
    "kiro": frozenset({"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"}),
    "copilot": frozenset({"default", "claude-sonnet-5"}),
    "claude": frozenset({"claude-sonnet-5", "claude-opus-5"}),
}
PROVIDER_DEFAULT_MODEL = {
    "kiro": "gpt-5.6-terra",
    "copilot": "default",
    "claude": "claude-sonnet-5",
}
PROVIDER_REQUIRED_FLAGS = {
    "kiro": ("--no-interactive", "--model", "--trust-tools"),
    "copilot": ("--prompt", "--available-tools", "--allow-tool", "--deny-tool", "--deny-url",
                "--disable-builtin-mcps", "--no-remote", "--no-remote-export", "--no-auto-update",
                "--no-ask-user", "--disallow-temp-dir"),
    "claude": ("--print", "--no-session-persistence", "--model", "--settings", "--setting-sources",
               "--strict-mcp-config", "--mcp-config", "--permission-mode", "--permission-prompts",
               "--tools", "--disallowedTools"),
}
INTERNAL_STATES = frozenset({"queued", "claimed", "running", "succeeded", "failed", "blocked"})
STATE_TRANSITIONS = {
    "queued": frozenset({"claimed", "blocked"}),
    "claimed": frozenset({"running", "blocked"}),
    "running": frozenset({"succeeded", "failed", "blocked"}),
    "succeeded": frozenset(), "failed": frozenset(), "blocked": frozenset(),
}
ERROR_CATEGORIES = frozenset({
    "AUTH", "RATE_LIMIT", "QUOTA", "MODEL", "RUNTIME", "TIMEOUT",
    "OUTPUT_LIMIT", "OUTPUT_VALIDATION", "PERMISSION", "UNAVAILABLE", "UNKNOWN",
})
SAFE_FAILOVER_CATEGORIES = frozenset({"AUTH", "RATE_LIMIT", "QUOTA", "MODEL", "UNAVAILABLE"})
MAX_TIMEOUT_SECONDS = 3_600
MAX_OUTPUT_BYTES = 65_536
MAX_PROMPT_CHARS = 12_000
COMMENT_RE = re.compile(
    r"\A\s*COMMANDER_JOB_V1\s*\n```json\s*\n(\{.*\})\s*\n```\s*\Z", re.DOTALL
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
WORKTREE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$")
SHELL_FRAGMENT_RE = re.compile(r"(?:\$\(|`|&&|\|\||;|(?:^|\s)[|<>](?:\s|$))")
HIGH_RISK_RE = re.compile(
    r"(?i)(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|"
    r"(?:ghp|github_pat|xox[baprs]|sk-[A-Za-z0-9]|AKIA)[A-Za-z0-9_./=-]{12,}|"
    r"(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s]{8,}|"
    r"(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s]+)"
)
REDACTION_RE = re.compile(
    r"(?i)(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{16,}|"
    r"(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s]+|"
    r"(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s]+)"
)

class RunnerError(RuntimeError):
    pass

class ValidationError(RunnerError):
    pass

class UnsafeOutputError(RunnerError):
    pass

@dataclasses.dataclass(frozen=True)
class Config:
    repository: str
    queue_issue: int
    commander_login: str
    runner_id: str
    canonical_repo: Path
    worktree_root: Path
    state_dir: Path
    origin_url: str
    poll_seconds: int = 60
    lease_seconds: int = 180
    executable_paths: Mapping[str, str] = dataclasses.field(default_factory=dict)
    provider_failover: bool = False

    @classmethod
    def load(cls, path: Path) -> "Config":
        try:
            if path.stat().st_mode & 0o077:
                raise ValidationError("local config must not be group/world accessible")
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValidationError(f"invalid local config: {exc}") from exc
        expected = {
            "repository", "queue_issue", "commander_login", "runner_id",
            "canonical_repo", "worktree_root", "state_dir", "origin_url",
            "poll_seconds", "lease_seconds", "executable_paths",
            "provider_failover",
        }
        unknown = set(raw) - expected
        missing = expected - set(raw)
        if unknown or missing:
            raise ValidationError("local config has unknown or missing fields")
        if not isinstance(raw["queue_issue"], int) or raw["queue_issue"] < 1:
            raise ValidationError("queue_issue must be a positive integer")
        for field in ("repository", "commander_login", "runner_id", "origin_url"):
            if not isinstance(raw[field], str) or not raw[field].strip():
                raise ValidationError(f"{field} must be a non-empty string")
        if not ID_RE.fullmatch(raw["runner_id"]):
            raise ValidationError("runner_id has invalid characters")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", raw["repository"]):
            raise ValidationError("repository must be owner/name")
        if not isinstance(raw["executable_paths"], dict) or set(raw["executable_paths"]) != WORKERS:
            raise ValidationError("executable_paths must be an object")
        for executable in raw["executable_paths"].values():
            if not isinstance(executable, str) or not executable.strip() or "\x00" in executable:
                raise ValidationError("provider executable must be a non-empty path or command name")
            if not absolute_path(executable).is_absolute():
                raise ValidationError("provider executable path must be absolute")
        if not isinstance(raw["provider_failover"], bool):
            raise ValidationError("provider_failover must be a boolean")
        return cls(
            repository=raw["repository"], queue_issue=raw["queue_issue"],
            commander_login=raw["commander_login"], runner_id=raw["runner_id"],
            canonical_repo=absolute_path(raw["canonical_repo"]),
            worktree_root=absolute_path(raw["worktree_root"]),
            state_dir=absolute_path(raw["state_dir"]), origin_url=raw["origin_url"],
            poll_seconds=bounded_int(raw["poll_seconds"], 15, 3600, "poll_seconds"),
            lease_seconds=bounded_int(raw["lease_seconds"], 30, 900, "lease_seconds"),
            executable_paths={str(k): str(absolute_path(v)) for k, v in raw["executable_paths"].items()},
            provider_failover=raw["provider_failover"],
        )

@dataclasses.dataclass(frozen=True)
class Job:
    job_id: str
    repository: str
    queue_issue: int
    target_sha: str
    worktree_id: str
    runner_id: str
    worker: str
    model: str
    profile: str
    assigned: str
    prompt: str
    timeout_seconds: int
    output_limit_bytes: int
    expected_evidence: str
    human_approval_ref: str | None = None

    @classmethod
    def from_comment(cls, text: str, config: Config) -> "Job":
        match = COMMENT_RE.fullmatch(text)
        if not match:
            raise ValidationError("comment is not exactly one COMMANDER_JOB_V1 fenced JSON object")
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError as exc:
            raise ValidationError("job JSON is invalid") from exc
        if not isinstance(data, dict):
            raise ValidationError("job must be a JSON object")
        required = {
            "schema", "job_id", "repository", "queue_issue", "target_sha", "worktree_id",
            "runner_id", "worker", "model", "profile", "assigned", "prompt",
            "timeout_seconds", "output_limit_bytes", "expected_evidence",
        }
        allowed = required | {"human_approval_ref"}
        if set(data) != required and not (required | {"human_approval_ref"}) == set(data):
            raise ValidationError("job has unknown or missing fields")
        if data.get("schema") != SCHEMA:
            raise ValidationError("unsupported schema")
        if data["repository"] != config.repository or data["queue_issue"] != config.queue_issue:
            raise ValidationError("job repository or queue issue mismatch")
        if data["runner_id"] != config.runner_id:
            raise ValidationError("job targets a different runner")
        if not isinstance(data["job_id"], str) or not valid_uuid(data["job_id"]):
            raise ValidationError("job_id must be a UUID")
        if not isinstance(data["target_sha"], str) or not SHA_RE.fullmatch(data["target_sha"]):
            raise ValidationError("target_sha must be an exact lowercase SHA")
        expected_worktree = derive_worktree_id(data["job_id"])
        if data["worktree_id"] != expected_worktree or not WORKTREE_RE.fullmatch(data["worktree_id"]):
            raise ValidationError("worktree_id is not the derived isolated worktree ID")
        if data["worker"] not in WORKERS or data["model"] not in MODEL_ALLOWLIST.get(data["worker"], ()):
            raise ValidationError("worker or model is not allowed")
        if data["worker"] == "kiro" and data["model"] == "auto":
            raise ValidationError("Kiro auto model is forbidden")
        if data["profile"] not in PROFILES:
            raise ValidationError("permission profile is not allowed")
        if data["profile"] != "repo_delivery" and data.get("human_approval_ref") is not None:
            raise ValidationError("approval reference is only valid for a future privileged profile")
        for key in ("assigned", "expected_evidence"):
            if not isinstance(data[key], str) or not data[key].strip() or len(data[key]) > 512:
                raise ValidationError(f"{key} must be a bounded non-empty string")
        if not isinstance(data["prompt"], str) or not data["prompt"].strip() or len(data["prompt"]) > MAX_PROMPT_CHARS:
            raise ValidationError("prompt must be a bounded non-empty string")
        if any(SHELL_FRAGMENT_RE.search(data[key]) for key in ("assigned", "expected_evidence", "prompt")):
            raise ValidationError("job text contains a shell fragment")
        timeout = bounded_int(data["timeout_seconds"], 1, MAX_TIMEOUT_SECONDS, "timeout_seconds")
        cap = bounded_int(data["output_limit_bytes"], 1, MAX_OUTPUT_BYTES, "output_limit_bytes")
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__})

def bounded_int(value: Any, low: int, high: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValidationError(f"{name} must be an integer in [{low}, {high}]")
    return value

def absolute_path(value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise ValidationError("configured path must be an absolute path")
    if value == "~" or value.startswith("~/"):
        path = Path.home() / value[2:] if value != "~" else Path.home()
    elif value == "${HOME}" or value.startswith("${HOME}/"):
        path = Path.home() / value[8:] if value != "${HOME}" else Path.home()
    else:
        path = Path(value)
    if not path.is_absolute():
        raise ValidationError("configured path must be absolute")
    return path

def valid_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False

def derive_worktree_id(job_id: str) -> str:
    return "job-" + str(uuid.UUID(job_id)).lower()

def comment_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()

def checked_child(root: Path, child_name: str, must_exist: bool = False) -> Path:
    if not WORKTREE_RE.fullmatch(child_name):
        raise ValidationError("unsafe worktree path component")
    if root.is_symlink():
        raise ValidationError("configured root may not be a symlink")
    resolved_root = root.resolve(strict=must_exist)
    candidate = root / child_name
    if candidate.is_symlink():
        raise ValidationError("worktree may not be a symlink")
    resolved_candidate = candidate.resolve(strict=False)
    if resolved_candidate.parent != resolved_root:
        raise ValidationError("worktree escapes its configured root")
    return candidate

def safe_environment(source: Mapping[str, str] | None = None) -> dict[str, str]:
    source = os.environ if source is None else source
    allowed = {"HOME", "PATH", "LANG", "LC_ALL", "TERM", "TMPDIR", "XDG_CONFIG_HOME"}
    return {key: value for key, value in source.items() if key in allowed and isinstance(value, str)}

def redact(text: str, limit: int = 4000) -> str:
    value = text.replace(str(Path.home()), "$HOME")
    value = re.sub(r"/Users/[^/\s]+", "/Users/[REDACTED_USER]", value)
    value = re.sub(r"(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])", "[REDACTED_IP]", value)
    value = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]", value)
    value = REDACTION_RE.sub("[REDACTED]", value)
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    return value[:limit]

def ensure_safe_post(text: str) -> str:
    cleaned = redact(text)
    if HIGH_RISK_RE.search(cleaned):
        raise UnsafeOutputError("high-risk output remains after redaction")
    return cleaned

def store_raw_output(state_dir: Path, job_id: str, text: str, retention_seconds: int = 7 * 24 * 3600) -> Path:
    """Keep capped worker output locally with owner-only permissions and short retention."""
    if not valid_uuid(job_id):
        raise ValidationError("invalid job ID for raw output")
    directory = state_dir / "raw-output"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    cutoff = time.time() - retention_seconds
    for entry in directory.glob("*.log"):
        if not entry.is_symlink() and entry.is_file() and entry.stat().st_mtime < cutoff:
            entry.unlink()
    target = directory / f"{job_id}.log"
    if target.is_symlink():
        raise ValidationError("raw output target may not be a symlink")
    target.write_text(text, encoding="utf-8", errors="replace")
    os.chmod(target, 0o600)
    return target

class State:
    """SQLite state; INSERT's unique constraints make job claims atomic."""
    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_dir, 0o700)
        self.path = state_dir / "state.sqlite3"
        self.db = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        os.chmod(self.path, 0o600)
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS claims (
          comment_id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, content_hash TEXT NOT NULL,
          status TEXT NOT NULL, claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id TEXT NOT NULL,
          status TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS lease (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1), runner_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL);
        """)
    def close(self) -> None:
        self.db.close()
    def claim(self, comment_id: str, job_id: str, content_hash_value: str) -> bool:
        now = int(time.time())
        try:
            self.db.execute("BEGIN IMMEDIATE")
            existing = self.db.execute("SELECT content_hash FROM claims WHERE comment_id=?", (comment_id,)).fetchone()
            if existing is not None:
                self.db.execute("COMMIT")
                if existing[0] != content_hash_value:
                    raise ValidationError("claimed comment was edited")
                return False
            duplicate = self.db.execute("SELECT comment_id FROM claims WHERE job_id=?", (job_id,)).fetchone()
            if duplicate is not None:
                self.db.execute("COMMIT")
                raise ValidationError("duplicate job ID")
            self.db.execute("INSERT INTO claims VALUES (?, ?, ?, 'queued', ?, ?)",
                            (comment_id, job_id, content_hash_value, now, now))
            self.db.execute("INSERT INTO history(comment_id,status,created_at) VALUES (?, 'queued', ?)",
                            (comment_id, now))
            self.db.execute("UPDATE claims SET status='claimed', updated_at=? WHERE comment_id=?",
                            (now, comment_id))
            self.db.execute("INSERT INTO history(comment_id,status,created_at) VALUES (?, 'claimed', ?)",
                            (comment_id, now))
            self.db.execute("COMMIT")
            return True
        except Exception:
            with contextlib.suppress(sqlite3.Error): self.db.execute("ROLLBACK")
            raise
    def set_status(self, comment_id: str, status: str) -> None:
        if status not in INTERNAL_STATES:
            raise ValidationError("invalid internal state")
        now = int(time.time())
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT status FROM claims WHERE comment_id=?", (comment_id,)).fetchone()
            if row is None or status not in STATE_TRANSITIONS.get(row[0], ()):
                raise ValidationError("invalid internal state transition")
            self.db.execute("UPDATE claims SET status=?, updated_at=? WHERE comment_id=?", (status, now, comment_id))
            self.db.execute("INSERT INTO history(comment_id,status,created_at) VALUES (?, ?, ?)",
                            (comment_id, status, now))
            self.db.execute("COMMIT")
        except Exception:
            with contextlib.suppress(sqlite3.Error): self.db.execute("ROLLBACK")
            raise
    def recover_incomplete(self) -> int:
        """Fail closed after a crash; never replay an ambiguously started worker."""
        now = int(time.time())
        rows = self.db.execute("SELECT comment_id FROM claims WHERE status IN ('claimed','running')").fetchall()
        for (comment_id,) in rows:
            self.set_status(comment_id, "blocked")
        return len(rows)
    def acquire_lease(self, runner_id: str, seconds: int) -> bool:
        now = int(time.time())
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT runner_id, expires_at FROM lease WHERE singleton=1").fetchone()
            if row and row[0] != runner_id and row[1] > now:
                self.db.execute("COMMIT")
                return False
            self.db.execute("INSERT INTO lease VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET runner_id=excluded.runner_id, expires_at=excluded.expires_at", (runner_id, now + seconds))
            self.db.execute("COMMIT")
            return True
        except Exception:
            self.db.execute("ROLLBACK")
            raise
    def summary(self) -> dict[str, Any]:
        rows = self.db.execute("SELECT status, count(*) FROM claims GROUP BY status").fetchall()
        lease = self.db.execute("SELECT runner_id, expires_at FROM lease WHERE singleton=1").fetchone()
        return {"jobs": dict(rows), "lease": {"active": bool(lease and lease[1] > int(time.time()))} if lease else None}

class ProcessLock:
    def __init__(self, state_dir: Path): self.path = state_dir / "runner.lock"; self.handle = None
    def __enter__(self) -> "ProcessLock":
        import fcntl
        self.handle = open(self.path, "a", encoding="utf-8")
        os.chmod(self.path, 0o600)
        try: fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.handle.close(); raise RunnerError("another runner process is active") from exc
        return self
    def __exit__(self, *exc: object) -> None:
        if self.handle:
            import fcntl
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN); self.handle.close()

@dataclasses.dataclass(frozen=True)
class Result:
    returncode: int
    output: str
    timed_out: bool
    overflow: bool
    duration_seconds: float

def execute(argv: Sequence[str], *, timeout: int, cap: int, cwd: Path | None = None, env: Mapping[str, str] | None = None) -> Result:
    """Run direct argv with bounded capture and reliable process-group cleanup."""
    import selectors
    if not argv or any(not isinstance(part, str) or "\x00" in part for part in argv):
        raise ValidationError("invalid argv")
    started = time.monotonic()
    proc = subprocess.Popen(list(argv), cwd=str(cwd) if cwd else None, env=dict(env or safe_environment()),
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=False, start_new_session=True)
    output = bytearray(); overflow = False; timed_out = False
    selector = selectors.DefaultSelector()
    if proc.stdout: selector.register(proc.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map():
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                timed_out = True; break
            for key, _ in selector.select(min(remaining, 0.25)):
                chunk = os.read(key.fd, 4096)
                if not chunk:
                    selector.unregister(key.fileobj); continue
                room = cap - len(output)
                output.extend(chunk[:max(0, room)])
                if len(chunk) > room:
                    overflow = True; break
            if overflow: break
            if proc.poll() is not None:
                # Drain any last data without extending the deadline.
                continue
        if timed_out or overflow:
            with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid, signal.SIGTERM)
    finally:
        selector.close()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        if proc.stdout:
            proc.stdout.close()
    return Result(proc.returncode or 0, output.decode("utf-8", "replace"), timed_out, overflow, time.monotonic()-started)

def adapter_argv(job: Job, executable_paths: Mapping[str, str]) -> list[str]:
    executable = executable_paths.get(job.worker, job.worker)
    # Prompt remains one inert argv element; no job field is interpreted as a flag.
    policy = ("Repository-only task. Obey the assigned spec and profile. Do not use web, MCP, "
              "remote control, subagents, servers, databases, or providers.\n\n")
    response_contract = ("\n\nReturn exactly one JSON object with keys status, summary, and evidence. "
                         "status is ok or blocked; summary is a non-empty string; evidence is a list of strings.")
    prompt = policy + job.prompt + response_contract
    if not prompt.strip():
        raise ValidationError("provider INPUT must be non-empty")
    if job.worker == "kiro":
        trusted = "fs_read" if job.profile == "repo_read" else "fs_read,fs_write"
        return [executable, "chat", "--no-interactive", "--model", job.model,
                f"--trust-tools={trusted}", prompt]
    if job.worker == "copilot":
        tools = "view,grep,glob" if job.profile == "repo_read" else "view,grep,glob,write,edit"
        argv = [executable, "--prompt", prompt, "--available-tools", tools,
                "--allow-tool", tools, "--deny-tool", "shell,url,web,mcp,remote,agents",
                "--deny-url", "*", "--disable-builtin-mcps", "--no-remote", "--no-remote-export",
                "--no-auto-update", "--no-ask-user", "--disallow-temp-dir", "--silent"]
        if job.model != "default":
            argv += ["--model", job.model]
        return argv
    if job.worker == "claude":
        settings = json.dumps({"remoteControlAtStartup": False}, separators=(",", ":"))
        tools = "Read,Glob,Grep" if job.profile == "repo_read" else "Read,Glob,Grep,Edit,Write"
        return [executable, "--print", prompt, "--no-session-persistence", "--model", job.model,
                "--settings", settings, "--setting-sources", "", "--strict-mcp-config",
                "--mcp-config", '{"mcpServers":{}}', "--permission-mode", "dontAsk",
                "--permission-prompts", "none", "--tools", tools,
                "--disallowedTools", "Bash,WebFetch,WebSearch,Task,TaskOutput",
                "--output-format", "json"]
    raise ValidationError("unknown worker")

@dataclasses.dataclass(frozen=True)
class NormalizedOutput:
    status: str
    summary: str
    evidence: tuple[str, ...]
    usage: str | None = None

@dataclasses.dataclass(frozen=True)
class ProviderAttempt:
    worker: str
    model: str
    result: Result | None
    output: NormalizedOutput | None
    error_category: str | None

def _candidate_json_objects(text: str) -> Iterable[str]:
    stripped = text.strip()
    if stripped:
        yield stripped
    for match in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE):
        yield match.group(1)
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character == "{":
            with contextlib.suppress(json.JSONDecodeError):
                _, end = decoder.raw_decode(text[index:])
                yield text[index:index + end]

def normalize_provider_output(text: str) -> NormalizedOutput:
    for candidate in _candidate_json_objects(text):
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("result"), str):
            # Claude --output-format json wraps the assistant response.
            with contextlib.suppress(ValidationError):
                normalized = normalize_provider_output(value["result"])
                visible = value.get("total_cost_usd")
                usage = normalized.usage if visible is None else f"cost_usd={visible}"
                return dataclasses.replace(normalized, usage=usage)
        if not isinstance(value, dict) or not {"status", "summary", "evidence"}.issubset(value):
            continue
        if set(value) - {"status", "summary", "evidence", "usage"}:
            continue
        status, summary, evidence = value["status"], value["summary"], value["evidence"]
        usage = value.get("usage")
        if status not in {"ok", "blocked"} or not isinstance(summary, str) or not summary.strip():
            continue
        if len(summary) > 2000 or not isinstance(evidence, list) or len(evidence) > 50:
            continue
        if any(not isinstance(item, str) or not item.strip() or len(item) > 1000 for item in evidence):
            continue
        if usage is not None and (not isinstance(usage, str) or len(usage) > 200):
            continue
        return NormalizedOutput(status, summary.strip(), tuple(item.strip() for item in evidence), usage)
    raise ValidationError("provider output failed structured validation")

def extract_visible_usage(text: str) -> str | None:
    match = re.search(r"(?i)\bcredits?\s*:\s*([0-9]+(?:\.[0-9]+)?)", text)
    if match: return f"credits={match.group(1)}"
    match = re.search(r'"total_cost_usd"\s*:\s*([0-9]+(?:\.[0-9]+)?)', text)
    if match: return f"cost_usd={match.group(1)}"
    return None

def classify_provider_error(result: Result | None, error: BaseException | None = None) -> str:
    if isinstance(error, PermissionError): return "PERMISSION"
    if isinstance(error, FileNotFoundError): return "UNAVAILABLE"
    if result is None: return "UNKNOWN"
    if result.timed_out: return "TIMEOUT"
    if result.overflow: return "OUTPUT_LIMIT"
    text = result.output.lower()
    patterns = (
        ("AUTH", ("not authenticated", "login required", "unauthorized", "authentication")),
        ("RATE_LIMIT", ("rate limit", "too many requests")),
        ("QUOTA", ("quota", "credits exhausted", "usage limit")),
        ("MODEL", ("unknown model", "unsupported model", "model not found")),
        ("PERMISSION", ("permission denied", "tool validation failed", "not allowed")),
    )
    for category, needles in patterns:
        if any(needle in text for needle in needles): return category
    return "RUNTIME" if result.returncode else "UNKNOWN"

class QuotaLedger:
    """Locally records observed usage; unknown balances remain unknown."""
    def __init__(self, state_dir: Path):
        self.path = state_dir / "quota.json"
        self.data: dict[str, Any] = {}
        if self.path.exists() and not self.path.is_symlink():
            try: self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError): self.data = {}
    @staticmethod
    def reset_key(worker: str, now: dt.datetime | None = None) -> str:
        now = now or dt.datetime.now(dt.timezone.utc)
        if worker in {"kiro", "copilot"}:
            return f"monthly:{now.year:04d}-{now.month:02d}-01"
        saturday = now.date() - dt.timedelta(days=(now.weekday() - 5) % 7)
        window = int(now.timestamp()) // (5 * 3600)
        return f"weekly:{saturday.isoformat()}:5h:{window}"
    def balance(self, worker: str) -> float | None:
        item = self.data.get(worker, {})
        return item.get("balance") if item.get("reset_key") == self.reset_key(worker) else None
    def record(self, worker: str, usage: str | None, balance: float | None = None) -> None:
        self.data[worker] = {"reset_key": self.reset_key(worker), "usage": usage, "balance": balance}
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        payload = json.dumps(self.data, sort_keys=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle: handle.write(payload)

def route_candidates(job: Job, allow_failover: bool = True) -> list[tuple[str, str]]:
    order = {
        "kiro": ("kiro", "copilot", "claude"),
        "copilot": ("copilot", "kiro", "claude"),
        "claude": ("claude", "kiro", "copilot"),
    }[job.worker]
    if not allow_failover:
        order = order[:1]
    return [(worker, job.model if worker == job.worker else PROVIDER_DEFAULT_MODEL[worker]) for worker in order]

def with_provider(job: Job, worker: str, model: str) -> Job:
    return dataclasses.replace(job, worker=worker, model=model)

def provider_health(config: Config) -> dict[str, dict[str, Any]]:
    ledger = QuotaLedger(config.state_dir)
    health: dict[str, dict[str, Any]] = {}
    for worker in sorted(WORKERS):
        executable = config.executable_paths.get(worker, worker)
        resolved = executable if os.path.isabs(executable) else shutil.which(executable)
        available = bool(resolved and Path(resolved).is_file())
        interface_ok = False
        if available:
            help_argv = [str(resolved), "chat", "--help"] if worker == "kiro" else [str(resolved), "--help"]
            try:
                result = execute(help_argv, timeout=15, cap=MAX_OUTPUT_BYTES, env=safe_environment())
                interface_ok = not (result.returncode or result.timed_out or result.overflow) and all(
                    flag in result.output for flag in PROVIDER_REQUIRED_FLAGS[worker])
            except OSError:
                interface_ok = False
        health[worker] = {
            "available": available,
            "interface_ok": interface_ok,
            "quota_balance": ledger.balance(worker),
            "quota_reset": QuotaLedger.reset_key(worker),
        }
    return health

def execute_with_failover(job: Job, config: Config, worktree: Path) -> tuple[ProviderAttempt, list[ProviderAttempt]]:
    attempts: list[ProviderAttempt] = []
    ledger = QuotaLedger(config.state_dir)
    for worker, model in route_candidates(job, config.provider_failover):
        candidate = with_provider(job, worker, model)
        try:
            result = execute(adapter_argv(candidate, config.executable_paths), timeout=job.timeout_seconds,
                             cap=job.output_limit_bytes, cwd=worktree, env=safe_environment())
        except (OSError, RunnerError) as exc:
            category = classify_provider_error(None, exc)
            attempt = ProviderAttempt(worker, model, None, None, category)
            attempts.append(attempt)
            if category in SAFE_FAILOVER_CATEGORIES: continue
            return attempt, attempts
        if result.returncode or result.timed_out or result.overflow:
            category = classify_provider_error(result)
            attempt = ProviderAttempt(worker, model, result, None, category)
            attempts.append(attempt)
            if category in SAFE_FAILOVER_CATEGORIES: continue
            return attempt, attempts
        try:
            normalized = normalize_provider_output(result.output)
        except ValidationError:
            attempt = ProviderAttempt(worker, model, result, None, "OUTPUT_VALIDATION")
            attempts.append(attempt)
            return attempt, attempts
        if normalized.usage is None:
            normalized = dataclasses.replace(normalized, usage=extract_visible_usage(result.output))
        ledger.record(worker, normalized.usage)
        attempt = ProviderAttempt(worker, model, result, normalized, None)
        attempts.append(attempt)
        return attempt, attempts
    return attempts[-1], attempts

def git_checked(argv: Sequence[str], cwd: Path, *, timeout: int = 60) -> str:
    result = execute(["git", *argv], timeout=timeout, cap=8192, cwd=cwd, env=safe_environment())
    if result.returncode or result.timed_out or result.overflow:
        raise RunnerError("bounded git verification failed")
    return result.output.strip()

def verify_target(config: Config, job: Job) -> None:
    if config.canonical_repo.is_symlink() or not config.canonical_repo.is_dir():
        raise ValidationError("canonical repository is missing or a symlink")
    if config.worktree_root.is_symlink() or not config.worktree_root.is_dir():
        raise ValidationError("worktree root is missing or a symlink")
    remote = git_checked(["remote", "get-url", "origin"], config.canonical_repo)
    if remote != config.origin_url:
        raise ValidationError("canonical repository origin does not match configured origin")
    # A SHA in job data is never accepted as a ref name or command fragment.
    git_checked(["fetch", "--no-tags", "origin", job.target_sha], config.canonical_repo, timeout=120)
    git_checked(["cat-file", "-e", f"{job.target_sha}^{{commit}}"], config.canonical_repo)

def prepare_worktree(config: Config, job: Job) -> Path:
    verify_target(config, job)
    path = checked_child(config.worktree_root, job.worktree_id, must_exist=True)
    if path.exists():
        raise RunnerError("worktree already exists; it will not be reused or deleted")
    worktree_args = ["git", "worktree", "add"]
    worktree_args += ["-b", job.worktree_id] if job.profile == "repo_delivery" else ["--detach"]
    worktree_args += [str(path), job.target_sha]
    result = execute(worktree_args, timeout=120, cap=8192,
                     cwd=config.canonical_repo, env=safe_environment())
    if result.returncode or result.timed_out or result.overflow:
        raise RunnerError("failed to create clean isolated worktree")
    if path.is_symlink() or git_checked(["rev-parse", "HEAD"], path) != job.target_sha:
        raise RunnerError("created worktree does not match requested SHA")
    if git_checked(["status", "--porcelain"], path):
        raise RunnerError("new isolated worktree is dirty")
    return path

def validate_delivery_snapshot(changes: str, diff: str) -> None:
    forbidden = re.compile(r"(?i)(?:^|/)(?:\.env(?:\.|$)|.*(?:credential|secret|token|keychain|id_rsa|id_ed25519).*)")
    for line in changes.splitlines():
        candidate = line[3:] if len(line) > 3 else ""
        if forbidden.search(candidate):
            raise RunnerError("delivery contains a forbidden sensitive path")
    if HIGH_RISK_RE.search(diff) or re.search(r"/Users/[A-Za-z0-9._-]+/", diff):
        raise RunnerError("delivery diff contains sensitive material or a device-specific path")

def deliver_worktree(config: Config, job: Job, worktree: Path) -> str:
    """The only V1 commit/push path; branch name is derived, never job-supplied."""
    if job.profile != "repo_delivery":
        return ""
    changes = git_checked(["status", "--porcelain"], worktree)
    if not changes:
        raise RunnerError("delivery job produced no changes")
    diff = execute(["git", "diff", "--no-ext-diff", "--binary"], timeout=60,
                   cap=MAX_OUTPUT_BYTES, cwd=worktree, env=safe_environment())
    if diff.returncode or diff.timed_out or diff.overflow:
        raise RunnerError("delivery diff could not be safely bounded")
    validate_delivery_snapshot(changes, diff.output)
    git_checked(["add", "--all"], worktree)
    git_checked(["diff", "--cached", "--check"], worktree)
    git_checked(["commit", "-m", f"commander job {job.job_id}"], worktree, timeout=120)
    # The branch was created from the UUID-derived worktree ID and cannot be main/dev.
    git_checked(["push", "origin", f"{job.worktree_id}:{job.worktree_id}"], worktree, timeout=120)
    return git_checked(["rev-parse", "HEAD"], worktree)

class GitHubClient:
    """The sole GitHub interface. Every call is an argv list to gh api."""
    def __init__(self, config: Config): self.config = config
    def _api(self, method: str, endpoint: str, fields: Mapping[str, str] | None = None,
             paginate: bool = False) -> Any:
        expected = f"repos/{self.config.repository}/issues/{self.config.queue_issue}"
        if endpoint not in {expected, f"{expected}/comments"}:
            raise ValidationError("GitHub endpoint outside queue issue")
        if method not in {"GET", "POST"} or (method == "POST" and endpoint != f"{expected}/comments"):
            raise ValidationError("GitHub operation outside queue comment boundary")
        argv = ["gh", "api", "--method", method, endpoint]
        if paginate:
            if method != "GET": raise ValidationError("pagination is read-only")
            argv += ["--paginate", "--slurp"]
        for key, value in (fields or {}).items(): argv += ["-f", f"{key}={value}"]
        result = execute(argv, timeout=30, cap=MAX_OUTPUT_BYTES)
        if result.returncode or result.timed_out or result.overflow: raise RunnerError("GitHub API request failed")
        try: return json.loads(result.output)
        except json.JSONDecodeError as exc: raise RunnerError("GitHub returned invalid JSON") from exc
    def verify_login(self) -> None:
        # /user is read-only; it is intentionally the only non-issue endpoint.
        result = execute(["gh", "api", "user"], timeout=30, cap=8192)
        if result.returncode or result.timed_out or result.overflow: raise RunnerError("unable to verify GitHub login")
        try: login = json.loads(result.output).get("login")
        except (json.JSONDecodeError, AttributeError) as exc: raise RunnerError("invalid GitHub login response") from exc
        if login != self.config.commander_login: raise RunnerError("unexpected GitHub login")
    def comments(self) -> list[dict[str, Any]]:
        value = self._api("GET", f"repos/{self.config.repository}/issues/{self.config.queue_issue}/comments",
                          paginate=True)
        if not isinstance(value, list): return []
        if value and all(isinstance(page, list) for page in value):
            return [comment for page in value for comment in page if isinstance(comment, dict)]
        return [comment for comment in value if isinstance(comment, dict)]
    def comment(self, comment_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[0-9]+", comment_id):
            raise ValidationError("invalid GitHub comment ID")
        for value in self.comments():
            if str(value.get("id", "")) == comment_id:
                return value
        raise RunnerError("claimed comment no longer exists on the queue issue")
    def post(self, body: str) -> None:
        self._api("POST", f"repos/{self.config.repository}/issues/{self.config.queue_issue}/comments", {"body": ensure_safe_post(body)})

def lifecycle(job: Job, state: str, detail: str = "") -> str:
    detail = ensure_safe_post(detail) if detail else ""
    return (f"COMMANDER_RUNNER_V1 {state}\njob={job.job_id}\nworker={job.worker}\nmodel={job.model}\n"
            f"profile={job.profile}\nsha={job.target_sha}\nrunner={job.runner_id}" + (f"\nevidence={detail}" if detail else ""))

def make_launchagent(template: Mapping[str, Any], python: str, script: str, config: str, log_dir: str) -> bytes:
    data = dict(template)
    data["ProgramArguments"] = [python, script, "--config", config, "serve"]
    data["StandardOutPath"] = str(Path(log_dir) / "runner.out.log")
    data["StandardErrorPath"] = str(Path(log_dir) / "runner.err.log")
    # Installation only writes the file; a later explicit start/bootstrap launches it.
    data["RunAtLoad"] = True
    return plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=True)

def launchagent_path() -> Path:
    return Path.home() / "Library/LaunchAgents/com.landlordeasy.commander-runner.plist"

def run_launchctl(*arguments: str) -> None:
    result = execute(["launchctl", *arguments], timeout=30, cap=8192)
    if result.returncode or result.timed_out or result.overflow:
        raise RunnerError("launchctl operation failed")

def verify_owned_launchagent(path: Path) -> None:
    try:
        data = plistlib.loads(path.read_bytes())
    except (OSError, ValueError) as exc:
        raise RunnerError("invalid runner LaunchAgent") from exc
    if data.get("Label") != "com.landlordeasy.commander-runner":
        raise RunnerError("refusing to alter a non-runner LaunchAgent")

def doctor(config: Config) -> dict[str, Any]:
    providers = provider_health(config)
    checks = {
        "canonical_repo": config.canonical_repo.is_dir() and not config.canonical_repo.is_symlink(),
        "worktree_root": config.worktree_root.is_dir() and not config.worktree_root.is_symlink(),
        "state_dir": config.state_dir.is_dir() or not config.state_dir.exists(),
        "absolute_paths": all(path.is_absolute() for path in (config.canonical_repo, config.worktree_root, config.state_dir)),
        "outbound_policy": "NO_INBOUND_LISTENER_IMPLEMENTED",
        "providers": providers,
    }
    booleans_ok = all(value for key, value in checks.items()
                      if key not in {"providers", "outbound_policy"})
    checks["ok"] = booleans_ok and all(item["available"] and item["interface_ok"]
                                        for item in providers.values())
    return checks

def run_once(config: Config, dry_run: bool = False) -> str:
    config.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with ProcessLock(config.state_dir):
        state = State(config.state_dir)
        try:
            if not state.acquire_lease(config.runner_id, config.lease_seconds): raise RunnerError("active lease belongs to another runner")
            state.recover_incomplete()
            client = GitHubClient(config); client.verify_login()
            for comment in client.comments():
                author = ((comment.get("user") or {}).get("login"))
                body, comment_id = comment.get("body"), str(comment.get("id", ""))
                if author != config.commander_login or not isinstance(body, str) or not comment_id: continue
                try: job = Job.from_comment(body, config)
                except ValidationError: continue
                digest = comment_hash(body)
                if dry_run:
                    verify_target(config, job)
                    return f"VALIDATED {job.job_id}"
                claimed = state.claim(comment_id, job.job_id, digest)
                if not claimed: continue
                latest = client.comment(comment_id)
                if ((latest.get("user") or {}).get("login") != config.commander_login
                        or not isinstance(latest.get("body"), str)
                        or comment_hash(latest["body"]) != digest):
                    state.set_status(comment_id, "blocked")
                    client.post(lifecycle(job, "REJECTED", "claimed comment was edited or author changed"))
                    return f"REJECTED {job.job_id}"
                client.post(lifecycle(job, "CLAIMED"))
                try:
                    worktree = prepare_worktree(config, job)
                    state.set_status(comment_id, "running")
                    attempt, attempts = execute_with_failover(job, config, worktree)
                    result = attempt.result
                    delivered_sha = ""
                    if attempt.error_category == "TIMEOUT":
                        state_name, internal_state = "TIMED_OUT", "blocked"
                    elif attempt.error_category == "RUNTIME":
                        state_name, internal_state = "FAILED", "failed"
                    elif attempt.error_category:
                        state_name, internal_state = "FAILED", "blocked"
                    elif attempt.output and attempt.output.status == "blocked":
                        state_name, internal_state = "FAILED", "blocked"
                    else:
                        delivered_sha = deliver_worktree(config, job, worktree)
                        state_name, internal_state = "COMPLETED", "succeeded"
                    if result:
                        store_raw_output(config.state_dir, job.job_id, result.output)
                    if attempt.output:
                        evidence = attempt.output.summary + "\n" + "\n".join(attempt.output.evidence)
                    else:
                        evidence = f"provider_error={attempt.error_category}"
                    evidence = redact(evidence, 3000)
                    if delivered_sha: evidence += f"\ndelivered_sha={delivered_sha}"
                    duration = result.duration_seconds if result else 0.0
                    exit_code = result.returncode if result else -1
                    detail = (f"provider={attempt.worker}; model={attempt.model}; attempts={len(attempts)}; "
                              f"exit={exit_code}; duration={duration:.1f}s; {evidence}")
                except RunnerError as exc:
                    state_name, internal_state, detail = "FAILED", "blocked", f"runner stop condition: {exc}"
                state.set_status(comment_id, internal_state)
                client.post(lifecycle(job, state_name, detail))
                return f"{state_name} {job.job_id}"
            return "NO_JOB"
        finally: state.close()

def command_install(args: argparse.Namespace) -> int:
    config = Config.load(Path(args.config)); report = doctor(config); print(json.dumps(report, sort_keys=True))
    if not report["ok"]: raise RunnerError("doctor checks failed; refusing installation")
    if not args.confirm: print("Not installed: pass --confirm after review."); return 0
    destination = launchagent_path()
    if destination.exists(): raise RunnerError("LaunchAgent already exists; refusing to overwrite")
    template = {"Label": "com.landlordeasy.commander-runner", "RunAtLoad": True, "KeepAlive": True}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(make_launchagent(template, sys.executable, str(Path(__file__).resolve()), str(Path(args.config).resolve()), str(config.state_dir)))
    os.chmod(destination, 0o600); print("Installed but not loaded."); return 0

def command_start() -> int:
    destination = launchagent_path(); verify_owned_launchagent(destination)
    run_launchctl("bootstrap", f"gui/{os.getuid()}", str(destination)); print("STARTED"); return 0

def command_stop() -> int:
    destination = launchagent_path(); verify_owned_launchagent(destination)
    run_launchctl("bootout", f"gui/{os.getuid()}", str(destination)); print("STOPPED"); return 0

def command_uninstall(args: argparse.Namespace) -> int:
    destination = launchagent_path(); verify_owned_launchagent(destination)
    if not args.confirm: print("Not removed: pass --confirm after review."); return 0
    # bootout is harmless if the job is not currently loaded only on some macOS releases;
    # an error is not a reason to remove an unknown file, which is verified above.
    with contextlib.suppress(RunnerError): run_launchctl("bootout", f"gui/{os.getuid()}", str(destination))
    destination.unlink(); print("UNINSTALLED"); return 0

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ORG-002 Local Commander Runner")
    parser.add_argument("--config", required=True, help="owner-readable local JSON config")
    subs = parser.add_subparsers(dest="command", required=True)
    install = subs.add_parser("install"); install.add_argument("--confirm", action="store_true")
    subs.add_parser("doctor"); subs.add_parser("health"); subs.add_parser("status"); subs.add_parser("heartbeat")
    once = subs.add_parser("run-once"); once.add_argument("--dry-run", action="store_true")
    subs.add_parser("serve")
    subs.add_parser("start"); subs.add_parser("stop")
    uninstall = subs.add_parser("uninstall"); uninstall.add_argument("--confirm", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "install": return command_install(args)
        config = Config.load(Path(args.config))
        if args.command == "doctor": print(json.dumps(doctor(config), sort_keys=True)); return 0
        if args.command == "health": print(json.dumps(provider_health(config), sort_keys=True)); return 0
        if args.command == "status":
            state = State(config.state_dir); print(json.dumps(state.summary(), sort_keys=True)); state.close(); return 0
        if args.command == "heartbeat":
            state = State(config.state_dir); ok = state.acquire_lease(config.runner_id, config.lease_seconds); state.close(); print("LEASE_OK" if ok else "LEASE_HELD"); return 0 if ok else 2
        if args.command == "run-once": print(run_once(config, args.dry_run)); return 0
        if args.command == "serve":
            delay = config.poll_seconds
            while True:
                try:
                    run_once(config)
                    delay = config.poll_seconds
                except RunnerError as exc:
                    print(f"runner error: {exc}", file=sys.stderr)
                    delay = min(600, max(config.poll_seconds, delay * 2))
                time.sleep(delay)
        if args.command == "start": return command_start()
        if args.command == "stop": return command_stop()
        if args.command == "uninstall": return command_uninstall(args)
    except RunnerError as exc:
        print(f"error: {exc}", file=sys.stderr); return 2
    return 0

if __name__ == "__main__": raise SystemExit(main())
