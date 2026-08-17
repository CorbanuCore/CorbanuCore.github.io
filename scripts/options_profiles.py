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
    "BRENTOIL": {"kind": "term_straddles", "underlierCandidates": ("BNO",)},
    "BTC": {"kind": "term_straddles", "underlierCandidates": ("IBIT",)},
    # These recent listings have live options but insufficient public earnings
    # history for the historical-payout methodology.
    "CBRS": {"kind": "term_straddles", "underlierCandidates": ("CBRS",)},
    "CL": {"kind": "term_straddles", "underlierCandidates": ("USO",)},
    "CRCL": {"kind": "term_straddles", "underlierCandidates": ("CRCL",)},
    "DRAM": {"kind": "term_straddles", "underlierCandidates": ("DRAM",)},
    "ETH": {
        "kind": "term_straddles",
        # Select the live liquidity leader on every refresh. ETHA currently
        # dominates these alternatives by both volume and open interest.
        "underlierCandidates": ("ETHA", "ETHE", "FETH", "ETHW"),
    },
    "EWY": {"kind": "term_straddles", "underlierCandidates": ("EWY",)},
    "GOLD": {"kind": "term_straddles", "underlierCandidates": ("GLD",)},
    "NATGAS": {"kind": "term_straddles", "underlierCandidates": ("UNG",)},
    "SILVER": {"kind": "term_straddles", "underlierCandidates": ("SLV",)},
    # SKHY is the listed ADR options underlier for both SK hynix views.
    "SKHX": {"kind": "term_straddles", "underlierCandidates": ("SKHY",)},
    "SKHY": {"kind": "term_straddles", "underlierCandidates": ("SKHY",)},
    "SOXL": {"kind": "term_straddles", "underlierCandidates": ("SOXL",)},
    "SP500": {"kind": "term_straddles", "underlierCandidates": ("SPY",)},
    "SPCX": {"kind": "term_straddles", "underlierCandidates": ("SPCX",)},
    "XYZ100": {"kind": "term_straddles", "underlierCandidates": ("QQQ",)},
}

# Every unsupported page is explicit so a new listing cannot silently disappear.
UNSUPPORTED_OPTIONS_PAGES: dict[str, str] = {
    "COPPER": "CPER currently lacks two distinct liquid paired ATM expiries",
    "CXMT": "the Shanghai-listed common has no Schwab-listed options chain",
    "SMSN": "Samsung common and its US OTC line have no Schwab-listed options chain",
    "SOL": "BSOL has listed options, but no production Schwab chain has passed the paired ATM liquidity gate",
    "XRP": "spot XRP ETFs exist, but no production Schwab chain has passed the paired ATM liquidity gate",
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
