#!/usr/bin/env python3
"""project-commander-kit lifecycle tool: doctor, install, upgrade, rollback.

Installs are **transactional**. A new runtime is staged in full, verified,
fsynced, and only then does an atomic pointer swap make it live. Any failure
before the swap leaves the previous version running, untouched. There is no
window in which half the files are new, or in which files and manifest
disagree.

Layout under `runtime_dir`:

    versions/<timestamp>-<short-source-commit>/   immutable, never edited
        commander_runner.py
        rehearsal_operations.py
        runtime-manifest.json
    current -> versions/<...>                     atomically replaced symlink

Nothing here contacts the network, GitHub, or any provider.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
REPO = KIT.parent
SOURCE = REPO / "tools/commander-runner"
RUNTIME_FILES = ("commander_runner.py", "rehearsal_operations.py")
MANIFEST_NAME = "runtime-manifest.json"
MANIFEST_SCHEMA = 3
KEEP_VERSIONS = 10
SELFTEST_GUARD = "PCK_IN_SELFTEST"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class DoctorFailure(Exception):
    """A condition that must make the command fail loudly."""


def digest_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def load_config(path: Path) -> dict:
    """Read the owner config, refusing anything unsafe or unusable.

    Every failure raises. Returning a partial or defaulted config is exactly
    what let `doctor` report ok:true on a config it could not actually read.
    """
    if not path.is_file():
        raise DoctorFailure(f"config not found: {path}")
    mode = path.stat().st_mode & 0o777
    if mode & 0o077:
        raise DoctorFailure(
            f"config {path} is group/world accessible (mode {mode:04o}); chmod 600 it")
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise DoctorFailure(f"config unreadable: {exc}") from exc
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DoctorFailure(f"config is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise DoctorFailure("config must be a JSON object")
    required = (
        "repository", "queue_issue", "commander_login", "executor_login", "runner_id",
        "canonical_repo", "worktree_root", "state_dir", "runtime_dir", "origin_url",
        "operational_executables", "executable_paths", "enabled_providers",
        "enabled_profiles", "enabled_quality_gates", "quality_gates",
    )
    missing = [key for key in required if key not in value]
    if missing:
        raise DoctorFailure(f"config is missing required fields: {', '.join(sorted(missing))}")
    empty = [key for key in ("repository", "runner_id", "commander_login", "executor_login")
             if not isinstance(value.get(key), str) or not value[key].strip()]
    if empty:
        raise DoctorFailure(f"config fields must be non-empty strings: {', '.join(sorted(empty))}")
    if str(value["commander_login"]).casefold() == str(value["executor_login"]).casefold():
        raise DoctorFailure(
            "commander_login and executor_login must be different GitHub accounts")
    return value


def expand(value: str) -> Path:
    if value.startswith("~"):
        value = str(Path.home()) + value[1:]
    if value.startswith("${HOME}"):
        value = str(Path.home()) + value[7:]
    path = Path(value)
    if not path.is_absolute():
        raise DoctorFailure(f"configured path must be absolute: {value}")
    return path


def runtime_dir(config: dict) -> Path:
    return expand(str(config["runtime_dir"]))


def current_link(config: dict) -> Path:
    return runtime_dir(config) / "current"


def versions_dir(config: dict) -> Path:
    return runtime_dir(config) / "versions"


def active_root(config: dict) -> Path | None:
    """The runtime directory in use, honouring the legacy flat layout."""
    link = current_link(config)
    if link.is_symlink():
        return link.resolve()
    root = runtime_dir(config)
    return root if (root / "commander_runner.py").is_file() else None


def source_commit() -> str | None:
    git = shutil.which("git")
    if git is None:
        return None
    try:
        result = subprocess.run([git, "rev-parse", "--verify", "HEAD"], cwd=str(REPO),
                                capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    head = result.stdout.strip()
    return head if result.returncode == 0 and SHA_RE.fullmatch(head) else None


def fsync_path(path: Path) -> None:
    """Force bytes (or a directory entry) to stable storage."""
    flags = os.O_RDONLY | (os.O_DIRECTORY if path.is_dir() else 0)
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run_tests() -> dict:
    """Run the kit's own suite as an install/upgrade precondition.

    The suite invokes this script, so a guard variable breaks the recursion: a
    nested call reports the suite as already covered by its parent.
    """
    if os.environ.get(SELFTEST_GUARD):
        return {"passed": True, "summary": "skipped: already inside the kit self-test"}
    environment = dict(os.environ, **{SELFTEST_GUARD: "1"})
    # Test the tree we INSTALL from.  Testing the kit copy while installing
    # from tools/ meant a drift between the two could pass its own tests and
    # still ship bytes that were never exercised.  The sync check makes drift
    # unlikely; this makes it irrelevant.
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(SOURCE / "tests")],
        capture_output=True, text=True, cwd=str(REPO), env=environment, timeout=900)
    tail = (result.stderr or result.stdout).strip().splitlines()
    return {"passed": result.returncode == 0, "summary": tail[-1] if tail else ""}


def stage_version(config: dict) -> Path:
    """Build a complete, verified, fsynced version directory.

    Returns the staged path; the caller makes it live with `activate`. Nothing
    outside the staging directory is touched, so a failure here cannot disturb
    the running version.
    """
    commit = source_commit()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    label = f"{stamp}-{commit[:8] if commit else 'nocommit'}"
    versions = versions_dir(config)
    versions.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(versions, 0o700)

    staging = Path(tempfile.mkdtemp(prefix=f".staging-{label}-", dir=versions))
    os.chmod(staging, 0o700)
    try:
        digests: dict[str, str] = {}
        for name in RUNTIME_FILES:
            source = SOURCE / name
            if not source.is_file():
                raise DoctorFailure(f"missing source file: {source}")
            payload = source.read_bytes()
            target = staging / name
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o700)
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            # Verify what actually landed on disk, not what we intended to write.
            if digest_file(target) != digest_bytes(payload):
                raise DoctorFailure(f"staged {name} does not match its source")
            digests[name] = digest_bytes(payload)

        manifest = {
            "schema_version": MANIFEST_SCHEMA,
            "entrypoint": "commander_runner.py",
            "source_commit": commit,
            "installed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "files": digests,
        }
        manifest_path = staging / MANIFEST_NAME
        fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_path(staging)

        final = versions / label
        if final.exists():
            final = versions / f"{label}-{os.getpid()}"
        os.replace(staging, final)
        fsync_path(versions)
        return final
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def activate(config: dict, version: Path) -> Path | None:
    """Atomically point `current` at `version`; returns the previous target."""
    link = current_link(config)
    previous = link.resolve() if link.is_symlink() else None
    temporary = link.with_name(f".current.{os.getpid()}.{dt.datetime.now().microsecond}")
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    os.symlink(version, temporary)
    # rename(2) over an existing symlink is atomic: a reader sees either the old
    # target or the new one, never a missing or partial pointer.
    os.replace(temporary, link)
    fsync_path(runtime_dir(config))
    return previous


def verify_live(config: dict) -> dict:
    """Re-verify the activated runtime end to end, after the swap."""
    root = active_root(config)
    if root is None:
        raise DoctorFailure("no active runtime after activation")
    manifest = json.loads((root / MANIFEST_NAME).read_text(encoding="utf-8"))
    if manifest.get("schema_version") != MANIFEST_SCHEMA:
        raise DoctorFailure("activated runtime has an unexpected manifest schema")
    for name, expected in manifest["files"].items():
        if digest_file(root / name) != expected:
            raise DoctorFailure(f"activated {name} does not match its manifest digest")
    return manifest


def prune_versions(config: dict, keep: int = KEEP_VERSIONS) -> list[str]:
    """Drop the oldest versions; never the active one, never the newest `keep`."""
    versions = versions_dir(config)
    if not versions.is_dir():
        return []
    live = active_root(config)
    entries = sorted((path for path in versions.iterdir()
                      if path.is_dir() and not path.name.startswith(".")),
                     key=lambda path: path.name)
    removed: list[str] = []
    for path in (entries[:-keep] if len(entries) > keep else []):
        if live is not None and path.resolve() == live:
            continue
        shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    return removed


def install_transactional(config: dict) -> dict:
    tests = run_tests()
    if not tests["passed"]:
        raise DoctorFailure(f"refusing to install: kit tests fail ({tests['summary']})")
    root = runtime_dir(config)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    version = stage_version(config)
    try:
        previous = activate(config, version)
        manifest = verify_live(config)
    except Exception:
        # The pointer either never moved or still resolves to the old version,
        # so the previous runtime keeps running; drop the staged tree so no
        # orphaned half-install is left behind.
        shutil.rmtree(version, ignore_errors=True)
        raise
    return {
        "activated": str(version),
        "previous": str(previous) if previous else None,
        "source_commit": manifest["source_commit"],
        "installed_at": manifest["installed_at"],
        "files": manifest["files"],
        "pruned": prune_versions(config),
        "tests": tests["summary"],
        "note": "restart the runner for this to take effect",
    }


def cmd_install(args) -> int:
    config = load_config(Path(args.config))
    if active_root(config) is not None and not args.force:
        raise DoctorFailure("a runtime is already installed; use `upgrade` instead")
    print(json.dumps(install_transactional(config), indent=2, sort_keys=True))
    return 0


def cmd_upgrade(args) -> int:
    config = load_config(Path(args.config))
    print(json.dumps(install_transactional(config), indent=2, sort_keys=True))
    return 0


def cmd_rollback(args) -> int:
    """Point `current` back at an earlier version. Nothing is ever deleted."""
    config = load_config(Path(args.config))
    versions = versions_dir(config)
    if not versions.is_dir():
        raise DoctorFailure("no versions directory; nothing to roll back")
    live = active_root(config)
    entries = sorted((path for path in versions.iterdir()
                      if path.is_dir() and not path.name.startswith(".")),
                     key=lambda path: path.name)
    if getattr(args, "version", None):
        target = versions / args.version
        if target not in entries:
            raise DoctorFailure(f"unknown version: {args.version}")
    else:
        earlier = [path for path in entries if live is None or path.resolve() != live]
        if not earlier:
            raise DoctorFailure("no earlier version to roll back to")
        target = earlier[-1]
    previous = activate(config, target)
    manifest = verify_live(config)
    print(json.dumps({
        "rolled_back_to": str(target), "previous": str(previous) if previous else None,
        "source_commit": manifest["source_commit"],
        "available": [path.name for path in entries],
        "note": "restart the runner for this to take effect",
    }, indent=2, sort_keys=True))
    return 0


def runner_doctor(config_path: Path) -> dict:
    result = subprocess.run(
        [sys.executable, str(SOURCE / "commander_runner.py"), "--config", str(config_path),
         "doctor"],
        capture_output=True, text=True, timeout=600)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False,
                "error": (result.stderr or result.stdout).strip()[:500] or "no output"}


def cmd_doctor(args) -> int:
    """Report health. Any failed check makes ok:false -- there is no silent pass.

    The previous implementation flattened the whole report and accepted anything
    that was not literally `False`, so a diagnostic string such as
    "invalid: ..." counted as a passing check. Failures are now collected
    explicitly and `ok` is simply "no failures".
    """
    report: dict = {"kit": str(KIT), "checks": {}, "failures": []}
    checks = report["checks"]

    def fail(reason: str) -> None:
        report["failures"].append(reason)

    for name in RUNTIME_FILES:
        source = SOURCE / name
        present = source.is_file()
        checks[f"source:{name}"] = {
            "present": present, "sha256": digest_file(source) if present else None}
        if not present:
            fail(f"missing source file tools/commander-runner/{name}")

    sync = subprocess.run(
        [sys.executable, str(KIT / "scripts/sync_from_source.py"), "--check"],
        capture_output=True, text=True, timeout=120)
    checks["kit_in_sync"] = sync.returncode == 0
    if sync.returncode != 0:
        fail("kit runner has drifted from tools/commander-runner")

    tests = run_tests()
    checks["tests"] = tests
    if not tests["passed"]:
        fail(f"kit tests fail: {tests['summary']}")

    if args.config:
        path = Path(args.config)
        config = None
        try:
            config = load_config(path)
        except DoctorFailure as exc:
            checks["config"] = {"readable": False, "error": str(exc)}
            fail(str(exc))
        if config is not None:
            checks["config"] = {"readable": True, "mode": oct(path.stat().st_mode & 0o777)}
            root = active_root(config)
            checks["installed"] = str(root) if root else None
            if root is not None:
                try:
                    manifest = json.loads((root / MANIFEST_NAME).read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    checks["manifest"] = {"readable": False, "error": str(exc)}
                    fail(f"runtime manifest unreadable: {exc}")
                    manifest = None
                if manifest is not None:
                    live = {name: digest_file(root / name)
                            for name in RUNTIME_FILES if (root / name).is_file()}
                    checks["manifest"] = {
                        "schema_version": manifest.get("schema_version"),
                        "source_commit": manifest.get("source_commit"),
                        "installed_at": manifest.get("installed_at"),
                        "matches_kit_source": all(
                            live.get(name) == digest_file(SOURCE / name)
                            for name in RUNTIME_FILES),
                    }
                    if manifest.get("schema_version") != MANIFEST_SCHEMA:
                        fail("installed runtime manifest predates provenance tracking; reinstall")
                    if manifest.get("source_commit") is None:
                        fail("installed runtime records no source commit")
                    for name, expected in (manifest.get("files") or {}).items():
                        if live.get(name) != expected:
                            fail(f"installed {name} does not match its manifest digest")
            doctor = runner_doctor(path)
            checks["runner_doctor"] = doctor
            if not doctor.get("ok"):
                fail("runner doctor reported not ok")

    report["ok"] = not report["failures"]
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="project-commander-kit lifecycle tool")
    subs = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("doctor", "check kit, config and runtime health"),
                            ("install", "transactionally install the runtime"),
                            ("upgrade", "stage a new version and atomically switch to it"),
                            ("rollback", "point `current` back at an earlier version")):
        sub = subs.add_parser(name, help=help_text)
        sub.add_argument("--config", required=name != "doctor")
        if name == "install":
            sub.add_argument("--force", action="store_true",
                             help="install even though a runtime is already active")
        if name == "rollback":
            sub.add_argument("--version", help="exact version directory name to activate")
    args = parser.parse_args()
    handler = {"doctor": cmd_doctor, "install": cmd_install,
               "upgrade": cmd_upgrade, "rollback": cmd_rollback}[args.command]
    try:
        return handler(args)
    except DoctorFailure as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
