# Collect the complete first-party GitHub star history for React, Angular, and Vue.
#
# GitHub's privacy-safe endpoint returns 30 calendar weeks per page with seven
# daily counts in each week. Every refresh replaces the complete daily history,
# derives completed calendar-month totals, and reconciles the official series
# with the archived Daily Stars Explorer CSVs on their common date range.

required_packages <- c("httr", "jsonlite", "readr", "dplyr", "lubridate", "tibble")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    ". Run `pnpm research:setup` first."
  )
}

source("github_star_history.R", local = environment())

repositories <- tibble::tribble(
  ~framework, ~repository,        ~archive_file,
  "React",    "facebook/react",   "facebook_react-stars-history.csv",
  "Angular",  "angular/angular",  "angular_angular-stars-history.csv",
  "Vue",      "vuejs/core",       "vuejs_core-stars-history.csv"
)

daily_path <- "out/github_stars_daily.csv"
monthly_path <- "out/github_stars_monthly.csv"
qa_path <- "out/github_star_qa.csv"
legacy_qa_path <- "out/github_star_legacy_qa.csv"
api_root <- Sys.getenv("RESEARCH_GITHUB_API_URL", "https://api.github.com")
api_version <- Sys.getenv("RESEARCH_GITHUB_API_VERSION", "2026-03-10")
github_token <- Sys.getenv("GITHUB_TOKEN", Sys.getenv("GH_TOKEN", ""))
verify_current_counts <- tolower(
  Sys.getenv("RESEARCH_GITHUB_VERIFY_CURRENT_COUNTS", "true")
) == "true"
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
fetched_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

collected <- lapply(seq_len(nrow(repositories)), function(index) {
  tracked <- repositories[index, ]
  history <- fetch_github_star_history(
    framework = tracked$framework,
    repository = tracked$repository,
    api_root = api_root,
    token = github_token,
    api_version = api_version,
    today = today,
    fetched_at = fetched_at
  )
  current_count <- if (verify_current_counts) {
    fetch_github_stargazer_count(
      repository = tracked$repository,
      api_root = api_root,
      token = github_token,
      api_version = api_version
    )
  } else {
    NA_real_
  }
  list(
    rows = history$rows,
    pages = history$pages,
    current_count = current_count,
    archive_file = tracked$archive_file
  )
})

daily <- dplyr::bind_rows(lapply(collected, `[[`, "rows")) |>
  dplyr::arrange(framework, date)
monthly <- aggregate_github_stars_monthly(daily, today)

qa <- dplyr::bind_rows(lapply(seq_along(collected), function(index) {
  item <- collected[[index]]
  rows <- item$rows
  history_total <- sum(rows$new_stars)
  count_difference <- if (is.finite(item$current_count)) history_total - item$current_count else NA_real_
  tibble::tibble(
    framework = repositories$framework[[index]],
    repository = repositories$repository[[index]],
    history_start = min(rows$date),
    history_through = max(rows$date),
    daily_rows = nrow(rows),
    api_pages = item$pages,
    history_total = history_total,
    current_stargazer_count = item$current_count,
    count_difference = count_difference,
    fetched_at = fetched_at,
    api_version = api_version,
    status = if (!is.finite(item$current_count)) {
      "not-checked"
    } else if (abs(count_difference) <= 2) {
      "ok"
    } else {
      "review"
    }
  )
}))

legacy_qa <- dplyr::bind_rows(lapply(seq_along(collected), function(index) {
  item <- collected[[index]]
  official <- item$rows
  legacy <- read_legacy_github_stars(
    file.path("git_stars", item$archive_file),
    repositories$framework[[index]],
    repositories$repository[[index]]
  )
  dplyr::bind_rows(
    compare_github_star_series(official, legacy, "daily"),
    compare_github_star_series(official, legacy, "monthly")
  )
})) |>
  dplyr::arrange(framework, granularity)

if (any(qa$status == "review")) {
  warning("One or more GitHub history totals differ materially from the current count; inspect ", qa_path)
}
if (any(legacy_qa$status %in% c("no-overlap", "coverage-gap"))) {
  stop("Official and legacy GitHub histories could not be compared over a complete overlap.")
}
if (any(legacy_qa$status == "value-differences")) {
  message("Official GitHub history differs from the legacy archive; inspect ", legacy_qa_path)
}

write_csv_atomic(daily, daily_path)
write_csv_atomic(monthly, monthly_path)
write_csv_atomic(qa, qa_path)
write_csv_atomic(legacy_qa, legacy_qa_path)

monthly_through <- if (nrow(monthly) == 0) "none" else as.character(max(monthly$period))
message(
  "GitHub stars refresh complete: ", nrow(daily), " daily rows, ",
  nrow(monthly), " completed monthly rows through ", monthly_through, "."
)
