# Isolated provider verification run — latest main

This execution-only branch is reset to current official main commit `6d4ab93e75932cf2c61878f771b62e114bf4e623`, which includes the current NVIDIA and Qwen hosted model identifiers in the shared provider resolver.

The existing isolated workflow independently probes NVIDIA, Qwen, and Logic with the dedicated `ryanai-provider-verification` GitHub Environment, disposable PostgreSQL, exact challenge validation, and persisted health-record readback.

No application source, provider credentials, or production configuration are changed by this marker.
