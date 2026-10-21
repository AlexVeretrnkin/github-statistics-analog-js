# Frozen forecasting experiment

The article experiment uses a verified, explicitly selected observation snapshot. It does not collect data, access a database, update the application forecasts, or edit the manuscript. A new directory contains the exact inputs, source code, environment, fitted models and numerical outputs. Existing directories require explicit `--resume`, which rejects changes to configuration, input manifest, code or core model versions.

## Run and verify

Run from the repository root with the locked R environment (forecast 8.23.0 and Prophet 1.0):

```sh
Rscript --vanilla research/framework-popularity/tests/test_article_experiment.R
Rscript --vanilla research/framework-popularity/experiment/run.R \
  --snapshot=output/reproducibility/snapshot-2026-09-29T16-16-47.409Z \
  --output=output/article-experiment-2026-10-18
Rscript --vanilla research/framework-popularity/experiment/render.R \
  output/article-experiment-2026-10-18
Rscript --vanilla research/framework-popularity/experiment/verify.R \
  output/article-experiment-2026-10-18
```

If restoring into the project's private library, set `R_LIBS_USER=research/framework-popularity/.r-library` before these commands. The captured `session-info.txt` and `installed-packages.csv` document the environment actually used. `renv.lock` describes the existing dependency lock; platform equivalence is not assumed.

The chosen September 29 snapshot contains real collected observations exported from the **local Compose PostgreSQL database**, through August 2026. The user selected this verified six-series snapshot after a read-only check found that the production database currently has npm tables but no GitHub tables. It is not a snapshot of the deployed GCP database. The runner verifies every source checksum and independently checks daily continuity, counts, monthly sums and complete final months.

## Prespecified protocol

- Six series: npm downloads and GitHub star-history counts for React, Angular and Vue. Google Trends is outside this experiment.
- Exclude each initial partial source month, then trim leading zero months. Preserve all later zeros and observations; do not clean anomalies or interpolate. Export exclusions in `preparation.csv`.
- Use a shared final observed month and the last 24 common monthly forecast origins with complete 12-month follow-up. Each training sample contains at least 36 observations. Training begins at each series' first retained month and expands. All five families use exactly the same training and target data at each origin.
- An origin date such as `2023-09-01` labels the completed September observation: the actual information cutoff is September month end. It does not mean that September's total was available on September 1.
- Transform all models' inputs as `log1p(count)`. Back-transform point predictions and interval endpoints with `max(expm1(z), 0)`. These point predictions are not generally conditional means in count units. Under symmetric predictive distributions they correspond to medians before clipping.
- SARIMA: seasonal period 12; KPSS-based nonseasonal differencing and seasonal-strength-based seasonal differencing; stepwise AICc search; approximation disabled; CSS initialization then maximum likelihood (`CSS-ML`); mean/drift permitted when applicable. The selected specification, coefficients, variance, likelihood, AICc and convergence code are saved. Seasonal search does not guarantee nonzero seasonal orders.
- ETS: automatic eligible error/trend/seasonal structures and damped/undamped trend; likelihood estimation of smoothing parameters and initial states; AICc selection; usual and admissible bounds; multiplicative trend disabled. Parameters and states are saved.
- Prophet: MAP estimation, linear trend, up to 25 changepoint candidates in the first 80% of history, additive annual seasonality with Fourier order 10, prior scales 10 for seasonality and 0.05 for changepoints. No daily/weekly seasonality, holidays or external regressors. Newton for fewer than 100 observations, otherwise L-BFGS with the library's Newton fallback. No hyperparameter search. Internal normalization scales, changepoints and fitted parameters are preserved in RDS.
- Naive and seasonal naive: random walk and period-12 seasonal random walk on the same transformed scale. Their count-scale point predictions equal the last value and the corresponding previous seasonal value. Default model-based intervals are included.
- Re-estimate all models at each origin. No later observation is passed into fitting or structural selection. The data themselves are a single modern snapshot: revised historical GitHub buckets mean this is a retrospective backtest, not a real-time-vintage experiment.
- Score the error **at exactly h months**, for h=1,3,6,12, across origins. MAE is mean absolute error; RMSE is the square root of mean squared error; WAPE is 100 times total absolute error divided by total absolute actuals. Never pool native counts across series. Report absolute-error SD and 10th/90th percentiles as descriptive variability, not confidence intervals.
- Score 80% and 95% interval coverage, average width and the proper interval score `width + 2/alpha * (lower-actual)+ + 2/alpha * (actual-upper)+`. Prophet uses one set of 1,000 simulated draws for nested interval quantiles, with stored seeds. MAP intervals do not include full posterior parameter uncertainty.
- Compare RMSE rankings and ex-post per-origin error winners (ties share weight). These are retrospective comparisons, not prospectively tuned selections. Overlapping forecast errors are dependent; no iid significance claims are made. An origin is excluded from **all** models' paired summaries if one fails, and exclusions are exported. A run with any failed fit exits nonzero and is not reported as a clean result.
- Fit all families again through the final observed month for a separate 24-month outlook. These full-history fits are not used to score the backtest.

