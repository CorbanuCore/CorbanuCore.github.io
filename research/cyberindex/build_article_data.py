#!/usr/bin/env python3
"""Build the auditable market-data snapshot used by the Cyber Index article.

The equity analytics come from the NavStrategies Bloomberg Desktop bridge. The
on-chain equity execution check uses the public Hyperliquid HIP-3 metadata for
the trade[XYZ] ``xyz`` DEX. This script writes only generated research artifacts beneath
``research/cyberindex/data``; it does not submit orders or mutate production
strategy state.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests


ARTICLE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = ARTICLE_DIR / "data"
DEFAULT_NAVSTRATEGIES_ROOT = ARTICLE_DIR.parents[2] / "navstrategies"
PRIVATE_SELECTION_RELATIVE_PATH = Path(
    "var/research/corbanu_cyber_private_inputs/selection_book.csv"
)
HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"

# Eligibility is thesis-first. Longs come from the universe above $1 billion of
# market capitalization, require a structural-beneficiary score of at least +50
# on the agentic-threat earnings assessment, and a positive current fundamental
# score. Shorts come from the universe above $10 billion, require a structural
# score of -40 or worse, and a negative current fundamental score. Ranking is
# a 50/50 blend of the structural score (rescaled) and the current fundamental
# score. Within each leg, sizing is a half-equal / half-signal blend; short
# signal includes a modest market-capacity tilt. Gross legs offset trailing
# two-year S&P 500 beta at the August 14, 2026 snapshot. Weights remain
# positive here; consumers apply the short sign.
EQUITY_BOOK: dict[str, list[tuple[str, float]]] = {
    "long": [
        ("TENB", 4.761509),
        ("YOU", 4.433747),
        ("QLYS", 4.395674),
        ("GEN", 4.375810),
        ("FFIV", 4.337737),
        ("IT", 4.236760),
        ("KD", 4.233449),
        ("ANET", 4.158958),
        ("CHKP", 4.153992),
        ("AVPT", 4.149026),
        ("OKTA", 4.140748),
        ("ESTC", 4.127506),
    ],
    "short": [
        ("TSLA", 6.129295),
        ("CVNA", 4.085101),
        ("YUM", 3.989615),
        ("COIN", 3.866074),
        ("TTWO", 3.706343),
        ("RIVN", 3.682118),
        ("MSCI", 3.675571),
        ("FLUT", 3.415208),
        ("MOH", 3.372959),
        ("PODD", 3.338923),
        ("CSGP", 3.186372),
        ("ATO", 3.182205),
        ("WTRG", 2.865300),
    ],
}

# Venue-constrained equity-perpetual proxy. Every contract had at least roughly
# $2.7 million of 24-hour notional volume and $11 million of open interest at
# the snapshot. Legs are equal-weighted within leg to respect venue depth, then
# independently beta-balanced using the same two-year daily method. It is not a
# one-for-one cash-basket replica.
ONCHAIN_BOOK: dict[str, list[tuple[str, float]]] = {
    "long": [
        ("PLTR", 15.211072),
        ("MSFT", 15.211072),
        ("AMZN", 15.211072),
        ("INTC", 15.211072),
    ],
    "short": [
        ("COIN", 9.788928),
        ("CRCL", 9.788928),
        ("TSLA", 9.788928),
        ("HOOD", 9.788928),
    ],
}


# Latest-call operating disclosures used to distinguish a demonstrated live
# production surface from a generic statement that a company "uses AI."  A
# percentage is included only when management disclosed one; it is never
# inferred from channel growth.  The common financial sensitivity below is
# calculated on total revenue so companies without a channel-mix disclosure
# remain comparable.
SHORT_PRODUCTION_SURFACES: dict[str, dict[str, str]] = {
    "TSLA": {
        "surface": "Paid FSD fleet, Robotaxi, Optimus, OTA vehicles, charging and energy systems on a common software control plane",
        "threat": "Fleet-update, teleoperation, model or firmware compromise forces recall, suspends autonomy revenue and creates physical liability",
    },
    "YUM": {
        "surface": "61% digital mix ex-Pizza Hut (KFC 67%); Byte platform centralizes ordering, menus, pricing and loyalty across brands",
        "threat": "Byte or loyalty compromise halts app, kiosk and delivery ordering across the franchise system during peak periods",
    },
    "COIN": {
        "surface": "Custodied customer crypto with operating hot wallets; Base settling the large majority of agentic stablecoin volume; x402 agent payments",
        "threat": "Key, bridge, exchange or agent-wallet compromise causes immediate, irreversible asset loss and customer make-whole expense",
    },
    "CVNA": {
        "surface": "Nearly 200k cars sold per quarter entirely online; loan origination and servicing on the same platform",
        "threat": "Platform outage stops all selling (roughly $80m of revenue per day) and loan-data compromise adds financing liability",
    },
    "MSCI": {
        "surface": "Indices and analytics embedded across the investment process; over $2.8tn of ETF assets linked to MSCI indices",
        "threat": "Index-integrity or client-data compromise damages retention while a cyber-driven risk-off cuts asset-based fees",
    },
    "RIVN": {
        "surface": "Software and services revenue of $515m in the quarter; VW joint venture, OTA updates, Autonomy+ and an AI assistant",
        "threat": "Compromised update, autonomy stack or plant OT creates recall, grounding, partner-confidence and production loss",
    },
    "TTWO": {
        "surface": "84% of net bookings from recurrent consumer spending across GTA Online, NBA 2K and Zynga accounts and payments",
        "threat": "Account takeover, payment fraud or an outage in the GTA VI launch window removes high-margin live-service revenue",
    },
    "FLUT": {
        "surface": "FanDuel real-money accounts, player deposit balances, and peak-event betting handle in regulated states",
        "threat": "Outage or account-takeover wave during NFL or World Cup peaks cuts handle and invites license action at 4.3x leverage",
    },
    "PODD": {
        "surface": "Omnipod 5 smartphone-controlled insulin dosing; cloud Omnipod Discover and a 360-degree customer data platform",
        "threat": "Dosing manipulation or PHI compromise triggers FDA action, recall, litigation and lost new-patient starts",
    },
    "MOH": {
        "surface": "$42bn of premium revenue and 5m members processed through electronic enrollment, claims and payment systems",
        "threat": "Ransomware halts claims and payment while a PHI breach adds fines and litigation against a roughly 1.3% pre-tax margin",
    },
    "CSGP": {
        "surface": "Proprietary property, lender and lease databases (100k+ active loans, $1.2tn of debt) behind 93% renewal rates",
        "threat": "Large-scale data exfiltration erodes the data moat, pricing power and renewal economics",
    },
    "ATO": {
        "surface": "Gas distribution and pipeline network run on SCADA telemetry, remote compression and pressure control across eight states",
        "threat": "OT intrusion forces manual operation or shut-ins; response cost is expensed against a regulated return with no disclosed cyber cost tracker",
    },
    "WTRG": {
        "surface": "Water, wastewater and gas operations on internet-reachable PLC/SCADA controls, plus an in-flight American Water merger integration",
        "threat": "The July 2026 multi-state water-utility PLC attack wave hit exactly this control surface; remediation and hardening are expensed operating cost with recovery only at the next rate case",
    },
}


def _atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.replace(path)


def _json_value(value: Any) -> Any:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        return _json_value(value.item())
    return value


def _float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _production_root() -> Path:
    return Path(
        os.getenv("NAV_PRODUCTION_ROOT")
        or DEFAULT_NAVSTRATEGIES_ROOT / "var" / "production"
    ).expanduser()


def _leg_weights(book: dict[str, list[tuple[str, float]]], leg: str) -> dict[str, float]:
    values = dict(book[leg])
    total = sum(values.values())
    return {symbol: weight / total for symbol, weight in values.items()}


def _weighted_mean(values: dict[str, float | None], weights: dict[str, float]) -> tuple[float | None, float]:
    valid = {
        symbol: value
        for symbol, value in values.items()
        if value is not None and symbol in weights
    }
    coverage = sum(weights[symbol] for symbol in valid)
    if not valid or coverage <= 0:
        return None, 0.0
    result = sum(weights[symbol] * float(value) for symbol, value in valid.items()) / coverage
    return result, coverage


def _aggregate_forward_valuation(
    records: dict[str, dict[str, Any]],
    weights: dict[str, float],
) -> tuple[float | None, float | None, float]:
    """Return weighted EPS yield, its reciprocal, and data coverage.

    Negative forward EPS is deliberately retained. Dropping loss-making
    constituents would bias a basket-level valuation comparison toward the
    profitable subset precisely when the losses are economically relevant.
    """
    earnings_yields = {
        symbol: (
            records[symbol]["best_eps_1bf"] / records[symbol]["px_last"]
            if symbol in records
            and records[symbol].get("best_eps_1bf") is not None
            and records[symbol].get("px_last") not in (None, 0)
            else None
        )
        for symbol in weights
    }
    aggregate_yield, coverage = _weighted_mean(earnings_yields, weights)
    pe_equivalent = (
        1.0 / aggregate_yield if aggregate_yield not in (None, 0) else None
    )
    return aggregate_yield, pe_equivalent, coverage


def _historical_aggregate_forward_valuation(
    eps_panel: pd.DataFrame,
    price_panel: pd.DataFrame,
    weights: dict[str, float],
    *,
    minimum_coverage: float = 0.80,
) -> pd.DataFrame:
    """Build a fixed-weight historical forward-valuation series.

    Bloomberg BEST_EPS is divided by the price observed on the same date (or
    the most recent preceding trading day).  Negative EPS is retained.  The
    reciprocal is reported only when the aggregate earnings yield is positive,
    because a negative basket P/E is not economically interpretable.
    """
    symbols = [
        symbol
        for symbol in weights
        if symbol in eps_panel.columns and symbol in price_panel.columns
    ]
    if not symbols or eps_panel.empty or price_panel.empty:
        return pd.DataFrame(columns=["forward_eps_yield_pct", "forward_pe_equivalent", "coverage_pct"])

    eps = eps_panel[symbols].copy()
    prices = price_panel[symbols].copy()
    eps.index = pd.to_datetime(eps.index)
    prices.index = pd.to_datetime(prices.index)
    eps = eps.sort_index()
    prices = prices.sort_index().reindex(eps.index, method="ffill", tolerance=pd.Timedelta(days=7))
    yields = eps.div(prices.replace(0.0, pd.NA))
    weight_series = pd.Series({symbol: weights[symbol] for symbol in symbols})
    coverage = yields.notna().mul(weight_series, axis=1).sum(axis=1)
    weighted_yield = (
        yields.mul(weight_series, axis=1).sum(axis=1, min_count=1)
        / coverage.replace(0.0, pd.NA)
    ).where(coverage.ge(minimum_coverage))
    pe_equivalent = 1.0 / weighted_yield.where(weighted_yield.gt(0.0))
    return pd.DataFrame(
        {
            "forward_eps_yield_pct": weighted_yield * 100.0,
            "forward_pe_equivalent": pe_equivalent,
            "coverage_pct": coverage * 100.0,
        }
    ).dropna(subset=["forward_eps_yield_pct"])


def _history_panel(raw: pd.DataFrame, ticker_to_symbol: dict[str, str]) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame()
    frame = raw.reset_index().copy()
    frame["symbol"] = frame["bbgTicker"].map(ticker_to_symbol)
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["date", "symbol", "value"])
    return (
        frame.pivot_table(index="date", columns="symbol", values="value", aggfunc="last")
        .sort_index()
        .ffill(limit=4)
    )


def _realized_revenue_panels(
    *,
    symbols: list[str],
    start_date: str,
    end_date: str,
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    production_root = _production_root()
    source = (
        production_root
        / "pre_catalyst/factors/pre_catalyst_fundamental_panel.parquet"
    )
    if not source.exists():
        raise FileNotFoundError(f"NavStrategies fundamental panel not found: {source}")
    frame = pd.read_parquet(
        source,
        columns=["trade_date", "ticker", "revenue_4"],
        filters=[("ticker", "in", symbols)],
    ).reset_index()
    frame["trade_date"] = pd.to_datetime(frame["trade_date"], errors="coerce")
    frame["revenue_4"] = pd.to_numeric(frame["revenue_4"], errors="coerce")
    frame = frame.dropna(subset=["trade_date", "ticker", "revenue_4"])
    frame = frame.sort_values(["ticker", "trade_date"], kind="mergesort")
    frame["revenue_4_lag_252"] = frame.groupby("ticker", observed=True)["revenue_4"].shift(252)
    frame = frame.loc[
        frame["trade_date"].between(pd.Timestamp(start_date), pd.Timestamp(end_date))
    ]
    current_panel = (
        frame.pivot_table(
            index="trade_date",
            columns="ticker",
            values="revenue_4",
            aggfunc="last",
        )
        .sort_index()
        .ffill(limit=5)
    )
    lagged_panel = (
        frame.pivot_table(
            index="trade_date",
            columns="ticker",
            values="revenue_4_lag_252",
            aggfunc="last",
        )
        .sort_index()
        .ffill(limit=5)
    )
    return (
        current_panel,
        lagged_panel,
        "NavStrategies point-in-time Sharadar SF1 fundamental panel",
    )


def _weighted_series(panel: pd.DataFrame, weights: dict[str, float], transform=None) -> pd.Series:
    available = [symbol for symbol in weights if symbol in panel.columns]
    if not available:
        return pd.Series(dtype=float)
    values = panel[available].copy()
    if transform is not None:
        values = transform(values)
    weight_series = pd.Series({symbol: weights[symbol] for symbol in available})
    coverage = values.notna().mul(weight_series, axis=1).sum(axis=1)
    result = values.mul(weight_series, axis=1).sum(axis=1, min_count=1) / coverage.replace(0.0, pd.NA)
    return result.where(coverage.ge(0.80)).dropna()


def _percentile_rank(series: pd.Series, value: float | None) -> float | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty or value is None:
        return None
    return float((clean.le(value).sum() / len(clean)) * 100.0)


def _factor_overlay(
    selection_path: Path,
    equity_book: dict[str, list[tuple[str, float]]],
) -> dict[str, Any]:
    """Attach current public-market factors to the fixed research selection.

    The private selection file supplies ticker, name, and side. The published
    payload deliberately excludes model/provider fields and internal selection
    scores; those mechanics are not part of the reader-facing thesis.
    """
    if not selection_path.exists():
        raise FileNotFoundError(f"Private research selection not found: {selection_path}")
    book = pd.read_csv(selection_path)
    published_weights = {
        (leg, symbol): (weight if leg == "long" else -weight)
        for leg, positions in equity_book.items()
        for symbol, weight in positions
    }
    book["weight_pct"] = [
        published_weights[(str(row["leg"]), str(row["ticker"]))]
        for _, row in book.iterrows()
    ]
    selected = set(book["ticker"].astype(str))

    production_root = _production_root()
    garp_path = production_root / "bloomberg_live_garp/live_garp_latest.parquet"
    if not garp_path.exists():
        raise FileNotFoundError(f"Bloomberg live GARP overlay not found: {garp_path}")

    garp = pd.read_parquet(
        garp_path,
        columns=[
            "symbol",
            "trade_date",
            "market_cap",
            "garp_live",
            "eps_revision_z_63d",
            "quality_growth_live",
            "forward_revenue_growth_2q",
        ],
    )
    garp = garp.loc[garp["symbol"].isin(selected)].copy()
    garp = garp.sort_values(["symbol", "trade_date"], kind="mergesort").drop_duplicates("symbol", keep="last")
    joined = book[["leg", "ticker", "company", "weight_pct"]].merge(
        garp,
        left_on="ticker",
        right_on="symbol",
        how="left",
    )

    metrics = [
        "garp_live",
        "eps_revision_z_63d",
        "quality_growth_live",
        "forward_revenue_growth_2q",
        "market_cap",
    ]
    legs: dict[str, Any] = {}
    for leg in ("long", "short"):
        frame = joined.loc[joined["leg"].eq(leg)].copy()
        frame["weight_abs"] = pd.to_numeric(frame["weight_pct"], errors="coerce").abs()
        frame["weight_norm"] = frame["weight_abs"] / frame["weight_abs"].sum()
        weights = dict(zip(frame["ticker"], frame["weight_norm"]))
        leg_values: dict[str, Any] = {}
        for metric in metrics:
            values = {
                str(row["ticker"]): _float(row.get(metric))
                for _, row in frame.iterrows()
            }
            value, coverage = _weighted_mean(values, weights)
            leg_values[metric] = value
            leg_values[f"{metric}_coverage_pct"] = coverage * 100.0
        legs[leg] = leg_values

    security_keys = [
        "leg",
        "ticker",
        "company",
        "weight_pct",
        *metrics,
    ]
    securities = [
        {key: _json_value(row.get(key)) for key in security_keys}
        for _, row in joined.iterrows()
    ]
    trade_dates = pd.to_datetime(garp["trade_date"], errors="coerce").dropna()
    return {
        "selection_as_of": "2026-08-14",
        "overlay_trade_date": trade_dates.max().date().isoformat() if not trade_dates.empty else None,
        "source": "Bloomberg estimates and current NavStrategies fundamental factors",
        "legs": legs,
        "securities": sorted(securities, key=lambda item: str(item["ticker"])),
    }


def _security_betas(
    price_panel: pd.DataFrame,
    *,
    symbols: list[str],
    benchmark_symbol: str,
) -> tuple[dict[str, float | None], dict[str, int]]:
    returns = price_panel.pct_change(fill_method=None)
    benchmark = returns.get(benchmark_symbol)
    if benchmark is None:
        raise ValueError(f"beta benchmark missing from Bloomberg history: {benchmark_symbol}")
    betas: dict[str, float | None] = {}
    observations: dict[str, int] = {}
    for symbol in symbols:
        values = returns.get(symbol)
        if values is None:
            betas[symbol] = None
            observations[symbol] = 0
            continue
        paired = pd.concat([values.rename("security"), benchmark.rename("market")], axis=1).dropna()
        observations[symbol] = len(paired)
        market_variance = paired["market"].var() if len(paired) >= 126 else None
        betas[symbol] = (
            float(paired["security"].cov(paired["market"]) / market_variance)
            if market_variance not in (None, 0) and math.isfinite(float(market_variance))
            else None
        )
    return betas, observations


def _portfolio_analytics(
    *,
    name: str,
    book: dict[str, list[tuple[str, float]]],
    records: dict[str, dict[str, Any]],
    eps_panel: pd.DataFrame,
    price_panel: pd.DataFrame,
    revenue_panel: pd.DataFrame,
    lagged_revenue_panel: pd.DataFrame,
    current_prices: dict[str, float],
    betas: dict[str, float | None],
) -> tuple[dict[str, Any], pd.DataFrame]:
    leg_metrics: dict[str, Any] = {}
    history = pd.DataFrame(index=eps_panel.index.union(revenue_panel.index).sort_values())
    prefix = "" if name == "cash" else f"{name}_"
    for leg in ("long", "short"):
        weights = _leg_weights(book, leg)
        growth_values = {
            symbol: records.get(symbol, {}).get("best_sales_yoy_growth_1fy_pct")
            for symbol in weights
        }
        revenue_growth, revenue_growth_coverage = _weighted_mean(growth_values, weights)
        (
            aggregate_earnings_yield,
            aggregate_pe_equivalent,
            earnings_yield_coverage,
        ) = _aggregate_forward_valuation(records, weights)
        valuation_history = _historical_aggregate_forward_valuation(
            eps_panel,
            price_panel,
            weights,
        )
        yield_history = valuation_history.get(
            "forward_eps_yield_pct", pd.Series(dtype=float)
        ).dropna()
        pe_history = valuation_history.get(
            "forward_pe_equivalent", pd.Series(dtype=float)
        ).dropna()
        current_yield_pct = (
            aggregate_earnings_yield * 100.0
            if aggregate_earnings_yield is not None
            else None
        )
        yield_std = float(yield_history.std(ddof=0)) if len(yield_history) > 1 else None
        yield_zscore = (
            (float(current_yield_pct) - float(yield_history.mean())) / yield_std
            if current_yield_pct is not None and yield_std not in (None, 0.0)
            else None
        )

        def earnings_power(values: pd.DataFrame) -> pd.DataFrame:
            transformed = values.copy()
            for symbol in transformed.columns:
                price = current_prices.get(symbol)
                transformed[symbol] = transformed[symbol] / price if price else pd.NA
            return transformed

        eps_power = _weighted_series(eps_panel, weights, transform=earnings_power)
        eps_index = eps_power / eps_power.iloc[0] * 100.0 if not eps_power.empty else eps_power
        eps_90d = (
            eps_power.loc[eps_power.index >= (eps_power.index.max() - pd.Timedelta(days=91))]
            if not eps_power.empty
            else eps_power
        )
        eps_90d_index = eps_90d / eps_90d.iloc[0] * 100.0 if not eps_90d.empty else eps_90d
        current_revenue = _weighted_series(revenue_panel, weights)
        lagged_revenue = _weighted_series(lagged_revenue_panel, weights)
        growth_series = (
            current_revenue.div(lagged_revenue.replace(0.0, pd.NA)).sub(1.0).mul(100.0)
        ).dropna()
        current_growth_history = float(growth_series.iloc[-1]) if not growth_series.empty else None
        weighted_beta, beta_coverage = _weighted_mean(betas, weights)
        gross_weight = sum(weight for _, weight in book[leg])
        beta_sign = 1.0 if leg == "long" else -1.0
        leg_metrics[leg] = {
            "gross_weight_pct": gross_weight,
            "weighted_beta": weighted_beta,
            "beta_coverage_pct": beta_coverage * 100.0,
            "signed_beta_exposure": (
                beta_sign * gross_weight / 100.0 * weighted_beta
                if weighted_beta is not None
                else None
            ),
            "best_sales_yoy_growth_1fy_weighted_pct": revenue_growth,
            "best_sales_yoy_growth_coverage_pct": revenue_growth_coverage * 100.0,
            "forward_eps_yield_weighted_pct": (
                current_yield_pct
            ),
            "forward_eps_yield_pe_equivalent": aggregate_pe_equivalent,
            "forward_eps_yield_coverage_pct": earnings_yield_coverage * 100.0,
            "forward_eps_yield_history_mean_pct": (
                float(yield_history.mean()) if not yield_history.empty else None
            ),
            "forward_eps_yield_history_median_pct": (
                float(yield_history.median()) if not yield_history.empty else None
            ),
            "forward_eps_yield_history_percentile": _percentile_rank(
                yield_history,
                current_yield_pct,
            ),
            "forward_eps_yield_history_zscore": yield_zscore,
            "forward_pe_history_median": (
                float(pe_history.median()) if not pe_history.empty else None
            ),
            "forward_pe_history_25th_percentile": (
                float(pe_history.quantile(0.25)) if not pe_history.empty else None
            ),
            "forward_pe_history_75th_percentile": (
                float(pe_history.quantile(0.75)) if not pe_history.empty else None
            ),
            "forward_valuation_history_observations": int(len(yield_history)),
            "realized_ttm_sales_growth_history_mean_pct": float(growth_series.mean()) if not growth_series.empty else None,
            "realized_ttm_sales_growth_latest_pct": current_growth_history,
            "realized_ttm_sales_growth_history_percentile": _percentile_rank(growth_series, current_growth_history),
            "eps_expectations_index_start": float(eps_index.iloc[0]) if not eps_index.empty else None,
            "eps_expectations_index_latest": float(eps_index.iloc[-1]) if not eps_index.empty else None,
            "eps_expectations_change_pct": float(eps_index.iloc[-1] - 100.0) if not eps_index.empty else None,
            "eps_expectations_change_90d_pct": float(eps_90d_index.iloc[-1] - 100.0) if not eps_90d_index.empty else None,
        }
        history[f"{prefix}{leg}_eps_expectations_index"] = eps_index.reindex(history.index).ffill(limit=4)
        history[f"{prefix}{leg}_eps_expectations_90d_index"] = eps_90d_index.reindex(history.index).ffill(limit=4)
        history[f"{prefix}{leg}_realized_ttm_sales_growth_pct"] = growth_series.reindex(history.index).ffill(limit=4)
        history[f"{prefix}{leg}_forward_eps_yield_pct"] = valuation_history[
            "forward_eps_yield_pct"
        ].reindex(history.index).ffill(limit=4)
        history[f"{prefix}{leg}_forward_pe_equivalent"] = valuation_history[
            "forward_pe_equivalent"
        ].reindex(history.index).ffill(limit=4)

    long_beta = leg_metrics["long"].get("signed_beta_exposure")
    short_beta = leg_metrics["short"].get("signed_beta_exposure")
    leg_metrics["portfolio"] = {
        "gross_exposure_pct": sum(
            float(leg_metrics[leg]["gross_weight_pct"]) for leg in ("long", "short")
        ),
        "net_cash_exposure_pct": (
            float(leg_metrics["long"]["gross_weight_pct"])
            - float(leg_metrics["short"]["gross_weight_pct"])
        ),
        "net_estimated_beta": (
            float(long_beta) + float(short_beta)
            if long_beta is not None and short_beta is not None
            else None
        ),
        "beta_method": "Trailing two-year daily covariance beta to the S&P 500 Index; within-leg conviction/capacity weights preserved",
    }
    return leg_metrics, history


def _book_payload(
    book: dict[str, list[tuple[str, float]]],
    betas: dict[str, float | None],
    beta_observations: dict[str, int],
) -> dict[str, list[dict[str, Any]]]:
    return {
        leg: [
            {
                "ticker": symbol,
                "weight_pct": weight if leg == "long" else -weight,
                "trailing_2y_beta": betas.get(symbol),
                "beta_observations": beta_observations.get(symbol, 0),
            }
            for symbol, weight in positions
        ]
        for leg, positions in book.items()
    }


def _short_materiality_payload(
    records: dict[str, dict[str, Any]],
    companies: dict[str, str],
) -> list[dict[str, Any]]:
    """Quantify a common recurring-cost sensitivity for exposed operators.

    The 50 bp case is a sensitivity, not a forecast.  It answers how a common
    revenue-scaled control burden would compare with each company's current
    earnings and cash generation.  Event loss, remediation, certification
    delay and revenue interruption are intentionally outside this recurring-
    expense bridge.
    """
    rows: list[dict[str, Any]] = []
    for symbol, _ in EQUITY_BOOK["short"]:
        record = records.get(symbol, {})
        revenue = _float(record.get("trailing_revenue_musd"))
        ebit = _float(record.get("trailing_ebit_musd"))
        free_cash_flow = _float(record.get("trailing_free_cash_flow_musd"))
        cost_50bps = revenue * 0.005 if revenue is not None else None
        surface = SHORT_PRODUCTION_SURFACES[symbol]
        rows.append(
            {
                "ticker": symbol,
                "company": companies.get(symbol, symbol),
                "trailing_revenue_musd": revenue,
                "trailing_ebit_musd": ebit,
                "trailing_free_cash_flow_musd": free_cash_flow,
                "disclosed_production_surface": surface["surface"],
                "primary_threat_path": surface["threat"],
                "incremental_cost_50bps_revenue_musd": cost_50bps,
                "incremental_cost_50bps_pct_ebit": (
                    cost_50bps / ebit * 100.0
                    if cost_50bps is not None and ebit is not None and ebit > 0
                    else None
                ),
                "incremental_cost_50bps_pct_free_cash_flow": (
                    cost_50bps / free_cash_flow * 100.0
                    if cost_50bps is not None
                    and free_cash_flow is not None
                    and free_cash_flow > 0
                    else None
                ),
                "revenue_bps_to_consume_10pct_ebit": (
                    ebit / revenue * 1000.0
                    if revenue is not None and revenue > 0 and ebit is not None and ebit > 0
                    else None
                ),
            }
        )
    return rows


def build_bloomberg_snapshot(output_dir: Path, navstrategies_root: Path, *, start_date: str, end_date: str) -> None:
    sys.path.insert(0, str(navstrategies_root))
    from navstrategies.config.credentials import load_persistent_env
    from navstrategies.data_sources.bloomberg import BloombergRemoteClient

    load_persistent_env()
    client = BloombergRemoteClient(timeout=180)
    all_symbols = list(
        dict.fromkeys(
            symbol
            for book in (EQUITY_BOOK, ONCHAIN_BOOK)
            for leg in book.values()
            for symbol, _ in leg
        )
    )
    symbol_to_ticker = {symbol: f"{symbol} US Equity" for symbol in all_symbols}
    ticker_to_symbol = {ticker: symbol for symbol, ticker in symbol_to_ticker.items()}
    tickers = list(symbol_to_ticker.values())

    bdp_1bf = client.BDP(
        tickers,
        [
            "PX_LAST",
            "BEST_PE_RATIO",
            "BEST_SALES",
            "BEST_EPS",
            "EXPECTED_REPORT_DT",
            "CUR_MKT_CAP",
            "SALES_REV_TURN",
            "EBIT",
            "TRAIL_12M_FREE_CASH_FLOW",
            "OPER_MARGIN",
        ],
        overrides={"BEST_FPERIOD_OVERRIDE": "1BF", "EQY_FUND_CRNCY": "USD"},
    )
    bdp_1fy = client.BDP(
        tickers,
        ["BEST_SALES_YOY_GTH", "BEST_EPS_YOY_GTH"],
        overrides={"BEST_FPERIOD_OVERRIDE": "1FY", "EQY_FUND_CRNCY": "USD"},
    )
    joined = bdp_1bf.join(bdp_1fy, how="outer", rsuffix="_1FY")
    joined["symbol"] = joined.index.map(ticker_to_symbol)

    records: list[dict[str, Any]] = []
    by_symbol: dict[str, dict[str, Any]] = {}
    for ticker, row in joined.iterrows():
        symbol = ticker_to_symbol.get(str(ticker))
        if not symbol:
            continue
        px_last = _float(row.get("PX_LAST"))
        best_eps_1bf = _float(row.get("BEST_EPS"))
        record = {
            "symbol": symbol,
            "bbg_ticker": str(ticker),
            "px_last": px_last,
            "best_pe_ratio_1bf": _float(row.get("BEST_PE_RATIO")),
            "best_sales_1bf_musd": _float(row.get("BEST_SALES")),
            "best_eps_1bf": best_eps_1bf,
            "forward_eps_yield_pct": (
                best_eps_1bf / px_last * 100.0
                if best_eps_1bf is not None and px_last not in (None, 0)
                else None
            ),
            "best_sales_yoy_growth_1fy_pct": _float(row.get("BEST_SALES_YOY_GTH")),
            "best_eps_yoy_growth_1fy_pct": _float(row.get("BEST_EPS_YOY_GTH")),
            "expected_report_date": _json_value(row.get("EXPECTED_REPORT_DT")),
            "market_cap_musd": _float(row.get("CUR_MKT_CAP")),
            "trailing_revenue_musd": _float(row.get("SALES_REV_TURN")),
            "trailing_ebit_musd": _float(row.get("EBIT")),
            "trailing_free_cash_flow_musd": _float(row.get("TRAIL_12M_FREE_CASH_FLOW")),
            "trailing_operating_margin_pct": _float(row.get("OPER_MARGIN")),
        }
        records.append(record)
        by_symbol[symbol] = record

    eps_raw = client.BDH(
        tickers,
        "BEST_EPS",
        start_date,
        end_date,
        periodicity="WEEKLY",
        overrides={"BEST_FPERIOD_OVERRIDE": "1BF", "EQY_FUND_CRNCY": "USD"},
    )
    eps_panel = _history_panel(eps_raw, ticker_to_symbol)
    beta_ticker = "SPX Index"
    beta_raw = client.BDH(
        [*tickers, beta_ticker],
        "PX_LAST",
        start_date,
        end_date,
        periodicity="DAILY",
    )
    beta_panel = _history_panel(
        beta_raw,
        {**ticker_to_symbol, beta_ticker: "SPX"},
    )
    for symbol, record in by_symbol.items():
        security_history = _historical_aggregate_forward_valuation(
            eps_panel,
            beta_panel,
            {symbol: 1.0},
        )
        yield_history = security_history.get(
            "forward_eps_yield_pct", pd.Series(dtype=float)
        ).dropna()
        pe_history = security_history.get(
            "forward_pe_equivalent", pd.Series(dtype=float)
        ).dropna()
        current_yield = _float(record.get("forward_eps_yield_pct"))
        record["forward_eps_yield_history_median_pct"] = (
            float(yield_history.median()) if not yield_history.empty else None
        )
        record["forward_eps_yield_history_percentile"] = _percentile_rank(
            yield_history,
            current_yield,
        )
        record["forward_pe_history_median"] = (
            float(pe_history.median()) if not pe_history.empty else None
        )
        record["forward_valuation_history_observations"] = int(len(yield_history))
    betas, beta_observations = _security_betas(
        beta_panel,
        symbols=all_symbols,
        benchmark_symbol="SPX",
    )
    revenue_panel, lagged_revenue_panel, growth_source = _realized_revenue_panels(
        symbols=all_symbols,
        start_date=start_date,
        end_date=end_date,
    )

    current_prices = {
        symbol: float(record["px_last"])
        for symbol, record in by_symbol.items()
        if record["px_last"] not in (None, 0)
    }

    leg_metrics, cash_history = _portfolio_analytics(
        name="cash",
        book=EQUITY_BOOK,
        records=by_symbol,
        eps_panel=eps_panel,
        price_panel=beta_panel,
        revenue_panel=revenue_panel,
        lagged_revenue_panel=lagged_revenue_panel,
        current_prices=current_prices,
        betas=betas,
    )
    tradexyz_leg_metrics, tradexyz_history = _portfolio_analytics(
        name="tradexyz",
        book=ONCHAIN_BOOK,
        records=by_symbol,
        eps_panel=eps_panel,
        price_panel=beta_panel,
        revenue_panel=revenue_panel,
        lagged_revenue_panel=lagged_revenue_panel,
        current_prices=current_prices,
        betas=betas,
    )
    history = cash_history.join(tradexyz_history, how="outer")
    for record in records:
        symbol = str(record["symbol"])
        record["trailing_2y_beta"] = betas.get(symbol)
        record["beta_observations"] = beta_observations.get(symbol, 0)

    generated_at = datetime.now(timezone.utc)
    snapshot = {
        "schema_version": 5,
        "generated_at_utc": generated_at.isoformat(),
        "source": "Bloomberg Desktop BLPAPI via NavStrategies BloombergRemoteClient",
        "request_window": {"start_date": start_date, "end_date": end_date, "estimate_periodicity": "WEEKLY", "beta_periodicity": "DAILY"},
        "field_definitions": {
            "best_pe_ratio_1bf": "Bloomberg BEST_PE_RATIO with BEST_FPERIOD_OVERRIDE=1BF",
            "forward_eps_yield": "Fixed-basket position-weighted Bloomberg BEST_EPS 1BF divided by current PX_LAST, including negative EPS; P/E-equivalent is the reciprocal of the aggregate yield",
            "historical_forward_valuation": "Fixed-weight weekly aggregate Bloomberg BEST_EPS 1BF divided by contemporaneous PX_LAST over the two-year request window; negative EPS retained and reciprocal shown only for positive aggregate yield",
            "short_materiality": "A 50 basis-point-of-total-revenue recurring-cost sensitivity, not a forecast; compared with trailing Bloomberg EBIT and free cash flow",
            "best_sales_yoy_growth_1fy_pct": "Bloomberg BEST_SALES_YOY_GTH with BEST_FPERIOD_OVERRIDE=1FY",
            "eps_expectations_index": "Fixed-basket weighted BEST_EPS 1BF divided by current PX_LAST, indexed to 100 at the first observation; isolates consensus changes rather than price returns",
            "realized_ttm_sales_growth": "Growth of fixed-position-weight aggregate point-in-time Sharadar SF1 revenue_4 versus the same weighted revenue base 252 US trading sessions earlier; loss-making and pre-revenue companies remain in the basket without unstable company-level percentage ratios",
            "trailing_2y_beta": "Daily covariance beta to the Bloomberg S&P 500 Index price series over the request window; at least 126 paired observations required",
        },
        "realized_growth_source": growth_source,
        "fundamental_overlay": _factor_overlay(
            navstrategies_root / PRIVATE_SELECTION_RELATIVE_PATH,
            EQUITY_BOOK,
        ),
        "legs": leg_metrics,
        "tradexyz_legs": tradexyz_leg_metrics,
        "books": {
            "cash": _book_payload(EQUITY_BOOK, betas, beta_observations),
            "tradexyz": _book_payload(ONCHAIN_BOOK, betas, beta_observations),
        },
        "short_materiality": _short_materiality_payload(
            by_symbol,
            {
                str(item["ticker"]): str(item["company"])
                for item in _factor_overlay(
                    navstrategies_root / PRIVATE_SELECTION_RELATIVE_PATH,
                    EQUITY_BOOK,
                )["securities"]
            },
        ),
        "securities": sorted(records, key=lambda item: item["symbol"]),
    }
    _atomic_text(
        output_dir / "bloomberg_snapshot.json",
        json.dumps(snapshot, indent=2, sort_keys=True, default=_json_value) + "\n",
    )

    history = history.dropna(how="all").resample("W-FRI").last().reset_index(names="date")
    history["date"] = pd.to_datetime(history["date"]).dt.date.astype(str)
    _atomic_text(output_dir / "portfolio_history.csv", history.to_csv(index=False, float_format="%.6f"))
    book_rows: list[dict[str, Any]] = []
    for portfolio_name, book in (("cash", EQUITY_BOOK), ("tradexyz", ONCHAIN_BOOK)):
        for leg, positions in book.items():
            sign = 1.0 if leg == "long" else -1.0
            for symbol, weight in positions:
                beta = betas.get(symbol)
                book_rows.append(
                    {
                        "portfolio": portfolio_name,
                        "leg": leg,
                        "ticker": symbol,
                        "weight_pct": sign * weight,
                        "trailing_2y_beta": beta,
                        "signed_beta_contribution": sign * weight / 100.0 * beta if beta is not None else None,
                        "beta_observations": beta_observations.get(symbol, 0),
                    }
                )
    _atomic_text(
        output_dir / "beta_neutral_books.csv",
        pd.DataFrame(book_rows).to_csv(index=False, float_format="%.8f"),
    )
    _atomic_text(
        output_dir / "short_materiality.csv",
        pd.DataFrame(snapshot["short_materiality"]).to_csv(
            index=False,
            float_format="%.6f",
        ),
    )


def build_tradexyz_snapshot(output_dir: Path) -> None:
    response = requests.post(
        HYPERLIQUID_INFO_URL,
        json={"type": "metaAndAssetCtxs", "dex": "xyz"},
        timeout=30,
    )
    response.raise_for_status()
    metadata, contexts = response.json()
    universe = metadata.get("universe") or []
    by_name = {str(item.get("name")): (item, contexts[index]) for index, item in enumerate(universe)}

    selected = {symbol for leg in ONCHAIN_BOOK.values() for symbol, _ in leg}
    markets: list[dict[str, Any]] = []
    for symbol in sorted(selected):
        venue_symbol = f"xyz:{symbol}"
        meta, context = by_name.get(venue_symbol, ({}, {}))
        mark = _float(context.get("markPx"))
        open_interest = _float(context.get("openInterest"))
        markets.append(
            {
                "symbol": symbol,
                "venue_symbol": venue_symbol,
                "listed": bool(meta),
                "active": bool(meta) and not bool(meta.get("isDelisted")) and context.get("midPx") is not None,
                "max_leverage": meta.get("maxLeverage"),
                "mark_price": mark,
                "day_notional_volume_usd": _float(context.get("dayNtlVlm")),
                "open_interest_notional_usd": (
                    open_interest * mark
                    if open_interest is not None and mark is not None
                    else None
                ),
                "funding_rate": _float(context.get("funding")),
            }
        )

    payload = {
        "schema_version": 3,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": HYPERLIQUID_INFO_URL,
        "dex": "xyz",
        "venue_note": "Venue-constrained stock-perpetual proxy validated against the live trade[XYZ] xyz HIP-3 metadata. It is not the cash basket: Coinbase was the only cash constituent listed with meaningful venue liquidity at the snapshot.",
        "selection_note": "The proxy preserves the cyber-beneficiary versus exposed-operator construction among contracts with real venue liquidity, equal-weights within each leg, then balances trailing market beta across the two legs.",
        "documentation": "https://docs.trade.xyz/about-trade-xyz/hyperliquid-xyz-and-hip-3",
        "book": ONCHAIN_BOOK,
        "markets": markets,
        "all_selected_active": all(item["active"] for item in markets),
    }
    _atomic_text(
        output_dir / "tradexyz_market_snapshot.json",
        json.dumps(payload, indent=2, sort_keys=True, default=_json_value) + "\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--navstrategies-root", type=Path, default=DEFAULT_NAVSTRATEGIES_ROOT)
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--lookback-days", type=int, default=730)
    args = parser.parse_args()
    end = date.fromisoformat(args.end_date)
    start = end - timedelta(days=max(90, int(args.lookback_days)))
    build_bloomberg_snapshot(
        args.output_dir,
        args.navstrategies_root,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    build_tradexyz_snapshot(args.output_dir)
    article_payload = {
        "bloomberg": json.loads((args.output_dir / "bloomberg_snapshot.json").read_text(encoding="utf-8")),
        "tradexyz": json.loads((args.output_dir / "tradexyz_market_snapshot.json").read_text(encoding="utf-8")),
        "history": json.loads(
            pd.read_csv(args.output_dir / "portfolio_history.csv").to_json(orient="records")
        ),
    }
    _atomic_text(
        args.output_dir / "article_data.js",
        "window.CYBER_INDEX_DATA = "
        + json.dumps(article_payload, separators=(",", ":"), default=_json_value)
        + ";\n",
    )
    print(f"wrote Cyber Index data to {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
