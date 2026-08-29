#!/usr/bin/env python3
"""Render the six charts requested in article.platt.md into charts/."""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd
from datetime import date

OUT = Path(__file__).resolve().parent / "charts"
OUT.mkdir(exist_ok=True)
DATA = Path(__file__).resolve().parent / "data"

plt.rcParams.update({
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "axes.edgecolor": "#333333",
    "axes.grid": True,
    "grid.color": "#dddddd",
    "grid.linewidth": 0.6,
    "font.size": 10,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
})
LONG_C = "#1a7a4a"
SHORT_C = "#b03030"
ACCENT = "#1f4e9c"


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / name, dpi=150)
    plt.close(fig)
    print("wrote", name)


# 1. Ransomware victim listings — known monthly datapoints + y/y inflection
def chart1():
    fig, ax = plt.subplots(figsize=(9, 4.6))
    labels = ["2025\navg", "Jul\n2025", "Jan\n2026", "Feb\n2026", "Mar\n2026", "Q2 2026\nmonthly avg", "Jul\n2026"]
    vals = [609, 516, 677, 680, 808, 713, 964]
    colors = ["#9aa7b8", "#9aa7b8", ACCENT, ACCENT, ACCENT, ACCENT, SHORT_C]
    bars = ax.bar(range(len(vals)), vals, color=colors, width=0.62)
    for i, v in enumerate(vals):
        ax.text(i, v + 12, str(v), ha="center", fontsize=9, fontweight="bold")
    ax.set_xticks(range(len(labels)), labels)
    ax.set_ylabel("Ransomware victim listings per month")
    ax.set_title("Ransomware victim listings: the inflection, not a trend continuation")
    ax2 = ax.twinx()
    yy_x = [4, 5, 6]
    yy = [18.5, 33.0, 87.0]
    ax2.plot(yy_x, yy, color="#222222", marker="o", linewidth=2, zorder=5)
    for x, y in zip(yy_x, yy):
        ax2.annotate(f"+{y:.0f}% y/y", (x, y), textcoords="offset points", xytext=(-12, 10), fontsize=9, fontweight="bold")
    ax2.set_ylabel("Year-over-year growth (%)")
    ax2.set_ylim(0, 110)
    ax2.grid(False)
    ax.set_ylim(0, 1060)
    fig.text(0.01, 0.01, "Sources: Breachsense monthly leak-site tracking (Jan–Mar 2026, 2025 avg); Check Point (Q2 2026, Jul 2025/2026). Trackers count publicly listed victims.", fontsize=7, color="#555555")
    save(fig, "ransomware_inflection.png")


# 2. Four-bar forward earnings yield comparison
def chart2():
    fig, ax = plt.subplots(figsize=(8, 4.4))
    labels = ["This long book", "S&P 500\ncomponents (IVV)", "IHAK cyber ETF\ncomponents", "This short book"]
    vals = [6.4, 5.0, 3.8, 2.5]
    pes = ["15.5×", "20.1×", "26.4×", "40.7×"]
    colors = [LONG_C, "#9aa7b8", "#9aa7b8", SHORT_C]
    ax.bar(labels, vals, color=colors, width=0.55)
    for i, (v, pe) in enumerate(zip(vals, pes)):
        ax.text(i, v + 0.12, f"{v:.1f}%  ({pe})", ha="center", fontsize=10, fontweight="bold")
    ax.set_ylabel("Weighted forward earnings yield (%)")
    ax.set_title("Forward earnings per dollar invested — snapshot August 13–14, 2026")
    ax.set_ylim(0, 7.4)
    fig.text(0.01, 0.01, "Identical fixed-weight method throughout, negative earnings included. IHAK/IVV holdings from BlackRock as of Aug 13, 2026 (97% IHAK weight coverage).", fontsize=7, color="#555555")
    save(fig, "earnings_yield_comparison.png")


