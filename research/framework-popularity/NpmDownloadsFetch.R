# Incremental npm downloads collector for React, Angular, and Vue.
#
# Existing daily data is reused. Each refresh refetches a short overlap window
# so late corrections from npm replace previously stored values. Only completed
# calendar months are included in monthly/model inputs.

required_packages <- c(
  "httr", "jsonlite", "dplyr", "tidyr", "purrr", "lubridate", "readr", "zoo"
)
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    ". Run `pnpm research:setup` first."
  )
}

packages <- c("react", "vue", "@angular/core")
history_start <- as.Date(Sys.getenv("RESEARCH_NPM_START", "2015-01-01"))
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
end_date <- today - 1
overlap_days <- as.integer(Sys.getenv("RESEARCH_NPM_OVERLAP_DAYS", "14"))
full_refresh <- tolower(Sys.getenv("RESEARCH_NPM_FULL_REFRESH", "false")) == "true"
daily_path <- "out/npm_downloads_daily.csv"

safe_get_json <- function(url, retries = 6) {
  for (attempt in seq_len(retries)) {
    response <- try(
      httr::GET(
        url,
        httr::user_agent("github-statistics-analog-js research collector/1.0"),
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
    downloads = as.integer(result$downloads$downloads)
  )
}

fetch_history <- function(package_name, from, to, chunk_days = 365) {
  if (from > to) {
    return(tibble::tibble(
      package = character(), date = as.Date(character()), downloads = integer()
    ))
  }

  starts <- seq(from, to, by = sprintf("%d days", chunk_days))
  purrr::map_dfr(starts, function(left) {
    right <- min(left + chunk_days - 1, to)
    message("npm ", package_name, ": ", left, " → ", right)
    fetch_range(package_name, left, right)
  })
}

write_csv_atomic <- function(data, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  temporary_path <- tempfile(pattern = paste0(basename(path), "."), tmpdir = dirname(path))
  readr::write_csv(data, temporary_path)
  if (!file.rename(temporary_path, path)) {
    unlink(temporary_path)
    stop("Could not atomically replace ", path)
  }
}

existing <- if (file.exists(daily_path) && !full_refresh) {
  readr::read_csv(daily_path, show_col_types = FALSE) |>
    dplyr::mutate(date = as.Date(date), downloads = as.integer(downloads))
} else {
  tibble::tibble(package = character(), date = as.Date(character()), downloads = integer())
}

fetch_start <- if (nrow(existing) > 0) {
  max(history_start, max(existing$date, na.rm = TRUE) - overlap_days)
} else {
  history_start
}

message(
  if (nrow(existing) > 0) "Updating npm history from " else "Fetching full npm history from ",
  fetch_start, " through ", end_date
)

fresh <- purrr::map_dfr(packages, fetch_history, from = fetch_start, to = end_date)
if (nrow(fresh) == 0) stop("npm returned no download rows.")

daily <- dplyr::bind_rows(existing, fresh) |>
  dplyr::filter(package %in% packages, !is.na(date), date <= end_date) |>
  dplyr::mutate(downloads = tidyr::replace_na(as.integer(downloads), 0L)) |>
  dplyr::group_by(package, date) |>
  dplyr::slice_tail(n = 1) |>
  dplyr::ungroup() |>
  dplyr::arrange(package, date)

# end_date + 1 enters a new month only when end_date completed its month.
complete_month_cutoff <- lubridate::floor_date(end_date + 1, "month")
monthly <- daily |>
  dplyr::mutate(period = lubridate::floor_date(date, "month")) |>
  dplyr::filter(period < complete_month_cutoff) |>
  dplyr::group_by(package, period) |>
  dplyr::summarise(downloads = sum(downloads, na.rm = TRUE), .groups = "drop") |>
  dplyr::mutate(year = lubridate::year(period), month = lubridate::month(period)) |>
  dplyr::select(package, year, month, downloads, period) |>
  dplyr::arrange(package, period)

wide_monthly <- monthly |>
  dplyr::select(package, period, downloads) |>
  tidyr::pivot_wider(names_from = package, values_from = downloads, values_fill = 0) |>
  dplyr::arrange(period)

qa <- monthly |>
  dplyr::group_by(package) |>
  dplyr::arrange(period, .by_group = TRUE) |>
  dplyr::mutate(
    downloads = as.numeric(downloads),
    growth_abs = downloads - dplyr::lag(downloads),
    ma_3 = zoo::rollapply(downloads, 3, mean, align = "right", fill = NA),
    ma_6 = zoo::rollapply(downloads, 6, mean, align = "right", fill = NA),
    p95_6 = zoo::rollapply(
      downloads, 6, function(values) stats::quantile(values, 0.95),
      align = "right", fill = NA
    )
  ) |>
  dplyr::ungroup() |>
  dplyr::select(package, period, downloads, growth_abs, ma_3, ma_6, p95_6)

write_csv_atomic(daily, daily_path)
write_csv_atomic(monthly, "out/npm_downloads_monthly.csv")
write_csv_atomic(wide_monthly, "out/npm_downloads_wide_monthly.csv")
write_csv_atomic(qa, "out/qa_summary.csv")

message(
  "npm refresh complete: ", nrow(fresh), " fetched rows; complete monthly data through ",
  max(monthly$period)
)
