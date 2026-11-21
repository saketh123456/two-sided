import numpy as np
import pytest

from mmsim import FixedSpread, InventorySkew, MarketParams, fill_probability, simulate

SMALL = MarketParams(n_steps=200)


def test_fill_probability_decreases_with_distance():
    deltas = np.linspace(0.0, 5.0, 51)
    p = fill_probability(deltas, A=140.0, k=2.0, dt=0.001)
    assert np.all(np.diff(p) < 0)
    assert np.all((p > 0) & (p < 1))


def test_fill_probability_matches_poisson_formula():
    A, k, dt, delta = 140.0, 2.0, 0.001, 0.5
    lam = A * np.exp(-k * delta)
    assert fill_probability(delta, A, k, dt) == pytest.approx(1 - np.exp(-lam * dt))


def test_quotes_through_mid_capped_at_max_rate():
    assert fill_probability(-1.0, 140.0, 2.0, 0.001) == fill_probability(0.0, 140.0, 2.0, 0.001)


def test_zero_vol_profit_is_spread_times_fills():
    """With a constant mid, every fill earns exactly the half-spread."""
    h = 0.5
    m = MarketParams(sigma=0.0, n_steps=500)
    r = simulate(FixedSpread(half_spread=h), m, n_paths=2000, seed=1)
    np.testing.assert_allclose(r.final_pnl, h * (r.bid_fills + r.ask_fills), atol=1e-9)
    assert np.all(r.final_pnl >= 0)
    assert r.final_pnl.mean() > 0
    assert np.all(r.max_drawdown == 0)  # PnL never falls when sigma = 0


def test_zero_vol_expected_profit_matches_theory():
    h = 0.5
    m = MarketParams(sigma=0.0, n_steps=500)
    r = simulate(FixedSpread(half_spread=h), m, n_paths=4000, seed=2)
    p = float(fill_probability(h, m.A, m.k, m.dt))
    expected = 2 * m.n_steps * p * h
    se = r.final_pnl.std(ddof=1) / np.sqrt(r.n_paths)
    assert abs(r.final_pnl.mean() - expected) < 4 * se


def test_symmetric_flow_inventory_is_mean_zero():
    m = MarketParams(sigma=0.0, n_steps=500)
    r = simulate(FixedSpread(), m, n_paths=4000, seed=3)
    q = r.final_inventory
    se = q.std(ddof=1) / np.sqrt(q.size)
    assert abs(q.mean()) < 4 * se
    # Mean-zero at every time step too (averaged across paths).
    path_means = r.inventory.mean(axis=1)
    se_t = r.inventory.std(axis=1, ddof=1).max() / np.sqrt(q.size)
    assert np.max(np.abs(path_means)) < 5 * se_t


def test_same_seed_reproduces_exactly():
    a = simulate(FixedSpread(), SMALL, n_paths=500, seed=42)
    b = simulate(FixedSpread(), SMALL, n_paths=500, seed=42)
    np.testing.assert_array_equal(a.final_pnl, b.final_pnl)
    np.testing.assert_array_equal(a.inventory, b.inventory)
    np.testing.assert_array_equal(a.max_drawdown, b.max_drawdown)


def test_different_seeds_differ():
    a = simulate(FixedSpread(), SMALL, n_paths=500, seed=42)
    b = simulate(FixedSpread(), SMALL, n_paths=500, seed=43)
    assert not np.array_equal(a.final_pnl, b.final_pnl)


def test_common_random_numbers_across_strategies():
    a = simulate(FixedSpread(), SMALL, n_paths=300, seed=7)
    b = simulate(InventorySkew(), SMALL, n_paths=300, seed=7)
    np.testing.assert_array_equal(a.final_mid, b.final_mid)


def test_accounting_identity():
    r = simulate(FixedSpread(), SMALL, n_paths=500, seed=5)
    np.testing.assert_array_equal(r.final_inventory, r.bid_fills - r.ask_fills)
    np.testing.assert_allclose(
        r.final_pnl, r.final_cash + r.final_inventory * r.final_mid, rtol=0, atol=1e-8
    )


def test_gaussian_mid_has_configured_volatility():
    m = MarketParams(sigma=3.0, n_steps=200)
    r = simulate(FixedSpread(), m, n_paths=5000, seed=9, record_inventory=False)
    moves = r.final_mid - m.s0
    assert moves.std(ddof=1) == pytest.approx(m.sigma * np.sqrt(m.horizon), rel=0.05)


def test_binary_mid_moves_on_lattice():
    m = MarketParams(sigma=1.0, n_steps=100, price_model="binary")
    r = simulate(FixedSpread(), m, n_paths=1000, seed=11, record_inventory=False)
    steps = (r.final_mid - m.s0) / (m.sigma * np.sqrt(m.dt))
    np.testing.assert_allclose(steps, np.round(steps), atol=1e-6)
    # Parity: after an even number of +/-1 steps the position is even.
    assert np.all(np.round(steps).astype(int) % 2 == 0)


def test_unknown_price_model_rejected():
    with pytest.raises(ValueError):
        simulate(FixedSpread(), MarketParams(price_model="levy"), n_paths=10, seed=0)
