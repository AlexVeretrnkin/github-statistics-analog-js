# JavaScript framework popularity research

This directory preserves and consolidates the research previously maintained in
`main-web-js-frameworks-popularity`.

## What is included

- `data_builder.R` — Google Trends collection and monthly aggregation.
- `NpmDownloadsFetch.R` and `npm_transform.R` — npm download collection, QA, and transformation.
- `refresh_github_stars.R` and `github_star_history.R` — complete first-party GitHub daily star history, completed-month aggregation, and legacy reconciliation.
- `Github_Stars_Analysis.R` — monthly GitHub-star analysis.
- `Frameworks.R` — shared time-series, ARIMA, ETS, decomposition, and residual helpers.
- `Google_Trends_Analysis.R` and `NPM_Downlads_Analysis.R` — signal-specific forecasting workflows.
- `out/`, `git_stars/`, and `ts_out/` — archived datasets and generated research outputs.

The web application reads the archived monthly inputs on the server and exposes an
interactive comparison at `/framework-popularity`.

## Reproducing the analysis

Run the scripts from this directory so their relative paths resolve correctly.
They install/load the R packages declared at the beginning of each script.

Typical order:

1. `Rscript data_builder.R`
2. `Rscript NpmDownloadsFetch.R`
3. `Rscript npm_transform.R`
4. `Rscript Google_Trends_Analysis.R`
5. `Rscript NPM_Downlads_Analysis.R`
6. `Rscript Github_Stars_Analysis.R`
7. `Rscript export_forecasts.R`

`export_forecasts.R` creates the app-ready 24-month ARIMA, ETS, and Prophet forecast file
at `out/framework_popularity_forecasts.csv`. A 12-month holdout RMSE selects the
default model independently for each framework and metric.

## Automated refresh

From the repository root:

```bash
pnpm research:setup
pnpm research:refresh
```

Available commands:

- `pnpm research:refresh:npm` incrementally refetches npm data with a 14-day
  overlap, preserves historical daily observations, and publishes only completed
  calendar months.
- `pnpm research:refresh:trends` replaces the complete rolling five-year Google
  Trends snapshot. Trends results are normalized within each request, so snapshots
  must never be appended together.
- `pnpm research:collect:trends-ingestion` and
  `pnpm research:publish:trends-ingestion` run the database collector and publisher
  separately, using an ephemeral RDS handoff.
- `pnpm research:collect:stars-ingestion` creates an ephemeral full-history RDS payload;
  `pnpm research:publish:stars-ingestion` stages, validates, and atomically commits it to PostgreSQL.
- `pnpm local:pipeline:stars` runs both GitHub ingestion steps against the local private API.
- `pnpm research:refresh:stars` remains an explicit CSV research-export command and is not the production source of truth.
- `pnpm research:test:stars` runs the star-history parser, aggregation, and overlap-comparison checks without network access.
- `pnpm local:compare:stars` compares canonical PostgreSQL daily/monthly rows with the legacy files and prints the five largest differences per repository. Add `:strict` to fail on any overlap difference.
- `pnpm research:forecasts` regenerates all 24-month ARIMA, ETS, and Prophet
  forecasts without fetching source data. Before fitting, it independently drops
  the current and any future calendar month from every monthly input.
- `pnpm research:test:completed-months` verifies the shared completed-month guard
  without fetching data or regenerating forecasts.
- `pnpm research:validate` checks schemas, expected series, duplicate keys, numeric
  ranges, forecast horizons, and best-model uniqueness.

Successful runs write `out/refresh_manifest.json` with source coverage and forecast
metadata. Writes are atomic: an unsuccessful request does not replace the last good
dataset.

The GitHub Actions workflow `.github/workflows/ingest-npm-downloads.yml` runs on the
sixth day of each month. It reads the PostgreSQL checkpoint through a private Cloud
Run endpoint, refetches a 14-day npm overlap, and publishes validated batches back to
that endpoint using short-lived OIDC credentials. It does not commit generated data.

`.github/workflows/ingest-google-trends.yml` also runs monthly. It preserves Google's
returned 0–100 weekly values, uploads the complete rolling five-year window, and atomically
replaces the active database dataset. Completed monthly averages are derived in PostgreSQL.

