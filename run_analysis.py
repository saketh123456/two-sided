"""Run the Monte Carlo comparison of all strategies and write tables + plots.

Usage:
    python run_analysis.py                 # 10,000 paths per strategy per scenario
    python run_analysis.py --paths 2000    # quicker
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, replace
from pathlib import Path

from mmsim import MarketParams, default_strategies, simulate
from mmsim.metrics import paired_difference, summarize
from mmsim.plots import plot_drawdowns, plot_inventory, plot_pnl_distributions, plot_sample_pnl

SCENARIOS = {
    "baseline": MarketParams(sigma=2.0),
    "high_vol": MarketParams(sigma=6.0),
}


def fmt_table(rows: list[dict]) -> str:
    cols = [
        ("Strategy", "strategy", "{}"),
        ("Mean PnL", "mean_pnl", "{:.2f}"),
        ("Std PnL", "std_pnl", "{:.2f}"),
        ("95% CI of mean", None, None),
        ("P(loss)", "p_loss", "{:.2%}"),
        ("5% quantile", "pnl_p05", "{:.2f}"),
        ("ES 5%", "es05", "{:.2f}"),
        ("Sharpe (mean/std)", "sharpe_xs", "{:.2f}"),
        ("Median per-path Sharpe", "sharpe_path_median", "{:.2f}"),
        ("Max DD median", "dd_median", "{:.2f}"),
        ("Max DD 95th", "dd_p95", "{:.2f}"),
        ("Fills / session", "fills_mean", "{:.1f}"),
        ("Mean abs inventory", "mean_abs_inv", "{:.2f}"),
    ]
    head = "| " + " | ".join(c[0] for c in cols) + " |"
    sep = "|" + "|".join("---" for _ in cols) + "|"
    lines = [head, sep]
    for r in rows:
        cells = []
        for _, key, f in cols:
            if key is None:
                cells.append(f"[{r['ci95_low']:.2f}, {r['ci95_high']:.2f}]")
            else:
                cells.append(f.format(r[key]))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paths", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=20261120)
    ap.add_argument("--out", type=Path, default=Path("results"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    report: dict = {"seed": args.seed, "n_paths": args.paths, "scenarios": {}}
    md: list[str] = []

    for name, market in SCENARIOS.items():
        t0 = time.perf_counter()
        results = [simulate(s, market, n_paths=args.paths, seed=args.seed) for s in default_strategies()]
        elapsed = time.perf_counter() - t0
        rows = [summarize(r) for r in results]
        base = results[0]
        diffs = {r.strategy: paired_difference(r, base) for r in results[1:]}

        report["scenarios"][name] = {
            "market": asdict(market),
            "strategies": [
                {**asdict(s), **{"name": s.name}} for s in default_strategies()
            ],
            "summary": rows,
            "paired_diff_vs_fixed": diffs,
            "runtime_seconds": elapsed,
        }

        title = f"{name}: sigma={market.sigma}, {args.paths:,} paths, seed {args.seed}"
        plot_pnl_distributions(results, f"Final PnL distribution — {title}", args.out / f"pnl_{name}.png")
        plot_inventory(results, f"Inventory over time — {title}", args.out / f"inventory_{name}.png")
        plot_drawdowns(results, f"Max drawdown CDF — {title}", args.out / f"drawdown_{name}.png")
        plot_sample_pnl(results, f"Sample PnL paths — {title}", args.out / f"pnl_paths_{name}.png")

        md.append(f"### {name} (sigma = {market.sigma})\n")
        md.append(fmt_table(rows))
        md.append("\nPaired difference vs fixed spread (same seeds, so same price paths and order arrivals):\n")
        md.append("| Strategy | Mean PnL diff | 95% CI |\n|---|---|---|")
        for k, d in diffs.items():
            md.append(f"| {k} | {d['mean_diff']:.2f} | [{d['ci95_low']:.2f}, {d['ci95_high']:.2f}] |")
        md.append(f"\nRuntime: {elapsed:.1f}s for 3 strategies x {args.paths:,} paths x {market.n_steps} steps.\n")

        del results

    (args.out / "summary.json").write_text(json.dumps(report, indent=2))
    text = "\n".join(md)
    (args.out / "summary.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
