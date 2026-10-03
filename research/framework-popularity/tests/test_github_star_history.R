command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(file.path(dirname(file_argument), ".."), mustWork = TRUE)
setwd(research_root)

required_packages <- c("httr", "jsonlite", "readr", "dplyr", "lubridate", "tibble")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing test packages: ", paste(missing_packages, collapse = ", "))
}

source("github_star_history.R")

week_start <- as.numeric(as.POSIXct("2026-01-04T00:00:00Z", tz = "UTC"))
parsed <- parse_github_star_history_page(
  list(list(week = week_start, total = 10, days = list(1, 0, 2, 0, 3, 0, 4))),
  framework = "React",
  repository = "facebook/react",
  fetched_at = "2026-02-01T00:00:00Z"
)
stopifnot(
  nrow(parsed) == 7,
  identical(as.character(parsed$date), as.character(seq(as.Date("2026-01-04"), by = "day", length.out = 7))),
  identical(parsed$new_stars, c(1, 0, 2, 0, 3, 0, 4)),
  sum(parsed$new_stars) == 10
)

positive_offset_boundary <- parse_github_star_history_page(
  list(list(
    week = as.numeric(as.POSIXct("2026-01-03T14:00:00Z", tz = "UTC")),
    total = 0,
    days = as.list(rep(0, 7))
  )),
  framework = "React",
  repository = "facebook/react",
  fetched_at = "2026-02-01T00:00:00Z"
)
stopifnot(positive_offset_boundary$date[[1]] == as.Date("2026-01-04"))

invalid_week_failed <- tryCatch({
  parse_github_star_history_page(
    list(list(week = week_start, total = 11, days = list(1, 0, 2, 0, 3, 0, 4))),
    "React",
    "facebook/react",
    "2026-02-01T00:00:00Z"
  )
  FALSE
}, error = function(error) TRUE)
stopifnot(invalid_week_failed)

daily <- tibble::tibble(
  date = seq(as.Date("2026-01-01"), as.Date("2026-02-15"), by = "day"),
  framework = "React",
  repository = "facebook/react",
  new_stars = 1,
  week_start = as.Date("2025-12-28"),
  fetched_at = "2026-02-15T00:00:00Z",
  source = "github-rest-star-history"
)
monthly <- aggregate_github_stars_monthly(daily, as.Date("2026-02-15"))
stopifnot(
  nrow(monthly) == 1,
  monthly$period[[1]] == as.Date("2026-01-01"),
  monthly$new_stars[[1]] == 31,
  monthly$days_observed[[1]] == 31
)

official <- tibble::tibble(
  date = seq(as.Date("2026-01-01"), as.Date("2026-01-04"), by = "day"),
  framework = "React",
  repository = "facebook/react",
  new_stars = c(1, 2, 3, 4)
)
legacy <- tibble::tibble(
  date = seq(as.Date("2025-12-31"), as.Date("2026-01-03"), by = "day"),
  framework = "React",
  repository = "facebook/react",
  new_stars = c(99, 1, 20, 3)
)
comparison <- compare_github_star_series(official, legacy, "daily")
stopifnot(
  comparison$overlap_start[[1]] == as.Date("2026-01-01"),
  comparison$overlap_end[[1]] == as.Date("2026-01-03"),
  comparison$compared_rows[[1]] == 3,
  comparison$exact_matches[[1]] == 2,
  comparison$value_mismatches[[1]] == 1,
  comparison$signed_sum_difference[[1]] == -18,
  comparison$status[[1]] == "value-differences"
)

official_monthly_source <- tibble::tibble(
  date = seq(as.Date("2025-12-15"), as.Date("2026-02-28"), by = "day"),
  framework = "React",
  repository = "facebook/react",
  new_stars = 1
)
legacy_monthly_source <- tibble::tibble(
  date = seq(as.Date("2025-12-20"), as.Date("2026-02-15"), by = "day"),
  framework = "React",
  repository = "facebook/react",
  new_stars = 1
)
monthly_comparison <- compare_github_star_series(
  official_monthly_source,
  legacy_monthly_source,
  "monthly"
)
stopifnot(
  monthly_comparison$overlap_start[[1]] == as.Date("2026-01-01"),
  monthly_comparison$overlap_end[[1]] == as.Date("2026-01-01"),
  monthly_comparison$compared_rows[[1]] == 1,
  monthly_comparison$exact_matches[[1]] == 1,
  monthly_comparison$status[[1]] == "exact"
)

message("GitHub star-history unit checks passed.")
