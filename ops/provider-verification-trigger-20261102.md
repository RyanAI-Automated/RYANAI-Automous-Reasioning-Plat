# Isolated provider verification trigger

This marker commit intentionally triggers `.github/workflows/provider-verification.yml` on the dedicated automation branch.

The workflow uses the preconfigured `ryanai-provider-verification` GitHub environment, one provider credential at a time, and a disposable PostgreSQL service. It must not use production databases or print credentials. This branch is an execution branch only and is not intended for merge.
