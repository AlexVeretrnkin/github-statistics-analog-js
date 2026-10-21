# Usage: Rscript --vanilla research/framework-popularity/experiment/run.R \
#   --snapshot=output/reproducibility/snapshot-... --output=output/article-experiment-...
args <- commandArgs(trailingOnly = TRUE)
option <- function(key, default = NULL) {
  x <- args[startsWith(args, paste0('--', key, '='))]
  if (length(x) > 1) stop('Duplicate option: ', key)
  if (length(x)) substring(x, nchar(key) + 4L) else default
}
script <- normalizePath(sub('^--file=', '', commandArgs(FALSE)[startsWith(commandArgs(FALSE), '--file=')][1]))
script_dir <- dirname(script)
source(file.path(script_dir, 'models.R'))
for (p in c('forecast', 'prophet', 'jsonlite', 'digest')) {
  if (!requireNamespace(p, quietly = TRUE)) stop('Missing dependency: ', p)
}
if (as.character(packageVersion('forecast')) != '8.23.0' || as.character(packageVersion('prophet')) != '1.0') {
  stop('Restore the locked forecast 8.23.0 and prophet 1.0 environment before running.')
}
json_write <- function(x, file) jsonlite::write_json(x, file, pretty = TRUE, auto_unbox = TRUE, na = 'null', digits = NA)
csv_write <- function(x, file) write.csv(x, file, row.names = FALSE, na = '')
sha <- function(file) digest::digest(file = file, algo = 'sha256')
origin_count <- as.integer(option('origins', '24'))
samples <- as.integer(option('samples', '1000'))
stopifnot(is.finite(origin_count), origin_count >= 1, is.finite(samples), samples >= 100)
snapshot_arg <- option('snapshot'); output_arg <- option('output')
if (is.null(snapshot_arg) || is.null(output_arg)) stop('--snapshot and --output are required')
snapshot <- normalizePath(snapshot_arg, mustWork = TRUE)
out <- normalizePath(output_arg, mustWork = FALSE)
resume <- '--resume' %in% args
if (dir.exists(out) && !resume) stop('Output exists; choose a new directory or use --resume')
if (resume && !file.exists(file.path(out, 'config.json'))) stop('Cannot resume without config.json')
manifest <- jsonlite::read_json(file.path(snapshot, 'manifest.json'), simplifyVector = TRUE)
for (i in seq_len(nrow(manifest$files))) {
  row <- manifest$files[i, ]
  path <- normalizePath(file.path(snapshot, row$path), mustWork = TRUE)
  if (!startsWith(path, paste0(snapshot, '/'))) stop('Unsafe snapshot path')
  if (file.info(path)$size != row$bytes || sha(path) != row$sha256) stop('Snapshot integrity failure: ', row$path)
}
config <- list(schema_version = 1, input_manifest_sha256 = sha(file.path(snapshot, 'manifest.json')),
  source = manifest$source, snapshot_as_of = manifest$asOf,
  origins = origin_count, min_training_months = 36L, horizons = c(1L, 3L, 6L, 12L), full_forecast_months = 24L,
  origin_policy = 'last N common monthly origins with all 12 future months observed; expanding window',
  origin_date_convention = 'YYYY-MM-01 labels the completed origin month; information cutoff is its month end, not its first day',
  transformation = 'log1p(count); nonnegative expm1 inverse without mean bias adjustment',
  preparation = 'exclude initial partial source months; trim leading zero months; preserve all later zeros and observations; no interpolation or cleaning',
  seed = 20261018L, uncertainty_samples = samples, models = model_names,
  historical_interpretation = 'retrospective backtest using one frozen snapshot, not real-time historical data vintages',
  score_definition = 'error at exactly h months; WAPE=100*sum(abs(error))/sum(abs(actual)); no pooled cross-series errors',
  interval_definition = 'Prophet shared simulated quantiles; forecast analytic/default model intervals; endpoints inverse transformed and clipped to zero',
  ranking = 'ex-post comparison; no independently held-out claim; no formal significance test for dependent overlapping errors',
  source_hashes = list(models = sha(file.path(script_dir, 'models.R')), runner = sha(script)),
  forecast_version = as.character(packageVersion('forecast')), prophet_version = as.character(packageVersion('prophet')),
  R_version = R.version.string)
