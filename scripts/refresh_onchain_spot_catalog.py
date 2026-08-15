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
NETWORK_NAMES = {
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
) -> dict[str, Any]:
    normalized = deployments_sorted(deployments)
    primary = next((row for row in normalized if row["network"] == primary_network), normalized[0])
    return {
        "issuer": issuer,
        "tokenSymbol": token_symbol,
        "name": name,
        "sourceUrl": source_url,
        "primaryDeployment": primary,
        "deployments": normalized,
        "queryAddresses": list(dict.fromkeys(row["address"] for row in normalized)),
    }


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
    ondo_by_id = {row["id"]: row for row in coingecko if row["id"] in set(ONDO_IDS.values())}

    instruments: dict[str, list[dict[str, Any]]] = {}
    for symbol in SYMBOLS:
        rows: list[dict[str, Any]] = []

        robinhood_symbol = ROBINHOOD_SYMBOLS.get(symbol, symbol)
        robinhood_asset = robinhood_by_symbol.get(robinhood_symbol)
        if robinhood_asset:
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
                )
            )

        ondo_id = ONDO_IDS.get(symbol)
        ondo_asset = ondo_by_id.get(ondo_id) if ondo_id else None
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
                )
            )

        xstock = xstocks_by_symbol.get(symbol)
        if xstock:
            rows.append(
                market(
                    issuer="xStocks",
                    token_symbol=xstock["symbol"],
                    name=xstock["name"],
                    deployments=xstock["deployments"],
                    source_url="https://api.backed.fi/rest/tokens",
                    primary_network="Solana",
                )
            )

        instruments[symbol.lower()] = rows

    payload = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "liquiditySource": "https://api.dexscreener.com/latest/dex/tokens/{address}",
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
