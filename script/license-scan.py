#!/usr/bin/env python3
"""License gate for Cedian's Rust daemon (docs/CEDIAN_SPEC.md §9).

Pass: every third-party package offers the code under MIT or another
permissive license (Apache-2.0, BSD, ISC, Zlib, Unlicense, CC0-1.0, 0BSD,
Unicode-3.0/DFS); any permissive license is accepted (decided 2026-10-28).
Packages without an MIT option are listed so their NOTICE/attribution is
kept in THIRD_PARTY_NOTICES.md.

Fail: strong/weak copyleft with no permissive option (GPL, AGPL, LGPL-only,
MPL, CDDL, EPL, SSPL/FSL/BSL-only), proprietary, or unknown licenses.

With --app <Cedian.app>, also scans the npm packages the built app ships:
every package.json under node_modules in Contents/Resources/app, inside
node_modules.asar too, and in each built-in extension.

Usage: python3 script/license-scan.py [--app <Cedian.app>]  (run from the repo root)
"""

import json
import re
import struct
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
    # npm packages VS Code ships (Phase A app scan, 2026-10-28): tar, minipass,
    # chownr, yallist, lru-cache are BlueOak; @vscode/codicons' icons are CC-BY.
    # Both are permissive and only ask for attribution.
    "BlueOak-1.0.0",
    "CC-BY-4.0",
}

# Packages the owner allowed by name despite their license, with why. Each keeps its
# notice in THIRD_PARTY_NOTICES.md.
EXCEPTIONS = {
    # VS Code's encoding guesser, shipped unmodified as its own module (owner, 2026-10-28;
    # legal review before ship rechecks it).
    "jschardet": "LGPL-2.1+",
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


def npm_license(package):
    """The SPDX expression a package.json declares, in any of npm's spellings."""
    value = package.get("license")
    if isinstance(value, dict):
        value = value.get("type")
    if not value and isinstance(package.get("licenses"), list):
        value = " OR ".join(
            l.get("type", "") if isinstance(l, dict) else str(l) for l in package["licenses"]
        )
    return value if isinstance(value, str) else None


def asar_package_jsons(path):
    """(inner path, parsed package.json) for each package.json in an asar (VS Code packs
    node_modules itself, so its packages sit at the top)."""
    data = path.read_bytes()
    # Two Chromium pickles: one holding the header's size, then the header (size, length,
    # JSON). File offsets count from the end of the header pickle.
    header_size = struct.unpack_from("<I", data, 4)[0]
    json_len = struct.unpack_from("<I", data, 12)[0]
    header = json.loads(data[16 : 16 + json_len])
    base = 8 + header_size

    def walk(node, prefix):
        for name, entry in node.get("files", {}).items():
            inner = f"{prefix}/{name}" if prefix else name
            if "files" in entry:
                yield from walk(entry, inner)
            elif name == "package.json" and not entry.get("unpacked"):
                start = base + int(entry["offset"])
                try:
                    yield inner, json.loads(data[start : start + entry["size"]])
                except ValueError:
                    continue

    yield from walk(header, "")


def app_packages(app):
    """(where, package.json) for every npm package a built app ships."""
    resources = app / "Contents" / "Resources" / "app"
    if not resources.is_dir():
        sys.exit(f"{app} has no Contents/Resources/app")
    asar = resources / "node_modules.asar"
    if asar.is_file():
        for inner, package in asar_package_jsons(asar):
            yield f"node_modules.asar/{inner}", package
    for path in resources.rglob("node_modules/**/package.json"):
        try:
            yield str(path.relative_to(resources)), json.loads(path.read_text())
        except (ValueError, UnicodeDecodeError):
            continue


def scan_app(app):
    """Rejected (package, license) pairs among the app's npm packages, and how many there are."""
    seen = {}
    for where, package in app_packages(app):
        name, version = package.get("name"), package.get("version")
        if not name or not version:
            continue  # a nested package.json that only sets "type" or similar
        seen.setdefault(f"{name} {version}", (npm_license(package), where))
    bad = [
        (name, f"{expression or 'missing license'} ({where})")
        for name, (expression, where) in seen.items()
        if not acceptable(expression or "")
        and EXCEPTIONS.get(name.rsplit(" ", 1)[0]) != expression
    ]
    non_mit = [
        (name, expression)
        for name, (expression, _) in seen.items()
        if acceptable(expression or "") and not {"MIT", "MIT-0"} & set(options(expression))
    ]
    return bad, non_mit, len(seen)


def main():
    app = None
    if len(sys.argv) == 3 and sys.argv[1] == "--app":
        app = Path(sys.argv[2])
    elif len(sys.argv) != 1:
        sys.exit("usage: python3 script/license-scan.py [--app <Cedian.app>]")
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
    if app is not None:
        app_bad, app_non_mit, app_checked = scan_app(app)
        bad += app_bad
        non_mit += app_non_mit
        checked += app_checked
    if non_mit:
        print("permissive, non-MIT (keep their NOTICE/attribution):")
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
