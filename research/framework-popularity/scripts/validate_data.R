required_packages <- c("readr", "dplyr", "lubridate", "jsonlite")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing validation packages: ", paste(missing_packages, collapse = ", "))
}

required_files <- c(
  "out/npm_downloads_daily.csv",
  "out/npm_downloads_monthly.csv",
  "out/npm_downloads_wide_monthly.csv",
  "ts_out/gt_ui_5y_weekly_cat31.csv",
  "ts_out/gt_ui_5y_monthly_cat31.csv",
  "out/github_star_snapshots.csv",
  "out/github_star_growth_monthly.csv",
  "out/github_star_qa.csv",
  "out/framework_popularity_forecasts.csv"
)
missing_files <- required_files[!file.exists(required_files)]
if (length(missing_files) > 0) {
  stop("Missing research outputs: ", paste(missing_files, collapse = ", "))
}

assert_unique <- function(data, keys, label) {
  duplicates <- data |>
    dplyr::count(dplyr::across(dplyr::all_of(keys))) |>
    dplyr::filter(n > 1)
  if (nrow(duplicates) > 0) stop(label, " contains duplicate keys.")
}

assert_finite <- function(data, columns, label) {
  for (column in columns) {
    values <- data[[column]]
    if (any(!is.finite(values))) stop(label, " contains non-finite values in ", column, ".")
  }
}

npm <- readr::read_csv("out/npm_downloads_monthly.csv", show_col_types = FALSE) |>
  dplyr::mutate(period = as.Date(period))
expected_packages <- c("react", "vue", "@angular/core")
if (!setequal(unique(npm$package), expected_packages)) {
  stop("npm data does not contain exactly the expected packages.")
}
assert_unique(npm, c("package", "period"), "npm monthly data")
assert_finite(npm, c("downloads"), "npm monthly data")
if (any(npm$downloads < 0)) stop("npm monthly data contains negative downloads.")

trends <- readr::read_csv("ts_out/gt_ui_5y_monthly_cat31.csv", show_col_types = FALSE) |>
  dplyr::mutate(date = as.Date(date))
expected_frameworks <- c("React", "Angular", "Vue")
if (!all(expected_frameworks %in% names(trends))) {
  stop("Google Trends data is missing an expected framework column.")
}
assert_unique(trends, "date", "Google Trends monthly data")
assert_finite(trends, expected_frameworks, "Google Trends monthly data")
if (any(unlist(trends[expected_frameworks]) < 0 | unlist(trends[expected_frameworks]) > 100)) {
  stop("Google Trends values must stay within 0–100.")
}

expected_repositories <- c("facebook/react", "angular/angular", "vuejs/core")
star_snapshots <- readr::read_csv("out/github_star_snapshots.csv", show_col_types = FALSE) |>
  dplyr::mutate(month = as.Date(month), snapshot_date = as.Date(snapshot_date))
if (!setequal(unique(star_snapshots$repository), expected_repositories)) {
  stop("GitHub snapshot data does not contain exactly the expected repositories.")
}
if (!setequal(unique(star_snapshots$framework), expected_frameworks)) {
  stop("GitHub snapshot data does not contain exactly the expected frameworks.")
}
assert_unique(star_snapshots, c("repository", "month"), "GitHub star snapshots")
assert_finite(star_snapshots, "total_stars", "GitHub star snapshots")
if (any(star_snapshots$total_stars < 0)) stop("GitHub snapshots contain negative totals.")
if (any(lubridate::floor_date(star_snapshots$snapshot_date, "month") != star_snapshots$month)) {
  stop("GitHub snapshot month does not match snapshot_date.")
}

star_growth <- readr::read_csv("out/github_star_growth_monthly.csv", show_col_types = FALSE)
if (nrow(star_growth) > 0) {
  assert_unique(star_growth, c("repository", "period"), "GitHub star growth")
  assert_finite(star_growth, c("net_stars", "days_covered"), "GitHub star growth")
  if (any(star_growth$days_covered <= 0)) stop("GitHub star growth has a non-positive interval.")
}

star_qa <- readr::read_csv("out/github_star_qa.csv", show_col_types = FALSE)
if (!setequal(unique(star_qa$repository), expected_repositories) || nrow(star_qa) != 3) {
  stop("GitHub star QA must compare all three repositories.")
}
assert_unique(star_qa, "repository", "GitHub star QA")
assert_finite(star_qa, c("archived_total", "current_total", "total_delta", "days_gap"), "GitHub star QA")

forecasts <- readr::read_csv("out/framework_popularity_forecasts.csv", show_col_types = FALSE) |>
  dplyr::mutate(date = as.Date(date))
expected_metrics <- c("google-trends", "npm-downloads", "github-stars")
expected_models <- c("ARIMA", "ETS", "PROPHET")
if (!setequal(unique(forecasts$metric), expected_metrics)) stop("Forecast metrics are incomplete.")
if (!setequal(unique(forecasts$model), expected_models)) stop("Forecast models are incomplete.")
if (!setequal(unique(forecasts$framework), expected_frameworks)) stop("Forecast frameworks are incomplete.")
assert_unique(forecasts, c("metric", "framework", "model", "date"), "Forecast data")
assert_finite(
  forecasts,
  c("mean", "lo80", "hi80", "lo95", "hi95", "validation_rmse"),
  "Forecast data"
)

series_summary <- forecasts |>
  dplyr::group_by(metric, framework, model) |>
  dplyr::summarise(points = dplyr::n(), .groups = "drop")
if (any(series_summary$points != 24)) stop("Every forecast series must contain 24 months.")

best_summary <- forecasts |>
  dplyr::filter(is_best) |>
  dplyr::distinct(metric, framework, model) |>
  dplyr::count(metric, framework)
if (nrow(best_summary) != 9 || any(best_summary$n != 1)) {
  stop("Every metric/framework pair must have exactly one best model.")
}

manifest <- list(
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  sources = list(
    npm_downloads = list(
      through = as.character(max(npm$period)),
      rows = nrow(npm)
    ),
    google_trends = list(
      through = as.character(max(trends$date)),
      rows = nrow(trends),
      window = "rolling-five-years",
      category = 31
    ),
    github_stars = list(
      through = as.character(max(star_snapshots$snapshot_date)),
      rows = nrow(star_snapshots),
      repositories = length(unique(star_snapshots$repository)),
      metric = "net-growth-between-first-party-count-snapshots",
      legacy_history = "archived-origin-pending"
    )
  ),
  forecasts = list(horizon_months = 24, models = expected_models, rows = nrow(forecasts))
)

temporary_manifest <- tempfile(pattern = "refresh_manifest.", tmpdir = "out")
jsonlite::write_json(manifest, temporary_manifest, pretty = TRUE, auto_unbox = TRUE)
if (!file.rename(temporary_manifest, "out/refresh_manifest.json")) {
  unlink(temporary_manifest)
  stop("Could not atomically replace the refresh manifest.")
}

message(
  "Research data validated. npm through ", max(npm$period),
  "; Google Trends through ", max(trends$date),
  "; GitHub snapshots through ", max(star_snapshots$snapshot_date),
  "; ", nrow(forecasts), " forecast rows."
)
