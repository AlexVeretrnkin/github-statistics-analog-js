# Collect the incremental npm-download range for database ingestion.
#
# Durable history lives behind the ingestion API. This script writes only an
# ephemeral RDS handoff file for the later, freshly authenticated publish step.

required_packages <- c("httr", "jsonlite", "dplyr", "tidyr", "purrr", "tibble")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing R packages: ", paste(missing_packages, collapse = ", "))
}

packages <- c("react", "vue", "@angular/core")
history_start <- as.Date(Sys.getenv("RESEARCH_NPM_START", "2015-01-01"))
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
end_date <- today - 1
overlap_days <- as.integer(Sys.getenv("RESEARCH_NPM_OVERLAP_DAYS", "14"))
checkpoint <- Sys.getenv("RESEARCH_NPM_LATEST_DATE", "")
output_path <- Sys.getenv("RESEARCH_NPM_INGESTION_FILE", "out/npm_ingestion.rds")

if (end_date < history_start) stop("npm ingestion end date precedes the history start.")

fetch_start <- if (nzchar(checkpoint)) {
  checkpoint_date <- as.Date(checkpoint)
  if (is.na(checkpoint_date)) stop("RESEARCH_NPM_LATEST_DATE is not a valid date.")
  max(history_start, checkpoint_date - overlap_days)
} else {
  history_start
}

safe_get_json <- function(url, retries = 6) {
  for (attempt in seq_len(retries)) {
    response <- try(
      httr::GET(
        url,
        httr::user_agent("github-statistics-analog-js npm collector/2.0"),
        httr::timeout(60)
      ),
      silent = TRUE
    )

    if (!inherits(response, "try-error") && httr::status_code(response) == 200) {
      return(jsonlite::fromJSON(
        httr::content(response, as = "text", encoding = "UTF-8"),
        simplifyVector = TRUE
      ))
    }

    retry_after <- if (!inherits(response, "try-error")) {
      suppressWarnings(as.numeric(httr::headers(response)[["retry-after"]]))
    } else {
      NA_real_
    }
    wait_seconds <- if (is.finite(retry_after)) retry_after else min(60, 2 ^ attempt)
    Sys.sleep(wait_seconds)
  }

  stop("npm downloads request failed after retries: ", url)
}

build_range_url <- function(package_name, from, to) {
  encoded_package <- URLencode(package_name, reserved = TRUE)
  sprintf(
    "https://api.npmjs.org/downloads/range/%s:%s/%s",
    format(from, "%Y-%m-%d"),
    format(to, "%Y-%m-%d"),
    encoded_package
  )
}

fetch_range <- function(package_name, from, to) {
  result <- safe_get_json(build_range_url(package_name, from, to))
  if (is.null(result$downloads) || length(result$downloads) == 0) {
    return(tibble::tibble(
      package = character(), date = as.Date(character()), downloads = integer()
    ))
  }

  tibble::tibble(
    package = package_name,
    date = as.Date(result$downloads$day),
    downloads = as.numeric(result$downloads$downloads)
  )
}

fetch_history <- function(package_name, from, to, chunk_days = 365) {
  starts <- seq(from, to, by = sprintf("%d days", chunk_days))
  purrr::map_dfr(starts, function(left) {
    right <- min(left + chunk_days - 1, to)
    message("npm ", package_name, ": ", left, " -> ", right)
    fetch_range(package_name, left, right)
  })
}

message("Collecting npm ingestion range ", fetch_start, " through ", end_date)

raw <- purrr::map_dfr(packages, fetch_history, from = fetch_start, to = end_date) |>
  dplyr::filter(package %in% packages, !is.na(date), date >= fetch_start, date <= end_date) |>
  dplyr::group_by(package, date) |>
  dplyr::slice_tail(n = 1) |>
  dplyr::ungroup()

coverage <- raw |>
  dplyr::group_by(package) |>
  dplyr::summarise(
    first_date = min(date),
    last_date = max(date),
    rows = dplyr::n(),
    .groups = "drop"
  ) |>
  dplyr::mutate(expected_rows = as.integer(last_date - first_date + 1))

if (!setequal(coverage$package, packages)) stop("npm did not return all tracked packages.")
if (any(coverage$last_date != end_date)) {
  stop("npm response did not cover the latest requested date.")
}
if (fetch_start > history_start && any(coverage$first_date != fetch_start)) {
  stop("npm incremental response did not cover the first requested date.")
}
if (any(coverage$rows != coverage$expected_rows)) {
  stop("npm response contained missing dates after a package's first observation.")
}

# A bootstrap can start before a package existed. The npm API omits that leading
# range (for example, @angular/core before 2015-01-10), whereas the archived
# scripts represented it as zeroes. Incremental runs still require both endpoints.
fresh <- raw |>
  tidyr::complete(
    package = packages,
    date = seq(fetch_start, end_date, by = "day"),
    fill = list(downloads = 0)
  ) |>
  dplyr::mutate(downloads = as.numeric(downloads)) |>
  dplyr::arrange(package, date)

expected_rows <- length(packages) * as.integer(end_date - fetch_start + 1)
if (nrow(fresh) != expected_rows) stop("npm collector did not produce complete daily coverage.")
if (any(!is.finite(fresh$downloads)) || any(fresh$downloads < 0)) {
  stop("npm collector produced invalid download counts.")
}

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
saveRDS(
  list(
    schema_version = 1L,
    source_data_through = as.character(end_date),
    fetched_from = as.character(fetch_start),
    rows = fresh
  ),
  output_path
)

message("Prepared ", nrow(fresh), " npm rows for ingestion at ", output_path)
