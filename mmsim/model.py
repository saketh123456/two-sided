"""Core market-making simulation, vectorised over Monte Carlo paths.

All data is synthetic: the mid price is a random walk and market orders are
Poisson arrivals whose intensity decays exponentially with quote distance.

Timing convention for each step t -> t+1:
  1. The strategy quotes bid/ask using the current mid S_t and inventory q_t.
  2. Market orders arrive; each side fills (one unit) with probability
     1 - exp(-lambda(delta) * dt).
  3. Cash and inventory update at the quoted prices.
  4. The mid moves to S_{t+1}; PnL is marked to market at S_{t+1}.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class MarketParams:
    """Parameters of the synthetic market."""

    s0: float = 100.0          # initial mid price
    sigma: float = 2.0         # mid volatility, price units per sqrt(unit time)
    horizon: float = 1.0       # length of one session (unit time)
    n_steps: int = 1000        # time steps per session
    A: float = 140.0           # arrival intensity at zero distance, per side
    k: float = 2.0             # exponential decay of intensity with distance
    price_model: str = "gaussian"  # "gaussian" (Brownian) or "binary" (+/- steps)

    @property
    def dt(self) -> float:
        return self.horizon / self.n_steps


class Strategy(Protocol):
    name: str

    def quotes(
        self, mid: np.ndarray, inventory: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Return (bid, ask, bid_active, ask_active), each shaped like `mid`."""
        ...


def arrival_rate(delta: np.ndarray | float, A: float, k: float) -> np.ndarray:
    """Poisson intensity lambda(delta) = A * exp(-k * delta).

    Quotes at or through the mid (delta <= 0) get the maximum rate A.
    """
    return A * np.exp(-k * np.maximum(delta, 0.0))


def fill_probability(delta: np.ndarray | float, A: float, k: float, dt: float) -> np.ndarray:
    """Probability of at least one arrival in dt: 1 - exp(-lambda(delta) dt)."""
    return -np.expm1(-arrival_rate(delta, A, k) * dt)


@dataclass
class SimResult:
    """Outputs of `simulate`. Arrays are indexed [path] or [time, path]."""

    strategy: str
    market: MarketParams
    seed: int
    times: np.ndarray              # (n_steps + 1,)
    final_pnl: np.ndarray          # (n_paths,)
    final_inventory: np.ndarray    # (n_paths,)
    final_cash: np.ndarray         # (n_paths,)
    final_mid: np.ndarray          # (n_paths,)
    max_drawdown: np.ndarray       # (n_paths,) largest peak-to-trough fall of MtM PnL
    bid_fills: np.ndarray          # (n_paths,)
    ask_fills: np.ndarray          # (n_paths,)
    step_pnl_mean: np.ndarray      # (n_paths,) mean of per-step PnL changes
    step_pnl_std: np.ndarray       # (n_paths,) std of per-step PnL changes
    mean_abs_inventory: np.ndarray  # (n_paths,) time-average |q|
    inventory: np.ndarray | None   # (n_steps + 1, n_paths) int32, if recorded
    sample_pnl: np.ndarray         # (n_steps + 1, n_sample) MtM PnL of first paths

    @property
    def n_paths(self) -> int:
        return self.final_pnl.shape[0]


def simulate(
    strategy: Strategy,
    market: MarketParams = MarketParams(),
    n_paths: int = 10_000,
    seed: int = 0,
    record_inventory: bool = True,
    n_sample_paths: int = 20,
) -> SimResult:
    """Run `n_paths` independent sessions in parallel.

    Random numbers are drawn in the same order regardless of strategy, so two
    strategies run with the same seed see identical mid-price paths and
    identical order-arrival uniforms (common random numbers). That makes
    strategy comparisons paired rather than independent.
    """
    if market.price_model not in ("gaussian", "binary"):
        raise ValueError(f"unknown price_model {market.price_model!r}")

    rng = np.random.default_rng(seed)
    n, T, dt = n_paths, market.n_steps, market.dt
    vol_step = market.sigma * np.sqrt(dt)
    m = min(n_sample_paths, n)

    mid = np.full(n, market.s0, dtype=np.float64)
    q = np.zeros(n, dtype=np.int64)
    cash = np.zeros(n, dtype=np.float64)
    pnl = np.zeros(n, dtype=np.float64)
    peak = np.zeros(n, dtype=np.float64)
    max_dd = np.zeros(n, dtype=np.float64)
    nb = np.zeros(n, dtype=np.int64)
    na = np.zeros(n, dtype=np.int64)
    d_sum = np.zeros(n, dtype=np.float64)
    d_sumsq = np.zeros(n, dtype=np.float64)
    abs_q_sum = np.zeros(n, dtype=np.float64)

    inv = np.zeros((T + 1, n), dtype=np.int32) if record_inventory else None
    sample_pnl = np.zeros((T + 1, m), dtype=np.float64)

    for t in range(T):
        # Fixed draw order per step keeps streams aligned across strategies.
        z = rng.standard_normal(n)
        u = rng.random((2, n))

        bid, ask, bid_on, ask_on = strategy.quotes(mid, q)
        p_bid = fill_probability(mid - bid, market.A, market.k, dt)
        p_ask = fill_probability(ask - mid, market.A, market.k, dt)
        bid_fill = bid_on & (u[0] < p_bid)   # someone sells to us at our bid
        ask_fill = ask_on & (u[1] < p_ask)   # someone buys from us at our ask

        q += bid_fill.astype(np.int64) - ask_fill.astype(np.int64)
        cash += np.where(ask_fill, ask, 0.0) - np.where(bid_fill, bid, 0.0)
        nb += bid_fill
        na += ask_fill

        if market.price_model == "gaussian":
            mid = mid + vol_step * z
        else:
            mid = mid + vol_step * np.where(z >= 0.0, 1.0, -1.0)

        new_pnl = cash + q * mid
        d = new_pnl - pnl
        d_sum += d
        d_sumsq += d * d
        pnl = new_pnl
        np.maximum(peak, pnl, out=peak)
        np.maximum(max_dd, peak - pnl, out=max_dd)
        abs_q_sum += np.abs(q)

        if inv is not None:
            inv[t + 1] = q
        sample_pnl[t + 1] = pnl[:m]

    step_mean = d_sum / T
    step_var = np.maximum(d_sumsq / T - step_mean**2, 0.0)

    return SimResult(
        strategy=strategy.name,
        market=market,
        seed=seed,
        times=np.linspace(0.0, market.horizon, T + 1),
        final_pnl=pnl,
        final_inventory=q.copy(),
        final_cash=cash,
        final_mid=mid,
        max_drawdown=max_dd,
        bid_fills=nb,
        ask_fills=na,
        step_pnl_mean=step_mean,
        step_pnl_std=np.sqrt(step_var),
        mean_abs_inventory=abs_q_sum / T,
        inventory=inv,
        sample_pnl=sample_pnl,
    )
