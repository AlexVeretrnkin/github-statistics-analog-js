# Research snapshot data dictionary

Scope: React (`react`, `facebook/react`), Angular (`@angular/core`,
`angular/angular`), and Vue (`vue`, `vuejs/core`). Google Trends is excluded
from this article dataset.

All CSVs use UTF-8, a header row, comma separators, and standard double-quote
escaping. Dates are ISO `YYYY-MM-DD`. Counts are nonnegative integers, not
unique users or adoption rates. Missing rows are not equivalent to zero.
`period` identifies the first day of a calendar month. Only months strictly
before `completedMonthBefore` in the manifest are exported.

| File / field | Meaning |
| --- | --- |
| `npm_downloads_daily.csv`: `package`, `date`, `downloads` | Package downloads reported for that day. Automated and repeated downloads may be included. |
| `npm_downloads_monthly.csv`: `package`, `period`, `downloads` | Canonical monthly sum of daily downloads, not cumulative lifetime downloads. |
| `github_stars_daily.csv`: `repository`, `framework`, `date`, `new_stars` | Daily bucket count reconstructed by GitHub for the current stargazer population. Not an immutable ledger of gross star events. |
| `github_stars_monthly.csv`: `repository`, `framework`, `period`, `new_stars` | Canonical monthly sum of daily star-history buckets, not lifetime stars. |
| `last_run_id` | Join key to the ingestion run that last supplied a canonical row. |
| `ingestion-runs.json` | Allowlisted run IDs, source, schema version, status, commit if available, source coverage and collection timestamps. No credentials or arbitrary metadata. |
| `archived-dashboard-forecasts.csv` | Previously stored forecasts, preserved without recomputation. Their training inputs are not assumed identical to the new database snapshot. |
| Forecast `metric`, `framework`, `model`, `date` | Series identifier, framework, ARIMA/ETS/PROPHET label, and forecast month. |
| Forecast `mean`, `lo80`, `hi80`, `lo95`, `hi95` | Stored point estimate and prediction interval bounds in the metric's original units. |
| Forecast `validation_rmse`, `is_best` | Stored 12-month holdout RMSE and minimum-RMSE selection flag. Not retrospective-test results. |

GitHub buckets can change after unstars or account removal. The snapshot records
what the configured database held at capture time, not what an earlier API call
would have returned. A complete calendar month in the date filter alone does
not prove that every source day was collected: reconcile daily coverage and
monthly sums before designating a snapshot as the article's canonical dataset.

SHA-256 checksums detect subsequent file changes. They do not establish original
collection authenticity, accuracy, or equivalence with the article's tables.

Original software: MIT (see `LICENSE-SCOPE.md`). Data rights: not assigned;
source-specific redistribution conditions require review before publication.
