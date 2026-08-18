#!/usr/bin/env python3
"""Build liquid-options earnings cones through the production Schwab bridge."""

from __future__ import annotations

import argparse
import base64
import bisect
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
import re
import shlex
import subprocess
from statistics import NormalDist
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from scripts.options_profiles import OPTIONS_PROFILES, options_profile
except ModuleNotFoundError:  # Direct execution: python3 scripts/refresh_earnings_options.py
    from options_profiles import OPTIONS_PROFILES, options_profile


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REMOTE = "pfrpc@productionrpc"
DEFAULT_REMOTE_REPO = "/home/pfrpc/repos/navstrategies"
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")
MAX_SPREAD_PCT = 12.5
MIN_OPEN_INTEREST = 500
MIN_VOLUME = 25
TERM_MAX_SPREAD_PCT = 20.0
TERM_MIN_OPEN_INTEREST = 50
TERM_MIN_VOLUME = 5
MAX_QUOTE_AGE_DAYS = 4


def _remote_events_source(symbols: tuple[str, ...], today: date) -> str:
    return f'''import json
from datetime import date, timedelta
import pandas as pd
from navstrategies.config import Settings
from navstrategies.config.credentials import load_persistent_env
from navstrategies.data_sources.fmp import FMPClient

load_persistent_env(overwrite=False)
client = FMPClient(Settings.from_env().fmp_api_key, max_retries=3)
today = date.fromisoformat({today.isoformat()!r})
parts = []
for offset in range(0, 240, 60):
    start = today + timedelta(days=offset)
    end = min(today + timedelta(days=239), start + timedelta(days=59))
    frame = client.get_earnings_calendar(
        from_date=start.isoformat(),
        to_date=end.isoformat(),
    )
    if not frame.empty:
        parts.append(frame)
calendar = pd.concat(parts, ignore_index=True, sort=False) if parts else pd.DataFrame()
results = {{}}
for symbol in {symbols!r}:
    rows = calendar.loc[calendar["symbol"].eq(symbol)].sort_values("date")
    if rows.empty:
        continue
    event = rows.iloc[0].where(rows.iloc[0].notna(), None).to_dict()
    results[symbol] = event
print(json.dumps(results, separators=(",", ":"), default=str))
'''


def fetch_forward_events_remote(
    symbols: tuple[str, ...],
    *,
    remote: str,
    remote_repo: str,
    today: date,
) -> dict[str, dict[str, Any]]:
    source = _remote_events_source(symbols, today)
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = (
        f"cd {shlex.quote(remote_repo)} && .venv/bin/python -c "
        f"\"import base64;exec(compile(base64.b64decode('{encoded}'),'<forward-earnings>','exec'))\""
    )
    completed = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", remote, command],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return json.loads(completed.stdout)


