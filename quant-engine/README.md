# RyanAI Quant Engine

A dependency-free Python 3.10+ research engine. It accepts caller-supplied daily OHLCV bars as JSON and runs a deterministic long-only SMA crossover backtest. Signals formed at a bar close execute no earlier than the next bar open. Fees and slippage are configurable and included in fills.

## Safety

- No broker, market-data provider, network, LLM, credential, or real-order integration.
- Historical input only; no synthetic/default market data is generated.
- Maximum 2 MB input and 2,500 bars per run.
- Only the explicitly implemented `sma_crossover` strategy is accepted.
- Results are educational simulations, not investment advice or a prediction.

## Test

`python3 -m unittest discover -s quant-engine/tests -v`

The API wrapper is responsible for authenticated access, durable user-scoped persistence, process timeouts, and input-size limits.
