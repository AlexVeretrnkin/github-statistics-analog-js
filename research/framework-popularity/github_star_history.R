# Shared collection, transformation, and reconciliation helpers for GitHub stars.

github_request_json <- function(
    url,
    query = list(),
    token = "",
    api_version = "2026-03-10",
    retries = 6L) {
  headers <- c(
    Accept = "application/vnd.github+json",
    `X-GitHub-Api-Version` = api_version
  )
  if (nzchar(token)) headers <- c(headers, Authorization = paste("Bearer", token))
  request_headers <- do.call(httr::add_headers, as.list(headers))

  for (attempt in seq_len(retries)) {
    response <- try(
      httr::GET(
        url,
        request_headers,
        httr::user_agent("github-statistics-analog-js research collector/2.0"),
        httr::timeout(60),
        query = query
      ),
      silent = TRUE
    )

    if (!inherits(response, "try-error") && httr::status_code(response) == 200) {
      return(list(
        data = jsonlite::fromJSON(
          httr::content(response, as = "text", encoding = "UTF-8"),
          simplifyVector = FALSE
        ),
        headers = httr::headers(response)
      ))
    }

    status <- if (inherits(response, "try-error")) NA_integer_ else httr::status_code(response)
    response_headers <- if (inherits(response, "try-error")) list() else httr::headers(response)
    retry_after <- suppressWarnings(as.numeric(response_headers[["retry-after"]]))
    retryable <- is.na(status) || status == 429 || status >= 500

    if (!retryable) {
      detail <- if (inherits(response, "try-error")) {
        as.character(response)
      } else {
        substr(httr::content(response, as = "text", encoding = "UTF-8"), 1, 500)
      }
      rate_limit <- response_headers[["x-ratelimit-remaining"]]
      rate_limit_note <- if (!is.null(rate_limit)) paste0("; rate-limit remaining: ", rate_limit) else ""
      stop("GitHub request failed (HTTP ", status, rate_limit_note, "): ", detail)
    }

    wait_seconds <- if (is.finite(retry_after)) retry_after else min(60, 2 ^ attempt)
    message("GitHub request attempt ", attempt, " failed; retrying in ", wait_seconds, "s")
    Sys.sleep(wait_seconds)
  }

  stop("GitHub request failed after ", retries, " attempts: ", url)
}

parse_github_star_history_page <- function(payload, framework, repository, fetched_at) {
  if (!is.list(payload)) stop("GitHub star-history response must be an array.")
  if (length(payload) == 0) {
    return(tibble::tibble(
      date = as.Date(character()),
      framework = character(),
      repository = character(),
      new_stars = numeric(),
      week_start = as.Date(character()),
      fetched_at = character(),
      source = character()
    ))
  }

  rows <- lapply(payload, function(week_row) {
    week <- suppressWarnings(as.numeric(week_row$week))
    total <- suppressWarnings(as.numeric(week_row$total))
    days <- suppressWarnings(as.numeric(unlist(week_row$days, use.names = FALSE)))

    if (!is.finite(week) || week < 0 || length(days) != 7L ||
        any(!is.finite(days)) || any(days < 0) || any(days != floor(days))) {
      stop("GitHub returned an invalid star-history week for ", repository, ".")
    }
    if (!is.finite(total) || total < 0 || total != sum(days)) {
      stop("GitHub weekly total does not equal the seven daily values for ", repository, ".")
    }

    # GitHub guarantees that days[1] is Sunday but explicitly does not guarantee
    # that bucket boundaries align with UTC. Normalize the epoch's UTC date to
    # the nearest Sunday so positive-offset boundaries cannot appear as Saturday.
    boundary_date <- as.Date(as.POSIXct(week, origin = "1970-01-01", tz = "UTC"))
    weekday_offset <- lubridate::wday(boundary_date, week_start = 7L) - 1L
    sunday_shift <- if (weekday_offset <= 3L) -weekday_offset else 7L - weekday_offset
    week_start <- boundary_date + sunday_shift
    tibble::tibble(
      date = week_start + 0:6,
      framework = framework,
      repository = repository,
      new_stars = days,
      week_start = week_start,
      fetched_at = fetched_at,
      source = "github-rest-star-history"
    )
  })

  dplyr::bind_rows(rows)
}

