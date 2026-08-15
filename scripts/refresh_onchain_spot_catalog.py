#!/usr/bin/env python3
"""Refresh verified tokenized-equity deployments used by market pages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
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
BINANCE_API = "https://data-api.binance.vision/api/v3"
LBANK_API = "https://api.lbkex.com/v2"
METEORA_API = "https://dlmm.datapi.meteora.ag"
DEPTH_BAND_PCT = 2.0
MAJOR_SOLANA_QUOTES = {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD6K2eY4W7WMsF6gQ8h4uK": "USDT",
}


def fetch_json(url: str) -> Any:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "Corbanu-Market-Lens/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def utc_iso(timestamp_ms: int | float | None = None) -> str:
    observed = (
        datetime.fromtimestamp(float(timestamp_ms) / 1000.0, tz=timezone.utc)
        if timestamp_ms is not None
        else datetime.now(timezone.utc)
    )
    return observed.isoformat().replace("+00:00", "Z")


def order_book_snapshot(
    *,
    venue: str,
    pair: str,
    base_symbol: str,
    bids: list[list[str]],
    asks: list[list[str]],
    last_price: str | float,
    quote_volume: str | float,
    observed_at: str,
    source_url: str,
    trade_url: str,
    live_adapter: str | None = None,
) -> dict[str, Any]:
    normalized_bids = sorted(
        ((float(price), float(quantity)) for price, quantity in bids), reverse=True
    )
    normalized_asks = sorted(
        (float(price), float(quantity)) for price, quantity in asks
    )
    if not normalized_bids or not normalized_asks:
        raise RuntimeError(f"{venue} returned an empty book for {pair}")
    best_bid = normalized_bids[0][0]
    best_ask = normalized_asks[0][0]
    mid = (best_bid + best_ask) / 2.0
    lower = mid * (1.0 - DEPTH_BAND_PCT / 100.0)
    upper = mid * (1.0 + DEPTH_BAND_PCT / 100.0)
    sell_depth = sum(price * quantity for price, quantity in normalized_bids if price >= lower)
    buy_depth = sum(price * quantity for price, quantity in normalized_asks if price <= upper)
    return {
        "kind": "orderBook",
        "venue": venue,
        "pair": pair,
        "baseSymbol": base_symbol,
        "quoteSymbol": "USDT",
        "lastPrice": float(last_price),
        "bestBid": best_bid,
        "bestAsk": best_ask,
        "midPrice": mid,
        "spreadBps": (best_ask / best_bid - 1.0) * 10_000.0,
        "depthBandPct": DEPTH_BAND_PCT,
        "buyDepthUsd": buy_depth,
        "sellDepthUsd": sell_depth,
        "buyDepthComplete": normalized_asks[-1][0] >= upper,
        "sellDepthComplete": normalized_bids[-1][0] <= lower,
        "quoteVolume24hUsd": float(quote_volume),
        "observedAt": observed_at,
        "sourceUrl": source_url,
        "tradeUrl": trade_url,
        "liveAdapter": live_adapter,
    }


def binance_book(base_symbol: str, pair: str) -> dict[str, Any]:
    depth_url = f"{BINANCE_API}/depth?symbol={pair}&limit=1000"
    ticker_url = f"{BINANCE_API}/ticker/24hr?symbol={pair}"
    depth = fetch_json(depth_url)
    ticker = fetch_json(ticker_url)
    return order_book_snapshot(
        venue="Binance",
        pair=f"{base_symbol}/USDT",
        base_symbol=base_symbol,
        bids=depth["bids"],
        asks=depth["asks"],
        last_price=ticker["lastPrice"],
        quote_volume=ticker["quoteVolume"],
        observed_at=utc_iso(ticker["closeTime"]),
        source_url=depth_url,
        trade_url=f"https://www.binance.com/en/trade/{base_symbol}_USDT?type=spot",
        live_adapter="binanceSpot",
    )


def lbank_book(base_symbol: str, pair: str) -> dict[str, Any]:
    depth_url = f"{LBANK_API}/depth.do?symbol={pair}&size=200"
    ticker_url = f"{LBANK_API}/ticker/24hr.do?symbol={pair}"
    depth = fetch_json(depth_url)["data"]
    ticker_payload = fetch_json(ticker_url)
    ticker_row = ticker_payload["data"][0]
    ticker = ticker_row["ticker"]
    return order_book_snapshot(
        venue="LBank",
        pair=f"{base_symbol}/USDT",
        base_symbol=base_symbol,
        bids=depth["bids"],
        asks=depth["asks"],
        last_price=ticker["latest"],
        quote_volume=ticker["turnover"],
        observed_at=utc_iso(ticker_row.get("timestamp") or ticker_payload.get("ts")),
        source_url=depth_url,
        trade_url=f"https://www.lbank.com/trade/{pair}",
    )


def meteora_pool(token_address: str) -> dict[str, Any] | None:
    query_url = f"{METEORA_API}/pools?{urlencode({'query': token_address, 'page_size': 100, 'sort_by': 'tvl:desc'})}"
    payload = fetch_json(query_url)
    eligible: list[tuple[dict[str, Any], dict[str, Any], bool]] = []
    for pool in payload.get("data", []):
        token_x = pool.get("token_x", {})
        token_y = pool.get("token_y", {})
        target_is_x = str(token_x.get("address")) == token_address
        target_is_y = str(token_y.get("address")) == token_address
        quote = token_y if target_is_x else token_x if target_is_y else {}
        if (
            str(quote.get("address")) in MAJOR_SOLANA_QUOTES
            and float(pool.get("current_price") or 0.0) > 0.0
            and float(pool.get("tvl") or 0.0) > 0.0
        ):
            eligible.append((pool, quote, target_is_x))
    if not eligible:
        return None
    pool, quote, target_is_x = max(
        eligible, key=lambda item: float(item[0].get("tvl") or 0.0)
    )
    raw_price = float(pool["current_price"])
    price = raw_price if target_is_x else 1.0 / raw_price
    address = str(pool["address"])
    return {
        "kind": "ammPool",
        "venue": "Meteora",
        "pair": str(pool["name"]),
        "quoteSymbol": str(quote.get("symbol") or MAJOR_SOLANA_QUOTES[str(quote["address"])]),
        "lastPrice": price,
        "poolTvlUsd": float(pool.get("tvl") or 0.0),
        "quoteVolume24hUsd": float(pool.get("volume", {}).get("24h") or 0.0),
        "feePct": float(pool.get("dynamic_fee_pct") or pool.get("pool_config", {}).get("base_fee_pct") or 0.0),
        "observedAt": utc_iso(),
        "sourceUrl": f"{METEORA_API}/pools/{address}",
        "tradeUrl": f"https://app.meteora.ag/dlmm/{address}",
        "poolAddress": address,
        "targetSide": "x" if target_is_x else "y",
        "liveAdapter": "meteoraDlmm",
    }


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
    binance_pairs = {
        str(row["symbol"])
        for row in fetch_json(f"{BINANCE_API}/exchangeInfo")["symbols"]
        if row.get("status") == "TRADING" and row.get("quoteAsset") == "USDT"
    }
    lbank_pairs = set(fetch_json(f"{LBANK_API}/currencyPairs.do")["data"])

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

    for symbol, rows in instruments.items():
        for row in rows:
            direct_venues: list[dict[str, Any]] = []
            token_symbol = str(row["tokenSymbol"])
            binance_pair = f"{token_symbol.upper()}USDT"
            if binance_pair in binance_pairs:
                try:
                    direct_venues.append(binance_book(token_symbol.upper(), binance_pair))
                except Exception as error:
                    print(f"warning: Binance {binance_pair}: {error}")

            lbank_pair = f"{token_symbol.lower()}_usdt"
            if lbank_pair in lbank_pairs:
                try:
                    direct_venues.append(lbank_book(token_symbol.upper(), lbank_pair))
                except Exception as error:
                    print(f"warning: LBank {lbank_pair}: {error}")

            solana_deployments = [
                deployment
                for deployment in row.get("deployments", [])
                if deployment.get("network") == "Solana"
            ]
            for deployment in solana_deployments:
                try:
                    pool = meteora_pool(str(deployment["address"]))
                except Exception as error:
                    print(f"warning: Meteora {symbol} {deployment['address']}: {error}")
                    pool = None
                if pool:
                    direct_venues.append(pool)
                    break

            direct_venues.sort(
                key=lambda venue: float(venue.get("quoteVolume24hUsd") or 0.0),
                reverse=True,
            )
            row["directVenues"] = direct_venues
            row["directVenueVolumeUsd"] = sum(
                float(venue.get("quoteVolume24hUsd") or 0.0)
                for venue in direct_venues
            )
            row.pop("marketDataUrl", None)

        rows.sort(
            key=lambda row: float(row.get("directVenueVolumeUsd") or 0.0),
            reverse=True,
        )
        preferred_assigned = False
        for rank, row in enumerate(rows, start=1):
            has_volume = float(row.get("directVenueVolumeUsd") or 0.0) > 0
            row["volumeRank"] = rank if has_volume else None
            row["preferred"] = bool(not preferred_assigned and has_volume)
            preferred_assigned = preferred_assigned or row["preferred"]

    payload = {
        "version": 3,
        "generatedAt": utc_iso(),
        "volumeSource": "direct Binance, LBank, and Meteora venue APIs",
        "liquiditySource": "direct order books within 2% of mid and direct Meteora pool state",
        "preferenceBasis": "highest summed 24-hour turnover across directly queried venues",
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
