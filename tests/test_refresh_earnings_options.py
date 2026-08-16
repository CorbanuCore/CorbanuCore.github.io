from __future__ import annotations

import unittest
from datetime import date

from scripts.refresh_earnings_options import (
    _historical_scenarios,
    _pava,
    _payout_statistics,
    _rank_historical_structures,
)


class EarningsOptionsHistoryTests(unittest.TestCase):
    def test_payout_multiple_and_profit_threshold_use_original_debit(self) -> None:
        scenarios = [
            {
                "earningsDate": "2025-01-30",
                "entryDate": "2024-11-15",
                "exitDate": "2025-02-21",
                "entryPrice": 100.0,
                "exitPrice": 120.0,
                "underlyingReturnPct": 20.0,
            },
            {
                "earningsDate": "2024-10-31",
                "entryDate": "2024-08-16",
                "exitDate": "2024-11-22",
                "entryPrice": 100.0,
                "exitPrice": 105.0,
                "underlyingReturnPct": 5.0,
            },
        ]
        result = _payout_statistics(
            scenarios,
            put_ratio=0.90,
            call_ratio=1.10,
            premium_ratio=0.05,
        )
        self.assertEqual(result["events"], 2)
        self.assertEqual(result["profitableEvents"], 1)
        self.assertEqual(result["profitableRatePct"], 50.0)
        self.assertEqual(result["averageGrossPayoutMultiple"], 1.0)
        self.assertEqual(result["averageWinnerPayoutMultiple"], 2.0)
        self.assertTrue(result["outcomes"][0]["profitable"])
        self.assertFalse(result["outcomes"][1]["profitable"])

    def test_single_call_payout_uses_call_intrinsic_value_only(self) -> None:
        scenarios = [{
            "earningsDate": "2025-01-30",
            "entryDate": "2024-11-15",
            "exitDate": "2025-02-21",
            "entryPrice": 100.0,
            "exitPrice": 120.0,
            "underlyingReturnPct": 20.0,
        }]
        result = _payout_statistics(
            scenarios,
            put_ratio=None,
            call_ratio=1.10,
            premium_ratio=0.025,
        )
        self.assertEqual(result["profitableEvents"], 1)
        self.assertEqual(result["averageGrossPayoutMultiple"], 4.0)

    def test_single_put_payout_uses_put_intrinsic_value_only(self) -> None:
        scenarios = [{
            "earningsDate": "2025-01-30",
            "entryDate": "2024-11-15",
            "exitDate": "2025-02-21",
            "entryPrice": 100.0,
            "exitPrice": 80.0,
            "underlyingReturnPct": -20.0,
        }]
        result = _payout_statistics(
            scenarios,
            put_ratio=0.90,
            call_ratio=None,
            premium_ratio=0.025,
        )
        self.assertEqual(result["profitableEvents"], 1)
        self.assertEqual(result["averageGrossPayoutMultiple"], 4.0)

    def test_structure_ranking_returns_top_two_without_strike_spacing(self) -> None:
        def contract(put_call: str, strike: float, ask: float) -> dict[str, object]:
            return {
                "putCall": put_call,
                "strike": strike,
                "ask": ask,
                "volume": 100,
                "openInterest": 1_000,
            }

        tradable = [
            contract("CALL", 100, 5),
            contract("PUT", 100, 5),
            contract("CALL", 105, 4),
            contract("CALL", 107, 3.5),
            contract("CALL", 112, 3),
            contract("PUT", 95, 4),
            contract("PUT", 93, 3.5),
            contract("PUT", 88, 3),
        ]
        scenarios = []
        for index in range(12):
            exit_price = 120.0 if index % 2 == 0 else 80.0
            scenarios.append({
                "earningsDate": f"2025-{index + 1:02d}-01",
                "entryDate": f"2024-{index + 1:02d}-01",
                "exitDate": f"2025-{index + 1:02d}-02",
                "entryPrice": 100.0,
                "exitPrice": exit_price,
                "underlyingReturnPct": exit_price - 100.0,
            })

        ranked = _rank_historical_structures(tradable, spot=100.0, scenarios=scenarios)

        self.assertEqual(
            [row["name"] for row in ranked],
            ["ATM straddle", "$105 call", "$107 call", "$95 put", "$93 put"],
        )

    def test_isotonic_fit_produces_increasing_cdf(self) -> None:
        fitted = _pava([
            {"strike": 90.0, "cdf": 0.20, "weight": 1.0},
            {"strike": 100.0, "cdf": 0.10, "weight": 1.0},
            {"strike": 110.0, "cdf": 0.50, "weight": 1.0},
        ])
        values = [row["cdf"] for row in fitted]
        self.assertEqual(values, sorted(values))
        self.assertAlmostEqual(values[0], 0.15)
        self.assertAlmostEqual(values[1], 0.15)

    def test_historical_windows_match_current_calendar_day_horizon(self) -> None:
        history = {
            "events": [{"accepted_at_eastern": "2025-01-30 16:30:00"}],
            "prices": [
                {"date": "2024-11-14", "closeadj": "98"},
                {"date": "2024-11-15", "closeadj": "100"},
                {"date": "2025-02-21", "closeadj": "120"},
                {"date": "2025-02-24", "closeadj": "121"},
            ],
        }
        scenarios = _historical_scenarios(
            history,
            quote_date=date(2026, 8, 14),
            event_date=date(2026, 10, 29),
            expiration_date=date(2026, 11, 20),
        )
        self.assertEqual(len(scenarios), 1)
        self.assertEqual(scenarios[0]["entryDate"], "2024-11-15")
        self.assertEqual(scenarios[0]["exitDate"], "2025-02-21")
        self.assertAlmostEqual(scenarios[0]["underlyingReturnPct"], 20.0)


if __name__ == "__main__":
    unittest.main()
