#!/usr/bin/env python3
"""License gate for Cedian's Rust daemon (docs/CEDIAN_SPEC.md §9).

Pass: every third-party package offers the code under MIT or another
permissive MIT-compatible license (Apache-2.0, BSD, ISC, Zlib, Unlicense,
CC0-1.0, 0BSD, Unicode-3.0/DFS). Packages that pass without an MIT option
are listed for the owner's explicit approval before ship (§13 License gate).

Fail: strong/weak copyleft with no permissive option (GPL, AGPL, LGPL-only,
MPL, CDDL, EPL, SSPL/FSL/BSL-only), proprietary, or unknown licenses.

Usage: python3 script/license-scan.py  (run from the repo root)
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAEMON = ROOT / "daemon"

# A license option that keeps the package MIT-compatible. Checked per
# SPDX option (split on OR/AND/parens/slashes), so dual-licensed
# "MIT OR Apache-2.0" passes while "GPL-3.0-only" fails.
PERMISSIVE = {
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Zlib",
    "Unlicense",
    "CC0-1.0",
    "0BSD",
    "Unicode-3.0",
    "Unicode-DFS-2016",
}

SPLIT_OR = re.compile(r"\s+OR\s+|[()/]")


def options(conjunct):
    return [t for t in (t.strip() for t in SPLIT_OR.split(conjunct)) if t]


def acceptable(expression):
    # Every AND-conjunct must offer at least one permissive option, so
    # "MIT OR Apache-2.0" and "(MIT OR Apache-2.0) AND Unicode-3.0" pass
    # while "GPL-3.0-only" fails.
    return bool(expression) and all(
        any(o in PERMISSIVE for o in options(conjunct))
        for conjunct in re.split(r"\s+AND\s+", expression)
    )


def main():
    meta = json.loads(
        subprocess.run(
            ["cargo", "metadata", "--format-version=1"],
            cwd=DAEMON,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    workspace = set(meta.get("workspace_members", []))
    bad = []
    non_mit = []
    checked = 0
    for package in meta["packages"]:
        if package["id"] in workspace:
            continue  # first-party crates, covered by the root LICENSE
        checked += 1
        name = f"{package['name']} {package['version']}"
        expression = package.get("license")
        if not acceptable(expression or ""):
            bad.append((name, expression or "missing license"))
            continue
        opts = options(expression)
        if "MIT" not in opts and "MIT-0" not in opts:
            non_mit.append((name, expression))
    if non_mit:
        print("permissive but non-MIT (needs owner approval before ship):")
        for name, expression in sorted(non_mit):
            print(f"  {name}: {expression}")
    if bad:
        print("REJECTED licenses:", file=sys.stderr)
        for name, expression in sorted(bad):
            print(f"  {name}: {expression}", file=sys.stderr)
        sys.exit(1)
    print(f"license scan passed ({checked} third-party packages)")


if __name__ == "__main__":
    main()
