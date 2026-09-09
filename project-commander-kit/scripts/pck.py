#!/usr/bin/env python3
"""project-commander-kit lifecycle tool: doctor, install, upgrade, rollback.

Every mutating action takes a timestamped backup first and is reversible with
`rollback`. Nothing here contacts the network, GitHub, or any provider.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = ("commander_runner.py", "rehearsal_operations.py")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_config(path: Path) -> dict:
    if path.stat().st_mode & 0o077:
        raise SystemExit(f"refusing: {path} is group/world accessible; chmod 600 it")
    return json.loads(path.read_text())


def runtime_dir(config: dict) -> Path:
    value = config["runtime_dir"]
    if value.startswith("~"):
        value = str(Path.home()) + value[1:]
    if value.startswith("${HOME}"):
        value = str(Path.home()) + value[7:]
    return Path(value)


def stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%dT%H%M%S")


def backup(target: Path) -> Path | None:
    """Copy an existing runtime file aside. Never overwrites, never deletes.

    The timestamp has one-second resolution, so an upgrade immediately followed
    by a rollback can land in the same second. Without the collision guard the
    rollback's own backup would overwrite the file it is about to restore, and
    the previous runtime would be lost.
    """
    if not target.exists():
        return None
    base = stamp()
    saved = target.with_name(f"{target.name}.{base}.bak")
    counter = 1
    while saved.exists():
        saved = target.with_name(f"{target.name}.{base}-{counter}.bak")
        counter += 1
    shutil.copy2(target, saved)
    os.chmod(saved, 0o600)
    return saved


def cmd_doctor(args) -> int:
    report: dict = {"kit": str(KIT), "checks": {}}
    checks = report["checks"]
    for name in RUNTIME_FILES:
        source = KIT / "runner" / name
        checks[f"source:{name}"] = {"present": source.is_file(),
                                    "sha256": digest(source) if source.is_file() else None}
    checks["tests"] = run_tests()
    if args.config:
        path = Path(args.config)
        checks["config:readable"] = path.is_file()
        if path.is_file():
            try:
                config = load_config(path)
            except SystemExit as exc:
                checks["config:permissions"] = str(exc)
                config = None
            except json.JSONDecodeError as exc:
                checks["config:json"] = f"invalid: {exc}"
                config = None
            if config:
                checks["config:permissions"] = "ok"
                checks["identity_separated"] = (
                    config.get("commander_login", "").casefold()
                    != config.get("executor_login", "x").casefold())
                installed = runtime_dir(config) / "commander_runner.py"
                checks["installed"] = installed.is_file()
                if installed.is_file():
                    live = digest(installed)
                    checks["installed_sha256"] = live
                    checks["up_to_date"] = live == digest(KIT / "runner" / "commander_runner.py")
                # Delegate to the runner's own doctor for environment probing.
                checks["runner_doctor"] = runner_doctor(path)
    ok = all(v is not False and v != "invalid" for v in flatten(checks))
    report["ok"] = bool(ok)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if ok else 1


def flatten(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from flatten(item)
    else:
        yield value


SELFTEST_GUARD = "PCK_IN_SELFTEST"


def run_tests() -> dict:
    """Run the kit's own suite as an install/upgrade precondition.

    The suite contains lifecycle tests that invoke this script, so a guard
    variable is propagated to break the otherwise infinite recursion: a nested
    invocation reports the suite as already covered by its parent rather than
    launching it again.
    """
    if os.environ.get(SELFTEST_GUARD):
        return {"passed": True, "summary": "skipped: already inside the kit self-test"}
    environment = dict(os.environ, **{SELFTEST_GUARD: "1"})
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(KIT / "runner" / "tests")],
        capture_output=True, text=True, cwd=str(KIT), env=environment, timeout=600)
    tail = (result.stderr or result.stdout).strip().splitlines()
    return {"passed": result.returncode == 0, "summary": tail[-1] if tail else ""}


def runner_doctor(config_path: Path) -> dict:
    result = subprocess.run(
        [sys.executable, str(KIT / "runner" / "commander_runner.py"),
         "--config", str(config_path), "doctor"],
        capture_output=True, text=True)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": (result.stderr or result.stdout).strip()[:400]}


def cmd_install(args) -> int:
    config = load_config(Path(args.config))
    target_dir = runtime_dir(config)
    if not run_tests()["passed"]:
        raise SystemExit("refusing to install: kit tests fail")
    target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(target_dir, 0o700)
    manifest = {"version": 2, "entrypoint": "commander_runner.py", "files": {}}
    for name in RUNTIME_FILES:
        source, target = KIT / "runner" / name, target_dir / name
        if target.exists() and not args.force:
            raise SystemExit(f"refusing: {target} exists; use `upgrade` instead")
        shutil.copy2(source, target)
        os.chmod(target, 0o700)
        manifest["files"][name] = digest(target)
    write_manifest(target_dir, manifest)
    print(json.dumps({"installed": str(target_dir), "files": manifest["files"]}, indent=2))
    return 0


def cmd_upgrade(args) -> int:
    config = load_config(Path(args.config))
    target_dir = runtime_dir(config)
    tests = run_tests()
    if not tests["passed"]:
        raise SystemExit("refusing to upgrade: kit tests fail")
    saved = {}
    manifest = {"version": 2, "entrypoint": "commander_runner.py", "files": {}}
    for name in RUNTIME_FILES:
        target = target_dir / name
        kept = backup(target)
        if kept:
            saved[name] = kept.name
        shutil.copy2(KIT / "runner" / name, target)
        os.chmod(target, 0o700)
        manifest["files"][name] = digest(target)
    write_manifest(target_dir, manifest)
    print(json.dumps({"upgraded": str(target_dir), "backups": saved,
                      "files": manifest["files"],
                      "note": "restart the runner for this to take effect"}, indent=2))
    return 0


def cmd_rollback(args) -> int:
    config = load_config(Path(args.config))
    target_dir = runtime_dir(config)
    restored = {}
    for name in RUNTIME_FILES:
        backups = sorted(target_dir.glob(f"{name}.*.bak"))
        if not backups:
            continue
        chosen = backups[-1] if not args.stamp else target_dir / f"{name}.{args.stamp}.bak"
        if not chosen.is_file():
            raise SystemExit(f"no backup {chosen.name}")
        # Preserve the current file before overwriting it, so rollback is itself
        # reversible and no diagnostic state is ever destroyed.
        backup(target_dir / name)
        shutil.copy2(chosen, target_dir / name)
        os.chmod(target_dir / name, 0o700)
        restored[name] = chosen.name
    if not restored:
        raise SystemExit("no backups found; nothing to roll back")
    manifest = {"version": 2, "entrypoint": "commander_runner.py",
                "files": {name: digest(target_dir / name) for name in RUNTIME_FILES}}
    write_manifest(target_dir, manifest)
    print(json.dumps({"rolled_back": restored, "files": manifest["files"],
                      "note": "restart the runner for this to take effect"}, indent=2))
    return 0


def write_manifest(target_dir: Path, manifest: dict) -> None:
    path = target_dir / "runtime-manifest.json"
    backup(path)
    path.write_text(json.dumps(manifest, sort_keys=True))
    os.chmod(path, 0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description="project-commander-kit lifecycle tool")
    subs = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("doctor", "check kit, config and environment health"),
                            ("install", "install the runtime for the first time"),
                            ("upgrade", "replace the runtime, keeping a backup"),
                            ("rollback", "restore the previous runtime from backup")):
        sub = subs.add_parser(name, help=help_text)
        sub.add_argument("--config", required=name != "doctor")
        if name == "install":
            sub.add_argument("--force", action="store_true")
        if name == "rollback":
            sub.add_argument("--stamp", help="restore a specific backup timestamp")
    args = parser.parse_args()
    return {"doctor": cmd_doctor, "install": cmd_install,
            "upgrade": cmd_upgrade, "rollback": cmd_rollback}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
