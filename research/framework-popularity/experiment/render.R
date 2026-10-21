# Regenerate publication-ready residual panels from saved models, without fitting.
args <- commandArgs(TRUE)
if (length(args) != 1L) stop('Pass an experiment directory')
out <- normalizePath(args[1], mustWork = TRUE)
status <- jsonlite::read_json(file.path(out, 'status.json'))
if (status$status != 'complete') stop('Render only a completed, successful experiment')
paths <- list.files(file.path(out, 'fits'), pattern = '_full\\.rds$', full.names = TRUE)
fits <- lapply(paths, readRDS)
fits <- Filter(function(r) r$status == 'ok' && r$identity$model %in% c('SARIMA', 'ETS', 'PROPHET'), fits)
for (id in unique(vapply(fits, function(r) r$identity$series_id, character(1)))) {
  selected <- Filter(function(r) r$identity$series_id == id, fits)
  selected <- selected[order(match(vapply(selected, function(r) r$identity$model, character(1)), c('SARIMA', 'ETS', 'PROPHET')))]
  draw <- function() {
    par(mfrow = c(length(selected), 3), mar = c(4.8, 4.6, 3.2, 1.2), mgp = c(2.7, .8, 0), oma = c(0, 0, 2, 0), cex = .85)
    for (r in selected) {
      e <- r$residuals$residual; e_finite <- e[is.finite(e)]
      plot(r$residuals$date, e, type = 'l', xlab = 'Month', ylab = 'Model residual', main = r$identity$model); abline(h = 0, col = 'grey60')
      if (sd(e_finite) > 0) acf(e_finite, lag.max = 36, main = 'Residual autocorrelation', xlab = 'Lag (months)') else plot.new()
      hist(e_finite, breaks = 15, main = 'Residual distribution', xlab = 'Model residual', col = 'grey75', border = 'white')
    }
    title(main = paste(id, '| fitted through', substr(selected[[1]]$identity$origin, 1, 7)), outer = TRUE, cex.main = 1)
  }
  prefix <- file.path(out, 'figures', paste0(id, '_residuals'))
  png(paste0(prefix, '.png'), width = 2400, height = 1800, res = 200); draw(); dev.off()
  pdf(paste0(prefix, '.pdf'), width = 12, height = 9, useDingbats = FALSE); draw(); dev.off()
}
command <- commandArgs(FALSE)
script <- normalizePath(sub('^--file=', '', command[startsWith(command, '--file=')][1]))
destination <- file.path(out, 'code', 'render.R')
if (script != destination) file.copy(script, destination, overwrite = TRUE)
files <- list.files(out, recursive = TRUE, full.names = TRUE)
files <- files[basename(files) != 'result-manifest.json']
jsonlite::write_json(list(schema_version = 1, config_sha256 = digest::digest(file = file.path(out, 'config.json'), algo = 'sha256'),
  figures_regenerated_from_saved_fits = TRUE,
  files = lapply(files, function(f) list(path = substring(f, nchar(out) + 2), bytes = unname(file.info(f)$size),
    sha256 = digest::digest(file = f, algo = 'sha256')))), file.path(out, 'result-manifest.json'),
  pretty = TRUE, auto_unbox = TRUE, digits = NA)
cat('Rendered six PNG/PDF residual panels and updated the checksum manifest.\n')
