import unittest
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quant_engine import run_backtest, run_walk_forward, validate


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


    def test_walk_forward_is_deterministic_and_trades_only_in_out_of_sample_windows(self):
        sample = bars(80)
        payload = {
            "bars": sample,
            "train_window": 30,
            "test_window": 10,
            "step_window": 10,
            "max_folds": 4,
            "parameter_grid": [
                {"fast_window": 3, "slow_window": 8},
                {"fast_window": 5, "slow_window": 12},
            ],
            "fee_bps": 5,
            "slippage_bps": 5,
        }
        first = run_walk_forward(payload)
        second = run_walk_forward(payload)
        self.assertEqual(first, second)
        self.assertEqual(first["metrics"]["fold_count"], 4)
        self.assertFalse(first["look_ahead_leakage"])
        self.assertEqual(first["folds"][0]["test_initial_position"], "long")
        self.assertEqual(first["folds"][0]["out_of_sample_trades"][0]["date"], first["folds"][0]["test_period"]["start"])
        for fold in first["folds"]:
            self.assertGreater(fold["test_period"]["start"], fold["training_period"]["end"])
            for trade in fold["out_of_sample_trades"]:
                self.assertGreaterEqual(trade["date"], fold["test_period"]["start"])

    def test_walk_forward_parameter_selection_cannot_see_test_bars(self):
        sample = bars(80)
        payload = {
            "bars": sample,
            "train_window": 30,
            "test_window": 10,
            "step_window": 10,
            "max_folds": 1,
            "parameter_grid": [
                {"fast_window": 3, "slow_window": 8},
                {"fast_window": 5, "slow_window": 12},
            ],
        }
        baseline = run_walk_forward(payload)
        changed = [dict(item) for item in sample]
        test_closes = [95.0, 90.0, 85.0, 80.0, 75.0, 85.0, 95.0, 105.0, 115.0, 125.0]
        for index, close in enumerate(test_closes, start=30):
            changed[index].update({
                "open": close - 0.2, "high": close + 0.5,
                "low": close - 0.5, "close": close,
            })
        altered = run_walk_forward({**payload, "bars": changed})
        self.assertEqual(
            baseline["folds"][0]["selected_parameters"],
            altered["folds"][0]["selected_parameters"],
        )
        self.assertNotEqual(
            baseline["folds"][0]["out_of_sample_metrics"],
            altered["folds"][0]["out_of_sample_metrics"],
        )

    def test_walk_forward_rejects_overlapping_folds_and_invalid_grids(self):
        payload = {
            "bars": bars(80),
            "train_window": 30,
            "test_window": 10,
            "step_window": 5,
            "parameter_grid": [{"fast_window": 3, "slow_window": 8}],
        }
        with self.assertRaisesRegex(ValueError, "must be at least test_window"):
            run_walk_forward(payload)
        with self.assertRaisesRegex(ValueError, "duplicate candidates"):
            run_walk_forward({
                **payload,
                "step_window": 10,
                "parameter_grid": [
                    {"fast_window": 3, "slow_window": 8},
                    {"fast_window": 3, "slow_window": 8},
                ],
            })


    def test_walk_forward_enforces_a_bounded_compute_budget(self):
        large_sample = []
        for index in range(1000):
            close = 100.0 + (index % 20)
            large_sample.append({
                "date": (date(2020, 1, 1) + timedelta(days=index)).isoformat(),
                "open": close - 0.2, "high": close + 0.5,
                "low": close - 0.5, "close": close, "volume": 1000,
            })
        grid = [
            {"fast_window": fast, "slow_window": fast + 1}
            for fast in range(2, 22)
        ]
        with self.assertRaisesRegex(ValueError, "bounded compute budget"):
            run_walk_forward({
                "bars": large_sample,
                "train_window": 500,
                "test_window": 5,
                "step_window": 5,
                "max_folds": 20,
                "parameter_grid": grid,
            })

    def test_backtest_warmup_does_not_execute_training_period_trades(self):
        sample = bars(80)
        result = run_backtest({"bars": sample, "fast_window": 3, "slow_window": 8}, start_index=30)
        self.assertTrue(all(trade["date"] >= sample[30]["date"] for trade in result["trades"]))
        self.assertEqual(result["period"]["start"], sample[30]["date"])
        self.assertEqual(result["period"]["bars"], 50)

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