def _remote_source(symbol: str, event: dict[str, Any]) -> str:
    return f'''import json
from navstrategies.config import Settings
from navstrategies.config.credentials import load_persistent_env
from navstrategies.data_sources.fmp import FMPClient
from navstrategies.brokers import SchwabClient
from navstrategies.utilities.db import make_engine
from navstrategies.data_updates.earnings_event_flags import DEFAULT_HISTORICAL_EARNINGS_CALENDAR_PATH
from sqlalchemy import text

load_persistent_env(overwrite=False)
event = {event!r}
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
calendar_history = __import__("pandas").read_parquet(
    DEFAULT_HISTORICAL_EARNINGS_CALENDAR_PATH,
    columns=["symbol", "date", "time"],
)
calendar_history = calendar_history[
    calendar_history["symbol"].eq({symbol!r})
    & (__import__("pandas").to_datetime(calendar_history["date"]) < __import__("pandas").Timestamp(event_date))
].sort_values("date", ascending=False)
calendar_events = [
    {{
        "accepted_at_eastern": str(row.date),
        "filing_date": str(row.date),
        "report_date": str(row.date),
        "time": row.time,
        "source": "FMP historical earnings calendar",
    }}
    for row in calendar_history.itertuples(index=False)
]
engine = make_engine(Settings.from_env().database_url)
with engine.connect() as connection:
    sec_events = [dict(row._mapping) for row in connection.execute(text(
        "SELECT accepted_at_eastern, filing_date, report_date "
        "FROM sec__earnings_release_history "
        "WHERE ticker=:symbol AND accepted_at_eastern < :event_date "
        "ORDER BY accepted_at_eastern DESC LIMIT 120"
    ), {{"symbol": {symbol!r}, "event_date": event_date}})]
    history_prices = [dict(row._mapping) for row in connection.execute(text(
        "SELECT date, closeadj FROM sharadar__sep "
        "WHERE ticker=:symbol ORDER BY date ASC"
    ), {{"symbol": {symbol!r}}})]
events_by_date = {{
    str(row["accepted_at_eastern"])[:10]: row
    for row in calendar_events
}}
for row in sec_events:
    events_by_date[str(row["accepted_at_eastern"])[:10]] = {{
        **row,
        "source": "SEC earnings release history",
    }}
history_events = sorted(
    events_by_date.values(),
    key=lambda row: str(row["accepted_at_eastern"]),
    reverse=True,
)
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


def fetch_remote(
    symbol: str,
    *,
    event: dict[str, Any],
    remote: str,
    remote_repo: str,
    today: date,
) -> dict[str, Any]:
    source = _remote_source(symbol, event)
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


def _remote_chain_source(symbols: tuple[str, ...], start: str, end: str) -> str:
    return f'''import json
from navstrategies.config.credentials import load_persistent_env
from navstrategies.brokers import SchwabClient

