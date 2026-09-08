#!/usr/bin/env python3
"""Fixed, read-only local rehearsal operations for ORG-003.

This module is not a general command runner.  It exposes one hard-coded probe
and accepts only the absolute Docker executable selected by owner-only config.
"""
from __future__ import annotations

import argparse
import json
import os
import selectors
import signal
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
    """A sanitized, expected guard failure."""


def _run(argv: Sequence[str]) -> str:
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
        raise ProbeError("docker_command_failed")
    return output.decode("utf-8", "replace").strip()


def _docker(docker: str, *arguments: str) -> str:
    allowed = {"ps", "inspect", "exec", "--version"}
    command = arguments[0] if arguments else ""
    if command not in allowed:
        raise ProbeError("mutation_command_rejected")
    return _run((docker, "--context", "default", *arguments))


def _inspect_json(docker: str, container_id: str, template: str) -> Any:
    raw = _docker(docker, "inspect", "--type", "container", "--format", template, container_id)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProbeError("invalid_container_metadata") from exc


def probe(docker: str) -> dict[str, Any]:
    ids = [line.strip() for line in _docker(
        docker, "ps", "--all",
        "--filter", f"label=com.docker.compose.project={PROJECT}",
        "--filter", f"label=com.docker.compose.service={SERVICE}",
        "--format", "{{.ID}}",
    ).splitlines() if line.strip()]
    if len(ids) != 1:
        raise ProbeError("container_identity_mismatch")
    container_id = ids[0]
    running = _inspect_json(docker, container_id, "{{json .State.Running}}")
    health = _inspect_json(docker, container_id, "{{json .State.Health.Status}}")
    project = _inspect_json(
        docker, container_id, '{{json (index .Config.Labels "com.docker.compose.project")}}')
    service = _inspect_json(
        docker, container_id, '{{json (index .Config.Labels "com.docker.compose.service")}}')
    image = _inspect_json(docker, container_id, "{{json .Config.Image}}")
    image_id = _inspect_json(docker, container_id, "{{json .Image}}")
    ports = _inspect_json(docker, container_id, "{{json .NetworkSettings.Ports}}")
    mounts = _inspect_json(docker, container_id, "{{json .Mounts}}")
    tmpfs = _inspect_json(docker, container_id, "{{json .HostConfig.Tmpfs}}")

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
    if (not isinstance(mounts, list) or len(mounts) != 1
            or not isinstance(mounts[0], dict)
            or mounts[0].get("Type") != "tmpfs"
            or mounts[0].get("Destination") != "/var/lib/mysql"
            or not isinstance(tmpfs, dict) or set(tmpfs) != {"/var/lib/mysql"}):
        raise ProbeError("container_storage_mismatch")
    if any(mount.get("Type") == "volume" for mount in mounts if isinstance(mount, dict)):
        raise ProbeError("container_storage_mismatch")

    sql = _docker(
        docker, "exec", "--env", "MYSQL_PWD=e2e", container_id,
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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ORG-003 fixed read-only rehearsal probe")
    parser.add_argument("--docker", required=True)
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
        result = probe(str(docker))
    except ProbeError as exc:
        result = {"status": "blocked", "summary": "OPS-001 probe blocked",
                  "evidence": [f"category={exc}"]}
    except OSError:
        result = {"status": "blocked", "summary": "OPS-001 probe blocked",
                  "evidence": ["category=local_runtime_unavailable"]}
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
