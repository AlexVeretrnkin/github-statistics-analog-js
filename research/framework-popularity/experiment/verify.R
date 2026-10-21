# Offline verification of archive integrity, temporal boundaries and saved-model replay.
args <- commandArgs(TRUE)
if (length(args) != 1L) stop('Pass an experiment output directory')
out <- normalizePath(args[1], mustWork = TRUE)
source(file.path(out, 'code', 'models.R'))
manifest <- jsonlite::read_json(file.path(out, 'result-manifest.json'), simplifyVector = TRUE)
for (i in seq_len(nrow(manifest$files))) {
  row <- manifest$files[i, ]; path <- normalizePath(file.path(out, row$path), mustWork = TRUE)
  stopifnot(startsWith(path, paste0(out, '/')), file.info(path)$size == row$bytes,
    digest::digest(file = path, algo = 'sha256') == row$sha256)
}
config <- jsonlite::read_json(file.path(out, 'config.json'), simplifyVector = TRUE)
input <- read.csv(file.path(out, 'model-inputs.csv')); input$date <- as.Date(input$date)
statuses <- read.csv(file.path(out, 'fit-status.csv'))
stopifnot(all(statuses$status == 'ok'), nrow(statuses) == 6 * (config$origins + 1) * 5)
for (path in list.files(file.path(out, 'fits'), pattern = '\\.rds$', full.names = TRUE)) {
  r <- readRDS(path); id <- r$identity
  train <- input[input$series_id == id$series_id & input$date <= as.Date(id$origin), ]
  stopifnot(r$status == 'ok', nrow(train) == id$n_train,
    as.character(max(train$date)) == id$origin,
    all(as.Date(r$predictions$date) > as.Date(id$origin)),
    all(as.Date(r$residuals$date) <= as.Date(id$origin)))
  fitted_input <- if (id$model == 'PROPHET') r$fit$history$y else r$fit$x
  stopifnot(length(fitted_input) == nrow(train),
    isTRUE(all.equal(as.numeric(fitted_input), log1p(train$value), tolerance = 1e-12)))
  if (id$phase == 'backtest') {
    actual <- input$value[match(paste(id$series_id, r$predictions$date), paste(input$series_id, input$date))]
    stopifnot(isTRUE(all.equal(actual, r$predictions$actual)), nrow(r$predictions) == 12)
  }
  # Recompute every full-history forecast from the stored fitted object, with no refit.
  if (id$phase == 'full') {
    replay <- predict_candidate(r$fit, id$model, as.Date(r$predictions$date), id$seed + 1L)
    stopifnot(isTRUE(all.equal(replay, r$predictions[names(replay)], tolerance = 1e-12)))
  }
}
p <- read.csv(file.path(out, 'predictions.csv')); a <- read.csv(file.path(out, 'accuracy.csv'))
for (i in seq_len(nrow(a))) {
  row <- a[i, ]; d <- p[p$phase == 'backtest' & p$series_id == row$series_id & p$model == row$model & p$horizon == row$horizon, ]
  calculated <- score_predictions(d)
  stopifnot(nrow(d) == config$origins)
  for (name in names(calculated)) stopifnot(isTRUE(all.equal(as.numeric(calculated[[name]]), as.numeric(row[[name]]), tolerance = 1e-10)))
}
stopifnot(nrow(a) == 6 * 5 * 4)
cat('PASS: all checksums, all training inputs and temporal boundaries, all target observations, 30 saved full-fit replays, all 120 accuracy rows.\n')
