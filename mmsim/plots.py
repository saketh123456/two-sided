"""Matplotlib figures for Monte Carlo results."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .model import SimResult  # noqa: E402

# Categorical slots in fixed order (validated for CVD separation).
COLORS = {
    "fixed_spread": "#2a78d6",
    "inventory_skew": "#eb6834",
    "inventory_limit": "#1baf7a",
}
LABELS = {
    "fixed_spread": "Fixed spread",
    "inventory_skew": "Inventory skew",
    "inventory_limit": "Inventory limit",
}
INK = "#2b2b29"
MUTED = "#76756f"
GRID = "#e4e3de"


def _style(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(MUTED)
    ax.tick_params(colors=MUTED, labelcolor=INK, labelsize=9)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def _color(name):
    return COLORS.get(name, MUTED)


def _label(name):
    return LABELS.get(name, name)


def plot_pnl_distributions(results: list[SimResult], title: str, path: Path) -> None:
    """Small multiples (shared x) of final PnL histograms."""
    allp = np.concatenate([r.final_pnl for r in results])
    lo, hi = np.percentile(allp, [0.1, 99.9])
    bins = np.linspace(lo, hi, 80)
    fig, axes = plt.subplots(len(results), 1, figsize=(8, 2.2 * len(results)), sharex=True, sharey=True)
    for ax, r in zip(np.atleast_1d(axes), results):
        c = _color(r.strategy)
        ax.hist(np.clip(r.final_pnl, lo, hi), bins=bins, color=c, alpha=0.85,
                edgecolor="white", linewidth=0.5)
        ax.axvline(0, color=INK, linewidth=1, linestyle="--")
        ax.axvline(r.final_pnl.mean(), color=INK, linewidth=1.5)
        ax.set_title(f"{_label(r.strategy)}  (mean {r.final_pnl.mean():.1f}, sd {r.final_pnl.std(ddof=1):.1f})",
                     loc="left", fontsize=10, color=INK)
        ax.set_ylabel("paths", color=INK, fontsize=9)
        _style(ax)
    np.atleast_1d(axes)[-1].set_xlabel("final mark-to-market PnL (solid = mean, dashed = 0; outer 0.1% tails collected in the end bins)", color=INK, fontsize=9)
    fig.suptitle(title, x=0.01, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_inventory(results: list[SimResult], title: str, path: Path, n_samples: int = 5) -> None:
    """Inventory over time: 5-95% and 25-75% bands, median, a few sample paths."""
    fig, axes = plt.subplots(1, len(results), figsize=(4.2 * len(results), 3.4), sharey=True)
    for ax, r in zip(np.atleast_1d(axes), results):
        if r.inventory is None:
            raise ValueError("simulate(..., record_inventory=True) is required for this plot")
        c = _color(r.strategy)
        q = r.inventory
        p5, p25, p50, p75, p95 = np.percentile(q, [5, 25, 50, 75, 95], axis=1)
        t = r.times
        ax.fill_between(t, p5, p95, color=c, alpha=0.18, linewidth=0, label="5–95%")
        ax.fill_between(t, p25, p75, color=c, alpha=0.35, linewidth=0, label="25–75%")
        for j in range(min(n_samples, q.shape[1])):
            ax.plot(t, q[:, j], color=MUTED, linewidth=0.7, alpha=0.7,
                    label="sample paths" if j == 0 else None)
        ax.plot(t, p50, color=c, linewidth=2, label="median")
        ax.set_title(_label(r.strategy), loc="left", fontsize=10, color=INK)
        ax.set_xlabel("time (session = 1)", color=INK, fontsize=9)
        _style(ax)
    first = np.atleast_1d(axes)[0]
    first.set_ylabel("inventory (units)", color=INK, fontsize=9)
    first.legend(fontsize=8, frameon=False, loc="upper left")
    fig.suptitle(title, x=0.01, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_drawdowns(results: list[SimResult], title: str, path: Path) -> None:
    """Empirical CDF of each path's maximum drawdown."""
    fig, ax = plt.subplots(figsize=(8, 3.8))
    for r in results:
        x = np.sort(r.max_drawdown)
        y = np.arange(1, x.size + 1) / x.size
        ax.plot(x, y, color=_color(r.strategy), linewidth=2, label=_label(r.strategy))
    ax.axhline(0.95, color=MUTED, linewidth=0.8, linestyle=":")
    ax.text(ax.get_xlim()[1], 0.935, "95th percentile", va="top", ha="right", fontsize=8, color=MUTED)
    ax.set_xlabel("maximum drawdown of MtM PnL within a session", color=INK, fontsize=9)
    ax.set_ylabel("share of paths ≤ x", color=INK, fontsize=9)
    ax.legend(frameon=False, fontsize=9, loc="lower right")
    _style(ax)
    ax.set_title(title, loc="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_sample_pnl(results: list[SimResult], title: str, path: Path, n_samples: int = 5) -> None:
    """A few MtM PnL paths per strategy (same seeds, so the same price paths)."""
    fig, axes = plt.subplots(1, len(results), figsize=(4.2 * len(results), 3.2), sharey=True)
    for ax, r in zip(np.atleast_1d(axes), results):
        c = _color(r.strategy)
        for j in range(min(n_samples, r.sample_pnl.shape[1])):
            ax.plot(r.times, r.sample_pnl[:, j], color=c, linewidth=1, alpha=0.4 + 0.12 * j)
        ax.axhline(0, color=INK, linewidth=0.8, linestyle="--")
        ax.set_title(_label(r.strategy), loc="left", fontsize=10, color=INK)
        ax.set_xlabel("time (session = 1)", color=INK, fontsize=9)
        _style(ax)
    np.atleast_1d(axes)[0].set_ylabel("MtM PnL", color=INK, fontsize=9)
    fig.suptitle(title, x=0.01, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
