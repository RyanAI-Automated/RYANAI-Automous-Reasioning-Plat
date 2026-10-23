#!/usr/bin/env python3
"""Probe RyanAI's running API and report the health response without simulating startup."""

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main() -> int:
    health_url = os.environ.get("API_HEALTH_URL", "http://localhost:3000/health")
    timeout = float(os.environ.get("API_TIMEOUT", "5"))
    print("RyanAI platform health probe")
    print(f"Endpoint: {health_url}")
    try:
        with urlopen(health_url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"API health check failed: {error}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0 if payload.get("status") == "online" else 1


if __name__ == "__main__":
    raise SystemExit(main())
