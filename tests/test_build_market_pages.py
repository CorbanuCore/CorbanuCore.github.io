from __future__ import annotations

from scripts.build_market_pages import _earnings_ledger_html, _markdown_brief


def test_markdown_brief_escapes_model_output_and_renders_structure() -> None:
    rendered = _markdown_brief("## Quarter in one view\n- **Revenue** rose <script>alert(1)</script>")
    assert "<h4>Quarter in one view</h4>" in rendered
    assert "<strong>Revenue</strong>" in rendered
    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered


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
