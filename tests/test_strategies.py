import numpy as np

from mmsim import FixedSpread, InventoryLimit, InventorySkew, MarketParams, simulate

M = MarketParams(n_steps=300)


def test_fixed_spread_quotes_symmetric():
    mid = np.array([100.0, 50.0])
    q = np.array([10, -3])
    bid, ask, bon, aon = FixedSpread(half_spread=0.4).quotes(mid, q)
    np.testing.assert_allclose(mid - bid, 0.4)
    np.testing.assert_allclose(ask - mid, 0.4)
    assert bon.all() and aon.all()


def test_skew_shifts_quotes_against_inventory():
    s = InventorySkew(half_spread=0.5, skew=0.1)
    mid = np.array([100.0, 100.0, 100.0])
    q = np.array([5, 0, -5])
    bid, ask, _, _ = s.quotes(mid, q)
    np.testing.assert_allclose(bid, [99.0, 99.5, 100.0])
    np.testing.assert_allclose(ask, [100.0, 100.5, 101.0])


def test_zero_skew_equals_fixed_spread():
    a = simulate(FixedSpread(0.5), M, n_paths=400, seed=3)
    b = simulate(InventorySkew(0.5, skew=0.0), M, n_paths=400, seed=3)
    np.testing.assert_array_equal(a.final_pnl, b.final_pnl)


def test_unreachable_limit_equals_fixed_spread():
    a = simulate(FixedSpread(0.5), M, n_paths=400, seed=3)
    b = simulate(InventoryLimit(0.5, max_inventory=10**6), M, n_paths=400, seed=3)
    np.testing.assert_array_equal(a.final_pnl, b.final_pnl)


def test_inventory_limit_is_never_breached():
    lim = 3
    r = simulate(InventoryLimit(0.5, max_inventory=lim), M, n_paths=2000, seed=4)
    assert np.abs(r.inventory).max() <= lim
    assert np.abs(r.inventory).max() == lim  # and it is actually reached


def test_limit_stops_quoting_the_breaching_side():
    s = InventoryLimit(max_inventory=2)
    _, _, bon, aon = s.quotes(np.full(3, 100.0), np.array([2, 0, -2]))
    np.testing.assert_array_equal(bon, [False, True, True])
    np.testing.assert_array_equal(aon, [True, True, False])


def test_risk_controls_reduce_inventory_dispersion():
    m = MarketParams(n_steps=500, sigma=2.0)
    fixed = simulate(FixedSpread(), m, n_paths=3000, seed=8)
    skew = simulate(InventorySkew(), m, n_paths=3000, seed=8)
    limit = simulate(InventoryLimit(), m, n_paths=3000, seed=8)
    assert skew.final_inventory.std() < fixed.final_inventory.std()
    assert limit.final_inventory.std() < fixed.final_inventory.std()


def test_risk_controls_reduce_pnl_variance_at_high_vol():
    m = MarketParams(n_steps=500, sigma=6.0)
    fixed = simulate(FixedSpread(), m, n_paths=3000, seed=8, record_inventory=False)
    skew = simulate(InventorySkew(), m, n_paths=3000, seed=8, record_inventory=False)
    limit = simulate(InventoryLimit(), m, n_paths=3000, seed=8, record_inventory=False)
    assert skew.final_pnl.std() < fixed.final_pnl.std()
    assert limit.final_pnl.std() < fixed.final_pnl.std()
