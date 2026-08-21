arguments <- commandArgs(trailingOnly = TRUE)
source_argument <- arguments[grepl("^--source=", arguments)]
source_name <- if (length(source_argument) > 0) sub("^--source=", "", source_argument[1]) else "all"
validate_only <- "--validate-only" %in% arguments

valid_sources <- c("all", "npm", "google", "github", "none")
if (!source_name %in% valid_sources) {
  stop("--source must be one of: ", paste(valid_sources, collapse = ", "))
}

command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(dirname(file_argument), mustWork = TRUE)
setwd(research_root)

project_library <- file.path(research_root, ".r-library")
if (dir.exists(project_library)) .libPaths(c(project_library, .libPaths()))

message("Framework research root: ", research_root)

if (!validate_only) {
  if (source_name %in% c("all", "npm")) source("NpmDownloadsFetch.R", local = new.env())
  if (source_name %in% c("all", "google")) source("refresh_google_trends.R", local = new.env())
  if (source_name %in% c("all", "github")) source("refresh_github_stars.R", local = new.env())

  # Forecasts depend on all three archived inputs, so regenerate them after any
  # source refresh. `--source=none` is the forecasts-only command.
  source("export_forecasts.R", local = new.env())
}

source("scripts/validate_data.R", local = new.env())
message("Framework research pipeline completed successfully.")
