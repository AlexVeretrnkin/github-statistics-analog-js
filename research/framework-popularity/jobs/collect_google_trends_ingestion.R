# Collect a complete rolling five-year Google Trends window for database ingestion.
# Google renormalizes every request, so each run replaces the prior window atomically.

project_library <- file.path(getwd(), ".r-library")
if (dir.exists(project_library)) .libPaths(c(project_library, .libPaths()))

required_packages <- c("gtrendsR", "dplyr", "tidyr", "tibble")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing packages: ", paste(missing_packages, collapse = ", "))
}

frameworks <- c("Angular", "React", "Vue")
category <- as.integer(Sys.getenv("RESEARCH_TRENDS_CATEGORY", "31"))
geo <- Sys.getenv("RESEARCH_TRENDS_GEO", "")
language <- Sys.getenv("RESEARCH_TRENDS_LANGUAGE", "en-US")
today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
output_path <- Sys.getenv(
  "RESEARCH_GOOGLE_TRENDS_INGESTION_FILE",
  "out/google_trends_ingestion.rds"
)

fetch_trends <- function(retries = 6) {
  time_variants <- c("today+5-y", "today 5-y")
  for (attempt in seq_len(retries)) {
    result <- try(
      gtrendsR::gtrends(
        keyword = frameworks,
        geo = geo,
        time = time_variants[((attempt - 1) %% length(time_variants)) + 1],
        category = category,
        gprop = "web",
        hl = language,
        onlyInterest = TRUE
      ),
      silent = TRUE
    )
    if (!inherits(result, "try-error") &&
        !is.null(result$interest_over_time) &&
        nrow(result$interest_over_time) > 0) {
      return(result$interest_over_time)
    }
    wait_seconds <- min(120, 5 * (2 ^ (attempt - 1))) + stats::runif(1, 0, 3)
    message("Google Trends attempt ", attempt, " failed; retrying in ", round(wait_seconds), "s")
    Sys.sleep(wait_seconds)
  }
  stop("Google Trends returned no usable data after retries.")
}

rows <- fetch_trends() |>
  dplyr::transmute(
    date = as.Date(date),
    framework = as.character(keyword),
    interest = suppressWarnings(as.numeric(dplyr::if_else(hits == "<1", "0.5", as.character(hits))))
  ) |>
  dplyr::filter(framework %in% frameworks, !is.na(date), is.finite(interest)) |>
  dplyr::group_by(date, framework) |>
  dplyr::summarise(interest = mean(interest), .groups = "drop") |>
  dplyr::arrange(framework, date)

if (!setequal(unique(rows$framework), frameworks)) {
  stop("Google Trends response did not contain all expected frameworks.")
}
if (any(rows$interest < 0 | rows$interest > 100)) {
  stop("Google Trends returned an interest value outside the 0-100 scale.")
}
coverage <- rows |>
  dplyr::group_by(framework) |>
  dplyr::summarise(first_date = min(date), last_date = max(date), points = dplyr::n(), .groups = "drop")
if (length(unique(coverage$first_date)) != 1 ||
    length(unique(coverage$last_date)) != 1 ||
    length(unique(coverage$points)) != 1) {
  stop("Google Trends frameworks do not share the same observation window.")
}
if (any(duplicated(rows[c("framework", "date")]))) {
  stop("Google Trends collector produced duplicate framework/date rows.")
}
if (min(coverage$points) < 250) {
  stop("Google Trends returned fewer than 250 weekly observations per framework.")
}

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
saveRDS(
  list(
    schema_version = 1L,
    source_data_through = as.character(max(rows$date)),
    completed_month_before = format(today, "%Y-%m-01"),
    metadata = list(
      category = category,
      geo = geo,
      language = language,
      property = "web",
      window = "rolling-five-years"
    ),
    rows = rows
  ),
  output_path
)
message("Prepared ", nrow(rows), " Google Trends rows for ingestion at ", output_path)
