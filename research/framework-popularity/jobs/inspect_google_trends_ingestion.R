# Print an ephemeral Google Trends ingestion RDS payload as JSON for local QA tooling.

command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(file.path(dirname(file_argument), ".."), mustWork = TRUE)
project_library <- file.path(research_root, ".r-library")
if (dir.exists(project_library)) .libPaths(c(project_library, .libPaths()))

arguments <- commandArgs(trailingOnly = TRUE)
input_path <- if (length(arguments) > 0) arguments[[1]] else file.path(
  research_root,
  "out/google_trends_ingestion.rds"
)

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Missing package: jsonlite. Run `pnpm research:setup` first.")
}
if (!file.exists(input_path)) stop("Google Trends ingestion RDS does not exist: ", input_path)

payload <- readRDS(input_path)
required_fields <- c("schema_version", "source_data_through", "completed_month_before", "rows")
if (!all(required_fields %in% names(payload))) {
  stop("Google Trends ingestion RDS is missing required fields.")
}

rows <- payload$rows
rows$date <- as.character(rows$date)
output <- list(
  schemaVersion = as.integer(payload$schema_version),
  sourceDataThrough = as.character(payload$source_data_through),
  completedMonthBefore = as.character(payload$completed_month_before),
  metadata = payload$metadata,
  rows = rows
)

cat(jsonlite::toJSON(
  output,
  auto_unbox = TRUE,
  dataframe = "rows",
  digits = NA,
  na = "null",
  null = "null"
))
