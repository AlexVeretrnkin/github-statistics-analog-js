# Shared completed-calendar-month guard for research inputs.
#
# Daily and weekly observations may include the current month so that ingestion
# can resume incrementally. Monthly model inputs must stop before the first day
# of that month because the current month is not comparable with historical
# full-month totals.

research_today <- function() {
  today <- as.Date(Sys.getenv("RESEARCH_TODAY", as.character(Sys.Date())))
  if (is.na(today)) stop("RESEARCH_TODAY must be a valid ISO date.")
  today
}

completed_month_before <- function(today = research_today()) {
  as.Date(format(as.Date(today), "%Y-%m-01"))
}

filter_completed_months <- function(data, date_column, label, today = research_today()) {
  if (!date_column %in% names(data)) {
    stop(label, " is missing the ", date_column, " column.")
  }

  periods <- as.Date(data[[date_column]])
  if (any(is.na(periods))) stop(label, " contains an invalid monthly date.")

  cutoff <- completed_month_before(today)
  keep <- periods < cutoff
  excluded <- sum(!keep)
  if (excluded > 0) {
    message(
      "Excluded ", excluded, " incomplete or future row(s) from ", label,
      "; completed months end before ", cutoff, "."
    )
  }

  data[keep, , drop = FALSE]
}

assert_completed_months <- function(data, date_column, label, today = research_today()) {
  if (!date_column %in% names(data)) {
    stop(label, " is missing the ", date_column, " column.")
  }

  periods <- as.Date(data[[date_column]])
  if (any(is.na(periods))) stop(label, " contains an invalid monthly date.")

  cutoff <- completed_month_before(today)
  if (any(periods >= cutoff)) {
    stop(label, " contains an incomplete or future calendar month.")
  }

  invisible(data)
}
