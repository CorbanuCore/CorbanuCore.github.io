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
ROBINHOOD_PRICE_API = "https://api.robinhood.com/rhj/prices"
ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com"
ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
ROBINHOOD_UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
ROBINHOOD_UNISWAP_QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7"
ROBINHOOD_UNISWAP_TRADE = "https://app.uniswap.org/swap?chain=robinhood"
BSC_RPC = "https://bsc-dataseed.binance.org"
BSC_USDT = "0x55d398326f99059fF775485246999027B3197955"
PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865"
PANCAKE_V3_QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"
PANCAKE_SWAP = "https://pancakeswap.finance/swap?chain=bsc"
DEXSCREENER_PAIR_API = "https://api.dexscreener.com/latest/dex/pairs/bsc"
UNISWAP_V3_FEES = (100, 500, 3000, 10000)
PANCAKE_V3_FEES = (100, 500, 2500, 10000)
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


def robinhood_reference(asset: dict[str, Any]) -> dict[str, Any]:
    """Return Robinhood's official token-equivalent reference bid and ask.

    The API quote is for one unit of the underlying. Robinhood documents that
    callers must apply currentMultiplier to express the value of one token.
    Its dailyTradingVolume is underlying-share volume, so it is deliberately
    excluded from direct venue turnover.
    """
    token_symbol = str(asset["tokenSymbol"])
    price_url = f"{ROBINHOOD_PRICE_API}/{token_symbol}"
    payload = fetch_json(price_url)
    quote = next(
        row
        for row in payload.get("quotes", [])
        if str(row.get("tokenSymbol")) == token_symbol
    )
    multiplier = float(asset.get("currentMultiplier") or 1.0)
    bid = float(quote["bid"]) * multiplier
    ask = float(quote["ask"]) * multiplier
    if bid <= 0.0 or ask <= 0.0 or ask < bid:
        raise RuntimeError(f"Robinhood returned an invalid quote for {token_symbol}")
    deployment = asset["deployments"][0]
    contract = str(deployment["contractAddress"])
    return {
        "kind": "referenceQuote",
        "venue": "Robinhood",
        "pair": f"{token_symbol}/USD reference",
        "baseSymbol": token_symbol,
        "quoteSymbol": "USD",
        "lastPrice": (bid + ask) / 2.0,
        "midPrice": (bid + ask) / 2.0,
        "bestBid": bid,
        "bestAsk": ask,
        "spreadBps": (ask / bid - 1.0) * 10_000.0,
        "currentMultiplier": multiplier,
        "mintBurnTokenVolume24h": float(quote.get("mintBurnTokenVolume") or 0.0),
        "mintBurnUsdVolume24h": float(quote.get("mintBurnUsdVolume") or 0.0),
        "underlyingVolume24hShares": float(quote.get("dailyTradingVolume") or 0.0),
        "isTradingHalt": bool(quote.get("isTradingHalt")),
        "observedAt": str(quote["generatedAt"]),
        "sourceUrl": price_url,
        "tradeUrl": (
            f"{ROBINHOOD_UNISWAP_TRADE}"
            f"&outputCurrency={contract}"
        ),
        "routeVenue": "Uniswap / Pleiades",
        "liquidityMeasurement": "unmeasured",
        "referenceOnly": True,
    }


