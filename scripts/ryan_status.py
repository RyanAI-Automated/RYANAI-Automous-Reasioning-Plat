#!/usr/bin/env python3
"""Print the live RyanAI API health document."""

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main() -> int:
    health_url = os.environ.get("API_HEALTH_URL", "http://localhost:3000/health")
    try:
        with urlopen(health_url, timeout=float(os.environ.get("API_TIMEOUT", "5"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"RyanAI is unavailable at {health_url}: {error}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0 if payload.get("status") == "online" else 1


if __name__ == "__main__":
    raise SystemExit(main())
