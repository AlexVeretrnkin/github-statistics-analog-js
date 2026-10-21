command <- commandArgs(FALSE)
path <- normalizePath(sub('^--file=', '', command[startsWith(command, '--file=')][1]))
source(file.path(dirname(path), '..', 'experiment', 'models.R'))
# Known errors and interval penalties, including an observation outside an interval.
d <- data.frame(actual = c(10, 20), point = c(8, 23), lo80 = c(9, 21), hi80 = c(11, 24), lo95 = c(8, 19), hi95 = c(12, 25))
s <- score_predictions(d)
stopifnot(s$mae == 2.5, abs(s$rmse - sqrt(6.5)) < 1e-12,
          abs(s$wape_pct - 100 * 5 / 30) < 1e-12, s$coverage80 == .5,
          s$coverage95 == 1, s$interval_score80 == 7.5, s$interval_score95 == 5)
d$point[1] <- NA_real_
stopifnot(inherits(try(score_predictions(d), silent = TRUE), 'try-error'))
set.seed(9)
dates <- seq(as.Date('2015-01-01'), by = 'month', length.out = 60)
y <- round(exp(5 + .005 * seq_along(dates) + .2 * sin(2 * pi * seq_along(dates) / 12) + rnorm(60, 0, .08)))
future <- seq(tail(dates, 1), by = 'month', length.out = 13)[-1]
for (m in model_names) {
  fit <- fit_candidate(y, dates, m, 101, samples = 100)
  a <- predict_candidate(fit, m, future, 102)
  b <- predict_candidate(fit, m, future, 102)
  stopifnot(identical(a, b), nrow(a) == 12, all(is.finite(as.matrix(a))), all(a >= 0))
  if (m == 'NAIVE') stopifnot(max(abs(a$point - tail(y, 1))) < 1e-9)
  if (m == 'SNAIVE') stopifnot(max(abs(a$point - tail(y, 12))) < 1e-9)
  tmp <- tempfile(fileext = '.rds'); saveRDS(fit, tmp)
  stopifnot(identical(a, predict_candidate(readRDS(tmp), m, future, 102)))
  unlink(tmp)
  pars <- parameter_table(fit, m); diag <- candidate_diagnostics(fit, m, y, dates)
  stopifnot(nrow(pars) > 0, all(is.finite(pars$estimate)), nrow(diag$residuals) == length(y), diag$diagnostics$lag > diag$diagnostics$fitdf)
}
cat('PASS: known metrics, invalid forecast rejection, all five models, baseline definitions, seeded intervals, RDS replay, parameters and diagnostics.\n')
