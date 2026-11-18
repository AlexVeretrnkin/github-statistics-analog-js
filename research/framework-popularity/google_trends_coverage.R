# Keep complete weekly observations and certify the monthly coverage boundary.
prepare_google_trends <- function(interest, today = Sys.Date()) {
  dates <- as.Date(interest$date)
  partial <- rep(FALSE, nrow(interest))
  if ("isPartial" %in% names(interest)) {
    flag <- tolower(as.character(interest$isPartial))
    partial <- is.na(flag) | !flag %in% c("false", "0")
  }
  partial <- partial | is.na(dates) | dates + 7 > as.Date(today)
  excluded <- unique(dates[partial])
  keep <- !dates %in% excluded & !is.na(dates)
  rows <- data.frame(
    date = dates[keep],
    framework = as.character(interest$keyword[keep]),
    interest = suppressWarnings(as.numeric(ifelse(as.character(interest$hits[keep]) == "<1", "0.5", as.character(interest$hits[keep]))))
  )
  rows <- rows[order(rows$framework, rows$date), ]
  if (!nrow(rows) || any(!is.finite(rows$interest)) || any(rows$interest < 0 | rows$interest > 100)) {
    stop("Google Trends contains invalid weekly observations.")
  }
  if (any(duplicated(rows[c("framework", "date")]))) stop("Duplicate Google Trends weekly observations.")
  windows <- split(rows$date, rows$framework)
  for (dates in windows) {
    if (any(as.integer(diff(dates)) != 7)) stop("Google Trends weekly coverage contains a gap.")
  }
  if (length(unique(vapply(windows, paste, collapse = ",", FUN.VALUE = character(1)))) != 1) {
    stop("Google Trends frameworks have different weekly windows.")
  }
  covered_through <- max(rows$date) + 6
  list(
    rows = rows,
    complete_weeks_through = as.character(covered_through),
    completed_month_before = min(format(as.Date(today), "%Y-%m-01"), format(covered_through + 1, "%Y-%m-01")),
    excluded_week_starts = as.character(excluded[!is.na(excluded)])
  )
}
