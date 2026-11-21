### baseline (sigma = 2.0)

| Strategy | Mean PnL | Std PnL | 95% CI of mean | P(loss) | 5% quantile | ES 5% | Sharpe (mean/std) | Median per-path Sharpe | Max DD median | Max DD 95th | Fills / session | Mean abs inventory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fixed_spread | 50.42 | 14.46 | [50.13, 50.70] | 0.25% | 27.46 | 18.23 | 3.49 | 4.37 | 6.47 | 22.07 | 100.6 | 5.14 |
| inventory_skew | 49.07 | 6.38 | [48.95, 49.20] | 0.00% | 38.76 | 36.13 | 7.70 | 7.71 | 2.03 | 4.19 | 102.7 | 1.68 |
| inventory_limit | 46.38 | 7.97 | [46.23, 46.54] | 0.00% | 32.96 | 29.22 | 5.82 | 6.16 | 3.26 | 6.25 | 92.7 | 2.56 |

Paired difference vs fixed spread (same seeds, so same price paths and order arrivals):

| Strategy | Mean PnL diff | 95% CI |
|---|---|---|
| inventory_skew | -1.35 | [-1.58, -1.11] |
| inventory_limit | -4.03 | [-4.24, -3.83] |

Runtime: 1.5s for 3 strategies x 10,000 paths x 1000 steps.

### high_vol (sigma = 6.0)

| Strategy | Mean PnL | Std PnL | 95% CI of mean | P(loss) | 5% quantile | ES 5% | Sharpe (mean/std) | Median per-path Sharpe | Max DD median | Max DD 95th | Fills / session | Mean abs inventory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fixed_spread | 50.69 | 41.04 | [49.89, 51.50] | 8.42% | -13.87 | -43.15 | 1.24 | 1.69 | 25.80 | 86.89 | 100.6 | 5.14 |
| inventory_skew | 49.15 | 13.77 | [48.88, 49.42] | 0.03% | 26.91 | 20.23 | 3.57 | 3.72 | 7.65 | 16.49 | 102.7 | 1.68 |
| inventory_limit | 46.46 | 18.90 | [46.09, 46.83] | 0.98% | 15.24 | 6.02 | 2.46 | 2.57 | 12.44 | 25.19 | 92.7 | 2.56 |

Paired difference vs fixed spread (same seeds, so same price paths and order arrivals):

| Strategy | Mean PnL diff | 95% CI |
|---|---|---|
| inventory_skew | -1.55 | [-2.25, -0.84] |
| inventory_limit | -4.23 | [-4.82, -3.64] |

Runtime: 1.5s for 3 strategies x 10,000 paths x 1000 steps.
