from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from datetime import date, datetime, timezone

from scripts.refresh_earnings_options import (
    _dedupe_historical_events,
    _historical_earnings_moves,
    _historical_scenarios,
    _normalize_liquid_contracts,
    _pava,
    _payout_statistics,
    _quantile,
    _rank_historical_structures,
    _retain_last_good_payload,
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

    def test_quantile_clips_to_liquid_cdf_support(self) -> None:
        points = [
            {"strike": 90.0, "cdf": 0.20},
            {"strike": 100.0, "cdf": 0.50},
            {"strike": 110.0, "cdf": 0.80},
        ]

        self.assertEqual(_quantile(points, 0.10), 90.0)
        self.assertEqual(_quantile(points, 0.90), 110.0)

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

    def test_term_liquidity_accepts_executable_modest_volume_legs(self) -> None:
        now = datetime(2026, 8, 16, 12, tzinfo=timezone.utc)

        def contract(symbol: str, *, open_interest: int, volume: int) -> dict[str, object]:
            return {
                "symbol": symbol,
                "putCall": "CALL",
                "expiration": "2026-09-18",
                "strikePrice": 100.0,
                "bid": 1.0,
                "ask": 1.2,
                "openInterest": open_interest,
                "totalVolume": volume,
                "quoteTimeInLong": int(now.timestamp() * 1000),
                "multiplier": 100,
                "nonStandard": False,
                "mini": False,
            }

        rows = _normalize_liquid_contracts(
            {
                "contracts": [
                    contract("KEPT", open_interest=50, volume=0),
                    contract("REJECTED", open_interest=49, volume=4),
                ]
            },
            now=now,
        )
        self.assertEqual([row["symbol"] for row in rows], ["KEPT"])

    def test_last_good_payload_retains_liquidity_screen_and_adds_reaction_tape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "coin-options.json"
            path.write_text(json.dumps({
                "mode": "earnings",
                "generatedAt": "2026-08-16T00:00:00Z",
                "liquidityFilter": {"minimumOpenInterestOrVolume": "volume >= 25"},
            }))
            retained = _retain_last_good_payload(
                path,
                now=datetime(2026, 8, 18, tzinfo=timezone.utc),
                failure="No current liquid structures",
                historical_earnings=[{"earningsDate": "2026-07-30", "movePct": 5.0}],
            )
        self.assertEqual(retained["generatedAt"], "2026-08-16T00:00:00Z")
        self.assertEqual(retained["liquidityFilter"]["minimumOpenInterestOrVolume"], "volume >= 25")
        self.assertEqual(retained["refreshStatus"]["state"], "retained_last_good")
        self.assertEqual(len(retained["historicalEarnings"]["events"]), 1)

    def test_adjacent_calendar_disagreement_prefers_sec_event(self) -> None:
        events = [
            {
                "accepted_at_eastern": "2026-04-29",
                "source": "FMP historical earnings calendar",
            },
            {
                "accepted_at_eastern": "2026-04-30 16:30:00",
                "source": "SEC earnings release history",
            },
            {
                "accepted_at_eastern": "2026-01-29 16:30:00",
                "source": "SEC earnings release history",
            },
        ]

        rows = _dedupe_historical_events(events)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["accepted_at_eastern"], "2026-04-30 16:30:00")
        self.assertEqual(rows[0]["source"], "SEC earnings release history")
        self.assertEqual(rows[1]["accepted_at_eastern"], "2026-01-29 16:30:00")

    def test_historical_earnings_moves_respect_before_and_after_close(self) -> None:
        history = {
            "events": [
                {"accepted_at_eastern": "2026-04-30 16:30:00", "source": "SEC"},
                {"accepted_at_eastern": "2026-01-29", "time": "bmo", "source": "calendar"},
            ],
            "prices": [
                {"date": "2026-01-28", "closeadj": "100"},
                {"date": "2026-01-29", "closeadj": "110"},
                {"date": "2026-04-30", "closeadj": "120"},
                {"date": "2026-05-01", "closeadj": "108"},
            ],
        }
        rows = _historical_earnings_moves(history)
        self.assertEqual(rows[0]["reactionWindow"], "event close to next close")
        self.assertEqual(rows[0]["movePct"], -10.0)
        self.assertEqual(rows[1]["reactionWindow"], "prior close to event close")
        self.assertEqual(rows[1]["movePct"], 10.0)

    def test_intraday_release_uses_prior_close_to_event_close(self) -> None:
        history = {
            "events": [{
                "accepted_at_eastern": "2026-04-30 12:15:00",
                "source": "SEC earnings release history",
            }],
            "prices": [
                {"date": "2026-04-29", "closeadj": "100"},
                {"date": "2026-04-30", "closeadj": "108"},
            ],
        }

        rows = _historical_earnings_moves(history)

        self.assertEqual(rows[0]["timing"], "during/unspecified")
        self.assertEqual(rows[0]["reactionWindow"], "prior close to event close")
        self.assertEqual(rows[0]["movePct"], 8.0)

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
