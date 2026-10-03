command <- commandArgs(trailingOnly = FALSE)
file_argument <- sub("^--file=", "", command[grepl("^--file=", command)][1])
research_root <- normalizePath(file.path(dirname(file_argument), ".."), mustWork = TRUE)

source(file.path(research_root, "completed_months.R"))

fixture <- data.frame(
  period = as.Date(c("2026-08-01", "2026-09-01", "2026-10-01")),
  value = c(31, 19, 1)
)

completed <- filter_completed_months(
  fixture,
  "period",
  "test fixture",
  today = as.Date("2026-09-19")
)

stopifnot(
  nrow(completed) == 1,
  completed$period[[1]] == as.Date("2026-08-01"),
  completed$value[[1]] == 31
)

assert_completed_months(
  completed,
  "period",
  "filtered test fixture",
  today = as.Date("2026-09-19")
)

incomplete_failed <- tryCatch({
  assert_completed_months(
    fixture,
    "period",
    "unfiltered test fixture",
    today = as.Date("2026-09-19")
  )
  FALSE
}, error = function(error) TRUE)

stopifnot(incomplete_failed)
message("Completed-month guard checks passed.")
