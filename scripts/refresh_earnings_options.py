#!/usr/bin/env python3
"""Build liquid-options earnings cones through the production Schwab bridge."""

from __future__ import annotations

import argparse
import base64
import bisect
import json
import math
import re
import shlex
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REMOTE = "pfrpc@productionrpc"
DEFAULT_REMOTE_REPO = "/home/pfrpc/repos/navstrategies"
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")
MAX_SPREAD_PCT = 12.5
MIN_OPEN_INTEREST = 500
MIN_VOLUME = 25
MAX_QUOTE_AGE_DAYS = 4


def _remote_source(symbol: str, start: str, end: str) -> str:
    return f'''import json
from navstrategies.config import Settings
from navstrategies.config.credentials import load_persistent_env
from navstrategies.data_sources.fmp import FMPClient
from navstrategies.brokers import SchwabClient
from navstrategies.utilities.db import make_engine
from sqlalchemy import text

load_persistent_env(overwrite=False)
calendar = FMPClient(Settings.from_env().fmp_api_key).get_earnings_calendar(
    from_date={start!r}, to_date={end!r}
)
events = calendar.loc[calendar["symbol"].eq({symbol!r})].sort_values("date")
if events.empty:
    raise RuntimeError("No FMP earnings estimate found for {symbol}")
event = events.iloc[0].where(events.iloc[0].notna(), None).to_dict()
event_date = str(event["date"])
chain_end = str(__import__("pandas").Timestamp(event_date).date() + __import__("datetime").timedelta(days=45))
chain, _ = SchwabClient(max_retries=2).request(
    "GET", "/marketdata/v1/chains",
    params={{
        "symbol": {symbol!r}, "contractType": "ALL", "strategy": "SINGLE",
        "includeUnderlyingQuote": "true", "fromDate": event_date, "toDate": chain_end,
    }},
)
contracts = []
for put_call, key in (("CALL", "callExpDateMap"), ("PUT", "putExpDateMap")):
    for expiration_key, strikes in (chain.get(key) or {{}}).items():
        expiration = expiration_key.split(":", 1)[0]
        for rows in strikes.values():
            for row in rows:
                keep = {{name: row.get(name) for name in (
                    "symbol", "description", "bid", "ask", "last", "mark", "bidSize",
                    "askSize", "totalVolume", "openInterest", "volatility", "delta",
                    "gamma", "theta", "vega", "strikePrice", "daysToExpiration",
                    "expirationDate", "quoteTimeInLong", "tradeTimeInLong", "multiplier",
                    "inTheMoney", "nonStandard", "mini", "pennyPilot",
                )}}
                keep["putCall"] = put_call
                keep["expiration"] = expiration
                contracts.append(keep)
engine = make_engine(Settings.from_env().database_url)
with engine.connect() as connection:
    history_events = [dict(row._mapping) for row in connection.execute(text(
        "SELECT accepted_at_eastern, filing_date, report_date "
        "FROM sec__earnings_release_history "
        "WHERE ticker=:symbol AND accepted_at_eastern < :event_date "
        "ORDER BY accepted_at_eastern DESC LIMIT 120"
    ), {{"symbol": {symbol!r}, "event_date": event_date}})]
    history_prices = [dict(row._mapping) for row in connection.execute(text(
        "SELECT date, closeadj FROM sharadar__sep "
        "WHERE ticker=:symbol ORDER BY date ASC"
    ), {{"symbol": {symbol!r}}})]
result = {{
    "event": event,
    "chain": {{
        "symbol": chain.get("symbol"), "status": chain.get("status"),
        "isDelayed": chain.get("isDelayed"), "interestRate": chain.get("interestRate"),
        "underlyingPrice": chain.get("underlyingPrice"), "numberOfContracts": chain.get("numberOfContracts"),
        "underlying": chain.get("underlying") or {{}}, "contracts": contracts,
    }},
    "history": {{"events": history_events, "prices": history_prices}},
}}
print(json.dumps(result, separators=(",", ":"), default=str))
'''