load_persistent_env(overwrite=False)
client = SchwabClient(max_retries=2)
results = {{}}
for symbol in {symbols!r}:
    chain, _ = client.request(
        "GET", "/marketdata/v1/chains",
        params={{
            "symbol": symbol,
            "contractType": "ALL",
            "strategy": "SINGLE",
            "includeUnderlyingQuote": "true",
            "fromDate": {start!r},
            "toDate": {end!r},
            "strikeCount": 40,
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
    results[symbol] = {{
        "symbol": chain.get("symbol"),
        "status": chain.get("status"),
        "isDelayed": chain.get("isDelayed"),
        "interestRate": chain.get("interestRate"),
        "underlyingPrice": chain.get("underlyingPrice"),
        "numberOfContracts": chain.get("numberOfContracts"),
        "underlying": chain.get("underlying") or {{}},
        "contracts": contracts,
    }}
print(json.dumps(results, separators=(",", ":"), default=str))
'''


def fetch_term_remote(
    symbols: tuple[str, ...],
    *,
    remote: str,
    remote_repo: str,
    today: date,
) -> dict[str, Any]:
    start = (today + timedelta(days=14)).isoformat()
    end = (today + timedelta(days=125)).isoformat()
    source = _remote_chain_source(symbols, start, end)
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = (
        f"cd {shlex.quote(remote_repo)} && .venv/bin/python -c "
        f"\"import base64;exec(compile(base64.b64decode('{encoded}'),'<term-options>','exec'))\""
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
    if not points:
        raise ValueError("Cannot estimate a quantile without liquid option CDF points")
    if probability <= points[0]["cdf"]:
        return points[0]["strike"]
    if probability >= points[-1]["cdf"]:
        return points[-1]["strike"]
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


def _historical_earnings_moves(history: dict[str, Any]) -> list[dict[str, Any]]:
    """Calculate the first close-to-close move that could absorb each release."""
    prices: list[tuple[date, float]] = []
    for row in history.get("prices", []):
        parsed = _number(row.get("closeadj"))
        try:
            price_date = date.fromisoformat(str(row.get("date"))[:10])
        except ValueError:
            continue
        if parsed is not None and parsed > 0:
            prices.append((price_date, parsed))
    prices.sort(key=lambda item: item[0])
    price_dates = [item[0] for item in prices]
    seen: set[date] = set()
    moves: list[dict[str, Any]] = []
    for row in history.get("events", []):
        timestamp = str(row.get("accepted_at_eastern") or row.get("filing_date") or "")
        try:
            event_day = date.fromisoformat(timestamp[:10])
        except ValueError:
            continue
        if event_day in seen:
            continue
        seen.add(event_day)
        timing = str(row.get("time") or "").strip().lower()
        hour: int | None = None
        minute = 0
        match = re.search(r"[ T](\d{2}):(\d{2})", timestamp)
        if match:
            hour, minute = int(match.group(1)), int(match.group(2))
        after_close = timing in {"amc", "after market close", "after close"} or (
            hour is not None and (hour, minute) >= (16, 0)
        )
        event_index = bisect.bisect_left(price_dates, event_day)
        if event_index >= len(prices):
            continue
        if after_close:
            if price_dates[event_index] != event_day or event_index + 1 >= len(prices):
                continue
            start_day, start_price = prices[event_index]
            end_day, end_price = prices[event_index + 1]
            window = "event close to next close"
            normalized_timing = "after close"
        else:
            if price_dates[event_index] != event_day or event_index < 1:
                continue
            start_day, start_price = prices[event_index - 1]
            end_day, end_price = prices[event_index]
            window = "prior close to event close"
            normalized_timing = "before/open market" if timing in {"bmo", "before market open", "before open"} or (
                hour is not None and (hour, minute) < (9, 30)
            ) else "during/unspecified"
        moves.append({
            "earningsDate": event_day.isoformat(),
            "timing": normalized_timing,
            "reactionWindow": window,
            "startDate": start_day.isoformat(),
            "reactionDate": end_day.isoformat(),
            "startPrice": round(start_price, 6),
            "reactionPrice": round(end_price, 6),
            "movePct": round((end_price / start_price - 1.0) * 100.0, 2),
            "eventSource": str(row.get("source") or "historical earnings calendar"),
        })
    moves.sort(key=lambda item: item["earningsDate"], reverse=True)
    return moves


def _payout_statistics(
    scenarios: list[dict[str, Any]],
    *,
    put_ratio: float | None,
    call_ratio: float | None,
    premium_ratio: float,
) -> dict[str, Any]:
    outcomes: list[dict[str, Any]] = []
    for scenario in scenarios:
        terminal_ratio = float(scenario["exitPrice"]) / float(scenario["entryPrice"])
        payoff_ratio = (
            (max(put_ratio - terminal_ratio, 0.0) if put_ratio is not None else 0.0)
            + (max(terminal_ratio - call_ratio, 0.0) if call_ratio is not None else 0.0)
        )
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
    common_strikes = sorted(set(call_by_strike) & set(put_by_strike), key=lambda strike: abs(strike / spot - 1.0))
    if not common_strikes:
        return []

    atm_strike = common_strikes[0]
    atm_put = put_by_strike[atm_strike]
    atm_call = call_by_strike[atm_strike]
    straddle_debit = float(atm_put["ask"]) + float(atm_call["ask"])
    straddle_premium_ratio = straddle_debit / spot
    straddle = {
        "name": "ATM straddle",
        "structure": "long straddle",
        "put": atm_put,
        "call": atm_call,
        "debitAsk": round(straddle_debit, 2),
        "debitPctSpot": round(straddle_premium_ratio * 100.0, 2),
        "lowerBreakeven": round(atm_strike - straddle_debit, 2),
        "upperBreakeven": round(atm_strike + straddle_debit, 2),
        "combinedVolume": int(atm_put["volume"]) + int(atm_call["volume"]),
        "minimumLegVolume": min(int(atm_put["volume"]), int(atm_call["volume"])),
        "combinedOpenInterest": int(atm_put["openInterest"]) + int(atm_call["openInterest"]),
        "trailing12": _payout_statistics(
            scenarios[:12],
            put_ratio=atm_strike / spot,
            call_ratio=atm_strike / spot,
            premium_ratio=straddle_premium_ratio,
        ),
        "fullHistory": _payout_statistics(
            scenarios,
            put_ratio=atm_strike / spot,
            call_ratio=atm_strike / spot,
            premium_ratio=straddle_premium_ratio,
        ),
    }

    call_candidates: list[dict[str, Any]] = []
    for call in (row for row in calls if float(row["strike"]) > spot):
        debit = float(call["ask"])
        premium_ratio = debit / spot
        trailing = _payout_statistics(
            scenarios[:12], put_ratio=None, call_ratio=float(call["strike"]) / spot, premium_ratio=premium_ratio
        )
        lifetime = _payout_statistics(
            scenarios, put_ratio=None, call_ratio=float(call["strike"]) / spot, premium_ratio=premium_ratio
        )
        score = trailing["averageGrossPayoutMultiple"]
        call_candidates.append({
            "name": f"${float(call['strike']):g} call",
            "structure": "long call",
            "put": None,
            "call": call,
            "debitAsk": round(debit, 2),
            "debitPctSpot": round(premium_ratio * 100.0, 2),
            "lowerBreakeven": None,
            "upperBreakeven": round(float(call["strike"]) + debit, 2),
            "combinedVolume": int(call["volume"]),
            "minimumLegVolume": int(call["volume"]),
            "combinedOpenInterest": int(call["openInterest"]),
            "trailing12": trailing,
            "fullHistory": lifetime,
            "rankingScore": round(score, 4),
        })
    call_candidates.sort(
        key=lambda row: (
            row["rankingScore"],
            row["trailing12"]["profitableRatePct"],
            row["combinedVolume"],
        ),
        reverse=True,
    )
    if len(call_candidates) < 2:
        return []
    top_calls = call_candidates[:2]

    put_candidates: list[dict[str, Any]] = []
    for put in (row for row in puts if float(row["strike"]) < spot):
        debit = float(put["ask"])
        premium_ratio = debit / spot
        trailing = _payout_statistics(
            scenarios[:12], put_ratio=float(put["strike"]) / spot, call_ratio=None, premium_ratio=premium_ratio
        )
        lifetime = _payout_statistics(
            scenarios, put_ratio=float(put["strike"]) / spot, call_ratio=None, premium_ratio=premium_ratio
        )
        score = trailing["averageGrossPayoutMultiple"]
        put_candidates.append({
            "name": f"${float(put['strike']):g} put",
            "structure": "long put",
            "put": put,
            "call": None,
            "debitAsk": round(debit, 2),
            "debitPctSpot": round(premium_ratio * 100.0, 2),
            "lowerBreakeven": round(float(put["strike"]) - debit, 2),
            "upperBreakeven": None,
            "combinedVolume": int(put["volume"]),
            "minimumLegVolume": int(put["volume"]),
            "combinedOpenInterest": int(put["openInterest"]),
            "trailing12": trailing,
            "fullHistory": lifetime,
            "rankingScore": round(score, 4),
        })
    put_candidates.sort(
        key=lambda row: (
            row["rankingScore"],
            row["trailing12"]["profitableRatePct"],
            row["combinedVolume"],
        ),
        reverse=True,
    )
    if len(put_candidates) < 2:
        return []
    top_puts = put_candidates[:2]
    return [straddle, *top_calls, *top_puts]


def _normalize_liquid_contracts(
    chain: dict[str, Any],
    *,
    now: datetime,
    max_spread_pct: float = TERM_MAX_SPREAD_PCT,
    min_open_interest: int = TERM_MIN_OPEN_INTEREST,
    min_volume: int = TERM_MIN_VOLUME,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_row in chain.get("contracts", []):
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
        quote_age = (
            (now - datetime.fromisoformat(quote_at.replace("Z", "+00:00"))).total_seconds() / 86400
            if quote_at
            else 999
        )
        standard = (
            not raw_row.get("nonStandard")
            and not raw_row.get("mini")
            and int(_number(raw_row.get("multiplier")) or 0) == 100
        )
        if not (
            standard
            and spread_pct <= max_spread_pct
            and (open_interest >= min_open_interest or volume >= min_volume)
            and quote_age <= MAX_QUOTE_AGE_DAYS
        ):
            continue
        rows.append({
            "putCall": str(raw_row["putCall"]),
            "symbol": raw_row.get("symbol"),
            "expiration": str(raw_row["expiration"]),
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
        })
    return rows


def _straddle_implied_quantiles(
    *,
    spot: float,
    debit: float,
    time_scale: float = 1.0,
) -> dict[float, float]:
    total_sigma = max(debit / spot * math.sqrt(math.pi / 2.0) * time_scale, 1e-6)
    normal = NormalDist()
    return {
        probability: spot * math.exp(
            normal.inv_cdf(probability) * total_sigma - 0.5 * total_sigma * total_sigma
        )
        for probability in (0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90)
    }


def _term_fan(
    *,
    spot: float,
    debit: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    quantiles = _straddle_implied_quantiles(spot=spot, debit=debit)
    fan = [
        {
            "probability": probability,
            "expirationPrice": round(quantiles[probability], 2),
        }
        for probability in (0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90)
    ]
    return fan, {
        "expiration68Low": round(quantiles[0.16], 2),
        "expiration68High": round(quantiles[0.84], 2),
        "expirationMedian": round(quantiles[0.50], 2),
        "method": "ATM-straddle-implied lognormal distribution",
    }


def _term_structure(
    contracts: list[dict[str, Any]],
    *,
    spot: float,
    now: datetime,
    expiration: str,
    target_days: int,
) -> dict[str, Any]:
    rows = [row for row in contracts if row["expiration"] == expiration]
    calls = {float(row["strike"]): row for row in rows if row["putCall"] == "CALL"}
    puts = {float(row["strike"]): row for row in rows if row["putCall"] == "PUT"}
    common = sorted(set(calls) & set(puts), key=lambda strike: abs(strike / spot - 1.0))
    if not common:
        raise RuntimeError(f"No liquid paired strike for {expiration}")
    strike = common[0]
    call = calls[strike]
    put = puts[strike]
    debit = float(call["ask"]) + float(put["ask"])
    expiration_date = date.fromisoformat(expiration)
    days_to_expiration = max((expiration_date - now.date()).days, 1)
    fan, distribution = _term_fan(spot=spot, debit=debit)
    return {
        "name": f"{target_days // 30}-month target ATM straddle",
        "structure": "long straddle",
        "targetDays": target_days,
        "daysToExpiration": days_to_expiration,
        "expiration": expiration,
        "put": put,
        "call": call,
        "debitAsk": round(debit, 2),
        "debitPctSpot": round(debit / spot * 100.0, 2),
        "lowerBreakeven": round(strike - debit, 2),
        "upperBreakeven": round(strike + debit, 2),
        "combinedVolume": int(put["volume"]) + int(call["volume"]),
        "minimumLegVolume": min(int(put["volume"]), int(call["volume"])),
        "combinedOpenInterest": int(put["openInterest"]) + int(call["openInterest"]),
        "impliedMovePct": round(debit / spot * 100.0, 2),
        "fan": fan,
        "distribution": distribution,
    }


def build_term_payload(
    raw_by_symbol: dict[str, Any],
    *,
    page_symbol: str,
    now: datetime,
) -> dict[str, Any]:
    candidates: list[tuple[tuple[int, int, int], str, dict[str, Any], list[dict[str, Any]]]] = []
    selection_audit: list[dict[str, Any]] = []
    for underlier, chain in raw_by_symbol.items():
        liquid = _normalize_liquid_contracts(chain, now=now)
        volume = sum(int(row["volume"]) for row in liquid)
        open_interest = sum(int(row["openInterest"]) for row in liquid)
        score = (volume, open_interest, len(liquid))
        selection_audit.append({
            "symbol": underlier,
            "liquidContracts": len(liquid),
            "contractVolume": volume,
            "openInterest": open_interest,
        })
        if liquid:
            candidates.append((score, underlier, chain, liquid))
    if not candidates:
        raise RuntimeError(f"No liquid options chain survived for {page_symbol}")
    _, underlier, chain, liquid = max(candidates, key=lambda item: item[0])
    spot = float(chain["underlyingPrice"])
    expirations = sorted({row["expiration"] for row in liquid})
    if len(expirations) < 2:
        raise RuntimeError(f"Fewer than two liquid expirations survived for {underlier}")
    structures: list[dict[str, Any]] = []
    selected_expirations: set[str] = set()
    for target_days in (30, 90):
        choices = sorted(
            (value for value in expirations if value not in selected_expirations),
            key=lambda value: abs((date.fromisoformat(value) - now.date()).days - target_days),
        )
        selected: dict[str, Any] | None = None
        for expiration in choices:
            try:
                selected = _term_structure(
                    liquid,
                    spot=spot,
                    now=now,
                    expiration=expiration,
                    target_days=target_days,
                )
            except RuntimeError:
                continue
            selected_expirations.add(expiration)
            break
        if selected is None:
            raise RuntimeError(f"No liquid paired strike survived for the {target_days}-day {underlier} target")
        structures.append(selected)
    quote_times = [row["quoteAt"] for row in liquid if row.get("quoteAt")]
    quote_at = max(quote_times) if quote_times else now.isoformat().replace("+00:00", "Z")
    return {
        "version": 3,
        "mode": "term_straddles",
        "pageSymbol": page_symbol,
        "symbol": page_symbol,
        "underlierSymbol": underlier,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "source": "Schwab listed-options chain",
        "chain": {
            "underlyingPrice": round(spot, 4),
            "quoteAt": quote_at,
            "isDelayed": bool(chain.get("isDelayed")),
            "liquidContractsUsed": len(liquid),
        },
        "underlierSelection": {
            "method": "highest summed live contract volume; open interest and contract count break ties",
            "candidates": sorted(selection_audit, key=lambda row: row["symbol"]),
        },
        "liquidityFilter": {
            "maxBidAskSpreadPct": TERM_MAX_SPREAD_PCT,
            "minimumOpenInterestOrVolume": f"open interest >= {TERM_MIN_OPEN_INTEREST} or daily volume >= {TERM_MIN_VOLUME}",
            "standardMultiplier": 100,
            "maximumQuoteAgeDays": MAX_QUOTE_AGE_DAYS,
        },
        "model": {
            "name": "ATM-straddle-implied lognormal distribution",
            "description": "Each target uses the nearest paired liquid ATM call and put. Their combined ask implies the expiration distribution shown on the chart.",
            "measure": "option-implied, not a historical or physical forecast",
        },
        "structures": structures,
        "contracts": liquid,
    }


def build_payload(
    raw: dict[str, Any],
    *,
    now: datetime,
    page_symbol: str | None = None,
) -> dict[str, Any]:
    event = dict(raw["event"])
    chain = dict(raw["chain"])
    underlier_symbol = str(chain["symbol"]).upper()
    page_symbol = str(page_symbol or underlier_symbol).upper()
    event_date = date.fromisoformat(str(event["date"])[:10])
    spot = float(chain["underlyingPrice"])
    expirations = sorted({str(row["expiration"]) for row in chain["contracts"] if str(row["expiration"]) >= event_date.isoformat()})
    if not expirations:
        raise RuntimeError(f"No {underlier_symbol} option expiration covers earnings on {event_date}")
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
    if len(cdf_points) >= 4:
        expiry_quantiles = {
            probability: _quantile(cdf_points, probability)
            for probability in (0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90)
        }
        distribution_method = "liquid vertical-spread risk-neutral CDF"
    else:
        calls = {float(row["strike"]): row for row in tradable if row["putCall"] == "CALL"}
        puts = {float(row["strike"]): row for row in tradable if row["putCall"] == "PUT"}
        common = sorted(set(calls) & set(puts), key=lambda strike: abs(strike / spot - 1.0))
        if not common:
            raise RuntimeError(f"No liquid ATM straddle survived for {underlier_symbol}")
        atm_strike = common[0]
        atm_debit = float(calls[atm_strike]["ask"]) + float(puts[atm_strike]["ask"])
        expiry_quantiles = _straddle_implied_quantiles(spot=spot, debit=atm_debit)
        distribution_method = "ATM-straddle-implied lognormal fallback"
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
    contracts = (
        [row for row in selected if str(row["symbol"]) in used_symbols]
        if used_symbols
        else selected
    )
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
    historical_earnings = _historical_earnings_moves(dict(raw.get("history") or {}))
    if len(historical_scenarios) < 4:
        raise RuntimeError(f"Only {len(historical_scenarios)} comparable earnings events available for {underlier_symbol}")
    if not historical_structures:
        raise RuntimeError(f"No volume-screened historical option structures survived for {underlier_symbol}")
    underlying = chain.get("underlying") or {}
    return {
        "version": 3,
        "mode": "earnings",
        "pageSymbol": page_symbol,
        "symbol": page_symbol,
        "underlierSymbol": underlier_symbol,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "source": "Schwab listed-options chain, FMP earnings calendars, and Sharadar adjusted prices",
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
            "name": distribution_method,
            "description": "Liquid vertical spreads are used when the chain supplies at least four valid probability points; otherwise the nearest liquid ATM straddle supplies the expiration distribution. Earnings-date log distances are time-scaled from the first post-event expiration.",
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
        "historicalEarnings": {
            "priceSource": "Sharadar split-adjusted close",
            "method": "After-close releases use event close to next trading close; before-open releases use prior trading close to event close. SEC acceptance time is used when available, with the historical calendar timing as fallback.",
            "events": historical_earnings,
        },
        "historicalAnalysis": {
            "entryLeadCalendarDays": (event_date - quote_date).days,
            "postEarningsCalendarDays": (expiration_date - event_date).days,
            "availableEvents": len(historical_scenarios),
            "primaryWindowEvents": min(12, len(historical_scenarios)),
            "priceSource": "Sharadar split-adjusted close",
            "eventSource": "SEC earnings release history with FMP historical calendar fallback",
            "method": "Each current two-leg structure is translated into percentage-of-spot strikes and debit. Those same normalized strikes and today's debit percentage are replayed across prior earnings using the same calendar-day entry lead and post-event exit horizon. A profitable event requires expiration payoff greater than the original debit.",
            "limitation": "Stock-path proxy using today's premium; historical option quotes, bid-ask execution, volatility repricing, early exercise, dividends, and transaction costs are not reconstructed.",
            "structures": historical_structures,
        },
        "contracts": contracts,
    }


def _build_profile_payload(
    page_symbol: str,
    *,
    now: datetime,
    remote: str,
    remote_repo: str,
    forward_events: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    profile = options_profile(page_symbol)
    candidates = profile["underlierCandidates"]
    if profile["kind"] == "earnings":
        underlier = candidates[0]
        if underlier not in forward_events:
            raise RuntimeError(f"No forward earnings estimate found for {underlier}")
        raw = fetch_remote(
            underlier,
            event=forward_events[underlier],
            remote=remote,
            remote_repo=remote_repo,
            today=now.date(),
        )
        return build_payload(raw, now=now, page_symbol=page_symbol)
    raw_by_symbol = fetch_term_remote(
        candidates,
        remote=remote,
        remote_repo=remote_repo,
        today=now.date(),
    )
    return build_term_payload(raw_by_symbol, page_symbol=page_symbol, now=now)


def _retain_last_good_payload(
    path: Path,
    *,
    now: datetime,
    failure: str,
    historical_earnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"No last-good options payload exists at {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if str(payload.get("mode")) not in {"earnings", "term_straddles"}:
        raise RuntimeError(f"Invalid last-good options payload at {path}")
    if payload["mode"] == "earnings" and historical_earnings is not None:
        payload["historicalEarnings"] = {
            "priceSource": "Sharadar split-adjusted close",
            "method": "After-close releases use event close to next trading close; before-open releases use prior trading close to event close. SEC acceptance time is used when available, with the historical calendar timing as fallback.",
            "events": historical_earnings,
        }
    payload["refreshStatus"] = {
        "state": "retained_last_good",
        "attemptedAt": now.isoformat().replace("+00:00", "Z"),
        "reason": failure,
    }
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", action="append", default=[])
    parser.add_argument("--remote", default=DEFAULT_REMOTE)
    parser.add_argument("--remote-repo", default=DEFAULT_REMOTE_REPO)
    parser.add_argument("--output-dir", type=Path, default=SITE_ROOT / "assets" / "market-data")
    parser.add_argument("--max-workers", type=int, default=4)
    args = parser.parse_args()
    symbols = [
        str(value).strip().upper()
        for value in (args.symbol or sorted(OPTIONS_PROFILES))
    ]
    for symbol in symbols:
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise SystemExit(f"Invalid symbol: {symbol!r}")
        if symbol not in OPTIONS_PROFILES:
            raise SystemExit(f"No listed-options profile for {symbol}")
    now = datetime.now(timezone.utc)
    earnings_underliers = tuple(
        options_profile(symbol)["underlierCandidates"][0]
        for symbol in symbols
        if options_profile(symbol)["kind"] == "earnings"
    )
    forward_events = (
        fetch_forward_events_remote(
            earnings_underliers,
            remote=args.remote,
            remote_repo=args.remote_repo,
            today=now.date(),
        )
        if earnings_underliers
        else {}
    )
    payloads: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, int(args.max_workers))) as executor:
        futures = {
            executor.submit(
                _build_profile_payload,
                symbol,
                now=now,
                remote=args.remote,
                remote_repo=args.remote_repo,
                forward_events=forward_events,
            ): symbol
            for symbol in symbols
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                payloads[symbol] = future.result()
            except subprocess.CalledProcessError as exc:
                stderr = str(exc.stderr or "").strip().splitlines()
                detail = stderr[-1] if stderr else str(exc)
                failures[symbol] = f"remote command failed: {detail}"
            except Exception as exc:
                failures[symbol] = f"{type(exc).__name__}: {exc}"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # A transient loss of qualifying current-chain volume must not weaken the
    # liquidity screen or block unrelated pages. Retain the disclosed last-good
    # structure and refresh its independent historical reaction tape.
    for symbol, failure in list(sorted(failures.items())):
        target = args.output_dir / f"{symbol.lower()}-options.json"
        try:
            historical_earnings = None
            profile = options_profile(symbol)
            if profile["kind"] == "earnings":
                underlier = profile["underlierCandidates"][0]
                if underlier not in forward_events:
                    raise RuntimeError(f"No forward earnings estimate found for {underlier}")
                raw = fetch_remote(
                    underlier,
                    event=forward_events[underlier],
                    remote=args.remote,
                    remote_repo=args.remote_repo,
                    today=now.date(),
                )
                historical_earnings = _historical_earnings_moves(dict(raw.get("history") or {}))
            payloads[symbol] = _retain_last_good_payload(
                target,
                now=now,
                failure=failure,
                historical_earnings=historical_earnings,
            )
            del failures[symbol]
        except Exception as fallback_error:
            failures[symbol] = f"{failure}; last-good retention failed: {fallback_error}"
    if failures:
        detail = "; ".join(f"{symbol}={message}" for symbol, message in sorted(failures.items()))
        raise RuntimeError(f"Options refresh failed: {detail}")
    for symbol in sorted(payloads):
        payload = payloads[symbol]
        target = args.output_dir / f"{symbol.lower()}-options.json"
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n",
            encoding="utf-8",
        )
        temporary.replace(target)
        if payload["mode"] == "earnings":
            detail = (
                f"{payload['earnings']['date']} earnings, "
                f"{len(payload['historicalAnalysis']['structures'])} ranked structures"
            )
        else:
            detail = (
                f"{payload['underlierSymbol']} proxy, "
                f"{len(payload['structures'])} term straddles"
            )
        print(f"{symbol}: {detail} -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
