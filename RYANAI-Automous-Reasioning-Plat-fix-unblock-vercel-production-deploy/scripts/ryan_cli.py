#!/usr/bin/env python3
"""Small CLI client for the RyanAI HTTP reasoning API."""

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def ask(prompt: str) -> str:
    base_url = os.environ.get("API_BASE_URL", "http://localhost:3000").rstrip("/")
    payload = {"prompt": prompt}
    model = os.environ.get("OPENAI_MODEL")
    if model:
        payload["model"] = model
    request = Request(
        f"{base_url}/api/reason",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=float(os.environ.get("API_TIMEOUT", "30"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
            message = details.get("error", str(error))
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = str(error)
        raise RuntimeError(message) from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Could not connect to RyanAI at {base_url}: {error}") from error

    output = payload.get("output") or payload.get("response")
    if not payload.get("success") or not isinstance(output, str):
        raise RuntimeError(payload.get("error", "The API returned no reasoning response"))
    return output


def main() -> int:
    prompt = " ".join(sys.argv[1:]).strip()
    if not prompt:
        if not sys.stdin.isatty():
            print("Usage: python scripts/ryan_cli.py <prompt>", file=sys.stderr)
            return 2
        prompt = input("RyanAI prompt: ").strip()

    if not prompt:
        print("A non-empty prompt is required.", file=sys.stderr)
        return 2

    try:
        print(ask(prompt))
        return 0
    except RuntimeError as error:
        print(f"RyanAI request failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
