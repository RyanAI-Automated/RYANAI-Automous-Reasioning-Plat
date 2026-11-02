# TorchTPU provider integration

TorchTPU is Google's native PyTorch backend for Google Cloud TPU hardware, co-developed with the PyTorch team at Meta. It is not a CPU/GPU emulator and it is not an HTTP inference server by itself. RyanAI connects to a separately operated OpenAI-compatible serving endpoint backed by vLLM-TorchTPU or SGLang-TorchTPU.

## Hardware and runtime prerequisites

The official TorchTPU documentation currently lists Cloud TPU VM generations v5e, v5p, v6e (Trillium) and v7x (Ironwood), Linux, and Python 3.11 or later. A provisioned Google Cloud TPU VM, supported GKE cluster or TPU runtime is required.

A minimal installation on the TPU host is documented as:

```sh
python -m venv .venv
. .venv/bin/activate
pip install torch_tpu==0.2.0 --extra-index-url https://download.pytorch.org/whl/cpu
```

For model serving, use a supported vLLM-TorchTPU or SGLang-TorchTPU deployment and configure it to expose an OpenAI-compatible `/v1/chat/completions` endpoint. Follow the upstream compatibility matrix for the model and TPU generation; not every model, operator or serving feature is automatically supported.

## RyanAI configuration

Set these server-side variables on the RyanAI MCP service:

- `TORCHTPU_API_ENDPOINT`: base URL ending in `/v1`.
- `TORCHTPU_MODEL`: model identifier expected by the serving endpoint.
- `TORCHTPU_API_KEY`: dedicated API key for the serving endpoint.

The MCP `reasoning_route` tool accepts `brain: "torchtpu"` and `response_format: "json_object"`. JSON responses are validated and returned as content. Tool-call-only responses are not executed by this route.

Remote endpoints must use HTTPS and a configured bearer key. The loopback default is only for a local test server inside the same MCP container; `127.0.0.1` in Docker does not refer to the host or a different container. Do not weaken the TLS/authentication guard to make an internal endpoint work.

The TorchTPU route is an optional MCP reasoning endpoint. It does not replace NVIDIA, Qwen or Logic in RyanAI's three-brain orchestrator and does not automatically send production tasks to a TPU.

## What this integration does not do

- It does not provision TPU hardware, create a Google Cloud project, enable billing, create a TPU VM or deploy GKE.
- It does not install `torch_tpu`, CUDA, libtpu, vLLM or SGLang in RyanAI's Node.js containers.
- It does not download model weights or claim a live TPU inference result.
- It does not change the primary three-brain configuration or enable provider calls by default.

## Validation

The MCP provider adapter has isolated Node regression tests for default configuration, authenticated HTTPS requests and structured JSON handling. A real end-to-end validation still requires a provisioned supported TPU, a running serving endpoint, credentials and an approved test prompt. Record the exact TPU generation, serving engine, model, region, request ID, latency and result before calling it operational.

Upstream:
- https://github.com/google-pytorch/torch_tpu
- https://torchtpu.readthedocs.io/
- https://docs.cloud.google.com/tpu/docs/pytorch-on-tpu