# 3. Two-year history of the leg-level earnings-yield spread
def chart3():
    h = pd.read_csv(DATA / "portfolio_history.csv", parse_dates=["date"])
    h = h.dropna(subset=["long_forward_eps_yield_pct", "short_forward_eps_yield_pct"])
    spread = h["long_forward_eps_yield_pct"] - h["short_forward_eps_yield_pct"]
    fig, ax = plt.subplots(figsize=(9, 4.4))
    ax.plot(h["date"], spread, color=ACCENT, linewidth=1.8)
    cur = spread.iloc[-1]
    ax.axhline(cur, color=SHORT_C, linestyle="--", linewidth=1)
    ax.annotate(f"current spread: {cur:.1f} pts", (h["date"].iloc[-1], cur),
                textcoords="offset points", xytext=(-150, 10), fontsize=10, fontweight="bold", color=SHORT_C)
    ax.set_ylabel("Long minus short forward earnings yield (pts)")
    ax.set_title("The carry: leg-level earnings-yield gap, current fixed weights held backward")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.text(0.01, 0.01, "Weekly Bloomberg forward EPS and prices, aggregate yields at current fixed weights (negative earnings included).", fontsize=7, color="#555555")
    save(fig, "carry_history.png")


# 4. Utility-sector incident timeline with cumulative affected states
def chart4():
    events = [
        (date(2026, 2, 20), "Dragos 2026 OT review:\nVolt Typhoon still embedded\nin U.S. utilities"),
        (date(2026, 4, 15), "Iran-linked disruptions at\nU.S. oil/gas and water sites"),
        (date(2026, 5, 15), "Fuel-station tank gauges\naltered in several states"),
        (date(2026, 7, 27), "30+ Minnesota water\nsystems attacked"),
        (date(2026, 7, 30), "Joint FBI/EPA alert:\n'significant escalation'"),
        (date(2026, 8, 4), "Incidents reported\nin 12 states"),
    ]
    steps = [(date(2026, 7, 27), 1), (date(2026, 7, 31), 7), (date(2026, 8, 4), 12), (date(2026, 8, 14), 12)]
    fig, ax = plt.subplots(figsize=(9.5, 4.8))
    xs = [s[0] for s in steps]
    ys = [s[1] for s in steps]
    ax.step(xs, ys, where="post", color=SHORT_C, linewidth=2.5)
    ax.fill_between(xs, ys, step="post", color=SHORT_C, alpha=0.15)
    ax.set_ylabel("States with reported water-system intrusions (cumulative)")
    ax.set_ylim(0, 14)
    ax.set_xlim(date(2026, 2, 1), date(2026, 8, 20))
    placements = [
        (date(2026, 2, 20), 11.8),
        (date(2026, 4, 12), 9.6),
        (date(2026, 5, 18), 12.4),
        (date(2026, 6, 12), 7.4),
        (date(2026, 6, 24), 4.4),
        (date(2026, 7, 2), 13.0),
    ]
    for (d, label), (lx, lh) in zip(events, placements):
        ax.axvline(d, color="#888888", linewidth=0.8, linestyle=":")
        ax.annotate(label, xy=(d, min(lh, 13.4)), xytext=(lx, lh),
                    fontsize=7.5, ha="center",
                    arrowprops=dict(arrowstyle="-", color="#999999", lw=0.7) if lx != d else None,
                    bbox=dict(boxstyle="round,pad=0.25", fc="#f4f4f4", ec="#999999", lw=0.5))
    ax.set_title("Utility-sector cyber timeline, February–August 2026")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
    fig.text(0.01, 0.01, "Sources: FBI/EPA PSA (Jul 30, 2026), CISA/FBI alerts, Dragos 2026 OT Year in Review, CNN/ABC/Axios incident reporting. CISA's Volt Typhoon pre-positioning advisory (AA24-038A) predates the window (Feb 2024).", fontsize=7, color="#555555")
    save(fig, "utility_attack_timeline.png")


