# JavaScript framework popularity research

This directory preserves and consolidates the research previously maintained in
`main-web-js-frameworks-popularity`.

## What is included

- `data_builder.R` — Google Trends collection and monthly aggregation.
- `NpmDownloadsFetch.R` and `npm_transform.R` — npm download collection, QA, and transformation.
- `refresh_github_stars.R` — first-party GitHub count snapshots, net-growth derivation, and archive comparison.
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
- `pnpm research:refresh:stars` fetches the current first-party repository totals,
  stores one observation per repository/month, derives net growth between snapshots,
  and compares the fetched totals with the archived daily histories.
- `pnpm research:forecasts` regenerates all 24-month ARIMA, ETS, and Prophet
  forecasts without fetching source data.
- `pnpm research:validate` checks schemas, expected series, duplicate keys, numeric
  ranges, forecast horizons, and best-model uniqueness.

Successful runs write `out/refresh_manifest.json` with source coverage and forecast
metadata. Writes are atomic: an unsuccessful request does not replace the last good
dataset.

The GitHub Actions workflow `.github/workflows/ingest-npm-downloads.yml` runs on the
sixth day of each month. It reads the PostgreSQL checkpoint through a private Cloud
Run endpoint, refetches a 14-day npm overlap, and publishes validated batches back to
that endpoint using short-lived OIDC credentials. It does not commit generated data.

For a local end-to-end run, start the stack with `pnpm local:dev` or `pnpm local:up`. Use
`pnpm local:smoke` for a small deterministic ingestion, or `pnpm local:pipeline:npm` to execute
this real collector and publisher against the loopback ingestion endpoint. The local publisher
bypass is enabled explicitly for that command and is never set by the GitHub workflow.

After a real local run, `pnpm local:compare:npm` reconciles the PostgreSQL daily observations and
monthly aggregates with the original archived CSVs in this directory. Add strict exit semantics
with `pnpm local:compare:npm:strict`. Comparison is limited to the common date range per package;
coverage outside that range is displayed but is not classified as a difference. Avoid running the
synthetic `local:smoke` fixture before a clean historical comparison.

`.github/workflows/refresh-framework-research.yml` is now a manual-only legacy CSV
workflow while the remaining sources migrate. Google Trends is an unofficial public
endpoint and may rate-limit shared CI addresses; the collector retries with
exponential backoff, and a failed run preserves the previous snapshot.

GitHub repository settings must allow GitHub Actions to create pull requests:
**Settings → Actions → General → Workflow permissions**.

## GitHub stars collector

GitHub introduced access restrictions in July 2026: listing a repository's
stargazers is limited to admins and collaborators. Although the REST endpoint can
return `starred_at` timestamps, it is therefore not a general backfill option for
external repositories such as React, Angular, and Vue.

The implemented collector uses the public GitHub repository endpoint, which remains
available for first-party aggregate counts:

1. Query each repository's `stargazers_count` once per month and retain one dated
   observation per repository/month in `out/github_star_snapshots.csv`.
2. Derive month-to-month **net star growth** in
   `out/github_star_growth_monthly.csv`. Name the metric
   accordingly because unstars are included in the delta; it is not gross new stars.
3. Compare each fresh count with the latest archived total in
   `out/github_star_qa.csv`, making the handoff easy to inspect without treating the
   multi-month gap as one ordinary month.
4. Keep the current archived daily histories explicitly marked as legacy data and do
   not splice snapshot deltas into them as if they shared the same definition.
5. For a historical gross-new-stars replacement, evaluate GitHub Archive
   `WatchEvent` data as a separate, documented backfill. Validate its coverage against
   the monthly first-party counts before replacing the legacy history.
6. If collaborator/admin access becomes available for the target repositories, the
   timestamped Stargazers REST endpoint becomes the preferred exact event source.

The monthly workflow supplies its short-lived `GITHUB_TOKEN`; local runs may use
`GITHUB_TOKEN` or `GH_TOKEN`, and can also use the public unauthenticated rate limit.

## Provenance status

- Google Trends: collected by `data_builder.R` with category 31.
- npm downloads: collected by `NpmDownloadsFetch.R` from npm download data.
- GitHub stars: new observations come from GitHub's repository API. The archived
  daily CSV files remain preserved as received, with their upstream origin explicitly
  deferred for a later discussion.

Generated PNGs and diagnostic CSVs remain here as research evidence. With
`FRAMEWORK_RESEARCH_DB_READS=true`, the app reads observed npm values from PostgreSQL;
the other signals and forecasts still use archived files during the migration. See
[`docs/research-ingestion-architecture.md`](../../docs/research-ingestion-architecture.md)
for the complete design and rollout runbook.
