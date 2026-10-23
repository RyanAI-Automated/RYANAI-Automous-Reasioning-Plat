#!/usr/bin/env python3
"""Syntax-check the Python tools shipped with RyanAI (no third-party core exists)."""

import ast
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PYTHON_TOOLS = (
    Path("scripts/ryan_cli.py"),
    Path("scripts/ryan_master_boot.py"),
    Path("scripts/ryan_benchmark.py"),
    Path("scripts/ryan_status.py"),
)


def main() -> int:
    if sys.version_info < (3, 10):
        print("Python 3.10 or newer is required.", file=sys.stderr)
        return 1

    failed = False
    for relative_path in PYTHON_TOOLS:
        source_path = ROOT / relative_path
        try:
            ast.parse(source_path.read_text(encoding="utf-8"), filename=str(relative_path))
            print(f"PASS {relative_path}")
        except (OSError, SyntaxError) as error:
            print(f"FAIL {relative_path}: {error}", file=sys.stderr)
            failed = True

    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
