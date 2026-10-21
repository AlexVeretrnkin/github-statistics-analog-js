# Shared fitting, forecasting and diagnostics for the frozen article experiment.
# Counts are modelled as log1p(count), with no cleaning or inverse bias correction.
model_names <- c('SARIMA', 'ETS', 'PROPHET', 'NAIVE', 'SNAIVE')

fit_candidate <- function(values, dates, model, seed, samples = 1000L) {
  stopifnot(length(values) == length(dates), all(is.finite(values)), all(values >= 0))
  set.seed(seed)
  y <- ts(log1p(values), frequency = 12,
          start = c(as.integer(format(dates[1], '%Y')), as.integer(format(dates[1], '%m'))))
  if (model == 'SARIMA') return(forecast::auto.arima(y, seasonal = TRUE,
    stepwise = TRUE, approximation = FALSE, ic = 'aicc', method = 'CSS-ML',
    test = 'kpss', seasonal.test = 'seas', allowmean = TRUE, allowdrift = TRUE))
  if (model == 'ETS') return(forecast::ets(y, model = 'ZZZ', damped = NULL,
    opt.crit = 'lik', ic = 'aicc', bounds = 'both', allow.multiplicative.trend = FALSE))
  if (model == 'PROPHET') return(prophet::prophet(data.frame(ds = dates, y = as.numeric(y)),
    growth = 'linear', n.changepoints = 25, changepoint.range = 0.8,
    yearly.seasonality = if (length(y) >= 24) 10 else FALSE,
    weekly.seasonality = FALSE, daily.seasonality = FALSE,
    seasonality.mode = 'additive', seasonality.prior.scale = 10,
    changepoint.prior.scale = 0.05, mcmc.samples = 0,
    uncertainty.samples = samples, interval.width = 0.95,
    algorithm = if (length(y) < 100) 'Newton' else 'LBFGS', seed = seed, verbose = FALSE))
  if (model == 'NAIVE') return(forecast::naive(y, h = 12, level = c(80, 95)))
  if (model == 'SNAIVE') return(forecast::snaive(y, h = 12, level = c(80, 95)))
  stop('Unknown model: ', model)
}

predict_candidate <- function(fit, model, dates, seed) {
  set.seed(seed)
  if (model == 'PROPHET') {
    # One sample matrix supplies both intervals, ensuring nested quantiles.
    simulations <- prophet::predictive_samples(fit, data.frame(ds = dates))$yhat
    point_fit <- fit
    point_fit$uncertainty.samples <- 0L
    center <- predict(point_fit, data.frame(ds = dates))$yhat
    bounds <- t(apply(simulations, 1, quantile, probs = c(.025, .1, .9, .975)))
    pred <- cbind(point = center, lo80 = bounds[, 2], hi80 = bounds[, 3],
                  lo95 = bounds[, 1], hi95 = bounds[, 4])
  } else {
    fc <- if (model %in% c('NAIVE', 'SNAIVE')) {
      forecast::forecast(fit$model, h = length(dates), level = c(80, 95))
    } else forecast::forecast(fit, h = length(dates), level = c(80, 95))
    pred <- cbind(point = fc$mean, lo80 = fc$lower[, '80%'], hi80 = fc$upper[, '80%'],
                  lo95 = fc$lower[, '95%'], hi95 = fc$upper[, '95%'])
  }
  pred <- matrix(as.numeric(pred), nrow = nrow(pred), dimnames = dimnames(pred))
  pred[] <- pmax(expm1(pred), 0)
  if (nrow(pred) != length(dates) || any(!is.finite(pred))) stop('Non-finite or incomplete forecast')
  if (any(pred[, 'lo95'] > pred[, 'lo80'] | pred[, 'lo80'] > pred[, 'hi80'] |
          pred[, 'hi80'] > pred[, 'hi95'])) stop('Unordered intervals')
  as.data.frame(pred)
}

parameter_table <- function(fit, model) {
  parameters <- numeric()
  if (model == 'SARIMA') parameters <- c(fit$coef, sigma2 = fit$sigma2)
  if (model == 'ETS') parameters <- c(fit$par, sigma2 = fit$sigma2)
  if (model == 'PROPHET') parameters <- unlist(lapply(fit$params, as.numeric))
  if (model == 'PROPHET') {
    parameters <- unlist(lapply(names(fit$params), function(n) {
      v <- as.numeric(fit$params[[n]])
      setNames(v, if (length(v) == 1) n else paste0(n, '[', seq_along(v), ']'))
    }))
  }
  if (model %in% c('NAIVE', 'SNAIVE')) parameters <- c(sigma2 = fit$model$sigma2)
  se <- rep(NA_real_, length(parameters))
  if (model == 'SARIMA' && length(fit$coef)) {
    se[seq_along(fit$coef)] <- sqrt(diag(fit$var.coef))
  }
  data.frame(parameter = names(parameters), estimate = as.numeric(parameters), standard_error = se,
    lower95 = as.numeric(parameters) - 1.96 * se, upper95 = as.numeric(parameters) + 1.96 * se,
    scale = if (model == 'PROPHET') 'Prophet internal normalized time and response; scales stored in RDS' else 'log1p count model',
    interval_method = ifelse(is.na(se), 'not computed', 'conditional asymptotic Wald; selected specification treated as fixed'))
}

