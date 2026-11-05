# Quant Lab market data provider

## Paper-first provider choice

RyanAI's first market-data adapter uses Alpaca's Trading API credentials with the historical stock-bars endpoint and explicitly requests the `iex` feed. An Alpaca Paper Only account is available globally and supports the paper API and IEX data without routing real orders. IEX is one US exchange, not consolidated SIP coverage; the UI and API retain this limitation as provenance.

Required server environment variables (names only; never commit their values):

- `ALPACA_API_KEY`
- `ALPACA_API_SECRET`

The application reports the provider as not configured until both are present. It does not accept keys from browser requests, persist credentials, or log credential values. This PR does not create or change any deployment secrets.

## Data controls

- Only daily US equity/ETF bars are requested, with `feed=iex` and split/dividend-adjusted history.
- The current UTC day's potentially incomplete bar is discarded.
- OHLCV values and strict chronological order are validated before persistence.
- At least 30 completed bars are required; requests are bounded to 1,000 bars.
- Data whose latest completed daily bar is more than five calendar days old is rejected.
- Each import stores the authenticated user, symbol, feed, timeframe, adjustment mode, retrieval time, first/last bar time, bars and provenance.
- A backtest references the server-stored import ID. The API reloads those bars under the authenticated user rather than trusting a browser-supplied replacement.

## Broker decision

Alpaca is the first paper-data integration because a global Paper Only account can be created without funding and uses free IEX market data. It is not a full-market consolidated quote feed, and Alpaca paper fills have simulation limitations. Interactive Brokers is the preferred candidate for a future South Africa-eligible live brokerage review: South Africa appears in its accepted-country list and its Web API supports trading and market-data access. IBKR's own TWS API documentation says a paper account is opened after the regular account is approved and funded. Any live broker integration remains a separate design, security review, credential approval and explicit authorization.

## Activation status

This PR adds code and database migration only. It does not activate provider credentials, connect a broker, apply a production migration, or deploy the application.