def rpc_eth_calls(
    calls: list[tuple[str, str]], rpc_url: str = ROBINHOOD_RPC
) -> list[str | None]:
    payload = [
        {
            "jsonrpc": "2.0",
            "id": index,
            "method": "eth_call",
            "params": [{"to": address, "data": data}, "latest"],
        }
        for index, (address, data) in enumerate(calls)
    ]
    request = Request(
        rpc_url,
        data=json.dumps(payload).encode(),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Corbanu-Market-Lens/1.0",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    by_id = {int(row["id"]): row.get("result") for row in result}
    return [by_id.get(index) for index in range(len(calls))]


def contract_call_data(signature: str, types: list[str], values: list[Any]) -> str:
    from eth_abi import encode
    from eth_utils import keccak

    return "0x" + (keccak(text=signature)[:4] + encode(types, values)).hex()


def quoter_call(
    token_in: str,
    token_out: str,
    amount_in: int,
    fee: int,
    quoter_address: str = ROBINHOOD_UNISWAP_QUOTER,
) -> tuple[str, str]:
    data = contract_call_data(
        "quoteExactInputSingle((address,address,uint256,uint24,uint160))",
        ["(address,address,uint256,uint24,uint160)"],
        [(token_in, token_out, amount_in, fee, 0)],
    )
    return quoter_address, data


def decode_quote(result: str | None) -> int | None:
    if not result:
        return None
    try:
        from eth_abi import decode

        amount_out, _, _, _ = decode(
            ["uint256", "uint160", "uint32", "uint256"],
            bytes.fromhex(result.removeprefix("0x")),
        )
        return int(amount_out)
    except Exception:
        return None


def quoted_depth(
    *,
    token_in: str,
    token_out: str,
    fee: int,
    input_decimals: int,
    output_decimals: int,
    baseline_input: float,
    adverse_side: str,
    rpc_url: str = ROBINHOOD_RPC,
    quoter_address: str = ROBINHOOD_UNISWAP_QUOTER,
) -> tuple[float, float, bool]:
    """Return output at the largest sampled input within 2% of baseline execution."""
    sizes = [baseline_input * (2**index) for index in range(20)]
    raw_inputs = [max(1, int(size * 10**input_decimals)) for size in sizes]
    outputs = [
        decode_quote(result)
        for result in rpc_eth_calls(
            [
                quoter_call(token_in, token_out, amount, fee, quoter_address)
                for amount in raw_inputs
            ],
            rpc_url,
        )
    ]

    baseline_out = outputs[0]
    if not baseline_out:
        raise RuntimeError("baseline quote failed")
    baseline_output = baseline_out / 10**output_decimals
    baseline_rate = baseline_output / sizes[0]
    if baseline_rate <= 0.0:
        raise RuntimeError("baseline quote was zero")

    def acceptable(index: int) -> bool:
        output = outputs[index]
        if not output:
            return False
        rate = (output / 10**output_decimals) / sizes[index]
        if adverse_side == "lower":
            return rate >= baseline_rate * (1.0 - DEPTH_BAND_PCT / 100.0)
        return rate <= baseline_rate * (1.0 + DEPTH_BAND_PCT / 100.0)

    passing = [index for index in range(len(sizes)) if acceptable(index)]
    accepted_index = max(passing) if passing else 0
    reached_cap = accepted_index == len(sizes) - 1
    accepted_input = sizes[accepted_index]
    accepted_output = float(outputs[accepted_index] or 0) / 10**output_decimals

    if not reached_cap and accepted_index + 1 < len(sizes):
        lower = accepted_input
        upper = sizes[accepted_index + 1]
        refinements = [
            lower + (upper - lower) * step / 12.0
            for step in range(1, 12)
        ]
        refinement_inputs = [
            max(1, int(size * 10**input_decimals)) for size in refinements
        ]
        refinement_outputs = [
            decode_quote(result)
            for result in rpc_eth_calls(
                [
                    quoter_call(token_in, token_out, amount, fee, quoter_address)
                    for amount in refinement_inputs
                ],
                rpc_url,
            )
        ]
        for size, output in zip(refinements, refinement_outputs):
            if not output:
                continue
            rate = (output / 10**output_decimals) / size
            passes = (
                rate >= baseline_rate * (1.0 - DEPTH_BAND_PCT / 100.0)
                if adverse_side == "lower"
                else rate <= baseline_rate * (1.0 + DEPTH_BAND_PCT / 100.0)
            )
            if passes:
                accepted_input = size
                accepted_output = output / 10**output_decimals

    return accepted_input, accepted_output, reached_cap


def uniswap_v3_pool(
    asset: dict[str, Any],
    reference: dict[str, Any],
) -> dict[str, Any] | None:
    deployment = next(
        (
            row
            for row in asset.get("deployments", [])
            if int(row.get("chainId") or 0) == 4663
        ),
        None,
    )
    if not deployment:
        return None
    token = str(deployment["contractAddress"])
    token_symbol = str(asset["tokenSymbol"])
    token_decimals = int(asset.get("tokenDecimals") or 18)

    factory_calls = [
        (
            ROBINHOOD_UNISWAP_V3_FACTORY,
            contract_call_data(
                "getPool(address,address,uint24)",
                ["address", "address", "uint24"],
                [ROBINHOOD_USDG, token, fee],
            ),
        )
        for fee in UNISWAP_V3_FEES
    ]
    pool_results = rpc_eth_calls(factory_calls)
    pools = [
        (fee, "0x" + result[-40:])
        for fee, result in zip(UNISWAP_V3_FEES, pool_results)
        if result and int(result, 16) != 0
    ]
    if not pools:
        return None

    reference_mid = float(reference["midPrice"])
    baseline_usd = 10.0
    baseline_token = baseline_usd / reference_mid
    baseline_calls: list[tuple[str, str]] = []
    for fee, _ in pools:
        baseline_calls.extend(
            [
                quoter_call(
                    ROBINHOOD_USDG,
                    token,
                    int(baseline_usd * 10**6),
                    fee,
                ),
                quoter_call(
                    token,
                    ROBINHOOD_USDG,
                    int(baseline_token * 10**token_decimals),
                    fee,
                ),
            ]
        )
    baseline_results = rpc_eth_calls(baseline_calls)
    candidates: list[tuple[float, int, str, float, float]] = []
    for index, (fee, pool) in enumerate(pools):
        bought_raw = decode_quote(baseline_results[index * 2])
        sold_raw = decode_quote(baseline_results[index * 2 + 1])
        if not bought_raw or not sold_raw:
            continue
        bought = bought_raw / 10**token_decimals
        sold_usd = sold_raw / 10**6
        buy_price = baseline_usd / bought
        sell_price = sold_usd / baseline_token
        if buy_price <= 0.0 or sell_price <= 0.0 or buy_price < sell_price:
            continue
        spread_bps = (buy_price / sell_price - 1.0) * 10_000.0
        candidates.append((spread_bps, fee, pool, buy_price, sell_price))
    if not candidates:
        return None
    _, fee, pool, buy_price, sell_price = min(candidates)

    buy_input_usd, _, buy_reached_cap = quoted_depth(
        token_in=ROBINHOOD_USDG,
        token_out=token,
        fee=fee,
        input_decimals=6,
        output_decimals=token_decimals,
        baseline_input=baseline_usd,
        adverse_side="lower",
    )
    _, sell_output_usd, sell_reached_cap = quoted_depth(
        token_in=token,
        token_out=ROBINHOOD_USDG,
        fee=fee,
        input_decimals=token_decimals,
        output_decimals=6,
        baseline_input=baseline_token,
        adverse_side="lower",
    )
    return {
        "kind": "ammQuoteDepth",
        "venue": "Uniswap V3",
        "pair": f"{token_symbol}/USDG",
        "baseSymbol": token_symbol,
        "quoteSymbol": "USDG",
        "lastPrice": (buy_price + sell_price) / 2.0,
        "midPrice": (buy_price + sell_price) / 2.0,
        "bestBid": sell_price,
        "bestAsk": buy_price,
        "spreadBps": (buy_price / sell_price - 1.0) * 10_000.0,
        "feePct": fee / 10_000.0,
        "depthBandPct": DEPTH_BAND_PCT,
        "buyDepthUsd": buy_input_usd,
        "sellDepthUsd": sell_output_usd,
        "buyDepthComplete": not buy_reached_cap,
        "sellDepthComplete": not sell_reached_cap,
        "observedAt": utc_iso(),
        "sourceUrl": f"https://robinhoodchain.blockscout.com/address/{pool}",
        "tradeUrl": (
            f"{ROBINHOOD_UNISWAP_TRADE}"
            f"&inputCurrency={ROBINHOOD_USDG}"
            f"&outputCurrency={token}"
        ),
        "poolAddress": pool,
        "feeTier": fee,
    }


def pancakeswap_v3_pool(
    token: str,
    token_symbol: str,
) -> dict[str, Any] | None:
    """Return a factory-verified PancakeSwap V3 USDT pool and direct quote depth."""
    decimals_result = rpc_eth_calls(
        [(token, contract_call_data("decimals()", [], []))], BSC_RPC
    )[0]
    if not decimals_result:
        raise RuntimeError("token decimals call failed")
    token_decimals = int(decimals_result, 16)

    factory_calls = [
        (
            PANCAKE_V3_FACTORY,
            contract_call_data(
                "getPool(address,address,uint24)",
                ["address", "address", "uint24"],
                [BSC_USDT, token, fee],
            ),
        )
        for fee in PANCAKE_V3_FEES
    ]
    pool_results = rpc_eth_calls(factory_calls, BSC_RPC)
    pools = [
        (fee, "0x" + result[-40:])
        for fee, result in zip(PANCAKE_V3_FEES, pool_results)
        if result and int(result, 16) != 0
    ]
    if not pools:
        return None

    baseline_usdt = 10.0
    buy_results = rpc_eth_calls(
        [
            quoter_call(
                BSC_USDT,
                token,
                int(baseline_usdt * 10**18),
                fee,
                PANCAKE_V3_QUOTER,
            )
            for fee, _ in pools
        ],
        BSC_RPC,
    )
    sell_calls: list[tuple[str, str]] = []
    sell_inputs: list[int | None] = []
    for (fee, _), buy_result in zip(pools, buy_results):
        bought_raw = decode_quote(buy_result)
        sell_inputs.append(bought_raw)
        sell_calls.append(
            quoter_call(
                token,
                BSC_USDT,
                int(bought_raw or 1),
                fee,
                PANCAKE_V3_QUOTER,
            )
        )
    sell_results = rpc_eth_calls(sell_calls, BSC_RPC)

    candidates: list[tuple[float, int, str, float, float, float]] = []
    for (fee, pool), bought_raw, sell_result in zip(pools, sell_inputs, sell_results):
        sold_raw = decode_quote(sell_result)
        if not bought_raw or not sold_raw:
            continue
        bought = bought_raw / 10**token_decimals
        sold_usdt = sold_raw / 10**18
        buy_price = baseline_usdt / bought
        sell_price = sold_usdt / bought
        if buy_price <= 0.0 or sell_price <= 0.0 or buy_price < sell_price:
            continue
        spread_bps = (buy_price / sell_price - 1.0) * 10_000.0
        candidates.append((spread_bps, fee, pool, buy_price, sell_price, bought))
    if not candidates:
        return None
    _, fee, pool, buy_price, sell_price, baseline_token = min(candidates)

    buy_input_usd, _, buy_reached_cap = quoted_depth(
        token_in=BSC_USDT,
        token_out=token,
        fee=fee,
        input_decimals=18,
        output_decimals=token_decimals,
        baseline_input=baseline_usdt,
        adverse_side="lower",
        rpc_url=BSC_RPC,
        quoter_address=PANCAKE_V3_QUOTER,
    )
    _, sell_output_usd, sell_reached_cap = quoted_depth(
        token_in=token,
        token_out=BSC_USDT,
        fee=fee,
        input_decimals=token_decimals,
        output_decimals=18,
        baseline_input=baseline_token,
        adverse_side="lower",
        rpc_url=BSC_RPC,
        quoter_address=PANCAKE_V3_QUOTER,
    )

    pool_stats: dict[str, Any] = {}
    stats_url = f"{DEXSCREENER_PAIR_API}/{pool}"
    try:
        stats_payload = fetch_json(stats_url)
        pool_stats = next(
            (
                row
                for row in stats_payload.get("pairs", [])
                if str(row.get("pairAddress", "")).lower() == pool.lower()
                and str(row.get("dexId", "")).lower() == "pancakeswap"
            ),
            {},
        )
    except Exception as error:
        print(f"warning: PancakeSwap pool stats {pool}: {error}")

    return {
        "kind": "ammQuoteDepth",
        "venue": "PancakeSwap V3",
        "pair": f"{token_symbol}/USDT",
        "baseSymbol": token_symbol,
        "quoteSymbol": "USDT",
        "lastPrice": (buy_price + sell_price) / 2.0,
        "midPrice": (buy_price + sell_price) / 2.0,
        "bestBid": sell_price,
        "bestAsk": buy_price,
        "spreadBps": (buy_price / sell_price - 1.0) * 10_000.0,
        "feePct": fee / 10_000.0,
        "depthBandPct": DEPTH_BAND_PCT,
        "buyDepthUsd": buy_input_usd,
        "sellDepthUsd": sell_output_usd,
        "buyDepthComplete": not buy_reached_cap,
        "sellDepthComplete": not sell_reached_cap,
        "poolTvlUsd": float(pool_stats.get("liquidity", {}).get("usd") or 0.0),
        "quoteVolume24hUsd": float(pool_stats.get("volume", {}).get("h24") or 0.0),
        "volumeMethod": "DexScreener indexed pool events",
        "observedAt": utc_iso(),
        "sourceUrl": f"https://bscscan.com/address/{pool}",
        "statsUrl": str(pool_stats.get("url") or stats_url),
        "tradeUrl": (
            f"{PANCAKE_SWAP}"
            f"&inputCurrency={BSC_USDT}"
            f"&outputCurrency={token}"
        ),
        "poolAddress": pool,
        "feeTier": fee,
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
            if row.get("issuer") == "Robinhood":
                robinhood_asset = robinhood_by_symbol.get(token_symbol)
                if robinhood_asset:
                    try:
                        reference = robinhood_reference(robinhood_asset)
                        direct_venues.append(reference)
                        pool = uniswap_v3_pool(robinhood_asset, reference)
                        if pool:
                            direct_venues.append(pool)
                    except Exception as error:
                        print(f"warning: Robinhood / Uniswap {token_symbol}: {error}")
            # Robinhood tokens settle on Robinhood Chain. A CEX pair sharing an
            # equity ticker can be an unrelated crypto asset (for example META),
            # so never attach symbol-only CEX matches to Robinhood deployments.
            if row.get("issuer") != "Robinhood":
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

            bsc_deployments = [
                deployment
                for deployment in row.get("deployments", [])
                if deployment.get("network") == "BNB Chain"
            ]
            for deployment in bsc_deployments:
                try:
                    pool = pancakeswap_v3_pool(
                        str(deployment["address"]), token_symbol
                    )
                except Exception as error:
                    print(
                        f"warning: PancakeSwap {symbol} "
                        f"{deployment['address']}: {error}"
                    )
                    pool = None
                if pool:
                    direct_venues.append(pool)
                    break

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
        "version": 5,
        "generatedAt": utc_iso(),
        "volumeSource": "direct Binance, LBank, and Meteora venue APIs plus factory-verified PancakeSwap V3 pool-event volume indexed by DexScreener; Robinhood reference volume is excluded",
        "liquiditySource": "direct order books, PancakeSwap and Uniswap V3 quoter depth within 2% of baseline, direct Meteora pool state, and official multiplier-adjusted Robinhood reference quotes",
        "preferenceBasis": "highest summed 24-hour turnover across queried CEX books and verified DEX pools",
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
