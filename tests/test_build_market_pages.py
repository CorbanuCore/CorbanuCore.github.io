from __future__ import annotations

import pandas as pd

from scripts.build_market_pages import (
    _earnings_ledger_html,
    _markdown_brief,
    _transcript_surrounding_moves,
)


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
