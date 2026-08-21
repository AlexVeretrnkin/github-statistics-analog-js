command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(file.path(dirname(file_argument), ".."), mustWork = TRUE)
project_library <- file.path(research_root, ".r-library")
dir.create(project_library, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(project_library, .libPaths()))

cran_packages <- c(
  "httr", "jsonlite", "readr", "dplyr", "tidyr", "purrr", "lubridate",
  "zoo", "forecast", "prophet", "tibble", "gtrendsR"
)

missing <- cran_packages[
  !vapply(cran_packages, requireNamespace, logical(1), quietly = TRUE)
]

if (length(missing) == 0) {
  message("All framework-research R packages are already installed.")
} else {
  message("Installing R packages: ", paste(missing, collapse = ", "))
  install.packages(
    missing,
    lib = project_library,
    repos = "https://cloud.r-project.org",
    Ncpus = 2
  )
}

still_missing <- cran_packages[
  !vapply(cran_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(still_missing) > 0) {
  stop("R dependency installation failed for: ", paste(still_missing, collapse = ", "))
}