fetch_github_star_history <- function(
    framework,
    repository,
    api_root,
    token,
    api_version,
    today,
    fetched_at,
    request = github_request_json) {
  url <- paste0(sub("/$", "", api_root), "/repos/", repository, "/stargazers/history")
  pages <- list()
  page <- 1L
  page_size <- 30L

  repeat {
    response <- request(
      url,
      query = list(per_page = page_size, page = page),
      token = token,
      api_version = api_version
    )
    payload <- response$data
    if (!is.list(payload)) stop("GitHub star-history response must be an array for ", repository, ".")
    pages[[page]] <- parse_github_star_history_page(payload, framework, repository, fetched_at)
    message("Fetched ", repository, " star-history page ", page, " (", length(payload), " weeks)")

    if (length(payload) < page_size) break
    page <- page + 1L
    if (page > 100L) stop("GitHub star history exceeded the documented 100-page limit for ", repository, ".")
  }

  daily <- dplyr::bind_rows(pages) |>
    dplyr::filter(date <= today) |>
    dplyr::arrange(date)

  if (nrow(daily) == 0) stop("GitHub returned no star history for ", repository, ".")
  if (any(duplicated(daily$date))) stop("GitHub returned duplicate dates for ", repository, ".")
  expected_days <- as.integer(max(daily$date) - min(daily$date) + 1)
  if (nrow(daily) != expected_days) stop("GitHub star history contains missing dates for ", repository, ".")

  list(rows = daily, pages = page)
}

fetch_github_stargazer_count <- function(
    repository,
    api_root,
    token,
    api_version,
    request = github_request_json) {
  url <- paste0(sub("/$", "", api_root), "/repos/", repository, "/stargazers/count")
  payload <- request(url, token = token, api_version = api_version)$data
  count <- suppressWarnings(as.numeric(payload$count))
  if (!is.finite(count) || count < 0 || count != floor(count)) {
    stop("GitHub returned an invalid current stargazer count for ", repository, ".")
  }
  count
}

aggregate_github_stars_monthly <- function(daily, today) {
  current_month <- lubridate::floor_date(today, "month")
  monthly <- daily |>
    dplyr::mutate(period = lubridate::floor_date(date, "month")) |>
    dplyr::filter(period < current_month) |>
    dplyr::group_by(framework, repository, period) |>
    dplyr::summarise(
      new_stars = sum(new_stars),
      days_observed = dplyr::n(),
      fetched_at = dplyr::first(fetched_at),
      .groups = "drop"
    ) |>
    dplyr::mutate(source = "github-rest-star-history") |>
    dplyr::arrange(framework, period)

  coverage <- monthly |>
    dplyr::group_by(repository) |>
    dplyr::arrange(period, .by_group = TRUE) |>
    dplyr::mutate(
      series_index = dplyr::row_number(),
      expected_days = lubridate::days_in_month(period)
    ) |>
    dplyr::filter(series_index > 1L, days_observed != expected_days) |>
    dplyr::ungroup()
  if (nrow(coverage) > 0) {
    stop("GitHub monthly aggregation contains an incomplete historical calendar month.")
  }

  monthly
}

read_legacy_github_stars <- function(path, framework, repository) {
  legacy <- readr::read_csv(path, show_col_types = FALSE)
  names(legacy) <- tolower(names(legacy))
  required <- c("date", "day-stars", "total-stars")
  if (!all(required %in% names(legacy))) stop("Legacy GitHub file has an invalid schema: ", path)

  legacy |>
    dplyr::transmute(
      date = lubridate::dmy(date),
      framework = framework,
      repository = repository,
      new_stars = as.numeric(`day-stars`),
      total_stars = as.numeric(`total-stars`)
    ) |>
    dplyr::filter(!is.na(date), is.finite(new_stars), is.finite(total_stars)) |>
    dplyr::arrange(date)
}

