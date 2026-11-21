"""Summary statistics for Monte Carlo results."""
from __future__ import annotations

import numpy as np

from .model import SimResult

Z95 = 1.959963984540054


def max_drawdown(pnl_path: np.ndarray) -> np.ndarray:
    """Largest peak-to-trough fall along axis 0. PnL starts at 0, so the peak includes 0."""
    path = np.asarray(pnl_path, dtype=float)
    peak = np.maximum.accumulate(np.maximum(path, 0.0), axis=0)
    return np.max(peak - path, axis=0)


def mean_ci95(x: np.ndarray) -> tuple[float, float]:
    """Normal-approximation 95% confidence interval for the mean of x."""
    x = np.asarray(x, dtype=float)
    m = x.mean()
    half = Z95 * x.std(ddof=1) / np.sqrt(x.size)
    return float(m - half), float(m + half)


def expected_shortfall(x: np.ndarray, alpha: float = 0.05) -> float:
    """Mean of the worst alpha fraction of outcomes."""
    x = np.sort(np.asarray(x, dtype=float))
    n = max(1, int(np.floor(alpha * x.size)))
    return float(x[:n].mean())


def summarize(r: SimResult) -> dict:
    pnl = r.final_pnl
    lo, hi = mean_ci95(pnl)
    std = float(pnl.std(ddof=1))
    with np.errstate(divide="ignore", invalid="ignore"):
        path_sharpe = r.step_pnl_mean / r.step_pnl_std * np.sqrt(r.market.n_steps)
    return {
        "strategy": r.strategy,
        "n_paths": int(r.n_paths),
        "mean_pnl": float(pnl.mean()),
        "std_pnl": std,
        "ci95_low": lo,
        "ci95_high": hi,
        "p_loss": float(np.mean(pnl < 0)),
        "pnl_p05": float(np.percentile(pnl, 5)),
        "es05": expected_shortfall(pnl, 0.05),
        "sharpe_xs": float(pnl.mean() / std) if std > 0 else float("nan"),
        "sharpe_path_median": float(np.nanmedian(path_sharpe)),
        "dd_median": float(np.median(r.max_drawdown)),
        "dd_p95": float(np.percentile(r.max_drawdown, 95)),
        "dd_max": float(r.max_drawdown.max()),
        "fills_mean": float(np.mean(r.bid_fills + r.ask_fills)),
        "final_inv_std": float(r.final_inventory.std(ddof=1)),
        "mean_abs_inv": float(r.mean_abs_inventory.mean()),
    }


def paired_difference(a: SimResult, b: SimResult) -> dict:
    """Mean and 95% CI of (a - b) final PnL. Valid as paired only when seeds match."""
    if a.seed != b.seed or a.n_paths != b.n_paths:
        raise ValueError("paired comparison needs the same seed and path count")
    d = a.final_pnl - b.final_pnl
    lo, hi = mean_ci95(d)
    return {"mean_diff": float(d.mean()), "ci95_low": lo, "ci95_high": hi}