## Diagnostics and parameter uncertainty

Residuals, ACF values and Ljung–Box results are computed from each exact saved fitted object. SARIMA/ETS/baselines use their model innovation residuals; Prophet uses in-sample response residuals on the log1p scale. Multiplicative ETS innovations are relative errors and must not be interpreted as count-scale errors.

Choose Ljung–Box lag `max(k+3, min(24, floor(n/5)))`. For SARIMA, `k=p+q+P+Q`. For other models `k=0`, matching the non-ARIMA convention in forecast 8.23.0 `checkresiduals`; ETS and Prophet p-values are explicitly exploratory, without a validated effective-df correction. Non-rejection does not establish independence or correct calibration. No interpolation is applied to internal missing residuals; such a fit fails diagnostics. Each diagnostic row records residual sample size, lag, fitdf and alpha=.05.

SARIMA coefficient standard errors come from the fitted covariance matrix. Exported 95% Wald intervals are approximate and conditional on the chosen specification, ignoring selection uncertainty. ETS/Prophet parameter confidence intervals are not computed or invented; point estimates and model-based forecast uncertainty are distinct outputs. Six full-history panels show time residuals, ACF and distributions for SARIMA, ETS and Prophet. Historical fits' residuals and ACF are available numerically.

## Output files

- `input/`: byte-preserved source snapshot, including its original provenance manifest. Its archived dashboard forecasts are historical supporting files, not the new experiment's forecasts.
- `code/`, `config.json`, environment files: exact execution sources and protocol.
- `model-inputs.csv`, `preparation.csv`, `origins.csv`: model-ready observations, exclusions and origin schedule.
- `fits/*.rds`: one checkpoint per series/origin/model, containing the fitted object, numerical results, warnings, messages and seed. Successful checkpoints can be resumed.
- `metadata.csv`, `parameters.csv`, `fit-status.csv`: specifications, estimates and execution status.
- `predictions.csv`: all 12 historical steps and all 24 full-fit steps, with actuals where observed and 80/95% bounds. `phase` distinguishes backtest and full-history outlook.
- `accuracy.csv`, `rankings.csv`: 120 metric rows (6 series × 5 models × 4 horizons), with paired-origin comparisons.
- `ex-post-origin-winners.csv`, `ex-post-winner-frequency.csv`: descriptive hindsight stability, not a model-selection policy.
- `residuals.csv`, `acf.csv`, `diagnostics.csv`, `figures/`: diagnostic evidence. `render.R` regenerates readable PNG and vector PDF panels from saved fits and updates the checksum inventory, without estimating models again.
- `status.json`, `result-manifest.json`: completion status and SHA-256 inventory. The manifest checks bytes; `verify.R` also checks training boundaries, actual targets, saved-model replay and numerical metrics.

Outputs remain local under ignored `output/`. Publication, licensing metadata, DOI and manuscript edits are later steps. The experiment does not claim to reproduce the old article tables, whose origins and model configurations differ.

## Application view

The **Research validation** tab at `/framework-popularity` exposes the frozen article study separately from live signals and the older retrospective views. It contains the six-series winner matrix, all 120 accuracy rows (via series/horizon controls), both interval levels, tie-weighted origin wins, origin-by-origin errors and predictions, all five full-history outlooks, parameter estimates, exact-fit residual charts/ACF/histograms and test settings. The view explains preprocessing, optimization, parameter uncertainty and the limits of the retrospective comparison. Undefined leading baseline residuals are retained as gaps and excluded from histograms and diagnostic sample sizes.

Generate the application assets after running the experiment:

```sh
pnpm run research:experiment:export
# Or use a different verified archive directory:
python3 tools/export-article-experiment.py /path/to/article-experiment
```

The exporter checks the config and every consumed CSV against the experiment SHA-256 manifest. It writes `public/research/article-experiment/` (numeric JSON, downloadable CSVs and provenance), which is included in the web build and requires no database access or R at runtime. These assets belong to the app and are versioned; the manuscript, rendering QA and full RDS archive remain outside the app repository. The exporter never refits models, queries a database or deploys the app.

Full-history diagnostics/parameters are labeled separately from historical evaluation. The JSON also contains the paired forecasts at the four scored horizons, allowing the UI tests to independently recalculate all point/interval metrics and origin win counts. CSV downloads retain the original precision. The web payload does not replace a complete independently reproducible DOI archive or distribute the 750 RDS objects.

The earlier **Forecast vs actual** view derives its scores from the points it plots. Its September 2025 GitHub ETS forecasts are preserved separately in `src/server/services/github-ets-2025-09.json`, copied from the archived forecast CSV before any refresh. Live forecast updates do not change this comparison; only matching snapshot dates are evaluated, with no positional substitution for missing dates.
