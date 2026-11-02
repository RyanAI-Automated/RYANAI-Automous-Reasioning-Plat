# DeepSeek V4.1 Flash / DGX Spark integration boundary

RyanAI can optionally call an externally managed DeepSeek V4.1 Flash OpenAI-compatible endpoint through the MCP `reasoning_route` tool. This is an API adapter only: it does not install TensorFold, build a GPU image, download model weights, configure NCCL/RoCE, or manage DGX Spark nodes.

## Configuration

For a local server listening on port 8888:

```dotenv
DEEPSEEK_API_ENDPOINT=http://127.0.0.1:8888/v1
DEEPSEEK_MODEL=DeepSeek-V4.1-Flash-1017
DEEPSEEK_API_KEY=
```

Loopback endpoints may be used without an API key. Any non-loopback endpoint must use HTTPS or HTTP on a trusted private network with `DEEPSEEK_API_KEY` configured; the adapter sends it as a Bearer token. Do not expose an unauthenticated inference endpoint to a LAN or the public internet.

In Docker Compose, `127.0.0.1` refers to the MCP container itself. Set `DEEPSEEK_API_ENDPOINT` to the reachable DGX host/service address and configure authentication at that endpoint plus `DEEPSEEK_API_KEY`. Do not add broad host networking or disable authentication as a shortcut.

The MCP `reasoning_route` tool accepts `brain: "deepseek"`. It also accepts `response_format: "json_object"`, which sends the OpenAI-compatible JSON response-format request and rejects non-JSON output. JSON content is returned as content; provider tool calls are never executed by this route. A tool-call-only response fails clearly rather than being guessed into text.

## Hardware/runtime requirements are external

The upstream four-node TensorFold recipe requires four NVIDIA DGX Sparks (GB10), ConnectX-7 links arranged as a supported switched mesh or switchless ring, Docker with NVIDIA runtime on every node, key-based SSH from the head node, substantial local storage, and an NFS-served model cache. The upstream instructions describe a roughly 510 GB checkpoint, roughly 320 GB of generated weight files, and additional disk requirements for the optional NVFP4 checkpoint conversion.

The upstream recipe's `NVFP4=1` is an opt-in setting for its own TensorFold runtime and NVIDIA NVFP4 checkpoint. It is not a RyanAI setting and must not be added to RyanAI's generic API container. The reported prefill/decode gains and load-time reductions are measurements on that specific four-Spark setup, not a promise for other hardware or inference servers.

Upstream project and runtime instructions:
- https://github.com/MiaAI-Lab/DeepSeek-V4.1-Flash-1017-4x-DGX-Sparks-TensorFold
- https://mia-ai.net/models/DeepSeek-V4.1-Flash-1017-4x-DGX-Sparks-TensorFold

## What this PR does not claim

- No DGX Spark hardware has been detected or provisioned by this change.
- No model weights were downloaded and no GPU benchmark was run.
- NVFP4 is not enabled by default and no quantization files are built by RyanAI.
- The MCP route does not execute DeepSeek tool calls or change the main three-brain provider selection.
- The upstream launch/prepare/stop scripts and TensorFold patches are not copied into RyanAI.

This separation lets RyanAI connect to a separately secured model service while keeping GPU lifecycle, quantization and cluster operations under the model operator's control.
