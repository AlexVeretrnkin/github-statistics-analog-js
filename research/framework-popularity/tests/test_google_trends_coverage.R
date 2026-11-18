command <- commandArgs(trailingOnly = FALSE)
script <- sub("^--file=", "", command[grepl("^--file=", command)][1])
source(file.path(dirname(script), "..", "google_trends_coverage.R"))
fixture <- data.frame(
  date = rep(seq(as.Date("2026-09-27"), as.Date("2026-11-01"), by = "week"), 3),
  keyword = rep(c("React", "Angular", "Vue"), each = 6),
  hits = 20,
  isPartial = rep(c(FALSE, FALSE, FALSE, FALSE, FALSE, TRUE), 3)
)
p <- prepare_google_trends(fixture, as.Date("2026-11-06"))
stopifnot(nrow(p$rows) == 15, p$complete_weeks_through == "2026-10-31",
          p$completed_month_before == "2026-11-01", p$excluded_week_starts == "2026-11-01")
# The current week is excluded even when the provider omits the flag.
fixture$isPartial <- NULL
stopifnot(nrow(prepare_google_trends(fixture, as.Date("2026-11-06"))$rows) == 15)
gap <- fixture[fixture$date != as.Date("2026-10-11"), ]
stopifnot(inherits(try(prepare_google_trends(gap, as.Date("2026-11-06")), silent = TRUE), "try-error"))
message("Google Trends complete-week and gap checks passed.")