# 5. Security spend baseline vs the 0.5% sensitivity dial
def chart5():
    years = [2022, 2023, 2024, 2025]
    spend = [0.48, 0.63, 0.69, 0.69]
    fig, ax = plt.subplots(figsize=(8.5, 4.6))
    ax.plot(years, spend, color=ACCENT, marker="o", linewidth=2, label="Average security spend (IANS/Artico)")
    # simple linear extrapolation to 2026
    slope = (spend[-1] - spend[0]) / (years[-1] - years[0])
    ax.plot([2025, 2026], [spend[-1], spend[-1] + slope], color=ACCENT, linestyle="--", linewidth=1.5, label="Trend extrapolation")
    for x, y in zip(years, spend):
        ax.annotate(f"{y:.2f}%", (x, y), textcoords="offset points", xytext=(0, 9), ha="center", fontsize=9, fontweight="bold")
    ax.axhline(0.5, color=SHORT_C, linewidth=1.6, linestyle="-.")
    ax.text(2022.1, 0.515, "0.5% of revenue — the materiality-bridge sensitivity dial", color=SHORT_C, fontsize=9, fontweight="bold")
    ax.axhspan(0.3, 0.5, color="#e8b84d", alpha=0.25)
    ax.text(2025.65, 0.335, "Healthcare spend band\n0.3–0.5% of revenue\nvs ~$11m avg breach cost\n(22:1 cost-to-budget)", fontsize=8, ha="center")
    ax.set_ylim(0.25, 0.85)
    ax.set_ylabel("Security spending, % of revenue")
    ax.set_title("The spend baseline was rising before agentic attackers")
    ax.legend(loc="upper left", fontsize=8)
    fig.text(0.01, 0.01, "Sources: IANS Research / Artico Search Security Budget Benchmark; IBM Cost of a Data Breach (healthcare).", fontsize=7, color="#555555")
    save(fig, "spend_baseline_vs_dial.png")


# 6. Estimate trends, 25 names, sorted, momentum-cut threshold
def chart6():
    longs = {"TENB": 1.9, "YOU": 0.8, "QLYS": 2.6, "GEN": 2.4, "FFIV": 2.0, "IT": 2.6,
             "KD": 0.7, "ANET": 3.0, "CHKP": 1.2, "AVPT": 3.2, "OKTA": 1.3, "ESTC": 0.8}
    shorts = {"TSLA": -1.3, "CVNA": 2.0, "YUM": -1.7, "COIN": -2.1, "TTWO": 1.3, "RIVN": 2.3,
              "MSCI": 1.0, "FLUT": -2.1, "MOH": 1.8, "PODD": 0.3, "CSGP": 0.9, "ATO": 1.3, "WTRG": 2.0}
    rows = [(t, v, LONG_C) for t, v in longs.items()] + [(t, v, SHORT_C) for t, v in shorts.items()]
    rows.sort(key=lambda r: r[1])
    fig, ax = plt.subplots(figsize=(9.5, 5.2))
    names = [r[0] for r in rows]
    vals = [r[1] for r in rows]
    colors = [r[2] for r in rows]
    ax.bar(range(len(rows)), vals, color=colors, width=0.7)
    ax.set_xticks(range(len(rows)), names, rotation=60, fontsize=8)
    ax.axhline(2.0, color="#222222", linewidth=1.4, linestyle="--")
    ax.text(0.2, 2.08, "+2 momentum-cut threshold: shorts above this for two consecutive monthly reviews get halved", fontsize=8, fontweight="bold")
    ax.axhline(0, color="#333333", linewidth=0.8)
    ax.set_ylabel("63-day standardized estimate trend")
    ax.set_title("Analyst estimate trend by name — longs (green) vs shorts (red)")
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=LONG_C, label="Longs"), Patch(color=SHORT_C, label="Shorts")], loc="upper left", fontsize=9)
    fig.text(0.01, 0.01, "Shorts on the clock at entry: RIVN +2.3, CVNA +2.0, WTRG +2.0. Long-side raises are broad: 12 of 12 positive.", fontsize=7, color="#555555")
    save(fig, "estimate_trends_by_name.png")


chart1(); chart2(); chart3(); chart4(); chart5(); chart6()