if (resume) {
  old <- jsonlite::read_json(file.path(out, 'config.json'))
  expected <- jsonlite::fromJSON(jsonlite::toJSON(config, auto_unbox = TRUE), simplifyVector = FALSE)
  if (!identical(old, expected)) stop('Resume config/source/environment differs from frozen run')
} else {
  dir.create(out, recursive = TRUE)
  dir.create(file.path(out, 'input')); dir.create(file.path(out, 'code')); dir.create(file.path(out, 'fits')); dir.create(file.path(out, 'figures'))
  for (f in c(manifest$files$path, 'manifest.json')) {
    if (!file.copy(file.path(snapshot, f), file.path(out, 'input', f))) stop('Input copy failed')
  }
  for (f in c('models.R', 'run.R', 'verify.R')) file.copy(file.path(script_dir, f), file.path(out, 'code', f))
  guide <- file.path(script_dir, '..', '..', '..', 'docs', 'article-experiment.md')
  if (file.exists(guide)) file.copy(guide, file.path(out, 'README.md'))
  lock <- file.path(script_dir, '..', 'renv.lock')
  if (file.exists(lock)) file.copy(lock, file.path(out, 'code', 'renv.lock'))
  json_write(config, file.path(out, 'config.json'))
}
writeLines(capture.output(sessionInfo()), file.path(out, 'session-info.txt'))
packages <- installed.packages()[, c('Package', 'Version'), drop = FALSE]
csv_write(as.data.frame(packages), file.path(out, 'installed-packages.csv'))

# Validate source coverage and monthly aggregation from the frozen daily observations.
inputs <- list(); preparation <- list()
for (metric in c('npm-downloads', 'github-stars')) {
  npm <- metric == 'npm-downloads'
  prefix <- if (npm) 'npm_downloads' else 'github_stars'
  key <- if (npm) 'package' else 'repository'
  count <- if (npm) 'downloads' else 'new_stars'
  ids <- if (npm) c(React = 'react', Angular = '@angular/core', Vue = 'vue') else c(React = 'facebook/react', Angular = 'angular/angular', Vue = 'vuejs/core')
  daily <- read.csv(file.path(out, 'input', paste0(prefix, '_daily.csv')))
  monthly <- read.csv(file.path(out, 'input', paste0(prefix, '_monthly.csv')))
  if (!setequal(unique(daily[[key]]), ids) || !setequal(unique(monthly[[key]]), ids)) stop('Unexpected series')
  for (framework in names(ids)) {
    d <- daily[daily[[key]] == ids[[framework]], ]; d <- d[order(d$date), ]
    m <- monthly[monthly[[key]] == ids[[framework]], ]; m <- m[order(m$period), ]
    dates <- as.Date(d$date); periods <- as.Date(m$period)
    if (anyNA(dates) || anyNA(periods) || any(diff(dates) != 1) || anyDuplicated(periods)) stop('Invalid source dates')
    if (any(!is.finite(d[[count]]) | d[[count]] < 0 | d[[count]] != floor(d[[count]]))) stop('Invalid daily counts')
    sums <- tapply(d[[count]], format(dates, '%Y-%m-01'), sum)
    if (!setequal(names(sums), m$period) || any(as.numeric(sums[m$period]) != m[[count]])) stop('Monthly/daily mismatch')
    if (!identical(as.character(seq(min(periods), max(periods), by = 'month')), as.character(periods))) stop('Missing month')
    next_month <- seq(max(periods), by = 'month', length.out = 2)[2]
    if (max(dates) != next_month - 1 || max(periods) >= as.Date(manifest$completedMonthBefore)) stop('Incomplete final source month')
    partial <- format(min(dates), '%d') != '01'
    keep <- rep(TRUE, nrow(m)); if (partial) keep[1] <- FALSE
    m <- m[keep, ]
    first_positive <- which(m[[count]] > 0)[1]
    if (is.na(first_positive)) stop('All-zero series')
    leading_removed <- first_positive - 1L
    m <- m[first_positive:nrow(m), ]
    id <- paste(metric, framework, sep = '_')
    inputs[[id]] <- data.frame(series_id = id, metric, framework, date = as.Date(m$period), value = m[[count]])
    preparation[[id]] <- data.frame(series_id = id, raw_months = length(periods), excluded_initial_partial = partial,
      excluded_leading_zeros = leading_removed, start = min(m$period), end = max(m$period), months = nrow(m))
  }
}
end <- min(vapply(inputs, function(d) as.numeric(max(d$date)), numeric(1)))
end <- as.Date(end, origin = '1970-01-01')
inputs <- lapply(inputs, function(d) d[d$date <= end, ])
if (any(vapply(inputs, nrow, integer(1)) < 48L)) stop('Every series needs at least 36 training and 12 evaluation months')
possible <- Reduce(intersect, lapply(inputs, function(d) as.character(d$date[seq.int(36L, nrow(d) - 12L)])))
origins <- as.Date(tail(sort(possible), origin_count))
if (length(origins) != origin_count) stop('Not enough common origins for requested experiment')
csv_write(do.call(rbind, inputs), file.path(out, 'model-inputs.csv'))
csv_write(do.call(rbind, preparation), file.path(out, 'preparation.csv'))
csv_write(data.frame(origin = origins, max_horizon = 12L), file.path(out, 'origins.csv'))
json_write(list(status = 'running', origins = as.character(origins), common_end = as.character(end)), file.path(out, 'status.json'))

