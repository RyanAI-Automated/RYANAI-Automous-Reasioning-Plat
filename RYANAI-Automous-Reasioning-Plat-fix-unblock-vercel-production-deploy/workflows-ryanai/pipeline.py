# File: workflows/pipeline.py
# Directory: workflows/
import asyncio
from typing import List, Dict, Any

@app.task
async def run_pipeline(ctx: TaskContext, source: str, destination: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = await ctx.run(extract, source)

    transformed = await asyncio.gather(
        *[ctx.run(transform, {"record": record, "config": config}) for record in records]
    )

    validated = await ctx.run(validate, {"records": transformed, "config": config})

    return await ctx.run(load, {"records": validated, "destination": destination})

@app.task(retry=Retry(
    max_retries=3, wait_duration_ms=1000, backoff_scaling=2.0
))
def transform(_ctx: TaskContext, payload: Dict[str, Any]) -> Dict[str, Any]:
    record = payload.get("record")
    config = payload.get("config")
    # Process single record transformation
    return record

@app.task
def extract(_ctx: TaskContext, source: str) -> List[Dict[str, Any]]:
    # Extract records from source
    return []

@app.task
def validate(_ctx: TaskContext, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = payload.get("records", [])
    config = payload.get("config", {})
    # Validate records against config
    return records

@app.task
def load(_ctx: TaskContext, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = payload.get("records", [])
    destination = payload.get("destination")
    # Load records into destination
    return records