required_packages <- c("readr", "dplyr", "lubridate", "jsonlite")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing validation packages: ", paste(missing_packages, collapse = ", "))
}

source("completed_months.R", local = environment())
validation_today <- research_today()

required_files <- c(
  "out/npm_downloads_daily.csv",
  "out/npm_downloads_monthly.csv",
  "out/npm_downloads_wide_monthly.csv",
  "ts_out/gt_ui_5y_weekly_cat31.csv",
  "ts_out/gt_ui_5y_monthly_cat31.csv",
  "out/github_stars_daily.csv",
  "out/github_stars_monthly.csv",
  "out/github_star_qa.csv",
  "out/github_star_legacy_qa.csv",
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
assert_completed_months(npm, "period", "npm monthly data", today = validation_today)

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
assert_completed_months(
  trends,
  "date",
  "Google Trends monthly data",
  today = validation_today
)

expected_repositories <- c("facebook/react", "angular/angular", "vuejs/core")
star_daily <- readr::read_csv("out/github_stars_daily.csv", show_col_types = FALSE) |>
  dplyr::mutate(date = as.Date(date), week_start = as.Date(week_start))
if (!setequal(unique(star_daily$repository), expected_repositories)) {
  stop("GitHub daily data does not contain exactly the expected repositories.")
}
if (!setequal(unique(star_daily$framework), expected_frameworks)) {
  stop("GitHub daily data does not contain exactly the expected frameworks.")
}
assert_unique(star_daily, c("repository", "date"), "GitHub daily data")
assert_finite(star_daily, "new_stars", "GitHub daily data")
if (any(star_daily$new_stars < 0) || any(star_daily$new_stars != floor(star_daily$new_stars))) {
  stop("GitHub daily data contains invalid new-star counts.")
}
daily_coverage <- star_daily |>
  dplyr::group_by(repository) |>
  dplyr::summarise(
    first_date = min(date),
    last_date = max(date),
    rows = dplyr::n(),
    expected_rows = as.integer(last_date - first_date + 1),
    .groups = "drop"
  )
if (any(daily_coverage$rows != daily_coverage$expected_rows)) {
  stop("GitHub daily data contains missing dates.")
}

star_monthly <- readr::read_csv("out/github_stars_monthly.csv", show_col_types = FALSE) |>
  dplyr::mutate(period = as.Date(period))
assert_unique(star_monthly, c("repository", "period"), "GitHub monthly data")
assert_finite(star_monthly, c("new_stars", "days_observed"), "GitHub monthly data")
if (any(star_monthly$new_stars < 0) || any(star_monthly$days_observed <= 0)) {
  stop("GitHub monthly data contains invalid values.")
}
assert_completed_months(
  star_monthly,
  "period",
  "GitHub monthly data",
  today = validation_today
)
monthly_from_daily <- star_daily |>
  dplyr::mutate(period = lubridate::floor_date(date, "month")) |>
  dplyr::filter(period %in% star_monthly$period) |>
  dplyr::group_by(repository, period) |>
  dplyr::summarise(expected_new_stars = sum(new_stars), .groups = "drop") |>
  dplyr::inner_join(
    star_monthly |> dplyr::select(repository, period, new_stars),
    by = c("repository", "period")
  )
if (nrow(monthly_from_daily) != nrow(star_monthly) ||
    any(monthly_from_daily$expected_new_stars != monthly_from_daily$new_stars)) {
  stop("GitHub monthly values do not equal the sums of official daily values.")
}

star_qa <- readr::read_csv("out/github_star_qa.csv", show_col_types = FALSE)
if (!setequal(unique(star_qa$repository), expected_repositories) || nrow(star_qa) != 3) {
  stop("GitHub star QA must compare all three repositories.")
}
assert_unique(star_qa, "repository", "GitHub star QA")
assert_finite(
  star_qa,
  c("daily_rows", "api_pages", "history_total"),
  "GitHub star QA"
)
verified_star_qa <- star_qa |> dplyr::filter(status != "not-checked")
if (nrow(verified_star_qa) > 0) {
  assert_finite(
    verified_star_qa,
    c("current_stargazer_count", "count_difference"),
    "verified GitHub star QA"
  )
}
if (any(!star_qa$status %in% c("ok", "review", "not-checked"))) {
  stop("GitHub star QA contains an unknown status.")
}

legacy_qa <- readr::read_csv("out/github_star_legacy_qa.csv", show_col_types = FALSE)
if (nrow(legacy_qa) != 6 ||
    !setequal(unique(legacy_qa$repository), expected_repositories) ||
    !setequal(unique(legacy_qa$granularity), c("daily", "monthly"))) {
  stop("GitHub legacy QA must contain daily and monthly comparisons for all repositories.")
}
assert_unique(legacy_qa, c("repository", "granularity"), "GitHub legacy QA")
assert_finite(
  legacy_qa,
  c(
    "compared_rows", "exact_matches", "value_mismatches", "missing_official",
    "missing_legacy", "official_sum", "legacy_sum", "signed_sum_difference",
    "total_absolute_difference", "max_absolute_difference"
  ),
  "GitHub legacy QA"
)
if (any(legacy_qa$compared_rows == 0) || any(legacy_qa$status %in% c("no-overlap", "coverage-gap"))) {
  stop("GitHub legacy QA has no complete comparable overlap.")
}

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
      through = as.character(max(star_daily$date)),
      daily_rows = nrow(star_daily),
      monthly_rows = nrow(star_monthly),
      repositories = length(unique(star_daily$repository)),
      metric = "daily-new-stars-aggregated-to-completed-calendar-months",
      source = "github-rest-star-history",
      legacy_reconciliation = as.list(table(legacy_qa$status))
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
  "; GitHub star history through ", max(star_daily$date),
  "; ", nrow(forecasts), " forecast rows."
)