def fetch_remote(symbol: str, *, remote: str, remote_repo: str, today: date) -> dict[str, Any]:
    start = today.isoformat()
    end = (today + timedelta(days=120)).isoformat()
    source = _remote_source(symbol, start, end)
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = (
        f"cd {shlex.quote(remote_repo)} && .venv/bin/python -c "
        f"\"import base64;exec(compile(base64.b64decode('{encoded}'),'<earnings-options>','exec'))\""
    )
    completed = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", remote, command],
        check=True,
        capture_output=True,
        text=True,
        timeout=90,
    )
    return json.loads(completed.stdout)


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _millis_iso(value: Any) -> str | None:
    parsed = _number(value)
    if parsed is None or parsed <= 0:
        return None
    return datetime.fromtimestamp(parsed / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _pava(points: list[dict[str, float]]) -> list[dict[str, float]]:
    """Weighted isotonic regression for an increasing option-implied CDF."""
    blocks: list[dict[str, Any]] = []
    for point in points:
        weight = max(float(point.get("weight") or 1.0), 1.0)
        blocks.append({"items": [point], "weight": weight, "sum": point["cdf"] * weight})
        while len(blocks) >= 2:
            left = blocks[-2]
            right = blocks[-1]
            if left["sum"] / left["weight"] <= right["sum"] / right["weight"]:
                break
            blocks[-2:] = [{
                "items": left["items"] + right["items"],
                "weight": left["weight"] + right["weight"],
                "sum": left["sum"] + right["sum"],
            }]
    fitted: list[dict[str, float]] = []
    for block in blocks:
        value = max(0.001, min(0.999, block["sum"] / block["weight"]))
        for point in block["items"]:
            fitted.append({**point, "cdf": value})
    return fitted


def _quantile(points: list[dict[str, float]], probability: float) -> float:
    if not points or probability < points[0]["cdf"] or probability > points[-1]["cdf"]:
        raise ValueError(f"Probability {probability:.3f} lies outside the liquid option CDF")
    for left, right in zip(points, points[1:]):
        if left["cdf"] <= probability <= right["cdf"]:
            width = right["cdf"] - left["cdf"]
            if width <= 1e-10:
                return (left["strike"] + right["strike"]) / 2.0
            fraction = (probability - left["cdf"]) / width
            return left["strike"] + fraction * (right["strike"] - left["strike"])
    return points[-1]["strike"]


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    center = len(ordered) // 2
    return ordered[center] if len(ordered) % 2 else (ordered[center - 1] + ordered[center]) / 2.0


def _historical_scenarios(
    history: dict[str, Any],
    *,
    quote_date: date,
    event_date: date,
    expiration_date: date,
) -> list[dict[str, Any]]:
    """Match prior earnings to today's calendar-day entry and exit horizons."""
    prices: list[tuple[date, float]] = []
    for row in history.get("prices", []):
        parsed = _number(row.get("closeadj"))
        if parsed is None or parsed <= 0:
            continue
        prices.append((date.fromisoformat(str(row["date"])[:10]), parsed))
    prices.sort(key=lambda item: item[0])
    price_dates = [item[0] for item in prices]
    lead_days = max((event_date - quote_date).days, 1)
    post_event_days = max((expiration_date - event_date).days, 1)
    seen_events: set[date] = set()
    scenarios: list[dict[str, Any]] = []
    for row in history.get("events", []):
        raw_timestamp = str(row.get("accepted_at_eastern") or row.get("filing_date") or "")
        try:
            historical_event = date.fromisoformat(raw_timestamp[:10])
        except ValueError:
            continue
        if historical_event in seen_events or historical_event >= event_date:
            continue
        seen_events.add(historical_event)
        entry_target = historical_event - timedelta(days=lead_days)
        exit_target = historical_event + timedelta(days=post_event_days)
        entry_index = bisect.bisect_right(price_dates, entry_target) - 1
        exit_index = bisect.bisect_left(price_dates, exit_target)
        if entry_index < 0 or exit_index >= len(prices) or exit_index <= entry_index:
            continue
        entry_day, entry_price = prices[entry_index]
        exit_day, exit_price = prices[exit_index]
        scenarios.append({
            "earningsDate": historical_event.isoformat(),
            "entryDate": entry_day.isoformat(),
            "exitDate": exit_day.isoformat(),
            "entryPrice": entry_price,
            "exitPrice": exit_price,
            "underlyingReturnPct": (exit_price / entry_price - 1.0) * 100.0,
        })
    scenarios.sort(key=lambda row: row["earningsDate"], reverse=True)
    return scenarios


def _payout_statistics(
    scenarios: list[dict[str, Any]],
    *,
    put_ratio: float,
    call_ratio: float,
    premium_ratio: float,
) -> dict[str, Any]:
    outcomes: list[dict[str, Any]] = []
    for scenario in scenarios:
        terminal_ratio = float(scenario["exitPrice"]) / float(scenario["entryPrice"])
        payoff_ratio = max(put_ratio - terminal_ratio, 0.0) + max(terminal_ratio - call_ratio, 0.0)
        gross_multiple = payoff_ratio / premium_ratio if premium_ratio > 0 else 0.0
        outcomes.append({
            "earningsDate": scenario["earningsDate"],
            "entryDate": scenario["entryDate"],
            "exitDate": scenario["exitDate"],
            "underlyingReturnPct": round(float(scenario["underlyingReturnPct"]), 2),
            "grossPayoutMultiple": round(gross_multiple, 3),
            "profitable": gross_multiple > 1.0,
        })
    multiples = [float(row["grossPayoutMultiple"]) for row in outcomes]
    winners = [value for value in multiples if value > 1.0]
    return {
        "events": len(outcomes),
        "profitableEvents": len(winners),
        "profitableRatePct": round(len(winners) / len(outcomes) * 100.0, 1) if outcomes else 0.0,
        "averageGrossPayoutMultiple": round(sum(multiples) / len(multiples), 2) if multiples else 0.0,
        "medianGrossPayoutMultiple": round(_median(multiples), 2),
        "averageWinnerPayoutMultiple": round(sum(winners) / len(winners), 2) if winners else 0.0,
        "maximumGrossPayoutMultiple": round(max(multiples), 2) if multiples else 0.0,
        "outcomes": outcomes,
    }


def _rank_historical_structures(
    tradable: list[dict[str, Any]],
    *,
    spot: float,
    scenarios: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    calls = sorted(
        (row for row in tradable if row["putCall"] == "CALL" and row["volume"] >= MIN_VOLUME),
        key=lambda row: row["strike"],
    )
    puts = sorted(
        (row for row in tradable if row["putCall"] == "PUT" and row["volume"] >= MIN_VOLUME),
        key=lambda row: row["strike"],
    )
    call_by_strike = {row["strike"]: row for row in calls}
    put_by_strike = {row["strike"]: row for row in puts}
    pairs: dict[tuple[float, float], tuple[dict[str, Any], dict[str, Any]]] = {}

    common_strikes = sorted(set(call_by_strike) & set(put_by_strike), key=lambda strike: abs(strike / spot - 1.0))
    if common_strikes:
        strike = common_strikes[0]
        pairs[(strike, strike)] = (put_by_strike[strike], call_by_strike[strike])

    otm_calls = [row for row in calls if row["strike"] > spot]
    for put in (row for row in puts if row["strike"] < spot):
        if not otm_calls:
            break
        target_log_distance = abs(math.log(float(put["strike"]) / spot))
        call = min(otm_calls, key=lambda row: abs(math.log(float(row["strike"]) / spot) - target_log_distance))
        symmetry_gap = abs(math.log(float(call["strike"]) / spot) - target_log_distance)
        if symmetry_gap <= 0.025:
            pairs[(put["strike"], call["strike"])] = (put, call)

    candidates: list[dict[str, Any]] = []
    for (put_strike, call_strike), (put, call) in pairs.items():
        debit = float(put["ask"]) + float(call["ask"])
        premium_ratio = debit / spot
        if premium_ratio <= 0:
            continue
        put_ratio = put_strike / spot
        call_ratio = call_strike / spot
        trailing = _payout_statistics(
            scenarios[:12], put_ratio=put_ratio, call_ratio=call_ratio, premium_ratio=premium_ratio
        )
        lifetime = _payout_statistics(
            scenarios, put_ratio=put_ratio, call_ratio=call_ratio, premium_ratio=premium_ratio
        )
        if trailing["profitableEvents"] < 2:
            continue
        is_straddle = put_strike == call_strike
        wing_pct = 0.0 if is_straddle else ((1.0 - put_ratio) + (call_ratio - 1.0)) / 2.0 * 100.0
        score = trailing["averageGrossPayoutMultiple"] * math.sqrt(trailing["profitableRatePct"] / 100.0)
        candidates.append({
            "name": f"${put_strike:g} straddle" if is_straddle else f"{wing_pct:.1f}% OTM strangle",
            "structure": "long straddle" if is_straddle else "long strangle",
            "put": put,
            "call": call,
            "debitAsk": round(debit, 2),
            "debitPctSpot": round(premium_ratio * 100.0, 2),
            "lowerBreakeven": round(put_strike - debit, 2),
            "upperBreakeven": round(call_strike + debit, 2),
            "wingPct": round(wing_pct, 2),
            "combinedVolume": int(put["volume"]) + int(call["volume"]),
            "minimumLegVolume": min(int(put["volume"]), int(call["volume"])),
            "combinedOpenInterest": int(put["openInterest"]) + int(call["openInterest"]),
            "trailing12": trailing,
            "fullHistory": lifetime,
            "rankingScore": round(score, 4),
        })
    candidates.sort(key=lambda row: (row["rankingScore"], row["combinedVolume"]), reverse=True)
    if not candidates:
        return []
    balance = candidates[0]
    balance["selectionLabel"] = "Best historical balance"
    alternatives = [
        row for row in candidates
        if abs(float(row["wingPct"]) - float(balance["wingPct"])) >= 2.5
    ]
    if not alternatives:
        return [balance]
    convexity = max(
        alternatives,
        key=lambda row: (
            row["trailing12"]["averageWinnerPayoutMultiple"]
            * math.sqrt(row["trailing12"]["profitableRatePct"] / 100.0),
            row["trailing12"]["averageGrossPayoutMultiple"],
            row["combinedVolume"],
        ),
    )
    convexity["selectionLabel"] = "Higher historical convexity"
    return [balance, convexity]


def build_payload(raw: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    event = dict(raw["event"])
    chain = dict(raw["chain"])
    symbol = str(chain["symbol"]).upper()
    event_date = date.fromisoformat(str(event["date"])[:10])
    spot = float(chain["underlyingPrice"])
    expirations = sorted({str(row["expiration"]) for row in chain["contracts"] if str(row["expiration"]) >= event_date.isoformat()})
    if not expirations:
        raise RuntimeError(f"No {symbol} option expiration covers earnings on {event_date}")
    expiration = expirations[0]
    expiration_date = date.fromisoformat(expiration)
    days_to_expiration = max((expiration_date - now.date()).days, 1)
    days_to_earnings = max((event_date - now.date()).days, 1)
    rate = float(chain.get("interestRate") or 0.0) / 100.0
    discount_adjustment = math.exp(rate * days_to_expiration / 365.0)

    tradable: list[dict[str, Any]] = []
    selected: list[dict[str, Any]] = []
    for raw_row in chain["contracts"]:
        if raw_row.get("expiration") != expiration:
            continue
        bid = _number(raw_row.get("bid"))
        ask = _number(raw_row.get("ask"))
        strike = _number(raw_row.get("strikePrice"))
        if bid is None or ask is None or strike is None or bid <= 0 or ask <= bid:
            continue
        midpoint = (bid + ask) / 2.0
        spread_pct = (ask - bid) / midpoint * 100.0
        open_interest = int(_number(raw_row.get("openInterest")) or 0)
        volume = int(_number(raw_row.get("totalVolume")) or 0)
        quote_at = _millis_iso(raw_row.get("quoteTimeInLong"))
        quote_age = (now - datetime.fromisoformat(quote_at.replace("Z", "+00:00"))).total_seconds() / 86400 if quote_at else 999
        standard = not raw_row.get("nonStandard") and not raw_row.get("mini") and int(_number(raw_row.get("multiplier")) or 0) == 100
        liquid = (
            standard
            and spread_pct <= MAX_SPREAD_PCT
            and (open_interest >= MIN_OPEN_INTEREST or volume >= MIN_VOLUME)
            and quote_age <= MAX_QUOTE_AGE_DAYS
        )
        if not liquid:
            continue
        put_call = str(raw_row["putCall"])
        role = "downside CDF" if put_call == "PUT" and strike <= spot else "upside survival" if put_call == "CALL" and strike >= spot else None
        normalized_row = {
            "putCall": put_call,
            "symbol": raw_row.get("symbol"),
            "strike": round(strike, 4),
            "bid": round(bid, 4),
            "ask": round(ask, 4),
            "mid": round(midpoint, 4),
            "spreadPct": round(spread_pct, 2),
            "bidSize": int(_number(raw_row.get("bidSize")) or 0),
            "askSize": int(_number(raw_row.get("askSize")) or 0),
            "volume": volume,
            "openInterest": open_interest,
            "impliedVolPct": round(float(_number(raw_row.get("volatility")) or 0.0), 3),
            "delta": round(float(_number(raw_row.get("delta")) or 0.0), 4),
            "quoteAt": quote_at,
        }
        tradable.append(normalized_row)
        if role is not None:
            selected.append({**normalized_row, "role": role})

    cdf_points: list[dict[str, float]] = []
    used_symbols: set[str] = set()
    for put_call in ("PUT", "CALL"):
        rows = sorted((row for row in selected if row["putCall"] == put_call), key=lambda row: row["strike"])
        for left, right in zip(rows, rows[1:]):
            strike_gap = right["strike"] - left["strike"]
            if strike_gap <= 0 or strike_gap > max(10.0, spot * 0.04):
                continue
            if put_call == "PUT":
                cdf = (right["mid"] - left["mid"]) / strike_gap * discount_adjustment
            else:
                survival = (left["mid"] - right["mid"]) / strike_gap * discount_adjustment
                cdf = 1.0 - survival
            if not math.isfinite(cdf) or cdf < -0.15 or cdf > 1.15:
                continue
            used_symbols.update((str(left["symbol"]), str(right["symbol"])))
            cdf_points.append({
                "strike": (left["strike"] + right["strike"]) / 2.0,
                "cdf": max(0.001, min(0.999, cdf)),
                "weight": math.sqrt(max(min(left["openInterest"], right["openInterest"]), 1)),
            })
    cdf_points = _pava(sorted(cdf_points, key=lambda point: point["strike"]))
    if len(cdf_points) < 8:
        raise RuntimeError(f"Only {len(cdf_points)} liquid vertical spreads survived for {symbol}")

    expiry_quantiles = {probability: _quantile(cdf_points, probability) for probability in (0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90)}
    time_scale = math.sqrt(min(days_to_earnings / days_to_expiration, 1.0))
    event_quantiles = {
        probability: spot * math.exp(math.log(price / spot) * time_scale)
        for probability, price in expiry_quantiles.items()
    }
    fan = []
    for probability in (0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90):
        fan.append({
            "probability": probability,
            "earningsPrice": round(event_quantiles[probability], 2),
            "expirationPrice": round(expiry_quantiles[probability], 2),
        })
    event_half_width = ((event_quantiles[0.84] - spot) + (spot - event_quantiles[0.16])) / (2.0 * spot) * 100.0
    contracts = [row for row in selected if str(row["symbol"]) in used_symbols]
    contracts.sort(key=lambda row: (row["strike"], row["putCall"]))
    quote_times = [row["quoteAt"] for row in contracts if row.get("quoteAt")]
    chain_quote_at = max(quote_times) if quote_times else now.isoformat().replace("+00:00", "Z")
    quote_date = datetime.fromisoformat(chain_quote_at.replace("Z", "+00:00")).date()
    historical_scenarios = _historical_scenarios(
        dict(raw.get("history") or {}),
        quote_date=quote_date,
        event_date=event_date,
        expiration_date=expiration_date,
    )
    historical_structures = _rank_historical_structures(
        tradable,
        spot=spot,
        scenarios=historical_scenarios,
    )
    if len(historical_scenarios) < 12:
        raise RuntimeError(f"Only {len(historical_scenarios)} comparable earnings events available for {symbol}")
    if not historical_structures:
        raise RuntimeError(f"No volume-screened historical option structures survived for {symbol}")
    underlying = chain.get("underlying") or {}
    return {
        "version": 2,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "source": "Schwab listed-options chain, FMP earnings calendar, SEC earnings releases, and Sharadar adjusted prices",
        "symbol": symbol,
        "earnings": {
            "date": event_date.isoformat(),
            "timing": event.get("time"),
            "status": "estimate",
            "sourceUpdatedAt": event.get("updatedFromDate"),
            "estimatedEps": _number(event.get("epsEstimated")),
            "estimatedRevenue": _number(event.get("revenueEstimated")),
        },
        "chain": {
            "expiration": expiration,
            "daysToExpiration": days_to_expiration,
            "underlyingPrice": round(spot, 4),
            "underlyingBid": _number(underlying.get("bid")),
            "underlyingAsk": _number(underlying.get("ask")),
            "quoteAt": chain_quote_at,
            "isDelayed": bool(chain.get("isDelayed")),
            "totalContractsReturned": int(chain.get("numberOfContracts") or len(chain["contracts"])),
            "liquidContractsUsed": len(contracts),
        },
        "liquidityFilter": {
            "maxBidAskSpreadPct": MAX_SPREAD_PCT,
            "minimumOpenInterestOrVolume": f"open interest >= {MIN_OPEN_INTEREST} or daily volume >= {MIN_VOLUME}",
            "standardMultiplier": 100,
            "maximumQuoteAgeDays": MAX_QUOTE_AGE_DAYS,
            "sides": "OTM puts below spot and OTM calls above spot",
        },
        "model": {
            "name": "liquid vertical-spread risk-neutral CDF",
            "description": "Adjacent liquid put spreads infer downside probabilities and adjacent liquid call spreads infer upside probabilities. Weighted isotonic regression enforces a valid increasing CDF. Earnings-date log distances are time-scaled from the first post-event expiration.",
            "measure": "risk-neutral, not a historical or physical forecast",
            "eventTimeScale": round(time_scale, 6),
            "cdfPoints": len(cdf_points),
        },
        "summary": {
            "impliedEarningsMovePct": round(event_half_width, 2),
            "event68Low": round(event_quantiles[0.16], 2),
            "event68High": round(event_quantiles[0.84], 2),
            "eventMedian": round(event_quantiles[0.50], 2),
            "expiration68Low": round(expiry_quantiles[0.16], 2),
            "expiration68High": round(expiry_quantiles[0.84], 2),
        },
        "fan": fan,
        "historicalAnalysis": {
            "entryLeadCalendarDays": (event_date - quote_date).days,
            "postEarningsCalendarDays": (expiration_date - event_date).days,
            "availableEvents": len(historical_scenarios),
            "primaryWindowEvents": 12,
            "priceSource": "Sharadar split-adjusted close",
            "eventSource": "SEC 8-K earnings-release acceptance timestamps",
            "method": "Each current two-leg structure is translated into percentage-of-spot strikes and debit. Those same normalized strikes and today's debit percentage are replayed across prior earnings using the same calendar-day entry lead and post-event exit horizon. A profitable event requires expiration payoff greater than the original debit.",
            "limitation": "Stock-path proxy using today's premium; historical option quotes, bid-ask execution, volatility repricing, early exercise, dividends, and transaction costs are not reconstructed.",
            "structures": historical_structures,
        },
        "contracts": contracts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", action="append", default=[])
    parser.add_argument("--remote", default=DEFAULT_REMOTE)
    parser.add_argument("--remote-repo", default=DEFAULT_REMOTE_REPO)
    parser.add_argument("--output-dir", type=Path, default=SITE_ROOT / "assets" / "market-data")
    args = parser.parse_args()
    symbols = [str(value).strip().upper() for value in (args.symbol or ["AAPL"])]
    now = datetime.now(timezone.utc)
    for symbol in symbols:
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise SystemExit(f"Invalid symbol: {symbol!r}")
        payload = build_payload(fetch_remote(symbol, remote=args.remote, remote_repo=args.remote_repo, today=now.date()), now=now)
        target = args.output_dir / f"{symbol.lower()}-options.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
        temporary.replace(target)
        print(f"{symbol}: {payload['earnings']['date']} earnings, {payload['chain']['expiration']} expiry, {payload['chain']['liquidContractsUsed']} liquid contracts, {len(payload['historicalAnalysis']['structures'])} historical structures -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
