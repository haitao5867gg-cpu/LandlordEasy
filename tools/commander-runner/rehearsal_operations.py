#!/usr/bin/env python3
"""Fixed, read-only local rehearsal operations for ORG-003.

This module is not a general command runner.  It exposes one hard-coded probe
and accepts only the absolute Docker executable selected by owner-only config.
"""
from __future__ import annotations

import argparse
import json
import os
import pwd
import selectors
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Sequence

PROJECT = "landlordeasy_ops001"
SERVICE = "mysql"
IMAGE = "mysql:8.0"
IMAGE_ID = "sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b"
DATABASE = "landlord_easy_e2e"
TABLE_COUNT = 22
MYSQL_QUERY = (
    "SELECT VERSION(); SELECT DATABASE(); "
    "SELECT COUNT(*) FROM information_schema.tables "
    "WHERE table_schema=DATABASE() AND table_type='BASE TABLE' "
    "AND table_name <> '_prisma_migrations';"
)
COMMAND_TIMEOUT = 20
COMMAND_CAP = 131_072


class ProbeError(RuntimeError):
    """A sanitized, expected guard failure.

    Carries the evidence gathered before the failure.  Discarding it was the
    same mistake this control plane was built to stop: the run had already
    produced the facts needed to diagnose it.
    """

    def __init__(self, category: str, evidence: Sequence[str] | None = None):
        super().__init__(category)
        self.category = category
        self.evidence = list(evidence or [])


