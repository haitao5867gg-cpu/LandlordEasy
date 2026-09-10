#!/usr/bin/env python3
"""Keep `project-commander-kit/runner/` byte-identical to its single source.

There are two copies of the runner in this repository: the one the Mac mini
actually installs from (`tools/commander-runner/`) and the one shipped inside
the portable kit. Two hand-maintained copies drift, and a drifted kit would
hand a new project a runner that is not the one under test here.

`tools/commander-runner/` is the SINGLE SOURCE OF TRUTH. This script copies it
into the kit (`--write`) or fails when the two differ (`--check`). CI runs
`--check`, so drift cannot merge.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools/commander-runner"
TARGET = REPO / "project-commander-kit/runner"

# Everything the kit ships from the canonical runner is DERIVED from the
# source tree, so a file added under tools/commander-runner/ is synced (and
# drift-checked) by default.  A hand-kept list made new files opt-in: they
# were never copied and `--check` still passed.  Exclusions are the opt-out.
EXCLUDED = frozenset({".gitignore", "README.md", "com.landlordeasy.commander-runner.plist.template"})
SOURCE_GLOBS = ("*.py", "*.json", "tests/*.py")


def synced_files() -> tuple[str, ...]:
    found: set[str] = set()
    for pattern in SOURCE_GLOBS:
        for path in SOURCE.glob(pattern):
            if path.is_file() and path.name not in EXCLUDED and "__pycache__" not in path.parts:
                found.add(path.relative_to(SOURCE).as_posix())
    return tuple(sorted(found))


SYNCED = synced_files()


def digest(path: Path) -> str | None:
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true",
                      help="exit non-zero if the kit copy differs from the source")
    mode.add_argument("--write", action="store_true",
                      help="overwrite the kit copy from the source")
    args = parser.parse_args()

    problems: list[str] = []
    written: list[str] = []

    for name in SYNCED:
        source, target = SOURCE / name, TARGET / name
        if not source.is_file():
            problems.append(f"missing source: tools/commander-runner/{name}")
            continue
        if digest(source) == digest(target):
            continue
        if args.check:
            state = "differs" if target.is_file() else "missing in kit"
            problems.append(f"{name}: {state}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            written.append(name)

    # A file that exists only in the kit's synced set is drift too: it would
    # ship something the canonical runner does not have.
    for target in sorted(TARGET.rglob("*.py")) + sorted(TARGET.rglob("*.json")):
        relative = target.relative_to(TARGET).as_posix()
        if "__pycache__" in target.parts:
            continue
        if relative not in SYNCED and not (SOURCE / relative).exists():
            problems.append(f"{relative}: present in kit but not in the source")

    if problems:
        print("kit runner is out of sync with tools/commander-runner:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        if args.check:
            print("\nRun: python3 project-commander-kit/scripts/sync_from_source.py --write",
                  file=sys.stderr)
        return 1

    print(f"synced {len(written)} file(s)" if args.write else
          f"kit runner matches the source ({len(SYNCED)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
