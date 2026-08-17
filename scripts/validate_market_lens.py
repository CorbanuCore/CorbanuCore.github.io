#!/usr/bin/env python3
"""Validate generated Market Lens payloads before publication."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

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
    expected_peer_targets = int(universe.get("peerTargetCount") or 0)
    validated_peer_targets = 0
    for instrument in instruments:
        slug = str(instrument["slug"])
        payload = load_json(DATA_ROOT / f"{slug}.json")
        page_path = SITE_ROOT / slug / "index.html"
        if not page_path.exists():
            raise AssertionError(f"{slug}: generated page is missing")
        page_markup = page_path.read_text()
        if 'class="chart-foot"' in page_markup:
            raise AssertionError(f"{slug}: obsolete data-availability box remains")
        if not str(payload.get("rawSymbol") or "").strip():
            raise AssertionError(f"{slug}: Hyperliquid raw symbol is missing")
        if int(payload.get("version") or 0) != 2:
            raise AssertionError(f"{slug}: terminal-anchored payload version is missing")
        anchors = payload.get("terminalAnchors") or {}
        spot_rows = payload.get("spot") or []
        perp_rows = payload.get("perp") or []
        if not spot_rows or not perp_rows:
            raise AssertionError(f"{slug}: total-return price history is empty")
        for side, rows in (("spot", spot_rows), ("perp", perp_rows)):
            anchor = anchors.get(side) or {}
            terminal_price = float(anchor.get("price") or 0)
            if terminal_price <= 0 or abs(float(rows[-1]["c"]) - terminal_price) > 1e-5:
                raise AssertionError(f"{slug}: {side} history does not end at its raw terminal price")
            if any(float(row.get("r") or 0) <= 0 for row in rows):
                raise AssertionError(f"{slug}: {side} shared-anchor return factor is invalid")
        if "close at 100" in str(payload.get("basis") or "").lower():
            raise AssertionError(f"{slug}: obsolete arbitrary index basis remains")
        for required_markup in (
            'id="live-perp-module"',
            'id="live-perp-price"',
            'id="live-perp-change"',
            'id="live-perp-state"',
            'id="live-perp-announcer"',
        ):
            if required_markup not in page_markup:
                raise AssertionError(f"{slug}: live perp module is incomplete: {required_markup}")
        peer_mapping = payload.get("peerMapping")
        if bool(instrument.get("peerMapped")) != bool(peer_mapping):
            raise AssertionError(f"{slug}: universe peer flag and payload disagree")
        if peer_mapping:
            peer_rows = payload.get("peer") or []
            peers = peer_mapping.get("peers") or []
            if str(peer_mapping.get("model")) != "moonshotai/kimi-k3":
                raise AssertionError(f"{slug}: peer model is not locked Kimi K3")
            if float(peer_mapping.get("temperature")) != 0.0:
                raise AssertionError(f"{slug}: peer temperature is not zero")
            if int(peer_mapping.get("replicatesPerTarget") or 0) != 3:
                raise AssertionError(f"{slug}: peer mapping does not contain three validated blocks")
            if str(peer_mapping.get("target")) != str(instrument["symbol"]).upper():
                raise AssertionError(f"{slug}: peer mapping target differs from the page symbol")
            if not 3 <= len(peers) <= 9:
                raise AssertionError(f"{slug}: peer mapping must contain 3 to 9 stocks")
            peer_symbols = [str(peer.get("ticker") or "") for peer in peers]
            if len(peer_symbols) != len(set(peer_symbols)) or str(instrument["symbol"]).upper() in peer_symbols:
                raise AssertionError(f"{slug}: peer mapping contains a duplicate or the target")
            if abs(sum(float(peer.get("weight") or 0) for peer in peers) - 1.0) > 1e-5:
                raise AssertionError(f"{slug}: peer weights do not sum to one")
            if any(not str(peer.get("reason") or "").strip() for peer in peers):
                raise AssertionError(f"{slug}: peer rationale is missing")
            if any(float(peer.get("day_notional_volume_usd") or 0) <= 0 for peer in peers):
                raise AssertionError(f"{slug}: peer liquidity snapshot is missing")
            if any(float(peer.get("liquidity_24h_usd_millions") or 0) <= 0 for peer in peers):
                raise AssertionError(f"{slug}: peer liquidity display value is missing")
            if any(not 1 <= int(peer.get("replicate_support") or 0) <= 3 for peer in peers):
                raise AssertionError(f"{slug}: peer replicate support is invalid")
            hedge = peer_mapping.get("primary_index_hedge") or {}
            if not str(hedge.get("ticker") or "").strip() or not str(hedge.get("reason") or "").strip():
                raise AssertionError(f"{slug}: primary index hedge is incomplete")
            if float(hedge.get("day_notional_volume_usd") or 0) <= 0 or float(hedge.get("liquidity_24h_usd_millions") or 0) <= 0:
                raise AssertionError(f"{slug}: primary index hedge liquidity snapshot is missing")
            if not peer_rows or str(peer_mapping.get("historyStart")) != str(peer_rows[0].get("d")):
                raise AssertionError(f"{slug}: weighted peer history is missing its audited start")
            if str(peer_mapping.get("historyEnd")) != str(peer_rows[-1].get("d")):
                raise AssertionError(f"{slug}: weighted peer history is missing its audited end")
            spot_by_date = {str(row["d"]): float(row["c"]) for row in spot_rows}
            first_peer_date = str(peer_rows[0]["d"])
            if first_peer_date not in spot_by_date or abs(float(peer_rows[0]["c"]) - spot_by_date[first_peer_date]) > 1e-5:
                raise AssertionError(f"{slug}: peer history is not rebased to the target spot level")
            if any(float(row.get("c") or 0) <= 0 for row in peer_rows):
                raise AssertionError(f"{slug}: weighted peer history contains an invalid level")
            if any(not 3 <= int(row.get("n") or 0) <= len(peers) for row in peer_rows):
                raise AssertionError(f"{slug}: weighted peer history has invalid active-peer breadth")
            if str(payload.get("spotStart")) < "2020-01-01":
                lag = (
                    pd.Timestamp(first_peer_date) - pd.Timestamp(str(payload["spotStart"]))
                ).days
                if lag > 10:
                    raise AssertionError(f"{slug}: peer spot backfill starts {lag} days after target spot")
            live_splice = peer_mapping.get("liveSplice") or {}
            live_inputs = live_splice.get("inputs") or []
            if live_splice.get("dex") != "xyz" or len(live_inputs) != len(peers):
                raise AssertionError(f"{slug}: live TradeXYZ peer splice is incomplete")
            if str(live_splice.get("baseDate")) != str(peer_rows[-1]["d"]):
                raise AssertionError(f"{slug}: live peer splice base date differs from spot history")
            if abs(float(live_splice.get("baseLevel") or 0) - float(peer_rows[-1]["c"])) > 1e-5:
                raise AssertionError(f"{slug}: live peer splice base level differs from spot history")
            live_symbols = [str(row.get("raw_symbol") or "") for row in live_inputs]
            if live_symbols != [str(peer.get("raw_symbol") or "") for peer in peers]:
                raise AssertionError(f"{slug}: live peer splice symbols differ from the mapping")
            if any(float(row.get("spot_close_usd") or 0) <= 0 or not str(row.get("spot_close_date") or "") for row in live_inputs):
                raise AssertionError(f"{slug}: live peer splice lacks a positive USD cash close")
            for required_markup in ('class="legend-peer"', 'class="peer-panel"', 'class="peer-table"'):
                if required_markup not in page_markup:
                    raise AssertionError(f"{slug}: peer chart or justification block is missing: {required_markup}")
            validated_peer_targets += 1
        elif 'class="peer-panel"' in page_markup or 'class="legend-peer"' in page_markup:
            raise AssertionError(f"{slug}: peer UI is rendered without a validated mapping")

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
        for required_control in (
            'data-distribution-center="spot"',
            'data-distribution-center="perp"',
        ):
            if required_control not in page_markup:
                raise AssertionError(f"{slug}: distribution-center control is missing: {required_control}")
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

    if validated_peer_targets != expected_peer_targets:
        raise AssertionError(
            f"validated {validated_peer_targets} peer targets, expected {expected_peer_targets}"
        )
    print(
        f"validated {len(instruments)} Market Lens pages: "
        f"{validated_peer_targets} Kimi K3 peer charts, "
        f"{listed_cex_markets} listed CEX markets, "
        f"{contract_backed_dex_routes} contract-backed DEX routes, "
        f"{validated_option_contracts} liquid listed-option inputs across "
        f"{validated_earnings_profiles} earnings profiles and "
        f"{validated_term_profiles} term-straddle profiles"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
