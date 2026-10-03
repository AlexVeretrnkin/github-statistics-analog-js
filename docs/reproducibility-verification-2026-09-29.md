# Verification results, 29 September 2026

## Completed

- Original software licensed under MIT, with separate scope exclusions for
  third-party material, datasets, manuscripts, and figures.
- `CITATION.cff` and the public Cloud Run dashboard link added.
- Web and ingestion Docker images built with `--no-cache` on Docker Desktop
  4.37.2 / Engine 27.4.0, Linux ARM64. No host dependencies or API credentials
  were supplied to the build or running test services.
- Fresh isolated PostgreSQL 18 database bootstrapped; all three migrations applied.
- Verified empty initial checkpoints and successful API commits of 93 npm,
  780 Google Trends, and 228 GitHub synthetic rows. The web page returned HTTP 200.
- The random test project's containers, internal network, and synthetic database
  were removed. The existing `github-statistics-local` project remained running.
- Local canonical npm and GitHub observations exported in a transaction reporting
  `read_only=on`, `isolation=repeatable read`. No production database was accessed.
- Integrity checks passed for all 13 files in the saved snapshot. The archived
  dashboard forecasts were preserved byte-for-byte and were not refitted.
- Offline checks passed: expected series, gap-free daily dates, nonnegative integer
  counts, exact monthly-versus-daily sums, and complete final source months.
- R 4.4.3 and 117 dependency records captured in `renv.lock`, including forecast
  8.23.0 and Prophet 1.0. Clean Linux restoration of R/Stan is not yet verified.

## Snapshot coverage

| Series | First daily observation | Last daily observation | Daily rows | Monthly rows |
| --- | --- | --- | ---: | ---: |
| npm @angular/core | 2015-01-01 | 2026-08-31 | 4,261 | 140 |
| npm react | 2015-01-01 | 2026-08-31 | 4,261 | 140 |
| npm vue | 2015-01-01 | 2026-08-31 | 4,261 | 140 |
| GitHub angular/angular | 2014-09-14 | 2026-08-31 | 4,370 | 144 |
| GitHub facebook/react | 2013-05-19 | 2026-08-31 | 4,853 | 160 |
| GitHub vuejs/core | 2018-06-10 | 2026-08-31 | 3,005 | 99 |

The three initial GitHub months start mid-month. This is reported rather than
filled with invented zero observations. Month-end filtering does not make those
initial source months complete. A forecast replay must explicitly document the
handling of these initial periods.

## Evidence retained locally

- Docker report: `output/reproducibility/framework-repro-6ae4269c-625/report.json`
- Snapshot: `output/reproducibility/snapshot-2026-09-29T16-16-47.409Z/manifest.json`
- R lock: `research/framework-popularity/renv.lock` (captured after the first
  snapshot, so it is not among that snapshot's 13 manifest entries).

The exporter was subsequently strengthened with the same offline validation
and with inclusion of `renv.lock` in future snapshots. Its second database run
was blocked by the approval service's usage limit, not a data or database error.
The existing snapshot was instead audited locally without another database call.

## Not established or published

- The Cloud Run page was publicly reachable. It still displayed **Archived GitHub
  star histories** and legacy provenance text, so its parity with the current
  local GitHub pipeline was not established. No redeployment was performed.
- This local snapshot is not asserted to be the production snapshot or the original
  training dataset of the article's archived forecasts.
- No numerical reproduction of the article's forecast tables was performed.
  The original seed, historical source versions, and npm retrospective
  reconstruction still require explicit mapping and verification.
- No Git commit, push, release tag, Zenodo deposit, or DOI was created.
- Data redistribution terms and named authorship metadata must be settled before
  publication. Full FAIR compliance is not claimed.

The Word article and existing forecast outputs were not modified by this work.
