# Collect complete GitHub star histories into an ephemeral database-ingestion payload.
# Durable canonical history is published by publish_github_stars_ingestion.R.

project_library <- file.path(getwd(), ".r-library")
if (dir.exists(project_library)) .libPaths(c(project_library, .libPaths()))

required_packages <- c("httr", "jsonlite", "readr", "dplyr", "lubridate", "tibble")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing packages: ", paste(missing_packages, collapse = ", "))
}

source("github_star_history.R", local = environment())

repositories <- tibble::tribble(
  ~framework, ~repository,        ~archive_file,
  "React",    "facebook/react",   "facebook_react-stars-history.csv",
  "Angular",  "angular/angular",  "angular_angular-stars-history.csv",
  "Vue",      "vuejs/core",       "vuejs_core-stars-history.csv"
)
api_root <- Sys.getenv("RESEARCH_GITHUB_API_URL", "https://api.github.com")
api_version <- Sys.getenv("RESEARCH_GITHUB_API_VERSION", "2026-03-10")
github_token <- Sys.getenv("GITHUB_TOKEN", Sys.getenv("GH_TOKEN", ""))
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
fetched_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
output_path <- Sys.getenv(
  "RESEARCH_GITHUB_STARS_INGESTION_FILE",
  "out/github_stars_ingestion.rds"
)

if (!nzchar(github_token)) {
  warning("No GitHub token is set; the complete three-repository refresh may exceed the anonymous limit.")
}

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
  current_count <- fetch_github_stargazer_count(
    repository = tracked$repository,
    api_root = api_root,
    token = github_token,
    api_version = api_version
  )
  list(
    archive_file = tracked$archive_file,
    current_count = current_count,
    pages = history$pages,
    rows = history$rows
  )
})

daily <- dplyr::bind_rows(lapply(collected, `[[`, "rows")) |>
  dplyr::arrange(repository, date)
coverage <- daily |>
  dplyr::group_by(framework, repository) |>
  dplyr::summarise(
    first_date = min(date),
    last_date = max(date),
    rows = dplyr::n(),
    expected_rows = as.integer(last_date - first_date + 1),
    .groups = "drop"
  )
if (!setequal(coverage$repository, repositories$repository)) {
  stop("GitHub did not return all tracked repositories.")
}
if (any(coverage$last_date != today) || any(coverage$rows != coverage$expected_rows)) {
  stop("GitHub history did not provide gap-free coverage through the collection date.")
}

count_qa <- dplyr::bind_rows(lapply(seq_along(collected), function(index) {
  item <- collected[[index]]
  history_total <- sum(item$rows$new_stars)
  difference <- history_total - item$current_count
  tibble::tibble(
    framework = repositories$framework[[index]],
    repository = repositories$repository[[index]],
    history_total = history_total,
    current_stargazer_count = item$current_count,
    count_difference = difference,
    api_pages = item$pages,
    status = if (abs(difference) <= 2) "ok" else "review"
  )
}))

legacy_qa <- dplyr::bind_rows(lapply(seq_along(collected), function(index) {
  item <- collected[[index]]
  legacy <- read_legacy_github_stars(
    file.path("git_stars", item$archive_file),
    repositories$framework[[index]],
    repositories$repository[[index]]
  )
  dplyr::bind_rows(
    compare_github_star_series(item$rows, legacy, "daily"),
    compare_github_star_series(item$rows, legacy, "monthly")
  )
})) |>
  dplyr::arrange(repository, granularity)

if (any(legacy_qa$status %in% c("no-overlap", "coverage-gap"))) {
  stop("Official and legacy GitHub histories do not have a complete comparable overlap.")
}
if (any(count_qa$status == "review")) {
  warning("One or more reconstructed history totals differ materially from the current count.")
}

rows <- daily |>
  dplyr::transmute(
    repository = as.character(repository),
    framework = as.character(framework),
    date = as.Date(date),
    new_stars = as.numeric(new_stars)
  )
dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
saveRDS(
  list(
    schema_version = 1L,
    source_data_through = as.character(max(rows$date)),
    completed_month_before = format(lubridate::floor_date(today, "month"), "%Y-%m-%d"),
    metadata = list(
      apiVersion = api_version,
      fetchedAt = fetched_at,
      aggregation = "daily-new-stars-to-completed-calendar-months",
      countQa = count_qa,
      legacyReconciliation = legacy_qa
    ),
    rows = rows
  ),
  output_path
)
message("Prepared ", nrow(rows), " GitHub star rows for ingestion at ", output_path)
