"""Auditable page-to-listed-options mappings for Corbanu Market Lens."""

from __future__ import annotations

from typing import Any


EARNINGS_PROFILES: dict[str, dict[str, Any]] = {
    symbol: {"kind": "earnings", "underlierCandidates": (symbol,)}
    for symbol in (
        "AAPL",
        "AMD",
        "AMZN",
        "BE",
        "COIN",
        "GOOGL",
        "INTC",
        "META",
        "MRVL",
        "MSTR",
        "MSFT",
        "MU",
        "NBIS",
        "NVDA",
        "PLTR",
        "SNDK",
        "TSLA",
    )
}

TERM_STRADDLE_PROFILES: dict[str, dict[str, Any]] = {
    "BTC": {"kind": "term_straddles", "underlierCandidates": ("IBIT",)},
    "CL": {"kind": "term_straddles", "underlierCandidates": ("USO",)},
    "DRAM": {"kind": "term_straddles", "underlierCandidates": ("DRAM",)},
    "ETH": {
        "kind": "term_straddles",
        # Select the live liquidity leader on every refresh. ETHA currently
        # dominates these alternatives by both volume and open interest.
        "underlierCandidates": ("ETHA", "ETHE", "FETH", "ETHW"),
    },
    "GOLD": {"kind": "term_straddles", "underlierCandidates": ("GLD",)},
    "SILVER": {"kind": "term_straddles", "underlierCandidates": ("SLV",)},
    "SOXL": {"kind": "term_straddles", "underlierCandidates": ("SOXL",)},
    "SP500": {"kind": "term_straddles", "underlierCandidates": ("SPY",)},
    "XYZ100": {"kind": "term_straddles", "underlierCandidates": ("QQQ",)},
}

OPTIONS_PROFILES: dict[str, dict[str, Any]] = {
    **EARNINGS_PROFILES,
    **TERM_STRADDLE_PROFILES,
}


def options_profile(page_symbol: str) -> dict[str, Any]:
    symbol = str(page_symbol).strip().upper()
    try:
        profile = OPTIONS_PROFILES[symbol]
    except KeyError as exc:
        raise KeyError(f"No listed-options profile for {symbol}") from exc
    return {
        "pageSymbol": symbol,
        "kind": str(profile["kind"]),
        "underlierCandidates": tuple(str(value).upper() for value in profile["underlierCandidates"]),
    }
