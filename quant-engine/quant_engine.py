#!/usr/bin/env python3
"""Deterministic, dependency-free long-only SMA backtester for RyanAI.

Input and output are JSON on stdin/stdout. This module never fetches market data,
loads credentials, calls an LLM, connects to a broker, or places real orders.
Signals are calculated at close and filled at the following bar's open.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from statistics import mean, median, stdev


def _number(value: object, name: str, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ValueError(f"{name} must be finite and at least {minimum}")
    return result


def validate(payload: object) -> tuple[list[dict], dict]:
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars = payload.get("bars")
    if not isinstance(bars, list) or not 30 <= len(bars) <= 2500:
        raise ValueError("bars must contain between 30 and 2500 OHLCV rows")
    normalized = []
    previous_date = None
    for index, item in enumerate(bars):
        if not isinstance(item, dict):
            raise ValueError(f"bars[{index}] must be an object")
        try:
            day = date.fromisoformat(item["date"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"bars[{index}].date must be an ISO date") from None
        if previous_date is not None and day <= previous_date:
            raise ValueError("bar dates must be strictly increasing")
        previous_date = day
        row = {"date": day.isoformat()}
        for field in ("open", "high", "low", "close"):
            row[field] = _number(item.get(field), f"bars[{index}].{field}", minimum=0.000001)
        row["volume"] = _number(item.get("volume", 0), f"bars[{index}].volume")
        if row["high"] < max(row["open"], row["close"], row["low"]):
            raise ValueError(f"bars[{index}].high is inconsistent with OHLC values")
        if row["low"] > min(row["open"], row["close"], row["high"]):
            raise ValueError(f"bars[{index}].low is inconsistent with OHLC values")
        normalized.append(row)

    strategy = payload.get("strategy", "sma_crossover")
    if strategy != "sma_crossover":
        raise ValueError("Only the sma_crossover strategy is currently supported")
    fast = payload.get("fast_window", 5)
    slow = payload.get("slow_window", 20)
    if isinstance(fast, bool) or not isinstance(fast, int) or not 2 <= fast <= 50:
        raise ValueError("fast_window must be an integer between 2 and 50")
    if isinstance(slow, bool) or not isinstance(slow, int) or not fast < slow <= 200:
        raise ValueError("slow_window must be greater than fast_window and at most 200")
    config = {
        "strategy": strategy,
        "fast_window": fast,
        "slow_window": slow,
        "initial_cash": _number(payload.get("initial_cash", 10000), "initial_cash", minimum=1),
        "fee_bps": _number(payload.get("fee_bps", 5), "fee_bps"),
        "slippage_bps": _number(payload.get("slippage_bps", 5), "slippage_bps"),
    }
    if config["fee_bps"] > 1000 or config["slippage_bps"] > 1000:
        raise ValueError("fee_bps and slippage_bps must not exceed 1000")
    return normalized, config


def run_backtest(payload: object, *, start_index: int = 0) -> dict:
    bars, config = validate(payload)
    if isinstance(start_index, bool) or not isinstance(start_index, int) or not 0 <= start_index < len(bars):
        raise ValueError("start_index must be an integer within the validated bar range")
    closes = [bar["close"] for bar in bars]
    fast, slow = config["fast_window"], config["slow_window"]
    cash = config["initial_cash"]
    quantity = 0.0
    entry_cost = 0.0
    trades = []
    equity_curve = []
    fee_rate = config["fee_bps"] / 10000
    slippage_rate = config["slippage_bps"] / 10000
    peak = cash
    max_drawdown = 0.0
    daily_returns = []
    previous_equity = cash

    # A close-time signal is queued and filled at the following bar's open.
    # The equity curve for each date is marked only after that date's open fills.
    pending_action = None
    for index, bar in enumerate(bars):
        if index >= start_index:
            if pending_action == "buy" and quantity == 0:
                fill_price = bar["open"] * (1 + slippage_rate)
                quantity = cash / (fill_price * (1 + fee_rate))
                fee = quantity * fill_price * fee_rate
                entry_cost = quantity * fill_price + fee
                cash = 0.0
                trades.append({
                    "date": bar["date"], "side": "buy",
                    "price": round(fill_price, 8), "quantity": round(quantity, 8),
                    "fee": round(fee, 8),
                })
            elif pending_action == "sell" and quantity > 0:
                fill_price = bar["open"] * (1 - slippage_rate)
                proceeds = quantity * fill_price
                fee = proceeds * fee_rate
                net_proceeds = proceeds - fee
                trades.append({
                    "date": bar["date"], "side": "sell",
                    "price": round(fill_price, 8), "quantity": round(quantity, 8),
                    "fee": round(fee, 8),
                    "realized_pnl": round(net_proceeds - entry_cost, 8),
                })
                cash = net_proceeds
                quantity = 0.0
                entry_cost = 0.0
            pending_action = None

            equity = cash + quantity * bar["close"]
            if previous_equity > 0:
                daily_returns.append(equity / previous_equity - 1)
            previous_equity = equity
            peak = max(peak, equity)
            if peak > 0:
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
            equity_curve.append({"date": bar["date"], "equity": round(equity, 2)})
        else:
            # Warm-up bars inform indicators but never generate simulated fills.
            pending_action = None

        # Compute the decision only after this bar has closed. It cannot fill
        # until the next iteration, at the next bar's open.
        if index >= slow and index + 1 < len(bars):
            fast_now = mean(closes[index - fast + 1:index + 1])
            slow_now = mean(closes[index - slow + 1:index + 1])
            fast_prev = mean(closes[index - fast:index])
            slow_prev = mean(closes[index - slow:index])
            crossed_up = fast_prev <= slow_prev and fast_now > slow_now
            crossed_down = fast_prev >= slow_prev and fast_now < slow_now
            if quantity == 0 and crossed_up:
                pending_action = "buy"
            elif quantity > 0 and crossed_down:
                pending_action = "sell"

    final_equity = cash + quantity * bars[-1]["close"]
    total_return = final_equity / config["initial_cash"] - 1
    volatility = stdev(daily_returns) if len(daily_returns) > 1 else 0.0
    sharpe = (mean(daily_returns) / volatility * math.sqrt(252)) if volatility > 0 else 0.0
    closed_trades = [trade for trade in trades if trade["side"] == "sell"]
    wins = sum(1 for trade in closed_trades if trade["realized_pnl"] > 0)

    return {
        "strategy": config["strategy"],
        "config": config,
        "period": {"start": bars[start_index]["date"], "end": bars[-1]["date"], "bars": len(bars) - start_index},
        "metrics": {
            "initial_cash": round(config["initial_cash"], 2),
            "final_equity": round(final_equity, 2),
            "total_return_pct": round(total_return * 100, 4),
            "max_drawdown_pct": round(max_drawdown * 100, 4),
            "annualized_sharpe": round(sharpe, 4),
            "trade_count": len(trades),
            "closed_trade_count": len(closed_trades),
            "win_rate_pct": round(wins / len(closed_trades) * 100, 2) if closed_trades else 0.0,
            "fees_and_slippage_bps": round(config["fee_bps"] + config["slippage_bps"], 2),
        },
        "equity_curve": equity_curve,
        "trades": trades,
        "execution_mode": "historical_simulation_only",
        "disclaimer": "Historical simulation is not a prediction or investment advice. No broker or live orders are connected.",
    }


DEFAULT_PARAMETER_GRID = [
    {"fast_window": 5, "slow_window": 20},
    {"fast_window": 5, "slow_window": 50},
    {"fast_window": 10, "slow_window": 30},
    {"fast_window": 10, "slow_window": 50},
    {"fast_window": 20, "slow_window": 50},
    {"fast_window": 20, "slow_window": 100},
]


def _integer_option(payload: dict, key: str, default: int, minimum: int, maximum: int) -> int:
    value = payload.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{key} must be an integer between {minimum} and {maximum}")
    return value


def run_walk_forward(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars, base_config = validate(payload)
    raw_grid = payload.get("parameter_grid", DEFAULT_PARAMETER_GRID)
    if not isinstance(raw_grid, list) or not 1 <= len(raw_grid) <= 20:
        raise ValueError("parameter_grid must contain between 1 and 20 candidates")
    parameter_grid = []
    seen = set()
    for index, candidate in enumerate(raw_grid):
        if not isinstance(candidate, dict) or set(candidate) != {"fast_window", "slow_window"}:
            raise ValueError(f"parameter_grid[{index}] must contain only fast_window and slow_window")
        fast = candidate["fast_window"]
        slow = candidate["slow_window"]
        if isinstance(fast, bool) or not isinstance(fast, int) or not 2 <= fast <= 50:
            raise ValueError(f"parameter_grid[{index}].fast_window is invalid")
        if isinstance(slow, bool) or not isinstance(slow, int) or not 3 <= slow <= 200 or fast >= slow:
            raise ValueError(f"parameter_grid[{index}].slow_window must exceed fast_window and be at most 200")
        pair = (fast, slow)
        if pair in seen:
            raise ValueError("parameter_grid cannot contain duplicate candidates")
        seen.add(pair)
        parameter_grid.append({"fast_window": fast, "slow_window": slow})

    max_slow = max(item["slow_window"] for item in parameter_grid)
    train_window = _integer_option(payload, "train_window", max(120, max_slow + 1), max(30, max_slow + 1), 2000)
    test_window = _integer_option(payload, "test_window", 30, 5, 500)
    step_window = _integer_option(payload, "step_window", test_window, 5, 500)
    max_folds = _integer_option(payload, "max_folds", 10, 1, 20)
    if step_window < test_window:
        raise ValueError("step_window must be at least test_window so out-of-sample folds do not overlap")
    if train_window + test_window > len(bars):
        raise ValueError("bars do not contain enough history for one train/test fold")

    folds = []
    start = train_window
    while start + test_window <= len(bars) and len(folds) < max_folds:
        end = start + test_window
        training_bars = bars[start - train_window:start]
        fold_bars = bars[start - train_window:end]
        candidates = []
        for candidate in parameter_grid:
            training_result = run_backtest({
                **payload,
                "bars": training_bars,
                "fast_window": candidate["fast_window"],
                "slow_window": candidate["slow_window"],
            })
            metrics = training_result["metrics"]
            candidates.append({
                "parameters": candidate,
                "score": (
                    metrics["annualized_sharpe"],
                    metrics["total_return_pct"],
                    -metrics["max_drawdown_pct"],
                ),
                "metrics": metrics,
            })
        selected = max(candidates, key=lambda item: item["score"])
        out_of_sample = run_backtest({
            **payload,
            "bars": fold_bars,
            "fast_window": selected["parameters"]["fast_window"],
            "slow_window": selected["parameters"]["slow_window"],
        }, start_index=train_window)
        folds.append({
            "fold": len(folds) + 1,
            "training_period": {
                "start": training_bars[0]["date"],
                "end": training_bars[-1]["date"],
                "bars": len(training_bars),
            },
            "test_period": {
                "start": bars[start]["date"],
                "end": bars[end - 1]["date"],
                "bars": test_window,
            },
            "selected_parameters": selected["parameters"],
            "training_selection_metrics": {
                "annualized_sharpe": selected["metrics"]["annualized_sharpe"],
                "total_return_pct": selected["metrics"]["total_return_pct"],
                "max_drawdown_pct": selected["metrics"]["max_drawdown_pct"],
            },
            "out_of_sample_metrics": out_of_sample["metrics"],
            "out_of_sample_trades": out_of_sample["trades"],
            "out_of_sample_equity_curve": out_of_sample["equity_curve"],
        })
        start += step_window

    if not folds:
        raise ValueError("No complete walk-forward test folds could be constructed")
    returns = [fold["out_of_sample_metrics"]["total_return_pct"] for fold in folds]
    drawdowns = [fold["out_of_sample_metrics"]["max_drawdown_pct"] for fold in folds]
    closed_trades = [
        trade
        for fold in folds
        for trade in fold["out_of_sample_trades"]
        if trade["side"] == "sell"
    ]
    wins = sum(1 for trade in closed_trades if trade.get("realized_pnl", 0) > 0)
    total_trades = sum(len(fold["out_of_sample_trades"]) for fold in folds)
    profitable_folds = sum(1 for value in returns if value > 0)
    return {
        "strategy": "sma_crossover",
        "evaluation_mode": "walk_forward_out_of_sample",
        "selection_metric": "training_annualized_sharpe_then_return_then_drawdown",
        "parameter_grid_size": len(parameter_grid),
        "config": {
            "train_window": train_window,
            "test_window": test_window,
            "step_window": step_window,
            "max_folds": max_folds,
            "initial_cash": base_config["initial_cash"],
            "fee_bps": base_config["fee_bps"],
            "slippage_bps": base_config["slippage_bps"],
        },
        "metrics": {
            "fold_count": len(folds),
            "out_of_sample_bars": len(folds) * test_window,
            "mean_return_pct": round(mean(returns), 4),
            "median_return_pct": round(median(returns), 4),
            "best_fold_return_pct": round(max(returns), 4),
            "worst_fold_return_pct": round(min(returns), 4),
            "mean_max_drawdown_pct": round(mean(drawdowns), 4),
            "profitable_fold_pct": round(profitable_folds / len(folds) * 100, 2),
            "trade_count": total_trades,
            "closed_trade_count": len(closed_trades),
            "win_rate_pct": round(wins / len(closed_trades) * 100, 2) if closed_trades else 0.0,
        },
        "folds": folds,
        "look_ahead_leakage": False,
        "execution_mode": "historical_simulation_only",
        "disclaimer": "Walk-forward results are historical out-of-sample simulations, not predictions or investment advice. No broker or live orders are connected.",
    }


def main() -> int:
    try:
        raw = sys.stdin.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Request exceeds the 2 MB engine input limit")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Request must be a JSON object")
        mode = payload.get("mode", "backtest")
        if mode == "walk_forward":
            result = run_walk_forward(payload)
        elif mode == "backtest":
            result = run_backtest(payload)
        else:
            raise ValueError("mode must be backtest or walk_forward")
        sys.stdout.write(json.dumps({"ok": True, "result": result}, allow_nan=False))
        return 0
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
