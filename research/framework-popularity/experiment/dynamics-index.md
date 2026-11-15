# Framework dynamics index: descriptive pilot

This pilot combines monthly npm downloads (D) and monthly GitHub stars (S) to
describe relative dynamics within a framework. It does not measure unique users,
market share, or latent popularity. GitHub observations inherit the reconstruction
and revision limitations of the source dataset.

## Definition

For a fixed historical reference period B and raw-count offset c:

```
RD(t) = (D(t) + c) / (mean_B(D) + c)
RS(t) = (S(t) + c) / (mean_B(S) + c)
I(t)  = 100 * RD(t)^w * RS(t)^(1-w)
A(t)  = 100 * [w * RD(t) + (1-w) * RS(t)]
```

The primary scenario uses c=1, w=0.5, and September 2022–August 2023 as B.
Equal weights are a transparent convention, not fitted optimal weights or proof
of equal empirical influence. Zero counts remain in the main analysis.
The offset is in raw count units; changing units requires changing the offset.
100 represents both components at their reference values; the mean geometric
index over B need not equal 100. Framework-specific bases preclude interpreting
index levels as a ranking of absolute adoption.

For fixed weights, offset, and base, cancellation gives:

```
log(I(t)/I(t-k)) = w*log((D(t)+c)/(D(t-k)+c))
                + (1-w)*log((S(t)+c)/(S(t-k)+c))
```

Thus geometric index growth is invariant to the fixed reference period, although
its level is not. This standard algebraic property fails in general for changing
weights or moving bases. If component log changes are gD and gS, the zero-growth
weight is -gS/(gD-gS), where defined. Since log growth is linear in w, endpoint
signs establish directional robustness over the full continuous weight interval.

## Scope and reproducibility

Run with R and the existing jsonlite/digest packages:

```sh
Rscript research/framework-popularity/experiment/dynamics-index.R \
  output/article-experiment-2026-10-18 output/NEW-DIRECTORY
```

The script checks the frozen model-inputs.csv hash against its source manifest,
refuses to overwrite an output directory, and exports configuration, source code,
session information, figures, numeric tables, a Ukrainian report, and SHA-256
checksums. The source archive contains 795 observations; the common paired panel
contains 96 months per framework (September 2018–August 2026).

Sensitivity covers two aggregation methods, 21 weights, and four reference
periods ending before September 2023. Additional checks compare means/medians and
offsets 0/1/10 on a positive-count window. Directional stability uses 36 months
from September 2023 to August 2026 and weights 0.25–0.75. These overlapping YoY
changes are not independent observations; this is not a new forecasting backtest.
The weight envelope is a scenario range, not a confidence interval.

These choices are exploratory and were made after seeing the existing dataset,
not preregistered. Report all tested variants rather than selecting a base or
weight because it yields an attractive trajectory. Always show both components
alongside the combined index to expose compensation between opposing changes.

## Next research stage

Freeze the target definition and weight before comparing direct forecasts of
log(I) with aggregation of component forecasts. Use identical paired training
windows and the article's 24 origins and horizons 1, 3, 6, and 12, with naïve
baselines. Existing component fits on longer histories need refitting for a fair
comparison. Do not optimize weights by forecast error on a target those same
weights redefine. Prediction intervals require joint component uncertainty and
dependence; multiplying marginal interval bounds does not establish coverage.
Back-transforming a mean log forecast does not generally give a mean forecast.

Forecast skill alone cannot validate the construct. Scientific contribution must
rest on a justified measurement protocol and empirical robustness or forecasting
findings; weighted averaging itself is not a novelty claim.

Methodological references: [OECD/JRC Handbook](https://doi.org/10.1787/9789264043466-en)
and [Weights and Importance in Composite Indicators](https://publications.jrc.ec.europa.eu/repository/handle/JRC105460).
Source observations: [Zenodo dataset](https://doi.org/10.5281/zenodo.23575437).

## Rolling-origin point-forecast experiment

The implemented follow-up freezes w=0.5, c=1 and the primary 12-month base.
All three targets use exactly the same September 2018 onward training window:
log normalized downloads, log normalized monthly stars, and their average
log(I/100). The 24 completed origin months are September 2023–August 2025.
Each fit predicts the next 12 months; scoring uses exactly h=1,3,6,12.

For each of SARIMA, ETS, Prophet, persistence and seasonal naïve, compare a
single direct index fit with two component fits of the same family. No mixed
model combinations or data-selected weights are used. SARIMA and Prophet retain
the article's fitting settings. ETS is restricted to additive models on all
three log targets, since normalized logs may be negative. This restriction is
explicitly different from the count experiment. The geometric aggregation uses
unclipped predicted log components, then exponentiates; it does not inherit the
count experiment's expm1-and-clip step. These are transformed point predictions,
not claims about original-scale conditional means.

All 1080 fits, parameters, seeds, warnings, and predictions are preserved.
Comparisons include MAE, RMSE, WAPE and log MAE for each framework/horizon,
plus paired origin-level win counts and absolute-error differences. Rankings
are descriptive ex-post comparisons; no formal significance or interval coverage
claim is made. Both naïve routes must coincide algebraically and numerically.
A Python standard-library verifier independently recomputes targets, naïve
predictions, dates and all scoring groups and writes a Ukrainian report.

```sh
Rscript --vanilla research/framework-popularity/experiment/dynamics-backtest.R \
  output/dynamics-index-pilot-2026-11-08-v2 output/NEW-BACKTEST-DIRECTORY
python3 research/framework-popularity/experiment/verify-dynamics-backtest.py \
  output/NEW-BACKTEST-DIRECTORY
```

## Weight, period, and large-change sensitivity

The follow-up evaluates w=0.25 and w=0.75 with all other settings fixed. The
runner accepts optional weight and component-cache arguments. It verifies cache
hashes, source data, fitting/prediction code, and job identities; component fits
are weight-independent and reused, while direct index fits are re-estimated.
Each additional weight requires 360 new fits and reuses 720 component fits.

```sh
Rscript --vanilla research/framework-popularity/experiment/dynamics-backtest.R \
  output/dynamics-index-pilot-2026-11-08-v2 output/NEW-W25 0.25 \
  output/dynamics-index-backtest-2026-11-08
python3 research/framework-popularity/experiment/verify-dynamics-backtest.py output/NEW-W25
# Repeat with weight 0.75 and a separate output directory.
python3 research/framework-popularity/experiment/dynamics-robustness.py \
  output/NEW-SENSITIVITY output/NEW-W25 \
  output/dynamics-index-backtest-2026-11-08 output/NEW-W75
```

Early/late subsets contain the first/last 12 origins. For each framework/horizon,
rank the 24 target months by max(abs(delta log1p downloads), abs(delta log1p
monthly stars)), with date as tie breaker. Score separately without the top three
months, using the same dates for every weight, model, and route. This is a
retrospective evaluation sensitivity check, not anomaly detection or deletion
from training. Training-spike effects are not isolated by this experiment.

Exports include all 1440 score groups, paired route comparisons, selected dates,
error-concentration shares, winner sets, and the performance gap when retaining
the full-period 50/50 winner in every scenario. That last diagnostic distinguishes
rank flips from large practical gaps; it is not validation of an independently
selected model. Do not optimize the weight by these errors: changing the weight
changes the target. No significance test is asserted for overlapping errors.