For a local end-to-end run, start the stack with `pnpm local:dev` or `pnpm local:up`. Use
`pnpm local:smoke` for a small deterministic ingestion, or `pnpm local:pipeline:npm` to execute
the real npm collector and publisher against the loopback ingestion endpoint. Use
`pnpm local:pipeline:trends` for the real Google Trends path. The local publisher bypass is
enabled explicitly for those commands and is never set by the GitHub workflows.

After a real local run, `pnpm local:compare:npm` reconciles the PostgreSQL daily observations and
monthly aggregates with the original archived CSVs in this directory. Add strict exit semantics
with `pnpm local:compare:npm:strict`. Comparison is limited to the common date range per package;
coverage outside that range is displayed but is not classified as a difference. Avoid running the
synthetic `local:smoke` fixture before a clean historical comparison.

After `pnpm local:pipeline:trends`, use `pnpm local:compare:trends` to compare the exact ephemeral
RDS payload with PostgreSQL weekly observations and with monthly averages independently derived
from that payload. Add strict exit semantics with `pnpm local:compare:trends:strict`. This avoids
treating an older, separately normalized Google Trends CSV request as an exact-value baseline.

`.github/workflows/refresh-framework-research.yml` is now a manual-only legacy CSV
workflow while the remaining outputs migrate. Google Trends is an unofficial public
endpoint and may rate-limit shared CI addresses; the collector retries with
exponential backoff, and a failed run preserves the previous snapshot.

GitHub repository settings must allow GitHub Actions to create pull requests:
**Settings → Actions → General → Workflow permissions**.

## GitHub stars collector

GitHub restricted identity-bearing stargazer listings in July 2026, then introduced
the privacy-safe `GET /repos/{owner}/{repo}/stargazers/history` endpoint on September
4, 2026. It returns 30 calendar weeks per page and seven daily new-star counts per
week without exposing user identities.

The collector now:

1. Fetches the complete history for `facebook/react`, `angular/angular`, and
   `vuejs/core` using API version `2026-03-10`.
2. Requires every weekly `total` to equal the sum of its seven `days` values and
   requires gap-free, unique daily dates for each repository.
3. Publishes daily observations to `github_star_daily` and sums only completed
   calendar months into `github_star_monthly`. They are privacy-safe star-history
   bucket counts, not cumulative totals or snapshot deltas. Because their full-history
   sum equals the current stargazer count, historical buckets can be restated after
   unstars or account removals and must not be described as immutable gross additions.
4. Compares the reconstructed history total with GitHub's current stargazer count. A one-
   or two-star difference is accepted because deleted or suspended accounts can make the
   aggregate history differ from the headline count; the result is stored in run metadata.
5. Reconciles the official series with the former Daily Stars Explorer files over
   the common coverage range at both daily and monthly granularity before publication;
   the QA summary is retained in pipeline-run metadata.
6. Stages batches first, validates repository mapping and gap-free coverage server-side,
   then replaces daily/monthly canonical tables and activates the run in one transaction.

A complete three-repository refresh is slightly larger than GitHub's anonymous
60-request hourly allowance, so automated runs use the workflow's short-lived
`GITHUB_TOKEN`. Local runs should set `GITHUB_TOKEN` or `GH_TOKEN`. For a history-only
diagnostic run, `RESEARCH_GITHUB_VERIFY_CURRENT_COUNTS=false` skips the three headline
count requests and records `not-checked` explicitly in QA.

## Provenance status

- Google Trends: collected by `data_builder.R` with category 31.
- npm downloads: collected by `NpmDownloadsFetch.R` from npm download data.
- GitHub stars: complete daily histories come from GitHub's privacy-safe repository
  star-history REST endpoint. The archived CSV files are preserved only as a legacy
  reconciliation baseline.

Generated PNGs and diagnostic CSVs remain here as research evidence. With
`FRAMEWORK_RESEARCH_DB_READS=true`, the app reads observed npm, Google Trends, and GitHub
stars from PostgreSQL. Forecast artifacts remain file-based for now. See
[`docs/research-ingestion-architecture.md`](../../docs/research-ingestion-architecture.md)
for the complete design and rollout runbook.