compare_github_star_series <- function(official, legacy, granularity = c("daily", "monthly")) {
  granularity <- match.arg(granularity)
  framework <- dplyr::first(official$framework)
  repository <- dplyr::first(official$repository)
  official_coverage_start <- min(official$date)
  official_coverage_end <- max(official$date)
  legacy_coverage_start <- min(legacy$date)
  legacy_coverage_end <- max(legacy$date)

  if (granularity == "monthly") {
    daily_overlap_start <- max(official_coverage_start, legacy_coverage_start)
    daily_overlap_end <- min(official_coverage_end, legacy_coverage_end)
    first_complete_month <- lubridate::floor_date(daily_overlap_start, "month")
    if (lubridate::day(daily_overlap_start) != 1L) {
      first_complete_month <- seq(first_complete_month, by = "1 month", length.out = 2)[[2]]
    }
    last_complete_month <- lubridate::floor_date(daily_overlap_end, "month")
    if (lubridate::day(daily_overlap_end) != lubridate::days_in_month(daily_overlap_end)) {
      last_complete_month <- seq(last_complete_month, by = "-1 month", length.out = 2)[[2]]
    }
    complete_through <- lubridate::ceiling_date(last_complete_month, "month") - lubridate::days(1)

    official <- official |>
      dplyr::filter(date >= first_complete_month, date <= complete_through) |>
      dplyr::mutate(date = lubridate::floor_date(date, "month")) |>
      dplyr::group_by(date) |>
      dplyr::summarise(new_stars = sum(new_stars), .groups = "drop")
    legacy <- legacy |>
      dplyr::filter(date >= first_complete_month, date <= complete_through) |>
      dplyr::mutate(date = lubridate::floor_date(date, "month")) |>
      dplyr::group_by(date) |>
      dplyr::summarise(new_stars = sum(new_stars), .groups = "drop")
  } else {
    official <- official |> dplyr::select(date, new_stars)
    legacy <- legacy |> dplyr::select(date, new_stars)
  }

  overlap_start <- if (nrow(official) == 0 || nrow(legacy) == 0) {
    as.Date(NA)
  } else {
    max(min(official$date), min(legacy$date))
  }
  overlap_end <- if (nrow(official) == 0 || nrow(legacy) == 0) {
    as.Date(NA)
  } else {
    min(max(official$date), max(legacy$date))
  }
  if (is.na(overlap_start) || is.na(overlap_end) || overlap_start > overlap_end) {
    return(tibble::tibble(
      granularity = granularity,
      framework = framework,
      repository = repository,
      official_coverage_start = official_coverage_start,
      official_coverage_end = official_coverage_end,
      legacy_coverage_start = legacy_coverage_start,
      legacy_coverage_end = legacy_coverage_end,
      overlap_start = as.Date(NA),
      overlap_end = as.Date(NA),
      compared_rows = 0L,
      exact_matches = 0L,
      value_mismatches = 0L,
      missing_official = 0L,
      missing_legacy = 0L,
      official_sum = 0,
      legacy_sum = 0,
      signed_sum_difference = 0,
      total_absolute_difference = 0,
      max_absolute_difference = 0,
      status = "no-overlap"
    ))
  }

  joined <- dplyr::full_join(
    official |>
      dplyr::filter(date >= overlap_start, date <= overlap_end) |>
      dplyr::rename(official_new_stars = new_stars),
    legacy |>
      dplyr::filter(date >= overlap_start, date <= overlap_end) |>
      dplyr::rename(legacy_new_stars = new_stars),
    by = "date"
  ) |>
    dplyr::mutate(
      difference = official_new_stars - legacy_new_stars,
      absolute_difference = abs(difference)
    )

  missing_official <- sum(is.na(joined$official_new_stars))
  missing_legacy <- sum(is.na(joined$legacy_new_stars))
  comparable <- joined |>
    dplyr::filter(!is.na(official_new_stars), !is.na(legacy_new_stars))
  value_mismatches <- sum(comparable$difference != 0)

  tibble::tibble(
    granularity = granularity,
    framework = framework,
    repository = repository,
    official_coverage_start = official_coverage_start,
    official_coverage_end = official_coverage_end,
    legacy_coverage_start = legacy_coverage_start,
    legacy_coverage_end = legacy_coverage_end,
    overlap_start = overlap_start,
    overlap_end = overlap_end,
    compared_rows = nrow(comparable),
    exact_matches = sum(comparable$difference == 0),
    value_mismatches = value_mismatches,
    missing_official = missing_official,
    missing_legacy = missing_legacy,
    official_sum = sum(comparable$official_new_stars),
    legacy_sum = sum(comparable$legacy_new_stars),
    signed_sum_difference = sum(comparable$difference),
    total_absolute_difference = sum(comparable$absolute_difference),
    max_absolute_difference = if (nrow(comparable) == 0) 0 else max(comparable$absolute_difference),
    status = dplyr::case_when(
      missing_official > 0 || missing_legacy > 0 ~ "coverage-gap",
      value_mismatches > 0 ~ "value-differences",
      TRUE ~ "exact"
    )
  )
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
