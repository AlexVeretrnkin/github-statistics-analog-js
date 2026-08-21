# Refresh the rolling five-year Google Trends snapshot used by the app.
#
# Google renormalizes each query to 0–100. The complete five-year window is
# therefore replaced atomically on every run; new observations must not be
# appended to an older request with a different normalization baseline.

required_packages <- c("gtrendsR", "dplyr", "tidyr", "lubridate", "zoo", "readr")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    ". Run `pnpm research:setup` first."
  )
}

frameworks <- c("Angular", "React", "Vue")
category <- as.integer(Sys.getenv("RESEARCH_TRENDS_CATEGORY", "31"))
geo <- Sys.getenv("RESEARCH_TRENDS_GEO", "")
language <- Sys.getenv("RESEARCH_TRENDS_LANGUAGE", "en-US")
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))

fetch_trends <- function(retries = 6) {
  time_variants <- c("today+5-y", "today 5-y")

  for (attempt in seq_len(retries)) {
    time_value <- time_variants[((attempt - 1) %% length(time_variants)) + 1]
    result <- try(
      gtrendsR::gtrends(
        keyword = frameworks,
        geo = geo,
        time = time_value,
        category = category,
        gprop = "web",
        hl = language,
        onlyInterest = TRUE
      ),
      silent = TRUE
    )

    if (
      !inherits(result, "try-error") &&
      !is.null(result$interest_over_time) &&
      nrow(result$interest_over_time) > 0
    ) {
      return(result$interest_over_time)
    }

    wait_seconds <- min(120, 5 * (2 ^ (attempt - 1))) + stats::runif(1, 0, 3)
    message("Google Trends attempt ", attempt, " failed; retrying in ", round(wait_seconds), "s")
    Sys.sleep(wait_seconds)
  }

  stop("Google Trends returned no usable data after retries.")
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

interest <- fetch_trends()
weekly <- interest |>
  dplyr::transmute(
    date = as.Date(date),
    framework = as.character(keyword),
    interest = suppressWarnings(as.numeric(dplyr::if_else(hits == "<1", "0.5", as.character(hits))))
  ) |>
  dplyr::filter(framework %in% frameworks, !is.na(date), is.finite(interest)) |>
  dplyr::group_by(date, framework) |>
  dplyr::summarise(interest = mean(interest), .groups = "drop") |>
  tidyr::pivot_wider(names_from = framework, values_from = interest) |>
  dplyr::arrange(date)

if (!all(frameworks %in% names(weekly))) {
  stop("Google Trends response did not contain all expected frameworks.")
}

monthly <- weekly |>
  tidyr::pivot_longer(-date, names_to = "framework", values_to = "interest") |>
  dplyr::mutate(date = lubridate::floor_date(date, "month")) |>
  dplyr::filter(date < lubridate::floor_date(today, "month")) |>
  dplyr::group_by(date, framework) |>
  dplyr::summarise(interest = mean(interest, na.rm = TRUE), .groups = "drop") |>
  tidyr::pivot_wider(names_from = framework, values_from = interest) |>
  dplyr::arrange(date)

if (nrow(monthly) < 48) stop("Google Trends returned fewer than 48 complete months.")

write_csv_atomic(weekly, "ts_out/gt_ui_5y_weekly_cat31.csv")
write_csv_atomic(monthly, "ts_out/gt_ui_5y_monthly_cat31.csv")

message(
  "Google Trends refresh complete: ", nrow(weekly), " weekly rows; complete monthly data through ",
  max(monthly$date)
)