# Each checkpoint contains the exact fitted object used for its predictions and diagnostics.
job_results <- list(); job <- 0L
for (id in names(inputs)) {
  d <- inputs[[id]]
  for (oi in seq_len(length(origins) + 1L)) {
    full <- oi > length(origins)
    origin <- if (full) end else origins[oi]
    train <- d[d$date <= origin, ]
    future <- seq(origin, by = 'month', length.out = if (full) 25 else 13)[-1]
    for (mi in seq_along(model_names)) {
      job <- job + 1L
      model <- model_names[mi]
      job_id <- paste(id, format(origin, '%Y-%m'), model, if (full) 'full' else 'backtest', sep = '_')
      path <- file.path(out, 'fits', paste0(job_id, '.rds'))
      seed <- config$seed + job * 10L
      identity <- data.frame(job_id, series_id = id, metric = d$metric[1], framework = d$framework[1],
        model, phase = if (full) 'full' else 'backtest', origin = as.character(origin),
        train_start = as.character(min(train$date)), n_train = nrow(train), seed)
      cat(sprintf('[%d/%d] %s\n', job, length(inputs) * (length(origins) + 1) * length(model_names), job_id)); flush.console()
      saved <- if (file.exists(path)) readRDS(path) else NULL
      if (!is.null(saved) && saved$status == 'ok') {
        job_results[[job_id]] <- saved
        next
      }
      warnings <- character(); messages <- character(); started <- proc.time()[3]
      result <- tryCatch(withCallingHandlers({
        fit <- fit_candidate(train$value, train$date, model, seed, samples)
        meta <- candidate_metadata(fit, model)
        if (is.finite(meta$convergence_code) && meta$convergence_code != 0) stop('Optimizer did not converge')
        prediction <- predict_candidate(fit, model, future, seed + 1L)
        prediction$date <- future; prediction$horizon <- seq_along(future)
        prediction$actual <- d$value[match(future, d$date)]
        if (!full && any(!is.finite(prediction$actual))) stop('Incomplete evaluation targets')
        diag <- candidate_diagnostics(fit, model, train$value, train$date)
        list(status = 'ok', identity = identity, fit = fit, metadata = meta,
             parameters = parameter_table(fit, model), predictions = prediction,
             residuals = diag$residuals, diagnostics = diag$diagnostics, acf = diag$acf)
      }, warning = function(w) {warnings <<- c(warnings, conditionMessage(w)); invokeRestart('muffleWarning')},
         message = function(m) {messages <<- c(messages, conditionMessage(m)); invokeRestart('muffleMessage')}),
        error = function(e) list(status = 'failed', identity = identity, error = conditionMessage(e)))
      result$warnings <- warnings; result$messages <- messages; result$elapsed_seconds <- unname(proc.time()[3] - started)
      saveRDS(result, paste0(path, '.tmp')); file.rename(paste0(path, '.tmp'), path)
      job_results[[job_id]] <- result
      if (result$status != 'ok') cat('  FAILED: ', result$error, '\n')
    }
  }
}

bind <- function(x) if (length(x)) do.call(rbind, x) else data.frame()
good <- Filter(function(r) r$status == 'ok', job_results)
for (field in c('metadata', 'parameters', 'predictions', 'residuals', 'diagnostics', 'acf')) {
  rows <- lapply(good, function(r) cbind(r$identity[rep(1L, nrow(r[[field]])), ], r[[field]]))
  csv_write(bind(rows), file.path(out, paste0(field, '.csv')))
}
status_rows <- bind(lapply(job_results, function(r) cbind(r$identity, status = r$status,
  elapsed_seconds = r$elapsed_seconds, error = if (is.null(r$error)) '' else r$error,
  warnings = paste(unique(r$warnings), collapse = ' | '), messages = paste(unique(r$messages), collapse = ' | '))))
