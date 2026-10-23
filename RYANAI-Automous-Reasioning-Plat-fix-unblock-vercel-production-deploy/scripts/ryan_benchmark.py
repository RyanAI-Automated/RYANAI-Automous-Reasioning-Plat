#!/usr/bin/env python3
"""Measure real API health-request latency; this does not infer model or GPU performance."""

import argparse
import json
import os
import statistics
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument(
        "--url",
        default=os.environ.get("API_HEALTH_URL", "http://localhost:3000/health"),
    )
    args = parser.parse_args()
    if not 1 <= args.iterations <= 1000:
        parser.error("--iterations must be between 1 and 1000")

    durations_ms = []
    timeout = float(os.environ.get("API_TIMEOUT", "5"))
    try:
        for _ in range(args.iterations):
            start = time.perf_counter()
            with urlopen(args.url, timeout=timeout) as response:
                health = json.loads(response.read().decode("utf-8"))
                if response.status >= 400 or health.get("status") != "online":
                    raise RuntimeError("The API health endpoint did not report online.")
            durations_ms.append((time.perf_counter() - start) * 1000)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, RuntimeError) as error:
        print(f"API health benchmark failed: {error}", file=sys.stderr)
        return 1

    ordered = sorted(durations_ms)
    p95_index = max(0, (len(ordered) * 95 + 99) // 100 - 1)
    print(json.dumps({
        "endpoint": args.url,
        "request": "GET health",
        "iterations": len(durations_ms),
        "meanMs": round(statistics.mean(durations_ms), 2),
        "medianMs": round(statistics.median(durations_ms), 2),
        "p95Ms": round(ordered[p95_index], 2),
        "minMs": round(ordered[0], 2),
        "maxMs": round(ordered[-1], 2),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
