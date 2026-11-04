import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quant_engine import run_backtest, validate


def bars(count=80):
    result = []
    price = 100.0
    for index in range(count):
        # Deterministic uptrend followed by a downtrend to exercise both sides.
        price += -1.0 if index < 20 else 1.4 if index < 50 else -1.6
        result.append({
            "date": f"2026-01-{index + 1:02d}" if index < 28 else f"2026-02-{index - 27:02d}" if index < 56 else f"2026-03-{index - 55:02d}",
            "open": price - 0.2, "high": price + 0.5,
            "low": price - 0.5, "close": price, "volume": 1000,
        })
    return result


class QuantEngineTests(unittest.TestCase):
    def test_backtest_is_deterministic_and_long_only(self):
        payload = {"bars": bars(), "fast_window": 3, "slow_window": 8}
        first = run_backtest(payload)
        second = run_backtest(payload)
        self.assertEqual(first, second)
        self.assertEqual(first["execution_mode"], "historical_simulation_only")
        self.assertGreaterEqual(first["metrics"]["max_drawdown_pct"], 0)
        sides = {trade["side"] for trade in first["trades"]}
        self.assertEqual(sides, {"buy", "sell"})
        self.assertEqual(first["period"]["bars"], 80)

    def test_fills_signal_on_the_following_bar_open(self):
        sample = bars()
        result = run_backtest({"bars": sample, "fast_window": 3, "slow_window": 8})
        first_buy = next(trade for trade in result["trades"] if trade["side"] == "buy")
        self.assertEqual(first_buy["date"], sample[23]["date"])
        self.assertAlmostEqual(first_buy["price"], sample[23]["open"] * 1.0005, places=7)

    def test_rejects_non_monotonic_dates(self):
        sample = bars()
        sample[3]["date"] = sample[2]["date"]
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            validate({"bars": sample, "fast_window": 3, "slow_window": 8})

    def test_rejects_lookahead_unsafe_strategy(self):
        with self.assertRaisesRegex(ValueError, "Only the sma_crossover"):
            run_backtest({"bars": bars(), "strategy": "llm_magic", "fast_window": 3, "slow_window": 8})

    def test_rejects_invalid_ohlc(self):
        sample = bars()
        sample[0]["high"] = sample[0]["low"] - 1
        with self.assertRaisesRegex(ValueError, "high is inconsistent"):
            validate({"bars": sample, "fast_window": 3, "slow_window": 8})

    def test_rejects_invalid_windows(self):
        with self.assertRaisesRegex(ValueError, "slow_window"):
            run_backtest({"bars": bars(), "fast_window": 8, "slow_window": 5})


if __name__ == "__main__":
    unittest.main()
