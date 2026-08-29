#!/usr/bin/env python3
"""Publish the transcript-backed Volt Typhoon utility screen.

The source run remains in NavStrategies. This exporter intentionally emits
only reader-facing evidence fields: issuer identity, latest-call date, market
capitalization, AI-load financial offset, operational exposure, and the
resulting common-equity burden. Provider names, prompt internals, token data,
and private trading signals are excluded.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = (
    HERE.parents[2]
    / "navstrategies/var/research/volt_typhoon_utility_one_pager_v1/ranked_scores.csv"
)
DEFAULT_MANIFEST = DEFAULT_SOURCE.parent / "universe_manifest.csv"
DEFAULT_OUTPUT = HERE / "data"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-market-cap-usd", type=float, default=5_000_000_000)
    args = parser.parse_args()

    ranked = pd.read_csv(args.source)
    manifest = pd.read_csv(args.manifest)
    public = ranked.loc[ranked["marketcap_usd"].ge(args.min_market_cap_usd)].copy()
    public["ai_load_financial_offset"] = public["benefit_score"].clip(lower=0, upper=100)
    public["operational_exposure"] = public["vulnerability_score"].clip(lower=0, upper=100)
    public["common_equity_burden"] = (
        public["operational_exposure"] - public["ai_load_financial_offset"]
    ).clip(lower=0, upper=100)
    public = public.rename(columns={"company_name": "company"})
    public = public[
        [
            "ticker",
            "company",
            "transcript_date",
            "marketcap_usd",
            "ai_load_financial_offset",
            "operational_exposure",
            "common_equity_burden",
        ]
    ].sort_values(["common_equity_burden", "marketcap_usd"], ascending=[False, False])

    eligible = manifest.loc[manifest["marketcap_usd"].ge(args.min_market_cap_usd)]
    missing = eligible.loc[~eligible["has_transcript"].astype(bool), ["ticker", "company_name"]]
    payload = {
        "schema_version": 1,
        "as_of": "2026-08-14",
        "method": (
            "Latest available earnings call mapped to the Volt Typhoon owner-operator frame: "
            "AI-load/rate-recovery offset, operational exposure, consequence, evidenced controls, "
            "and common-equity cost incidence."
        ),
        "universe": {
            "sharadar_utilities_above_threshold": int(len(eligible)),
            "transcript_backed": int(len(public)),
            "missing_latest_call": missing.to_dict(orient="records"),
            "minimum_market_cap_usd": args.min_market_cap_usd,
        },
        "companies": json.loads(public.to_json(orient="records")),
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    public.to_csv(args.output_dir / "volt_typhoon_utilities.csv", index=False, float_format="%.4f")
    (args.output_dir / "volt_typhoon_utilities.json").write_text(
        json.dumps(payload, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"published {len(public)} transcript-backed utilities; "
        f"{len(missing)} above-threshold issuer(s) lacked a usable call"
    )


if __name__ == "__main__":
    main()
