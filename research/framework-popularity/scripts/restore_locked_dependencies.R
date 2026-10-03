# Explicit dependency restoration; does not collect data or execute forecasts.
command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(file.path(dirname(file_argument), ".."), mustWork = TRUE)
project_library <- file.path(research_root, ".r-library")
dir.create(project_library, showWarnings = FALSE)
.libPaths(c(project_library, .libPaths()))
if (!requireNamespace("renv", quietly = TRUE)) {
  stop("Install renv first, e.g. install.packages('renv', repos='https://cloud.r-project.org'), then rerun.")
}
renv::restore(
  project = research_root,
  library = project_library,
  lockfile = file.path(research_root, "renv.lock"),
  prompt = FALSE
)