csv_write(status_rows, file.path(out, 'fit-status.csv'))
predictions <- bind(lapply(good, function(r) cbind(r$identity[rep(1L, nrow(r$predictions)), ], r$predictions)))
backtest <- predictions[predictions$phase == 'backtest' & predictions$horizon %in% config$horizons, ]
# Paired comparisons only: omit an origin for every model if any model failed there.
keys <- paste(backtest$series_id, backtest$origin, backtest$horizon)
complete <- names(which(table(keys) == length(model_names)))
paired <- backtest[keys %in% complete, ]
csv_write(backtest[!keys %in% complete, ], file.path(out, 'unpaired-predictions.csv'))
groups <- split(paired, interaction(paired$series_id, paired$model, paired$horizon, drop = TRUE))
accuracy <- bind(lapply(groups, function(d) cbind(d[1, c('series_id', 'metric', 'framework', 'model', 'horizon')], score_predictions(d))))
csv_write(accuracy, file.path(out, 'accuracy.csv'))
ranking <- bind(lapply(split(accuracy, interaction(accuracy$series_id, accuracy$horizon, drop = TRUE)), function(d) {
  d <- d[order(d$rmse), ]; d$rmse_rank <- rank(d$rmse, ties.method = 'min'); d
}))
csv_write(ranking, file.path(out, 'rankings.csv'))
origin_groups <- split(paired, interaction(paired$series_id, paired$origin, paired$horizon, drop = TRUE))
winners <- bind(lapply(origin_groups, function(d) {
  d$abs_error <- abs(d$actual - d$point)
  d <- d[d$abs_error == min(d$abs_error), ]; d$tie_weight <- 1 / nrow(d)
  d[, c('series_id', 'origin', 'horizon', 'model', 'abs_error', 'tie_weight')]
}))
csv_write(winners, file.path(out, 'ex-post-origin-winners.csv'))
frequency <- aggregate(tie_weight ~ series_id + horizon + model, winners, sum)
n_origins <- aggregate(origin ~ series_id + horizon, unique(paired[c('series_id', 'horizon', 'origin')]), length)
frequency <- merge(frequency, n_origins, by = c('series_id', 'horizon'))
frequency$frequency <- frequency$tie_weight / frequency$origin
csv_write(frequency, file.path(out, 'ex-post-winner-frequency.csv'))

# Full-fit descriptive panels; residuals/ACF for every historical fit are also in CSV.
for (id in names(inputs)) {
  selected <- Filter(function(r) r$identity$series_id == id && r$identity$phase == 'full' &&
                       r$identity$model %in% c('SARIMA', 'ETS', 'PROPHET'), good)
  if (!length(selected)) next
  png(file.path(out, 'figures', paste0(id, '_residuals.png')), width = 2100, height = 1500, res = 180)
  par(mfrow = c(length(selected), 3), mar = c(3.5, 4, 3, 1))
  for (r in selected) {
    e <- r$residuals$residual; valid <- is.finite(e)
    plot(r$residuals$date, e, type = 'l', xlab = 'Month', ylab = 'Residual', main = paste(id, r$identity$model), cex.main = .8); abline(h = 0, col = 'grey')
    if (sd(e[valid]) > 0) acf(e[valid], lag.max = 36, main = 'Residual ACF (lag in months)') else plot.new()
    hist(e[valid], breaks = 15, main = 'Residual distribution', xlab = 'Residual', col = 'grey80', border = 'white')
  }
  dev.off()
}
failed <- sum(status_rows$status != 'ok')
json_write(list(status = if (failed) 'completed-with-failures' else 'complete', fits = nrow(status_rows), failed_fits = failed,
  paired_origin_horizon_groups = length(complete), expected_origin_horizon_groups = length(inputs) * origin_count * length(config$horizons),
  source = manifest$source, article_updated = FALSE, published = FALSE), file.path(out, 'status.json'))
files <- list.files(out, recursive = TRUE, full.names = TRUE)
files <- files[basename(files) != 'result-manifest.json']
json_write(list(schema_version = 1, config_sha256 = sha(file.path(out, 'config.json')),
  files = lapply(files, function(f) list(path = substring(f, nchar(out) + 2), bytes = unname(file.info(f)$size), sha256 = sha(f)))),
  file.path(out, 'result-manifest.json'))
cat('Finished: ', out, '; failures=', failed, '\n')
if (failed) quit(status = 2L)
