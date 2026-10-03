# Research access, verification, and archival release

## Three distinct claims

1. **Public access:** the [Cloud Run dashboard](https://github-statistics-analog-js-1097704636754.europe-west1.run.app/framework-popularity)
   allows readers to inspect the deployed system. The database is the operational
   source of truth. Current observations and previously stored forecasts can
   have different origins; a live deployment is not a frozen experiment.
2. **Software bootstrap:** the isolated test below builds the software, creates a
   fresh database, applies migrations, commits synthetic observations through
   the ingestion API, and checks dashboard delivery. This does not fit models.
3. **Numerical reproduction:** reproducing article tables and figures requires
   the original input snapshot, model configuration, environment, and evaluation
   code. Software startup and file checksums alone do not prove this claim.

## Isolated Docker check

Prerequisites: Docker Engine/Desktop with Compose, Node.js >=22.13.0, and network
access during image build. No local `pnpm install`, API token, `.env` file,
existing database volume, or cloud credential is needed.

```sh
node tools/verify-docker-reproducibility.mjs --no-cache
```

This command uses `compose.reproducibility.yaml` under a random project name.
It exposes no host ports, uses an internal runtime network, and does not mount
the working directory or existing database. Dependencies are installed from the
pnpm lockfile inside Docker. `--no-cache` disables Docker build-layer reuse;
base images can still be present locally. It is not a claim of testing on
every operating system or architecture.

The command checks that source checkpoints are empty before ingestion. It then
submits 93 npm, 780 Google Trends, and 228 GitHub synthetic daily/weekly rows.
Google Trends remains an application integration test, not part of the article
dataset. All three services must pass health checks. Logs, concrete image IDs,
migration output, and `report.json` are saved under `output/reproducibility/`.
Only this test project's disposable containers, network, and synthetic database
volume are removed after the run. Existing local and cloud services are untouched.

## Freeze canonical observations without altering the database

Choose the database explicitly. For example, when `.env` contains the intended
`DATABASE_URL` and no inherited `DATABASE_URL` overrides it:

```sh
node --env-file=.env packages/research-database/tools/export-reproducibility-snapshot.mjs --as-of=2026-09-29
node tools/verify-research-snapshot.mjs output/reproducibility/snapshot-<timestamp>
node tools/audit-saved-research-snapshot.mjs output/reproducibility/snapshot-<timestamp>
```

The exporter requires installed workspace dependencies (`pnpm install
--frozen-lockfile`). It executes a PostgreSQL **REPEATABLE READ, READ ONLY**
transaction. No migration, collection, forecast fitting, or database write is
performed. The explicit date fixes a completed-month cutoff; it does not
reconstruct past database state. Exported rows retain their ingestion run IDs.
Runs marked as synthetic are rejected. Only allowlisted provenance fields are
exported; arbitrary run metadata, error messages, and credentials are excluded.

For the existing local Compose database, select it explicitly with
`node --env-file=.env.local packages/research-database/tools/export-reproducibility-snapshot.mjs --local --as-of=2026-09-29`.
This mode uses only loopback and `LOCAL_DATABASE_*` / `LOCAL_POSTGRES_PORT` settings,
ignoring any inherited cloud connection string. A local snapshot is not claimed
to be a snapshot of the GCP production dataset.

The snapshot contains npm and GitHub observations, preserved dashboard forecasts,
supporting scripts, a [data dictionary](reproducibility-data-dictionary.md),
and a SHA-256 manifest. A successful integrity check means the bytes agree with
the manifest, not that they reproduce every article result. Never pass a current
snapshot off as the original training dataset for an archived forecast.

The offline audit requires Python 3 (standard-library CSV parsing only); set
`RESEARCH_AUDIT_PYTHON` if its executable is not `python3`. It does not access
the database. Initial GitHub months beginning mid-month are reported explicitly,
not silently described as full source coverage. Preserve them in the raw snapshot
and make any exclusion from model inputs an explicit, documented analysis step.

See [the dated verification results](reproducibility-verification-2026-09-29.md)
for the completed checks and outstanding publication work.

## Current numerical-reproduction gaps

`research/framework-popularity/renv.lock` records R 4.4.3 and the installed
dependency versions captured on 2026-09-29, including forecast 8.23.0 and
Prophet 1.0. With `renv` installed, `pnpm research:restore` restores the lock
into the project's `.r-library`. This is separate from the unpinned convenience
command `research:setup`. Restoring the full R/Stan toolchain on a clean Linux
image has **not** yet been verified; the web/ingestion Docker images do not run R.

- The general forecast exporter expects `out/github_stars_monthly.csv`, while
  older checked-in outputs use legacy GitHub histories. Its data contract must
  be satisfied explicitly from a documented snapshot.
- The general exporter also expects Google Trends; a dedicated article replay
  must select only npm and GitHub without silently changing the application.
- The 2025 GitHub forecast is frozen; the historical npm comparison is a
  reconstruction. They must retain these different evidential labels.
- An R dependency lock captured now documents the **current** environment, not
  proof of the environment used to generate older archived forecasts.
- Prophet simulation-based intervals need a recorded random seed in future
  runs. A seed chosen now cannot establish the original seed.
- Match every article table/figure to its inputs, script, forecast origin, and
  expected result. Test that mapping in a separate workspace before claiming
  numerical reproduction. Do not overwrite archived forecasts during this work.

## Release gates (not automatic publication)

- Review and commit the intended code, including currently untracked ingestion
  code and migrations. Do not commit `.env`, tokens, operational RDS handoffs,
  local databases, or unrelated article revisions.
- Record a version/tag and exact commit; a dirty-tree commit ID is insufficient.
- Verify source data coverage and monthly aggregation, and distinguish the article
  snapshot from later observations. Include evaluation code and expected tables.
- Original contributor code and software documentation use MIT. Confirm data
  redistribution and reuse terms separately; MIT does not automatically cover
  external observations, manuscripts, or figures (`LICENSE-SCOPE.md`).
- Confirm author names/identifiers and dataset metadata, then create a versioned
  archival record (e.g. Zenodo) with a persistent identifier and explicit terms.
  A GitHub URL or a live Cloud Run URL is not a dataset DOI.
- Add the published identifiers and exact version to `CITATION.cff`, README,
  and the article's Data and Code Availability statement only after publication.

FAIR principles concern findability, accessibility, interoperability, and reuse,
including machine-readable metadata and provenance. Public access is useful but
not sufficient. See [Wilkinson et al. (2016)](https://doi.org/10.1038/sdata.2016.18)
and [FAIR4RS](https://doi.org/10.1038/s41597-022-01710-x). Full FAIR compliance and
independent numerical reproduction are not claimed by this guide.