def _run(argv: Sequence[str], failure_category: str) -> str:
    """Execute a bounded direct argv and never expose raw child errors."""
    process = subprocess.Popen(
        list(argv), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=False,
    )
    started = time.monotonic()
    output = bytearray()
    selector = selectors.DefaultSelector()
    if process.stdout:
        selector.register(process.stdout, selectors.EVENT_READ)
    timed_out = overflow = False
    try:
        while selector.get_map():
            remaining = COMMAND_TIMEOUT - (time.monotonic() - started)
            if remaining <= 0:
                timed_out = True
                break
            for key, _ in selector.select(min(remaining, 0.2)):
                chunk = os.read(key.fd, 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                room = COMMAND_CAP - len(output)
                output.extend(chunk[:max(0, room)])
                if len(chunk) > room:
                    overflow = True
                    break
            if overflow:
                break
        if timed_out or overflow:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
    finally:
        selector.close()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            process.wait()
        if process.stdout:
            process.stdout.close()
    if timed_out:
        raise ProbeError("docker_command_timeout")
    if overflow:
        raise ProbeError("docker_output_overflow")
    if process.returncode:
        raise ProbeError(failure_category)
    return output.decode("utf-8", "replace").strip()


def trusted_local_docker_host() -> str:
    """Return only the current POSIX user's verified local Docker Unix socket."""
    try:
        record = pwd.getpwuid(os.getuid())
        raw_home = record.pw_dir
        if not isinstance(raw_home, str) or not raw_home or "\x00" in raw_home:
            raise ProbeError("docker_socket_invalid")
        home = Path(raw_home)
        if not home.is_absolute():
            raise ProbeError("docker_socket_invalid")
        trusted_home = home.resolve(strict=True)
        docker_dir = trusted_home / ".docker"
        run_dir = docker_dir / "run"
        for directory in (docker_dir, run_dir):
            directory_metadata = os.lstat(directory)
            if (stat.S_ISLNK(directory_metadata.st_mode)
                    or not stat.S_ISDIR(directory_metadata.st_mode)
                    or directory_metadata.st_uid != os.geteuid()
                    or directory_metadata.st_mode & 0o022):
                raise ProbeError("docker_socket_invalid")
        socket_path = run_dir / "docker.sock"
        metadata = os.lstat(socket_path)
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISSOCK(metadata.st_mode):
            raise ProbeError("docker_socket_invalid")
        if metadata.st_uid != os.geteuid():
            raise ProbeError("docker_socket_invalid")
        resolved_socket = socket_path.resolve(strict=True)
        if not resolved_socket.is_relative_to(trusted_home):
            raise ProbeError("docker_socket_invalid")
    except (AttributeError, KeyError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise ProbeError("docker_socket_invalid") from exc
    return "unix://" + str(resolved_socket)


def _docker(docker: str, host: str, *arguments: str) -> str:
    allowed = {"version", "ps", "inspect", "exec"}
    command = arguments[0] if arguments else ""
    if command not in allowed:
        raise ProbeError("mutation_command_rejected")
    categories = {
        "version": "docker_version_failed",
        "ps": "docker_ps_failed",
        "inspect": "docker_inspect_failed",
        "exec": "docker_exec_failed",
    }
    return _run((docker, "--host", host, *arguments), categories[command])


def _inspect_json(docker: str, host: str, container_id: str, template: str) -> Any:
    raw = _docker(
        docker, host, "inspect", "--type", "container", "--format", template, container_id)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProbeError("invalid_container_metadata") from exc


def probe(docker: str) -> dict[str, Any]:
    host = trusted_local_docker_host()
    _docker(docker, host, "version", "--format", "{{.Server.Version}}")
    ids = [line.strip() for line in _docker(
        docker, host, "ps", "--all",
        "--filter", f"label=com.docker.compose.project={PROJECT}",
        "--filter", f"label=com.docker.compose.service={SERVICE}",
        "--format", "{{.ID}}",
    ).splitlines() if line.strip()]
    if len(ids) != 1:
        raise ProbeError("container_identity_mismatch")
    container_id = ids[0]
    running = _inspect_json(docker, host, container_id, "{{json .State.Running}}")
    health = _inspect_json(docker, host, container_id, "{{json .State.Health.Status}}")
    project = _inspect_json(
        docker, host, container_id,
        '{{json (index .Config.Labels "com.docker.compose.project")}}')
    service = _inspect_json(
        docker, host, container_id,
        '{{json (index .Config.Labels "com.docker.compose.service")}}')
    image = _inspect_json(docker, host, container_id, "{{json .Config.Image}}")
    image_id = _inspect_json(docker, host, container_id, "{{json .Image}}")
    ports = _inspect_json(docker, host, container_id, "{{json .NetworkSettings.Ports}}")
    mounts = _inspect_json(docker, host, container_id, "{{json .Mounts}}")
    tmpfs = _inspect_json(docker, host, container_id, "{{json .HostConfig.Tmpfs}}")

    if project != PROJECT or service != SERVICE:
        raise ProbeError("container_identity_mismatch")
    if running is not True or health != "healthy":
        raise ProbeError("container_health_mismatch")
    if image != IMAGE or image_id != IMAGE_ID:
        raise ProbeError("container_image_mismatch")
    expected_binding = [{"HostIp": "127.0.0.1", "HostPort": "33317"}]
    if not isinstance(ports, dict) or ports.get("3306/tcp") != expected_binding:
        raise ProbeError("container_binding_mismatch")
    if any(value not in (None, []) for key, value in ports.items() if key != "3306/tcp"):
        raise ProbeError("container_binding_mismatch")
    exact_tmpfs_mount = (
        len(mounts) == 1 and isinstance(mounts[0], dict)
        and mounts[0].get("Type") == "tmpfs"
        and mounts[0].get("Destination") == "/var/lib/mysql"
    ) if isinstance(mounts, list) else False
    if (not isinstance(mounts, list) or (mounts and not exact_tmpfs_mount)
            or not isinstance(tmpfs, dict) or set(tmpfs) != {"/var/lib/mysql"}):
        raise ProbeError("container_storage_mismatch")
    if any(mount.get("Type") in {"bind", "volume"}
           for mount in mounts if isinstance(mount, dict)):
        raise ProbeError("container_storage_mismatch")

    sql = _docker(
        docker, host, "exec", "--env", "MYSQL_PWD=e2e", container_id,
        "mysql", "--batch", "--skip-column-names", "--user=e2e", "--database=" + DATABASE,
        "--execute", MYSQL_QUERY,
    )
    lines = [line.strip() for line in sql.splitlines() if line.strip()]
    if len(lines) != 3:
        raise ProbeError("database_evidence_mismatch")
    version, database, table_count = lines
    if not version.startswith("8."):
        raise ProbeError("database_version_mismatch")
    if database != DATABASE:
        raise ProbeError("database_name_mismatch")
    try:
        count = int(table_count)
    except ValueError as exc:
        raise ProbeError("database_table_count_mismatch") from exc
    if count != TABLE_COUNT:
        raise ProbeError("database_table_count_mismatch")
    return {
        "status": "ok",
        "summary": "OPS-001 isolated MySQL probe passed",
        "evidence": [
            "container_identity=exact",
            "container_health=healthy",
            "image_identity=exact",
            "loopback_binding=exact",
            "storage=tmpfs_zero_volumes",
            "mysql_major=8",
            "database=expected_synthetic",
            f"application_tables={count}",
        ],
    }


# --------------------------------------------------------------------------
# REL-001 isolated real-MySQL suite (mode: rel001_suite)

COMPOSE_PROJECT = PROJECT
COMPOSE_FILE = "e2e/docker-compose.yml"
REQUIRED_PORT = "33317"
REQUIRED_HOST = "127.0.0.1"
CONTAINER_NAME = f"/{PROJECT}-{SERVICE}-1"
SUITE_TIMEOUT = 1_800
INSTALL_TIMEOUT = 900
STARTUP_ATTEMPTS = 3
HEALTH_DEADLINE = 180


def _sh(argv: Sequence[str], cwd: Path, env: dict[str, str], timeout: int) -> tuple[int, str]:
    """Bounded execution used only by the suite mode, which needs longer waits."""
    process = subprocess.Popen(
        list(argv), cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        start_new_session=True)
    # Bounded read: keep only the tail as it streams, so a runaway pnpm or
    # prisma cannot make the helper buffer gigabytes before the cap applies.
    tail = ""
    started = time.monotonic()
    assert process.stdout is not None
    try:
        while True:
            if time.monotonic() - started > timeout:
                raise subprocess.TimeoutExpired(argv, timeout)
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            tail = (tail + chunk)[-COMMAND_CAP:]
        process.wait(timeout=max(1, int(timeout - (time.monotonic() - started))))
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        return 124, tail
    return process.returncode, tail


def _suite_env(docker: str, sha: str) -> dict[str, str]:
    """Minimal environment. No production value can reach the child."""
    base = {
        "HOME": os.environ.get("HOME", ""),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "en_US.UTF-8",
        "CI": "true",
        "NODE_ENV": "test",
        "TZ": "UTC",
        "E2E_MYSQL_PORT": REQUIRED_PORT,
        "E2E_MYSQL_IMAGE": IMAGE,
        "COMPOSE_PROJECT_NAME": COMPOSE_PROJECT,
        "REL001_MYSQL_INTEGRATION": "1",
        "REL001_MYSQL_INTEGRATION_CANDIDATE_SHA": sha,
        "REL001_DOCKER_EXECUTABLE": docker,
        # Loopback-only, synthetic, disposable. Never a shared or production DB.
        "DATABASE_URL": f"mysql://e2e:e2e@{REQUIRED_HOST}:{REQUIRED_PORT}/{DATABASE}",
    }
    return {key: value for key, value in base.items() if value}


TABLE_NAME_RE = __import__("re").compile(r"^[A-Za-z0-9_]{1,64}$")


def _mysql_lines(docker: str, host: str, query: str) -> list[str]:
    """Rows from a batch mysql query, with client warnings stripped.

    The client prints "[Warning] Using a password on the command line ..." to
    the same stream as results; treating that as data made a table-name check
    reject a perfectly good database.
    """
    out = _docker(docker, host, "exec", f"{PROJECT}-{SERVICE}-1", "mysql",
                  "-N", "-B", "-ue2e", "-pe2e", DATABASE, "-e", query)
    lines = []
    for line in out.splitlines():
        text = line.strip()
        if not text or text.startswith("mysql:") or "[Warning]" in text:
            continue
        lines.append(text)
    return lines


def _mysql_scalar(docker: str, host: str, query: str) -> str:
    lines = _mysql_lines(docker, host, query)
    return lines[-1] if lines else ""


def _total_rows(docker: str, host: str) -> tuple[int, int]:
    """Sum of rows across every application table. Must be 0 before and after."""
    # information_schema row estimates are unreliable; count each table exactly.
    tables = _mysql_lines(
        docker, host,
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema=DATABASE() AND table_type='BASE TABLE' "
        "AND table_name <> '_prisma_migrations'")
    total = 0
    for name in tables:
        if not TABLE_NAME_RE.fullmatch(name):
            raise ProbeError("unexpected_table_name")
        value = _mysql_scalar(docker, host, f"SELECT COUNT(*) FROM `{name}`")
        total += int(value or 0)
    return total, len(tables)


def run_rel001_suite(docker: str, pnpm: str, repo: Path, sha: str) -> dict[str, Any]:
    """Bring up an isolated MySQL, run the REL-001 suite, tear it down.

    Every boundary the guard requires is asserted independently here as well:
    loopback-only binding, tmpfs storage, zero project volumes, the exact
    compose project, and a database that is empty both before fixtures and
    after cleanup. Transient startup problems get a bounded retry; anything
    that looks like a boundary violation stops immediately.
    """
    host = trusted_local_docker_host()
    env = _suite_env(docker, sha)
    evidence: list[str] = [f"candidate_sha={sha}", f"compose_project={COMPOSE_PROJECT}",
                           f"bind={REQUIRED_HOST}:{REQUIRED_PORT}"]
    compose = [docker, "compose", "-p", COMPOSE_PROJECT, "-f", str(repo / COMPOSE_FILE)]

    started = False
    try:
        # The runner hands us a FRESH worktree: no node_modules.  The first live
        # dispatch (2026-09-10) skipped this and reported `pnpm exec prisma`
        # failing as schema_push_failed -- a code failure that was really a
        # missing dependency tree.  Install from the lockfile, store-first.
        code, out = _sh([pnpm, "install", "--frozen-lockfile", "--prefer-offline"],
                        repo, env, INSTALL_TIMEOUT)
        if code != 0:
            raise ProbeError("dependency_install_failed", evidence)
        evidence.append("dependencies=installed")
        # The suite imports @prisma/client; in a fresh tree the client is not
        # generated, and every spec then fails at load with 0 tests -- which
        # `db push --skip-generate` below deliberately does not fix.
        code, out = _sh([pnpm, "--filter", "server", "exec", "prisma", "generate"],
                        repo, env, INSTALL_TIMEOUT)
        if code != 0:
            raise ProbeError("prisma_generate_failed", evidence)
        evidence.append("prisma_client=generated")

        # Always start from nothing.  An unattended operation must not inherit
        # a container left behind by an earlier run, whose database would no
        # longer be empty.
        _sh([*compose, "down", "-v", "--remove-orphans"], repo, env, 180)
        for attempt in range(1, STARTUP_ATTEMPTS + 1):
            code, out = _sh([*compose, "up", "-d", "--wait", "--wait-timeout",
                             str(HEALTH_DEADLINE)], repo, env, HEALTH_DEADLINE + 60)
            if code == 0:
                started = True
                evidence.append(f"startup_attempts={attempt}")
                break
            # Only startup/health problems are retried; the container is torn
            # down between tries so no partial state carries over.
            _sh([*compose, "down", "-v", "--remove-orphans"], repo, env, 120)
            if attempt == STARTUP_ATTEMPTS:
                raise ProbeError("mysql_startup_failed")
            time.sleep(5 * attempt)
        if not started:
            raise ProbeError("mysql_startup_failed")

        # Schema first: the boundary probe asserts the exact application table
        # count, which only holds once the schema has been applied.
        code, out = _sh([pnpm, "--filter", "server", "exec", "prisma", "db", "push",
                         "--skip-generate", "--accept-data-loss"], repo, env, 600)
        if code != 0:
            raise ProbeError("schema_push_failed", evidence)
        evidence.append("schema=applied")

        boundary = probe(docker)
        if boundary.get("status") != "ok":
            raise ProbeError("isolation_boundary_rejected", evidence)
        evidence.append("isolation_boundary=verified")
        evidence.extend(str(item) for item in boundary.get("evidence", [])[:6])

        before, table_count = _total_rows(docker, host)
        evidence.append(f"tables={table_count}")
        evidence.append(f"rows_before={before}")
        if before != 0:
            raise ProbeError("database_not_empty_before", evidence)

        code, out = _sh([pnpm, "--filter", "server", "run", "test:mysql-integration"],
                        repo, env, SUITE_TIMEOUT)
        summary_line = ""
        failures: list[str] = []
        for line in out.splitlines():
            text = line.strip()
            if text.startswith("Tests:") or text.startswith("Test Suites:"):
                summary_line += text + "; "
            elif text.startswith("●") and "›" in text and len(failures) < 8:
                failures.append(text[:200])
        evidence.append(f"jest={summary_line.strip() or 'no summary line'}")
        evidence.extend(f"failed={item}" for item in failures)
        suite_ok = code == 0

        after, _ = _total_rows(docker, host)
        evidence.append(f"rows_after={after}")
        if after != 0:
            raise ProbeError("database_not_empty_after", evidence)

        return {
            "status": "ok" if suite_ok else "blocked",
            "summary": ("REL-001 isolated MySQL suite passed"
                        if suite_ok else "REL-001 isolated MySQL suite failed"),
            "evidence": evidence + [f"exit={code}"],
        }
    finally:
        if started:
            _sh([*compose, "down", "-v", "--remove-orphans"], repo, env, 180)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ORG-003 fixed local rehearsal operations")
    parser.add_argument("--docker", required=True)
    parser.add_argument("--mode", default="probe", choices=("probe", "rel001_suite"))
    parser.add_argument("--pnpm")
    parser.add_argument("--candidate-sha")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    docker = Path(args.docker)
    if not docker.is_absolute() or docker.name != "docker" or not docker.is_file() \
            or not os.access(docker, os.X_OK):
        print(json.dumps({"status": "blocked", "summary": "Probe prerequisite unavailable",
                          "evidence": ["category=docker_executable_invalid"]}, sort_keys=True))
        return 2
    if args.self_check:
        print("OPS001_PROBE_INTERFACE_OK")
        return 0
    try:
        if args.mode == "rel001_suite":
            pnpm = Path(args.pnpm) if args.pnpm else None
            if pnpm is None or not pnpm.is_absolute() or not pnpm.is_file() \
                    or not os.access(pnpm, os.X_OK):
                raise ProbeError("pnpm_executable_invalid")
            sha = (args.candidate_sha or "").strip()
            if len(sha) != 40 or any(ch not in "0123456789abcdef" for ch in sha):
                raise ProbeError("candidate_sha_invalid")
            result = run_rel001_suite(str(docker), str(pnpm), Path.cwd(), sha)
        else:
            result = probe(str(docker))
    except ProbeError as exc:
        result = {"status": "blocked", "summary": "OPS-001 operation blocked",
                  "evidence": [f"category={exc.category}", *getattr(exc, "evidence", [])]}
    except OSError:
        result = {"status": "blocked", "summary": "OPS-001 operation blocked",
                  "evidence": ["category=local_runtime_unavailable"]}
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
