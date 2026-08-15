#!/usr/bin/env python3
"""Refresh verified tokenized-equity deployments used by market pages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


SITE_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = SITE_ROOT / "assets" / "market-data" / "onchain-spot-catalog.json"
SYMBOLS = (
    "AAPL",
    "AMD",
    "CRCL",
    "CXMT",
    "GOOGL",
    "INTC",
    "META",
    "MRVL",
    "MSFT",
    "MU",
    "NVDA",
    "SKHX",
    "SMSN",
    "SNDK",
    "SPCX",
    "TSLA",
)
ROBINHOOD_SYMBOLS = {"SKHX": "SKHY"}
ONDO_IDS = {
    "AAPL": "apple-ondo-tokenized-stock",
    "AMD": "amd-ondo-tokenized-stock",
    "CRCL": "circle-internet-group-ondo-tokenized-stock",
    "GOOGL": "alphabet-class-a-ondo-tokenized-stock",
    "INTC": "intel-ondo-tokenized-stock",
    "META": "meta-platforms-ondo-tokenized-stock",
    "MRVL": "marvell-technology-ondo-tokenized-stock",
    "MSFT": "microsoft-ondo-tokenized-stock",
    "MU": "micron-technology-ondo-tokenized-stock",
    "NVDA": "nvidia-ondo-tokenized-stock",
    "SKHX": "sk-hynix-ondo-tokenized",
    "SNDK": "sandisk-ondo-tokenized",
    "SPCX": "spacex-ondo-tokenized-stock",
    "TSLA": "tesla-ondo-tokenized-stock",
}
ONDO_TOKEN_SYMBOLS = {symbol: f"{symbol}on" for symbol in ONDO_IDS}
ONDO_TOKEN_SYMBOLS["SKHX"] = "SKHYon"
ADDITIONAL_COINGECKO_IDS = {
    "BTech / Binance": {
        "AAPL": "apple-bstocks-tokenized-stock",
        "CRCL": "circle-internet-group-bstock",
        "GOOGL": "alphabet-bstocks-tokenized-stock",
        "META": "meta-platforms-bstocks-tokenized-stock",
        "MRVL": "marvell-technology-bstocks-tokenized-stock",
        "MSFT": "microsoft-bstocks-tokenized-stock",
        "MU": "micron-technology-bstock",
        "NVDA": "nvidia-bstocks",
        "SKHX": "sk-hynix-bstocks-tokenized-stock",
        "SNDK": "sandisk-bstocks-tokenized-stock",
        "SPCX": "spacex-bstocks-tokenized-stock",
        "TSLA": "tesla-bstocks-tokenized-stock",
    },
    "Backpack": {
        "AAPL": "apple-backpack-securities",
        "AMD": "advanced-micro-devices-backpack-securities",
        "CRCL": "circle-internet-group-backpack-securities",
        "GOOGL": "alphabet-backpack-securities",
        "INTC": "intel-backpack-securities",
        "META": "meta-platforms-backpack-securities",
        "MRVL": "marvell-technology-backpack-securities",
        "MU": "micron-technology-backpack-securities",
        "NVDA": "nvidia-backpack-securities",
        "SKHX": "sk-hynix-backpack-securities",
        "SNDK": "sandisk-backpack-securities",
        "SPCX": "spacex-backpack-securities",
        "TSLA": "tesla-backpack-securities",
    },
    "Reality": {
        "AAPL": "apple-reality-protocol",
        "SPCX": "spacex-reality-protocol",
    },
}
ISSUER_DETAILS = {
    "Robinhood": {
        "issuerUrl": "https://robinhood.com/rhj/stocktokens/",
        "legalStructure": "Tokenized debt security",
    },
    "Ondo": {
        "issuerUrl": "https://ondo.finance/ondo-stocks",
        "legalStructure": "Equity-backed total-return token",
    },
    "xStocks": {
        "issuerUrl": "https://xstocks.com/",
        "legalStructure": "1:1 collateralized tracker certificate",
    },
    "BTech / Binance": {
        "issuerUrl": "https://academy.binance.com/en/articles/what-are-bstocks-a-guide-to-tokenized-stocks-on-binance",
        "legalStructure": "ADGM-listed certificate over shares",
        "primaryNetwork": "BNB Chain",
    },
    "Backpack": {
        "issuerUrl": "https://learn.backpack.exchange/blog/introducing-backpack-securities",
        "legalStructure": "Brokerage-linked tokenized security",
        "primaryNetwork": "Solana",
    },
    "Reality": {
        "issuerUrl": "https://www.bitget.com/academy/what-is-raapl-apple-tokenized-stock-bitget",
        "legalStructure": "Brokerage-backed economic exposure token",
        "primaryNetwork": "Arbitrum",
    },
}
NETWORK_NAMES = {
    "arbitrum-one": "Arbitrum",
    "Arbitrum": "Arbitrum",
    "Avalanche": "Avalanche",
    "Base": "Base",
    "BinanceSmartChain": "BNB Chain",
    "Ethereum": "Ethereum",
    "Gnosis": "Gnosis",
    "HyperEVM": "HyperEVM",
    "Ink": "Ink",
    "Mantle": "Mantle",
    "Optimism": "Optimism",
    "Polygon": "Polygon",
    "Solana": "Solana",
    "Sonic": "Sonic",
    "Ton": "TON",
    "Tron": "Tron",
    "XLayer": "X Layer",
    "ethereum": "Ethereum",
    "binance-smart-chain": "BNB Chain",
    "hyperevm": "HyperEVM",
    "solana": "Solana",
}
NETWORK_ORDER = {
    name: index
    for index, name in enumerate(
        (
            "Robinhood Chain",
            "Ethereum",
            "Solana",
            "HyperEVM",
            "Arbitrum",
            "BNB Chain",
            "Base",
            "Optimism",
            "Mantle",
            "Ink",
            "X Layer",
            "Polygon",
            "Avalanche",
            "Gnosis",
            "Sonic",
            "TON",
            "Tron",
        )
    )
}


def fetch_json(url: str) -> Any:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "Corbanu-Market-Lens/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def normalize_address(value: str) -> str:
    return value.removeprefix("svm:").removeprefix("ton:")


def deployments_sorted(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        network = NETWORK_NAMES.get(str(row["network"]), str(row["network"]))
        address = normalize_address(str(row["address"]))
        unique[(network, address.lower())] = {"network": network, "address": address}
    return sorted(unique.values(), key=lambda row: (NETWORK_ORDER.get(row["network"], 99), row["address"]))


def market(
    *,
    issuer: str,
    token_symbol: str,
    name: str,
    deployments: list[dict[str, Any]],
    source_url: str,
    primary_network: str,
    coingecko_id: str | None = None,
) -> dict[str, Any]:
    normalized = deployments_sorted(deployments)
    primary = next((row for row in normalized if row["network"] == primary_network), normalized[0])
    details = ISSUER_DETAILS[issuer]
    return {
        "issuer": issuer,
        "issuerUrl": details["issuerUrl"],
        "legalStructure": details["legalStructure"],
        "tokenSymbol": token_symbol,
        "name": name,
        "sourceUrl": source_url,
        "coingeckoId": coingecko_id,
        "marketDataUrl": f"https://www.coingecko.com/en/coins/{coingecko_id}" if coingecko_id else None,
        "primaryDeployment": primary,
        "deployments": normalized,
        "queryAddresses": list(dict.fromkeys(row["address"] for row in normalized)),
    }


def coingecko_id_for_token(
    rows: list[dict[str, Any]], token_symbol: str, name_marker: str
) -> str | None:
    matches = [
        row["id"]
        for row in rows
        if str(row.get("symbol", "")).casefold() == token_symbol.casefold()
        and name_marker.casefold() in str(row.get("name", "")).casefold()
    ]
    return matches[0] if len(matches) == 1 else None


def additional_token_symbol(issuer: str, asset: dict[str, Any]) -> str:
    symbol = str(asset["symbol"])
    if issuer == "Reality" and symbol.casefold().startswith("r"):
        return f"r{symbol[1:].upper()}"
    return symbol.upper()


def main() -> None:
    robinhood = fetch_json("https://api.robinhood.com/rhj/assets")["assets"]
    robinhood_by_symbol = {row["tokenSymbol"]: row for row in robinhood if row.get("status") == "ASSET_STATUS_ACTIVE"}
    backed = fetch_json("https://api.backed.fi/rest/tokens")["nodes"]
    xstocks_by_symbol = {
        row["underlyingSymbol"]: row
        for row in backed
        if str(row.get("symbol", "")).endswith("x") and not row.get("isTradingHalted", False)
    }
    coingecko = fetch_json("https://api.coingecko.com/api/v3/coins/list?include_platform=true")
    coingecko_by_id = {row["id"]: row for row in coingecko}

    instruments: dict[str, list[dict[str, Any]]] = {}
    for symbol in SYMBOLS:
        rows: list[dict[str, Any]] = []

        robinhood_symbol = ROBINHOOD_SYMBOLS.get(symbol, symbol)
        robinhood_asset = robinhood_by_symbol.get(robinhood_symbol)
        if robinhood_asset:
            robinhood_coingecko_id = coingecko_id_for_token(
                coingecko, robinhood_asset["tokenSymbol"], "Robinhood Token"
            )
            rows.append(
                market(
                    issuer="Robinhood",
                    token_symbol=robinhood_asset["tokenSymbol"],
                    name=robinhood_asset["tokenName"],
                    deployments=[
                        {
                            "network": deployment.get("networkName") or "Robinhood Chain",
                            "address": deployment["contractAddress"],
                        }
                        for deployment in robinhood_asset["deployments"]
                    ],
                    source_url="https://api.robinhood.com/rhj/assets",
                    primary_network="Robinhood Chain",
                    coingecko_id=robinhood_coingecko_id,
                )
            )

        ondo_id = ONDO_IDS.get(symbol)
        ondo_asset = coingecko_by_id.get(ondo_id) if ondo_id else None
        if ondo_asset:
            rows.append(
                market(
                    issuer="Ondo",
                    token_symbol=ONDO_TOKEN_SYMBOLS[symbol],
                    name=ondo_asset["name"],
                    deployments=[
                        {"network": network, "address": address}
                        for network, address in ondo_asset.get("platforms", {}).items()
                        if address
                    ],
                    source_url=f"https://app.ondo.finance/assets/{ONDO_TOKEN_SYMBOLS[symbol].lower()}",
                    primary_network="Ethereum",
                    coingecko_id=ondo_id,
                )
            )

        xstock = xstocks_by_symbol.get(symbol)
        if xstock:
            xstock_coingecko_id = coingecko_id_for_token(
                coingecko, xstock["symbol"], "xStock"
            )
            rows.append(
                market(
                    issuer="xStocks",
                    token_symbol=xstock["symbol"],
                    name=xstock["name"],
                    deployments=xstock["deployments"],
                    source_url="https://api.backed.fi/rest/tokens",
                    primary_network="Solana",
                    coingecko_id=xstock_coingecko_id,
                )
            )

        for issuer, ids_by_symbol in ADDITIONAL_COINGECKO_IDS.items():
            coingecko_id = ids_by_symbol.get(symbol)
            asset = coingecko_by_id.get(coingecko_id) if coingecko_id else None
            if not asset:
                continue
            details = ISSUER_DETAILS[issuer]
            rows.append(
                market(
                    issuer=issuer,
                    token_symbol=additional_token_symbol(issuer, asset),
                    name=asset["name"],
                    deployments=[
                        {"network": network, "address": address}
                        for network, address in asset.get("platforms", {}).items()
                        if address
                    ],
                    source_url=f"https://www.coingecko.com/en/coins/{coingecko_id}",
                    primary_network=details["primaryNetwork"],
                    coingecko_id=coingecko_id,
                )
            )

        instruments[symbol.lower()] = rows

    coingecko_ids = sorted(
        {
            row["coingeckoId"]
            for rows in instruments.values()
            for row in rows
            if row.get("coingeckoId")
        }
    )
    market_stats = fetch_json(
        "https://api.coingecko.com/api/v3/coins/markets"
        f"?vs_currency=usd&ids={','.join(coingecko_ids)}&sparkline=false"
    )
    stats_by_id = {row["id"]: row for row in market_stats}
    for rows in instruments.values():
        for row in rows:
            stats = stats_by_id.get(row.get("coingeckoId"), {})
            row["allVenueVolumeUsd"] = stats.get("total_volume")
            row["marketCapUsd"] = stats.get("market_cap")
            row["marketDataUpdatedAt"] = stats.get("last_updated")
        rows.sort(
            key=lambda row: (
                float(row["allVenueVolumeUsd"]) if row.get("allVenueVolumeUsd") is not None else -1.0,
                float(row["marketCapUsd"]) if row.get("marketCapUsd") is not None else -1.0,
            ),
            reverse=True,
        )
        preferred_assigned = False
        for rank, row in enumerate(rows, start=1):
            row["volumeRank"] = rank if row.get("allVenueVolumeUsd") is not None else None
            row["preferred"] = bool(not preferred_assigned and row.get("allVenueVolumeUsd", 0) > 0)
            preferred_assigned = preferred_assigned or row["preferred"]

    payload = {
        "version": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "volumeSource": "https://api.coingecko.com/api/v3/coins/markets",
        "liquiditySource": "https://api.dexscreener.com/latest/dex/tokens/{address}",
        "preferenceBasis": "highest aggregate 24-hour spot volume across indexed CEX and DEX venues",
        "instruments": instruments,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(OUTPUT)
    counts = {symbol: len(rows) for symbol, rows in instruments.items()}
    print(f"wrote {OUTPUT} with {sum(counts.values())} markets: {counts}")


if __name__ == "__main__":
    main()
