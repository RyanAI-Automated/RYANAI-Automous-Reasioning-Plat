"""Deterministic record transformation pipeline with explicit validation."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from typing import Any


def transform_record(record: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
    """Rename configured fields and add explicitly configured defaults."""
    if not isinstance(record, Mapping):
        raise ValueError("Each record must be a JSON object.")

    field_mappings = config.get("field_mappings", {})
    defaults = config.get("defaults", {})
    if not isinstance(field_mappings, Mapping) or not isinstance(defaults, Mapping):
        raise ValueError("'field_mappings' and 'defaults' must be JSON objects.")

    transformed = {
        str(field_mappings.get(key, key)): value
        for key, value in record.items()
    }
    for key, value in defaults.items():
        transformed.setdefault(str(key), value)
    return transformed


def run_pipeline(
    records: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Transform records and reject the batch if required output fields are absent."""
    if isinstance(records, (str, bytes)) or not isinstance(records, Sequence):
        raise ValueError("'records' must be a JSON array.")
    if config is not None and not isinstance(config, Mapping):
        raise ValueError("'config' must be a JSON object.")

    settings = config or {}
    required_fields = settings.get("required_fields", [])
    if (
        not isinstance(required_fields, Sequence)
        or isinstance(required_fields, (str, bytes))
        or not all(isinstance(field, str) for field in required_fields)
    ):
        raise ValueError("'required_fields' must be an array of field names.")

    transformed = [transform_record(record, settings) for record in records]
    for index, record in enumerate(transformed):
        missing = [field for field in required_fields if field not in record]
        if missing:
            raise ValueError(
                f"Record {index} is missing required fields: {', '.join(missing)}"
            )
    return transformed


def main() -> None:
    """Read a JSON batch from stdin and write the transformed batch to stdout."""
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, Mapping):
            raise ValueError("Input must be a JSON object with 'records' and optional 'config'.")
        result = run_pipeline(payload.get("records"), payload.get("config"))
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    except (json.JSONDecodeError, ValueError, TypeError) as error:
        print(f"Pipeline failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
