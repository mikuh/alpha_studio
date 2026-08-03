# Calibration policy

## Unit of observation

One forecasted theme in one immutable premarket report. Use `todayAttackProbability` when parseable, otherwise `researchProbability`.

## Outcome mapping

- `hit` = 1.0
- `partial` = 0.5
- `not_triggered` = 0.0
- `miss` = 0.0
- `data_missing` = excluded

When several trigger review items belong to one theme, average their mapped outcomes. This evaluates trigger realization, not P&L.

## Metrics

- Brier = mean squared error between probability and outcome.
- MAE = mean absolute error.
- Bias = mean forecast minus mean outcome; positive means overforecasting.
- Reliability buckets use 20 percentage-point bands.

Show “sample insufficient” below 20 observations and avoid segment-level rules below five observations.
