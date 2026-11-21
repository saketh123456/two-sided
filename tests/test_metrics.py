import numpy as np
import pytest

from mmsim import FixedSpread, InventorySkew, MarketParams, simulate
from mmsim.metrics import expected_shortfall, max_drawdown, mean_ci95, paired_difference, summarize


def test_max_drawdown_known_series():
    path = np.array([0.0, 5.0, 2.0, 8.0, 1.0, 4.0])
    assert max_drawdown(path) == 7.0


def test_max_drawdown_counts_initial_zero_as_peak():
    assert max_drawdown(np.array([-1.0, -3.0, -2.0])) == 3.0


def test_streaming_drawdown_matches_full_path():
    m = MarketParams(n_steps=300, sigma=3.0)
    r = simulate(FixedSpread(), m, n_paths=200, seed=6, n_sample_paths=20)
    np.testing.assert_allclose(r.max_drawdown[:20], max_drawdown(r.sample_pnl), atol=1e-9)


def test_ci_contains_mean_and_shrinks():
    rng = np.random.default_rng(0)
    x = rng.normal(1.0, 2.0, 10_000)
    lo, hi = mean_ci95(x)
    assert lo < x.mean() < hi
    assert hi - lo == pytest.approx(2 * 1.96 * 2.0 / 100, rel=0.05)


def test_expected_shortfall():
    x = np.arange(100.0)
    assert expected_shortfall(x, 0.05) == pytest.approx(2.0)


def test_summary_fields_consistent():
    r = simulate(FixedSpread(), MarketParams(n_steps=200), n_paths=500, seed=1)
    s = summarize(r)
    assert s["ci95_low"] < s["mean_pnl"] < s["ci95_high"]
    assert 0.0 <= s["p_loss"] <= 1.0
    assert s["es05"] <= s["pnl_p05"]
    assert s["dd_median"] <= s["dd_p95"] <= s["dd_max"]


def test_paired_difference_requires_same_seed():
    m = MarketParams(n_steps=50)
    a = simulate(FixedSpread(), m, n_paths=50, seed=1)
    b = simulate(InventorySkew(), m, n_paths=50, seed=2)
    with pytest.raises(ValueError):
        paired_difference(a, b)
