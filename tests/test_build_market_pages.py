from __future__ import annotations

import pandas as pd

from scripts.build_market_pages import (
    _earnings_ledger_html,
    _uses_matching_perp_scale,
    _markdown_brief,
    _perp_change_metrics,
    _transcript_surrounding_moves,
    _weighted_peer_average,
)


def test_perp_change_metrics_use_exact_hourly_24h_and_7d_references() -> None:
    times = pd.date_range("2026-08-11T12:00:00Z", periods=169, freq="h")
    rows = pd.DataFrame({
        "bar_close_time": times,
        "price_close": [100.0 + index for index in range(len(times))],
    })

    result = _perp_change_metrics(rows)

    assert result["performanceMarkPrice"] == 268.0
    assert result["reference24hPrice"] == 244.0
    assert result["reference7dPrice"] == 100.0
    assert result["change24hPct"] == round((268.0 / 244.0 - 1.0) * 100.0, 4)
    assert result["change7dPct"] == 168.0


def test_weighted_peer_average_renormalizes_each_available_metric() -> None:
    rows = [
        {
            "weight": 0.6,
            "change24hPct": 2.0,
            "change7dPct": -1.0,
            "sevenDayLongAprPct": 12.0,
            "forwardPE": 10.0,
            "forwardSalesGrowthPct": None,
            "forwardEPSGrowthPct": 8.0,
            "epsRevision28dPctOfPrice": 0.5,
            "liquidity_24h_usd_millions": 20.0,
            "performanceObservedAt": "2026-08-18T13:00:00Z",
        },
        {
            "weight": 0.4,
            "change24hPct": -1.0,
            "change7dPct": 3.0,
            "sevenDayLongAprPct": -8.0,
            "forwardPE": 20.0,
            "forwardSalesGrowthPct": 25.0,
            "forwardEPSGrowthPct": 18.0,
            "epsRevision28dPctOfPrice": -0.5,
            "liquidity_24h_usd_millions": 10.0,
            "performanceObservedAt": "2026-08-18T14:00:00Z",
        },
    ]

    average = _weighted_peer_average(rows)

    assert average["role"] == "peer_average"
    assert average["weight"] == 1.0
    assert average["change24hPct"] == 0.8
    assert average["change7dPct"] == 0.6
    assert average["sevenDayLongAprPct"] == 4.0
    assert average["forwardPE"] == 14.0
    assert average["forwardSalesGrowthPct"] == 25.0
    assert average["forwardEPSGrowthPct"] == 12.0
    assert average["epsRevision28dPctOfPrice"] == 0.1
    assert average["liquidity_24h_usd_millions"] == 16.0
    assert average["performanceObservedAt"] == "2026-08-18T14:00:00Z"


def test_matching_perp_scale_covers_mismatched_cash_proxies_only() -> None:
    for symbol in ("UNG", "USO", "BNO", "CPER", "SLV"):
        assert _uses_matching_perp_scale("commodity", symbol)
    assert _uses_matching_perp_scale("equity_index", "SPY")
    assert not _uses_matching_perp_scale("commodity", "XAUT")
    assert not _uses_matching_perp_scale("single_name_equity", "AAPL")


def test_markdown_brief_escapes_model_output_and_renders_structure() -> None:
    rendered = _markdown_brief("## Quarter in one view\n- **Revenue** rose <script>alert(1)</script>")
    assert "<h4>Quarter in one view</h4>" in rendered
    assert "<strong>Revenue</strong>" in rendered
    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered


def test_transcript_surrounding_move_does_not_assume_call_timing() -> None:
    spot = pd.DataFrame({
        "date": pd.to_datetime(["2026-07-27", "2026-07-28", "2026-07-29"]),
        "price_close_usd": [100.0, 105.0, 110.0],
    })
    rows = _transcript_surrounding_moves(
        spot,
        [{"transcriptDate": "2026-07-28", "provider": "Bloomberg"}],
    )
    assert rows[0]["startDate"] == "2026-07-27"
    assert rows[0]["reactionDate"] == "2026-07-29"
    assert rows[0]["movePct"] == 10.0
    assert rows[0]["reactionWindow"] == "close before call to close after call"


def test_earnings_ledger_matches_nearby_transcript_and_shows_session_move() -> None:
    options = {
        "mode": "earnings",
        "historicalEarnings": {
            "method": "test reaction method",
            "events": [{
                "earningsDate": "2026-07-30", "timing": "after close",
                "reactionWindow": "event close to next close", "movePct": 4.25,
            }],
        },
    }
    packet = {"summaries": [{
        "transcriptDate": "2026-07-31", "fiscalQuarter": 3, "fiscalYear": 2026,
        "summaryMarkdown": "## Quarter in one view\n- Current-quarter evidence",
    }]}
    rendered = _earnings_ledger_html(symbol="AAPL", options_payload=options, analyst_packet=packet)
    assert "Jul 30, 2026" in rendered
    assert "+4.25%" in rendered
    assert "Q3 FY2026" in rendered
    assert 'class="transcript-brief"' in rendered
    assert "Current-quarter evidence" in rendered
    assert "after close" not in rendered
    assert "event close to next close" not in rendered
    assert "Session move:" in rendered


def test_earnings_ledger_shows_only_latest_eight_events() -> None:
    events = [
        {
            "earningsDate": f"2026-{month:02d}-15",
            "timing": "after close",
            "reactionWindow": "event close to next close",
            "movePct": float(month),
        }
        for month in range(1, 11)
    ]
    rendered = _earnings_ledger_html(
        symbol="INTC",
        options_payload={
            "mode": "earnings",
            "historicalEarnings": {"events": events},
        },
        analyst_packet=None,
    )
    assert "8 historical reactions" in rendered
    assert "Oct 15, 2026" in rendered
    assert "Mar 15, 2026" in rendered
    assert "Feb 15, 2026" not in rendered
    assert "Jan 15, 2026" not in rendered


def test_earnings_ledger_uses_fallback_events_without_an_options_profile() -> None:
    packet = {
        "summaries": [{
            "transcriptDate": "2026-07-29", "fiscalQuarter": 2, "fiscalYear": 2026,
            "summaryMarkdown": "## Quarter in one view\n- Samsung evidence",
        }],
        "fallbackEarningsEvents": [{
            "earningsDate": "2026-07-29", "timing": "call timing unavailable",
            "reactionWindow": "close before call to close after call", "movePct": -3.5,
        }],
        "fallbackEarningsMethod": "surrounding-session method",
    }
    rendered = _earnings_ledger_html(
        symbol="SMSN", options_payload=None, analyst_packet=packet,
    )
    assert "SMSN Earnings Tape and Transcript Briefings" in rendered
    assert "-3.50%" in rendered
    assert "Samsung evidence" in rendered
    assert "surrounding-session method" in rendered
