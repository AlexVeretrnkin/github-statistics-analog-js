# Collect first-party GitHub star-count snapshots for React, Angular, and Vue.
#
# GitHub's public repository endpoint exposes the current stargazer count, but
# does not expose when every public user starred an external repository. We keep
# one observation per repository/month and derive explicitly labelled net growth
# only between real snapshots. Archived daily additions remain a separate legacy
# dataset and are used here only for an overlap QA comparison.

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

repositories <- tibble::tribble(
  ~framework, ~repository,       ~archive_file,
  "React",    "facebook/react", "facebook_react-stars-history.csv",
  "Angular",  "angular/angular", "angular_angular-stars-history.csv",
  "Vue",      "vuejs/core",     "vuejs_core-stars-history.csv"
)

snapshot_path <- "out/github_star_snapshots.csv"
growth_path <- "out/github_star_growth_monthly.csv"
qa_path <- "out/github_star_qa.csv"
api_root <- Sys.getenv("RESEARCH_GITHUB_API_URL", "https://api.github.com")
github_token <- Sys.getenv("GITHUB_TOKEN", Sys.getenv("GH_TOKEN", ""))
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
observed_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
observation_month <- lubridate::floor_date(today, "month")

write_csv_atomic <- function(data, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  temporary_path <- tempfile(pattern = paste0(basename(path), "."), tmpdir = dirname(path))
  readr::write_csv(data, temporary_path)
  if (!file.rename(temporary_path, path)) {
    unlink(temporary_path)
    stop("Could not atomically replace ", path)
  }
}

github_headers <- function() {
  headers <- c(
    Accept = "application/vnd.github+json",
    `X-GitHub-Api-Version` = "2022-11-28"
  )
  if (nzchar(github_token)) headers <- c(headers, Authorization = paste("Bearer", github_token))
  do.call(httr::add_headers, as.list(headers))
}

fetch_repository <- function(repository, retries = 6) {
  url <- paste0(sub("/$", "", api_root), "/repos/", repository)

  for (attempt in seq_len(retries)) {
    response <- try(
      httr::GET(
        url,
        github_headers(),
        httr::user_agent("github-statistics-analog-js research collector/1.0"),
        httr::timeout(60)
      ),
      silent = TRUE
    )

    if (!inherits(response, "try-error") && httr::status_code(response) == 200) {
      payload <- jsonlite::fromJSON(
        httr::content(response, as = "text", encoding = "UTF-8"),
        simplifyVector = TRUE
      )
      count <- suppressWarnings(as.numeric(payload$stargazers_count))
      if (!is.finite(count) || count < 0) stop("GitHub returned an invalid star count for ", repository)
      return(count)
    }

    status <- if (inherits(response, "try-error")) NA_integer_ else httr::status_code(response)
    retry_after <- if (!inherits(response, "try-error")) {
      suppressWarnings(as.numeric(httr::headers(response)[["retry-after"]]))
    } else {
      NA_real_
    }
    retryable <- is.na(status) || status == 429 || status >= 500
    if (!retryable) {
      detail <- if (!inherits(response, "try-error")) {
        substr(httr::content(response, as = "text", encoding = "UTF-8"), 1, 240)
      } else {
        as.character(response)
      }
      stop("GitHub request failed for ", repository, " (HTTP ", status, "): ", detail)
    }

    wait_seconds <- if (is.finite(retry_after)) retry_after else min(60, 2 ^ attempt)
    message("GitHub attempt ", attempt, " failed for ", repository, "; retrying in ", wait_seconds, "s")
    Sys.sleep(wait_seconds)
  }

  stop("GitHub request failed after retries for ", repository)
}

fresh <- repositories |>
  dplyr::rowwise() |>
  dplyr::mutate(total_stars = fetch_repository(repository)) |>
  dplyr::ungroup() |>
  dplyr::transmute(
    month = observation_month,
    snapshot_date = today,
    framework,
    repository,
    total_stars = as.numeric(total_stars),
    observed_at = observed_at,
    source = "github-rest-repository"
  )

existing <- if (file.exists(snapshot_path)) {
  readr::read_csv(
    snapshot_path,
    col_types = readr::cols(observed_at = readr::col_character()),
    show_col_types = FALSE
  ) |>
    dplyr::mutate(
      month = as.Date(month),
      snapshot_date = as.Date(snapshot_date),
      total_stars = as.numeric(total_stars),
      observed_at = as.character(observed_at),
      source = as.character(source)
    )
} else {
  fresh[0, ]
}

# A rerun during the same month replaces that month's observation. This makes
# local retries idempotent while retaining one comparable point per month.
snapshots <- dplyr::bind_rows(existing, fresh) |>
  dplyr::filter(repository %in% repositories$repository) |>
  dplyr::arrange(repository, month, observed_at) |>
  dplyr::group_by(repository, month) |>
  dplyr::slice_tail(n = 1) |>
  dplyr::ungroup() |>
  dplyr::arrange(framework, month)

growth <- snapshots |>
  dplyr::group_by(framework, repository) |>
  dplyr::arrange(month, .by_group = TRUE) |>
  dplyr::mutate(
    from_date = dplyr::lag(snapshot_date),
    to_date = snapshot_date,
    net_stars = total_stars - dplyr::lag(total_stars),
    days_covered = as.integer(snapshot_date - dplyr::lag(snapshot_date))
  ) |>
  dplyr::filter(!is.na(net_stars)) |>
  dplyr::ungroup() |>
  dplyr::transmute(
    period = month,
    framework,
    repository,
    net_stars,
    from_date,
    to_date,
    days_covered,
    source = "github-count-snapshot-delta"
  ) |>
  dplyr::arrange(framework, period)

read_archive_latest <- function(archive_file) {
  path <- file.path("git_stars", archive_file)
  rows <- readr::read_csv(path, show_col_types = FALSE) |>
    dplyr::mutate(date = lubridate::dmy(date), `total-stars` = as.numeric(`total-stars`)) |>
    dplyr::filter(!is.na(date), is.finite(`total-stars`)) |>
    dplyr::arrange(date)
  if (nrow(rows) == 0) stop("Archived GitHub star history is empty: ", path)
  rows[nrow(rows), c("date", "total-stars")]
}

qa <- repositories |>
  dplyr::rowwise() |>
  dplyr::mutate(archive_latest = list(read_archive_latest(archive_file))) |>
  dplyr::ungroup() |>
  dplyr::mutate(
    archived_through = as.Date(vapply(archive_latest, function(row) as.character(row$date[[1]]), character(1))),
    archived_total = vapply(archive_latest, function(row) row$`total-stars`[[1]], numeric(1))
  ) |>
  dplyr::select(-archive_latest) |>
  dplyr::left_join(
    fresh |> dplyr::select(framework, repository, snapshot_date, current_total = total_stars),
    by = c("framework", "repository")
  ) |>
  dplyr::mutate(
    total_delta = current_total - archived_total,
    days_gap = as.integer(snapshot_date - archived_through),
    status = dplyr::if_else(total_delta >= 0, "ok", "current-total-below-archive")
  ) |>
  dplyr::select(
    framework, repository, archived_through, archived_total,
    snapshot_date, current_total, total_delta, days_gap, status
  )

if (any(qa$status != "ok")) {
  warning("One or more current GitHub totals are below the archived totals; inspect ", qa_path)
}

write_csv_atomic(snapshots, snapshot_path)
write_csv_atomic(growth, growth_path)
write_csv_atomic(qa, qa_path)

message(
  "GitHub stars refresh complete: ", nrow(fresh), " repositories observed for ",
  observation_month, "; ", nrow(growth), " snapshot-growth rows available."
)
