#!/usr/bin/env python3
"""Validate generated Market Lens payloads before publication."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from scripts.options_profiles import OPTIONS_PROFILES, UNSUPPORTED_OPTIONS_PAGES, options_profile
except ModuleNotFoundError:
    from options_profiles import OPTIONS_PROFILES, UNSUPPORTED_OPTIONS_PAGES, options_profile


SITE_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = SITE_ROOT / "assets" / "market-data"
EXPECTED_CEX_VENUES = {"Binance", "Bitget", "Bybit", "OKX"}
DEX_KINDS = {"ammPool", "ammQuoteDepth", "aggregatorQuote"}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def main() -> int:
    universe = load_json(DATA_ROOT / "universe.json")
    instruments = universe.get("instruments", [])
    if len(instruments) != 37:
        raise AssertionError(f"expected 37 instruments, found {len(instruments)}")

    listed_cex_markets = 0
    contract_backed_dex_routes = 0
    validated_option_contracts = 0
    validated_earnings_profiles = 0
    validated_term_profiles = 0
    for instrument in instruments:
        slug = str(instrument["slug"])
        payload = load_json(DATA_ROOT / f"{slug}.json")
        page_path = SITE_ROOT / slug / "index.html"
        if not page_path.exists():
            raise AssertionError(f"{slug}: generated page is missing")
        page_markup = page_path.read_text()
        if 'class="chart-foot"' in page_markup:
            raise AssertionError(f"{slug}: obsolete data-availability box remains")
        onchain = payload["onchainSpot"]
        if onchain.get("venueSplit") is not True:
            raise AssertionError(f"{slug}: CEX/DEX split is disabled")

        cex_rows = onchain.get("cexMarkets", [])
        venues = {str(row.get("venue")) for row in cex_rows}
        if slug not in {"btc", "eth"} and venues != EXPECTED_CEX_VENUES:
            raise AssertionError(
                f"{slug}: expected {sorted(EXPECTED_CEX_VENUES)}, found {sorted(venues)}"
            )
        if slug in {"btc", "eth"} and cex_rows:
            raise AssertionError(f"{slug}: tokenized-stock CEX rows must not be attached to native crypto")
        listed = [
            row
            for row in cex_rows
            if row.get("listed") and row.get("kind") == "orderBook"
        ]
        leaders = [row for row in listed if row.get("marketLeader")]
        if len(leaders) != (1 if listed else 0):
            raise AssertionError(f"{slug}: invalid CEX market-leader assignment")
        listed_cex_markets += len(listed)

        for market in onchain.get("markets", []):
            for venue in market.get("directVenues", []):
                if venue.get("kind") == "orderBook":
                    raise AssertionError(
                        f"{slug}: CEX order book leaked into DEX wrapper data"
                    )
                if venue.get("kind") not in DEX_KINDS:
                    continue
                token_contract = venue.get("assetContract") or market.get(
                    "primaryDeployment", {}
                ).get("address")
                route_contract = venue.get("poolAddress") or venue.get(
                    "routeContracts"
                )
                if not token_contract or not route_contract:
                    raise AssertionError(
                        f"{slug}: {venue.get('venue')} lacks token or route contract"
                    )
                contract_backed_dex_routes += 1

        symbol = str(instrument["symbol"]).upper()
        options = payload.get("earningsOptions")
        if symbol not in OPTIONS_PROFILES:
            if symbol not in UNSUPPORTED_OPTIONS_PAGES:
                raise AssertionError(f"{slug}: options coverage is neither configured nor explicitly unsupported")
            if options:
                raise AssertionError(f"{slug}: unsupported options payload is attached")
            if 'class="earnings-options-panel"' in page_markup:
                raise AssertionError(f"{slug}: unsupported options panel is rendered")
            continue
        if not options:
            raise AssertionError(f"{slug}: listed-options payload is missing")
        profile = options_profile(symbol)
        if str(options.get("mode")) != profile["kind"]:
            raise AssertionError(f"{slug}: options mode does not match its profile")
        if str(options.get("underlierSymbol")) not in profile["underlierCandidates"]:
            raise AssertionError(f"{slug}: options underlier is outside its auditable candidates")
        contracts = options.get("contracts", [])
        if len(contracts) != int(options["chain"]["liquidContractsUsed"]):
            raise AssertionError(f"{slug}: liquid contract count does not match payload")
        maximum_spread = float(options["liquidityFilter"]["maxBidAskSpreadPct"])
        for contract in contracts:
            if not (float(contract["bid"]) > 0 and float(contract["ask"]) > float(contract["bid"])):
                raise AssertionError(f"{slug}: option row lacks a two-sided executable quote")
            if float(contract["spreadPct"]) > maximum_spread:
                raise AssertionError(f"{slug}: option row violates the published spread gate")
        expected_probabilities = [0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90]
        if options["mode"] == "earnings":
            earnings_date = str(options["earnings"]["date"])
            expiration = str(options["chain"]["expiration"])
            if expiration < earnings_date:
                raise AssertionError(f"{slug}: selected option expiry precedes earnings")
            probabilities = [float(row["probability"]) for row in options.get("fan", [])]
            if probabilities != expected_probabilities:
                raise AssertionError(f"{slug}: invalid earnings probability fan {probabilities}")
            historical = options.get("historicalAnalysis") or {}
            available_events = int(historical.get("availableEvents") or 0)
            recent_events = int(historical.get("primaryWindowEvents") or 0)
            if available_events < 4 or recent_events != min(12, available_events):
                raise AssertionError(f"{slug}: invalid comparable earnings-event count")
            structures = historical.get("structures") or []
            structure_kinds = [str(row.get("structure")) for row in structures]
            if (
                len(structures) != 5
                or structure_kinds.count("long straddle") != 1
                or structure_kinds.count("long call") != 2
                or structure_kinds.count("long put") != 2
            ):
                raise AssertionError(f"{slug}: expected one ATM straddle, two calls, and two puts")
            calls = [row for row in structures if row["structure"] == "long call"]
            puts = [row for row in structures if row["structure"] == "long put"]
            for side in (calls, puts):
                payouts = [float(row["trailing12"]["averageGrossPayoutMultiple"]) for row in side]
                if payouts != sorted(payouts, reverse=True):
                    raise AssertionError(f"{slug}: structures are not ordered by highest average payout")
            for structure in structures:
                if int(structure.get("minimumLegVolume") or 0) < 25:
                    raise AssertionError(f"{slug}: historical structure violates the per-leg volume gate")
                recent = structure.get("trailing12") or {}
                if int(recent.get("events") or 0) != recent_events:
                    raise AssertionError(f"{slug}: historical structure uses the wrong recent window")
                if len(recent.get("outcomes") or []) != recent_events:
                    raise AssertionError(f"{slug}: historical payout tape is incomplete")
            validated_earnings_profiles += 1
        else:
            structures = options.get("structures") or []
            if len(structures) != 2 or {int(row["targetDays"]) for row in structures} != {30, 90}:
                raise AssertionError(f"{slug}: expected one 30-day and one 90-day ATM straddle target")
            if len({str(row["expiration"]) for row in structures}) != 2:
                raise AssertionError(f"{slug}: term straddles must use distinct expirations")
            for structure in structures:
                if structure.get("structure") != "long straddle":
                    raise AssertionError(f"{slug}: term structure is not a long straddle")
                if float(structure["call"]["strike"]) != float(structure["put"]["strike"]):
                    raise AssertionError(f"{slug}: term straddle legs do not share an ATM strike")
                probabilities = [float(row["probability"]) for row in structure.get("fan", [])]
                if probabilities != expected_probabilities:
                    raise AssertionError(f"{slug}: invalid term probability fan")
            validated_term_profiles += 1
        if 'id="historical-structure-rows"' not in page_markup:
            raise AssertionError(f"{slug}: selectable options table is missing")
        if page_markup.index('class="earnings-options-summary"') < page_markup.index('class="historical-table-scroll"'):
            raise AssertionError(f"{slug}: options summary must follow the options table")
        if "historical-play-card" in page_markup:
            raise AssertionError(f"{slug}: obsolete historical payout cards remain")
        validated_option_contracts += len(contracts)

    print(
        f"validated {len(instruments)} Market Lens pages: "
        f"{listed_cex_markets} listed CEX markets, "
        f"{contract_backed_dex_routes} contract-backed DEX routes, "
        f"{validated_option_contracts} liquid listed-option inputs across "
        f"{validated_earnings_profiles} earnings profiles and "
        f"{validated_term_profiles} term-straddle profiles"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