candidate_metadata <- function(fit, model) {
  value <- function(x) if (is.null(x)) NA_real_ else as.numeric(x)
  specification <- switch(model,
    SARIMA = paste(names(forecast::arimaorder(fit)), forecast::arimaorder(fit), collapse = ';'),
    ETS = fit$method,
    PROPHET = 'linear; additive yearly Fourier=10; 25 candidate changepoints in first 80%; MAP',
    NAIVE = 'random walk on log1p counts', SNAIVE = 'seasonal random walk on log1p counts; period=12')
  convergence <- if (model == 'SARIMA') value(fit$code) else if (model == 'PROPHET') {
    value(fit$stan.fit$return_code)
  } else NA_real_
  data.frame(specification, loglik = if (model %in% c('SARIMA', 'ETS')) value(fit$loglik) else NA_real_,
    aicc = if (model %in% c('SARIMA', 'ETS')) value(fit$aicc) else NA_real_,
    convergence_code = convergence,
    optimizer = switch(model, SARIMA = 'stats::arima CSS-ML / default BFGS',
      ETS = 'forecast::ets likelihood optimization (internal simplex)',
      PROPHET = 'Stan Newton if n<100, otherwise LBFGS; Newton fallback; see captured messages',
      NAIVE = 'closed form', SNAIVE = 'closed form'))
}

candidate_diagnostics <- function(fit, model, values, dates) {
  if (model == 'PROPHET') {
    point_fit <- fit; point_fit$uncertainty.samples <- 0L
    r <- log1p(values) - predict(point_fit, data.frame(ds = dates))$yhat
  } else r <- as.numeric(residuals(fit))
  if (length(r) != length(dates)) stop('Residual/date length mismatch')
  residual_rows <- data.frame(date = dates, residual = r,
    residual_type = if (model == 'PROPHET') 'in-sample response residual on log1p scale' else 'model innovation residual')
  valid <- which(is.finite(r))
  if (!length(valid) || any(diff(valid) != 1)) stop('Missing internal residuals')
  r <- r[valid]
  k <- if (model == 'SARIMA') sum(forecast::arimaorder(fit)[c('p', 'q', 'P', 'Q')], na.rm = TRUE) else 0L
  lag <- max(k + 3L, min(24L, floor(length(r) / 5)))
  # Same non-ARIMA fitdf=0 convention as forecast 8.23 checkresiduals.
  # ETS and Prophet p-values are exploratory, not calibrated post-selection tests.
  test <- if (lag < length(r) && sd(r) > 0) Box.test(r, lag = lag, type = 'Ljung-Box', fitdf = k) else NULL
  note <- if (model == 'SARIMA') 'approximate ARMA correction p+q+P+Q; conditional on selected model' else if (model %in% c('ETS', 'PROPHET')) 'exploratory unadjusted p-value; no validated effective-df correction' else 'unadjusted baseline diagnostic'
  ac <- if (sd(r) > 0) as.numeric(acf(r, lag.max = min(36L, length(r) - 1L), plot = FALSE)$acf) else NA_real_
  list(residuals = residual_rows,
    diagnostics = data.frame(n_residuals = length(r), lag, fitdf = k, alpha = .05,
      ljung_box_q = if (is.null(test)) NA_real_ else unname(test$statistic),
      p_value = if (is.null(test)) NA_real_ else test$p.value, interpretation = note),
    acf = data.frame(lag = seq_along(ac) - 1L, acf = ac))
}

score_predictions <- function(d) {
  stopifnot(nrow(d) > 0, all(is.finite(as.matrix(d[c('actual', 'point', 'lo80', 'hi80', 'lo95', 'hi95')]))))
  e <- d$actual - d$point
  interval_score <- function(lo, hi, alpha) hi - lo + 2 / alpha * pmax(lo - d$actual, 0) + 2 / alpha * pmax(d$actual - hi, 0)
  data.frame(n_origins = nrow(d), mae = mean(abs(e)), rmse = sqrt(mean(e^2)),
    wape_pct = if (sum(abs(d$actual)) == 0) NA_real_ else 100 * sum(abs(e)) / sum(abs(d$actual)),
    absolute_error_sd = sd(abs(e)), absolute_error_p10 = unname(quantile(abs(e), .1)),
    absolute_error_p90 = unname(quantile(abs(e), .9)),
    coverage80 = mean(d$actual >= d$lo80 & d$actual <= d$hi80),
    coverage95 = mean(d$actual >= d$lo95 & d$actual <= d$hi95),
    width80 = mean(d$hi80 - d$lo80), width95 = mean(d$hi95 - d$lo95),
    interval_score80 = mean(interval_score(d$lo80, d$hi80, .2)),
    interval_score95 = mean(interval_score(d$lo95, d$hi95, .05)))
}
