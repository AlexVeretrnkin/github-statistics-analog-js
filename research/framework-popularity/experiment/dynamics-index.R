# Offline, descriptive pilot. Never writes to the input archive or live database.
# Rscript research/framework-popularity/experiment/dynamics-index.R INPUT_DIR OUTPUT_DIR
args <- commandArgs(TRUE)
if (length(args) != 2L) stop('Pass frozen experiment directory and a NEW output directory')
input <- normalizePath(args[1], mustWork = TRUE)
out <- args[2]
if (dir.exists(out)) stop('Output directory already exists; choose a new run directory')
stopifnot(requireNamespace('jsonlite', quietly = TRUE), requireNamespace('digest', quietly = TRUE))
sha <- function(p) digest::digest(file = p, algo = 'sha256')
manifest <- jsonlite::read_json(file.path(input, 'result-manifest.json'), simplifyVector = TRUE)
source <- file.path(input, 'model-inputs.csv')
entry <- manifest$files[manifest$files$path == 'model-inputs.csv', ]
stopifnot(nrow(entry) == 1L, identical(sha(source), entry$sha256))
d <- read.csv(source, stringsAsFactors = FALSE)
d$date <- as.Date(d$date)
stopifnot(nrow(d) == 795L, !anyDuplicated(d[c('series_id', 'date')]),
  all(is.finite(d$value)), all(d$value >= 0), all(d$value == floor(d$value)))
frameworks <- c('React', 'Angular', 'Vue')
stopifnot(setequal(unique(d$series_id), as.vector(outer(c('npm-downloads', 'github-stars'), frameworks, paste, sep = '_'))))
for (id in unique(d$series_id)) {
  dates <- sort(d$date[d$series_id == id])
  stopifnot(identical(dates, seq(min(dates), max(dates), by = 'month')))
}
dates <- seq(as.Date('2018-09-01'), as.Date('2026-08-01'), by = 'month')
panel <- do.call(rbind, lapply(frameworks, function(f) {
  n <- d[d$series_id == paste0('npm-downloads_', f), ]
  s <- d[d$series_id == paste0('github-stars_', f), ]
  data.frame(framework = f, date = dates, downloads = n$value[match(dates, n$date)],
    stars = s$value[match(dates, s$date)])
}))
stopifnot(nrow(panel) == 288L, all(is.finite(panel$downloads)), all(is.finite(panel$stars)))
bases <- data.frame(base = c('primary_12m', 'calendar_2022', 'calendar_2021', 'prior_36m'),
  start = as.Date(c('2022-09-01', '2022-01-01', '2021-01-01', '2020-09-01')),
  end = as.Date(c('2023-08-01', '2022-12-01', '2021-12-01', '2023-08-01')))
first_origin <- as.Date('2023-09-01')
stopifnot(all(bases$end < first_origin))
weights <- seq(0, 1, by = 0.05)
sign_tol <- function(x) ifelse(abs(x) < 1e-10, 0L, ifelse(x > 0, 1L, -1L))
combine <- function(rd, rs, w, method) {
  if (method == 'geometric') 100 * exp(w * log(rd) + (1 - w) * log(rs))
  else 100 * (w * rd + (1 - w) * rs)
}
change <- function(x, lag) c(rep(NA_real_, lag), 100 * (x[(lag+1):length(x)] / x[1:(length(x)-lag)] - 1))
construct <- function(p, base, w, method, offset = 1, center = 'mean') {
  ref <- p[p$date >= base$start & p$date <= base$end, ]
  stopifnot(nrow(ref) == length(seq(base$start, base$end, by = 'month')))
  fun <- if (center == 'mean') mean else median
  bd <- fun(ref$downloads); bs <- fun(ref$stars)
  if (any(c(p$downloads, p$stars, bd, bs) + offset <= 0)) stop('Nonpositive ratio input')
  rd <- (p$downloads + offset) / (bd + offset)
  rs <- (p$stars + offset) / (bs + offset)
  v <- combine(rd, rs, w, method)
  data.frame(framework = p$framework, date = p$date, base = base$base,
    center = center, offset = offset, method = method, weight_downloads = w,
    baseline_downloads = bd, baseline_stars = bs, ratio_downloads = rd,
    ratio_stars = rs, index = v, mom_pct = change(v, 1), yoy_pct = change(v, 12))
}
# Independent algebraic/edge checks before any output.
stopifnot(isTRUE(all.equal(combine(1.5, .8, .5, 'geometric'), 100 * sqrt(1.2))),
  combine(1, 1, .3, 'geometric') == 100,
  combine(2, .5, 1, 'arithmetic') == 200,
  abs(combine(2, .5, 0, 'geometric') - 50) < 1e-12,
  abs(combine(2, .5, .5, 'geometric') - 100) < 1e-12,
  combine(2, .5, .5, 'arithmetic') == 125,
  is.finite(combine((0+1)/(10+1), (5+1)/(20+1), .5, 'geometric')))
for (f in frameworks) {
  p <- panel[panel$framework == f, ]
  prefix <- p[p$date < first_origin, ]
  for (b in seq_len(nrow(bases))) {
    full <- construct(p, bases[b, ], .5, 'geometric')
    past <- construct(prefix, bases[b, ], .5, 'geometric')
    stopifnot(isTRUE(all.equal(full$index[seq_len(nrow(past))], past$index)))
  }
}
grid <- list(); k <- 0L
for (f in frameworks) for (b in seq_len(nrow(bases))) for (w in weights) for (m in c('geometric', 'arithmetic')) {
  k <- k + 1L
  grid[[k]] <- construct(panel[panel$framework == f, ], bases[b, ], w, m)
}
grid <- do.call(rbind, grid)
stopifnot(nrow(grid) == 48384L, all(is.finite(grid$index)))
evaluation <- grid[grid$date >= first_origin, ]
primary <- grid[grid$base == 'primary_12m' & abs(grid$weight_downloads - .5) < 1e-10, ]
endpoints <- evaluation[evaluation$date == max(dates), ]
default_endpoints <- endpoints[endpoints$base == 'primary_12m' & abs(endpoints$weight_downloads - .5) < 1e-10, ]
# Continuous-weight direction thresholds, independent of the diagnostic weight grid.
directions <- do.call(rbind, lapply(frameworks, function(f) {
  p <- panel[panel$framework == f, ]
  gd <- c(rep(NA_real_, 12), diff(log1p(p$downloads), lag = 12))
  gs <- c(rep(NA_real_, 12), diff(log1p(p$stars), lag = 12))
  threshold <- ifelse(abs(gd - gs) > 1e-12, -gs / (gd - gs), NA_real_)
  z <- data.frame(framework = f, date = p$date, downloads_yoy_pct = change(p$downloads + 1, 12),
    stars_yoy_pct = change(p$stars + 1, 12), log_change_downloads = gd, log_change_stars = gs,
    component_disagreement = sign_tol(gd) * sign_tol(gs) < 0,
    zero_growth_weight = ifelse(threshold >= 0 & threshold <= 1, threshold, NA_real_),
    robust_direction_25_75 = sign_tol(.25 * gd + .75 * gs) == sign_tol(.75 * gd + .25 * gs),
    geometric_yoy_pct_w50 = 100 * expm1(.5 * gd + .5 * gs))
  z[z$date >= first_origin, ]
}))
robustness <- do.call(rbind, lapply(frameworks, function(f) {
  q <- evaluation[evaluation$framework == f, ]
  z <- directions[directions$framework == f, ]
  gm <- q[q$method == 'geometric' & abs(q$weight_downloads - .5) < 1e-10, ]
  bydate <- split(gm$yoy_pct, gm$date)
  invariance_error <- max(vapply(bydate, function(x) max(x) - min(x), numeric(1)))
  stopifnot(invariance_error < 1e-9)
  default <- q[q$base == 'primary_12m' & abs(q$weight_downloads - .5) < 1e-10, ]
  g <- default[default$method == 'geometric', ]; a <- default[default$method == 'arithmetic', ]
  stopifnot(all(g$date == a$date), all(a$index + 1e-10 >= g$index))
  data.frame(framework = f, evaluated_months = nrow(z),
    opposite_component_yoy_months = sum(z$component_disagreement),
    robust_yoy_direction_25_75_months = sum(z$robust_direction_25_75),
    arithmetic_geometric_yoy_direction_disagreements = sum(sign_tol(a$yoy_pct) != sign_tol(g$yoy_pct)),
    geometric_yoy_base_invariance_max_error = invariance_error,
    component_yoy_log_change_correlation = cor(z$log_change_downloads, z$log_change_stars))
}))
# Offset sensitivity and an outlier-robust baseline, diagnostic only (no source cleaning).
alternative <- do.call(rbind, lapply(frameworks, function(f) {
  # This diagnostic uses the common positive 2021+ window only. Earlier Vue zeros
  # remain in the main panel; c=0 has undefined log growth at those boundaries.
  p <- panel[panel$framework == f & panel$date >= as.Date('2021-01-01'), ]
  do.call(rbind, lapply(c(0, 1, 10), function(c) {
    do.call(rbind, lapply(c('mean', 'median'), function(center) {
      do.call(rbind, lapply(c('geometric', 'arithmetic'), function(m) construct(p, bases[1, ], .5, m, c, center)))
    }))
  }))
}))
offset_diagnostics <- do.call(rbind, lapply(frameworks, function(f) {
  g <- alternative[alternative$framework == f & alternative$center == 'mean' &
    alternative$method == 'geometric' & alternative$date >= first_origin, ]
  one <- g[g$offset == 1, ]; zero <- g[g$offset == 0, ]; ten <- g[g$offset == 10, ]
  data.frame(framework = f, max_abs_yoy_pp_offset0_vs1 = max(abs(zero$yoy_pct - one$yoy_pct)),
    max_abs_yoy_pp_offset10_vs1 = max(abs(ten$yoy_pct - one$yoy_pct)))
}))
# Quantify how much one month contributes to the reference-period total.
base_audit <- do.call(rbind, lapply(frameworks, function(f) do.call(rbind, lapply(seq_len(nrow(bases)), function(b) {
  p <- panel[panel$framework == f & panel$date >= bases$start[b] & panel$date <= bases$end[b], ]
  do.call(rbind, lapply(c('downloads', 'stars'), function(metric) data.frame(framework = f,
    base = bases$base[b], metric = metric, mean = mean(p[[metric]]), median = median(p[[metric]]),
    largest_month = p$date[which.max(p[[metric]])],
    largest_month_share_pct = 100 * max(p[[metric]]) / sum(p[[metric]]))))
}))))
dir.create(out, recursive = TRUE)
write <- function(x, name) write.csv(x, file.path(out, name), row.names = FALSE, na = '')
write(panel, 'paired-observations.csv'); write(grid, 'index-grid.csv')
write(primary, 'primary-trajectories.csv'); write(endpoints, 'endpoint-sensitivity.csv')
write(directions, 'direction-stability.csv'); write(robustness, 'robustness-summary.csv')
write(alternative, 'offset-and-center-sensitivity.csv'); write(offset_diagnostics, 'offset-summary.csv')
write(base_audit, 'baseline-audit.csv')
config <- list(status = 'descriptive pilot; no forecast fitting or weight optimization',
  input_sha256 = sha(source), input_manifest_sha256 = sha(file.path(input, 'result-manifest.json')),
  input = input, dataset_doi = '10.5281/zenodo.23575437',
  common_period = as.character(range(dates)), evaluation_period = c('2023-09-01', '2026-08-01'),
  bases = bases, weights = weights, default_weight = .5, default_offset_raw_counts = 1,
  formula_geometric = '100*((D+c)/(mean_B(D)+c))^w*((S+c)/(mean_B(S)+c))^(1-w)',
  formula_arithmetic = '100*(w*(D+c)/(mean_B(D)+c)+(1-w)*(S+c)/(mean_B(S)+c))',
  direction_definition = 'sign of 12-month change; core sensitivity w in [0.25,0.75]',
  interpretation = 'Within-framework activity/attention relative to reference; not usage, popularity rank or market share.',
  notes = c('Baseline mean of index is not forced to 100.',
    'Geometric temporal growth is exactly invariant to a fixed baseline at fixed weights and offset.',
    'Offset is in raw count units; metric-unit rescaling must rescale offset too.',
    'Offset-0 diagnostic is restricted to the positive common 2021+ window; main panel retains earlier zeros.',
    'Monthly flows, not cumulative stars; no seasonal adjustment; YoY is descriptive.',
    'No observations removed or winsorized; median is a baseline sensitivity only.',
    'Frozen reconstructed histories, not real-time data vintages; not preregistered.',
    'No independence-based significance tests or external adoption validation.'),
  R_version = R.version.string)
jsonlite::write_json(config, file.path(out, 'config.json'), pretty = TRUE, auto_unbox = TRUE, digits = NA)
jsonlite::write_json(list(endpoints = default_endpoints, robustness = robustness,
  offset = offset_diagnostics, baseline_audit = base_audit), file.path(out, 'summary.json'),
  pretty = TRUE, auto_unbox = TRUE, digits = NA)
writeLines(capture.output(sessionInfo()), file.path(out, 'session-info.txt'))
script <- sub('^--file=', '', grep('^--file=', commandArgs(FALSE), value = TRUE))
file.copy(script, file.path(out, 'dynamics-index.R'))

# Scientific plots, all values computed above; English labels avoid font ambiguity.
colors <- c('#007F78', '#CB573B', '#1C3557')
draw <- function(stem, fun) {
  pdf(file.path(out, paste0(stem, '.pdf')), width = 11, height = 8, useDingbats = FALSE)
  fun(); dev.off()
  png(file.path(out, paste0(stem, '.png')), width = 1650, height = 1200, res = 150)
  fun(); dev.off()
}
draw('01-index-trajectories', function() {
  par(mfrow = c(3, 1), mar = c(2.5, 4.4, 2.3, 1), oma = c(2, 0, 2, 0))
  for (f in frameworks) {
    q <- primary[primary$framework == f & primary$method == 'geometric' & primary$date >= as.Date('2021-01-01'), ]
    values <- cbind(q$index, 100*q$ratio_downloads, 100*q$ratio_stars)
    matplot(q$date, values, type = 'l', lty = c(1, 2, 3), col = colors, lwd = c(2, 1, 1), xaxt = 'n',
      xlab = '', ylab = 'Reference index', main = f)
    axis.Date(1, at = seq(as.Date('2021-01-01'), max(dates), by = 'year'), format = '%Y')
    abline(h = 100, col = 'grey75'); abline(v = as.numeric(first_origin), col = 'grey65', lty = 3)
    if (f == 'React') legend('topleft', c('Geometric composite, w=0.5', 'npm component', 'GitHub component'),
      col = colors, lty = c(1, 2, 3), bty = 'n', cex = .75)
  }
  mtext('Activity relative to Sep 2022-Aug 2023 means (not an adoption ranking)', outer = TRUE, side = 3, cex = 1)
  mtext('Vertical line: Sep 2023. Panels have independent vertical scales.', outer = TRUE, side = 1, cex = .8)
})
draw('02-yoy-weight-sensitivity', function() {
  par(mfrow = c(3, 1), mar = c(2.5, 4.4, 2.3, 1), oma = c(2, 0, 2, 0))
  for (f in frameworks) {
    q <- evaluation[evaluation$framework == f & evaluation$base == 'primary_12m' & evaluation$method == 'geometric', ]
    mid <- q[abs(q$weight_downloads - .5) < 1e-10, ]; lo <- q[abs(q$weight_downloads - .25) < 1e-10, ]
    hi <- q[abs(q$weight_downloads - .75) < 1e-10, ]; bottom <- pmin(lo$yoy_pct, hi$yoy_pct); top <- pmax(lo$yoy_pct, hi$yoy_pct)
    plot(mid$date, mid$yoy_pct, type = 'n', ylim = range(c(0, bottom, top)), main = f,
      xlab = '', ylab = 'YoY change (%)')
    title(main = f)
    polygon(c(mid$date, rev(mid$date)), c(bottom, rev(top)), col = '#CEE4E0', border = NA)
    lines(mid$date, mid$yoy_pct, col = colors[1], lwd = 2); abline(h = 0, lty = 2, col = 'grey45')
  }
  mtext('Geometric index: weight sensitivity, not a confidence interval', outer = TRUE, side = 3)
  mtext('Line: w=0.5. Shading: all weights from 0.25 to 0.75. Fixed-base invariant.', outer = TRUE, side = 1, cex = .8)
})
draw('03-baseline-sensitivity', function() {
  par(mfrow = c(1, 3), mar = c(6.5, 4.4, 3.2, 1), oma = c(2, 0, 2, 0))
  for (f in frameworks) {
    q <- endpoints[endpoints$framework == f & abs(endpoints$weight_downloads - .5) < 1e-10, ]
    a <- q[q$method == 'arithmetic', ]; g <- q[q$method == 'geometric', ]
    values <- rbind(g$index, a$index)
    barplot(values, beside = TRUE, names.arg = c('Sep22-Aug23', '2022', '2021', 'Sep20-Aug23'),
      las = 2, col = colors[c(1, 2)], ylab = 'Reference index', main = f)
    abline(h = 100, lty = 2, col = 'grey50')
    if (f == 'React') legend('topright', c('Geometric', 'Arithmetic'), fill = colors[c(1, 2)], bty = 'n', cex = .8)
  }
  mtext('August 2026 level changes with the reference period (w=0.5)', outer = TRUE, side = 3)
  mtext('100 corresponds to both reference components; panel scales differ.', outer = TRUE, side = 1, cex = .8)
})
report <- c('# Пілот індексу динаміки вебфреймворків', '',
  '## Статус і межі', '',
  'Виконано описовий пілот на заморожених даних статті. Ваги не оптимізувалися, нові прогнози не оцінювалися. Це не валідований індекс використання та не рейтинг популярності.', '',
  '## Дизайн', '',
  '- Джерело: перевірені model-inputs.csv (795 спостережень), звірені з SHA-256 маніфесту експерименту. Дані відповідають підготовленій підвибірці спостережень Zenodo DOI 10.5281/zenodo.23575437.',
  '- Спільна історія: вересень 2018 — серпень 2026, 96 місяців × 3 фреймворки × 2 компоненти. Решта історії не входить до парного порівняння.',
  '- Основна база: вересень 2022 — серпень 2023. Альтернативи: 2021, 2022 та вересень 2020 — серпень 2023. Усі бази передують першому origin вересня 2023.',
  '- Описове оцінювання стійкості: вересень 2023 — серпень 2026, 36 місяців. Це не новий backtest і не 36 незалежних спостережень.',
  '- Два способи агрегування, 21 вага downloads від 0 до 1 з кроком 0,05, чотири бази. Разом 48 384 значення індексу. Основний варіант має рівні ваги.',
  '- R_D=(D+1)/(mean_B(D)+1), R_S=(S+1)/(mean_B(S)+1). Геометричний I=100 R_D^w R_S^(1-w). Арифметичний A=100[w R_D+(1-w)R_S].',
  '- Значення 100 відповідає базовим значенням компонентів. Середнє геометричного індексу за базовий період не примушується до 100.', '',
  '## Ключовий результат: залежність напряму від ваги', '',
  '| Фреймворк | Різні напрями компонентів YoY | Стійкий знак індексу при w від 0,25 до 0,75 | Розбіжність знака арифметичного/геометричного при w=0,5 |',
  '|---|---:|---:|---:|')
for (i in seq_len(nrow(robustness))) {
  r <- robustness[i, ]
  report <- c(report, sprintf('| %s | %d/36 | %d/36 | %d/36 |', r$framework,
    r$opposite_component_yoy_months, r$robust_yoy_direction_25_75_months,
    r$arithmetic_geometric_yoy_direction_disagreements))
}
report <- c(report, '',
  'Напрям означає зміну проти того самого місяця попереднього року (YoY). Стійкість перевірена на всьому безперервному інтервалі ваг через його кінці: логарифмічна зміна є лінійною функцією ваги. Діапазон 0,25–0,75 — сценарій, а не оцінена ймовірність чи довірчий інтервал.', '',
  '## Серпень 2026, рівні ваги й основна база', '',
  '| Фреймворк | Геометричний рівень | Арифметичний рівень | Геометрична зміна YoY |',
  '|---|---:|---:|---:|')
for (f in frameworks) {
  g <- default_endpoints[default_endpoints$framework == f & default_endpoints$method == 'geometric', ]
  a <- default_endpoints[default_endpoints$framework == f & default_endpoints$method == 'arithmetic', ]
  report <- c(report, sprintf('| %s | %.2f | %.2f | %+.2f%% |', f, g$index, a$index, g$yoy_pct))
}
report <- c(report, '',
  'Рівні відносні до власної бази кожного фреймворку. Ця таблиця не порівнює масштаби використання. Останній місяць є ілюстрацією, а висновки про стійкість охоплюють усі 36 місяців.', '',
  '## Математичний результат', '',
  'Для фіксованих ваг, доданка c і бази маємо log(I_t/I_(t-k)) = w log((D_t+c)/(D_(t-k)+c)) + (1-w) log((S_t+c)/(S_(t-k)+c)). Базові середні скорочуються точно. Отже, темп геометричного індексу не залежить від вибору фіксованої бази; рівень залежить. Це властивість стандартного геометричного агрегування, а не заявка на нову теорему.', '',
  'У разі протилежних напрямів критична вага w* = -g_S/(g_D-g_S). Наприклад, для Vue в липні 2026 вона становить приблизно 0,4916: висновок дуже чутливий до ваг поблизу 0,5. Компоненти тоді мають близько +102,71% та -49,50% YoY, а індекс з рівними вагами — лише +1,17%. Значення обчислено для лічильників із доданком 1.', '',
  '## Базовий період, сплески та нулі', '',
  'Грудень 2022 формує 44,14% сумарних npm-завантажень Vue в основному 12-місячному базовому періоді. Заміна середнього бази на медіану змінює геометричний рівень Vue у серпні 2026 зі 100,63 до 135,57. Джерельні спостереження при цьому не вилучалися. Вибирати базу лише за привабливістю результату не можна.',
  'У спільній історії є шість нульових місяців GitHub Vue. Основний індекс із c=1 їх зберігає. Діагностику c=0 виконано на додатному спільному вікні від 2021 року, яке містить базу та всі оцінювані YoY-пари. Порівняння c=0,1,10 показує чутливість до псевдолічильника; він заданий у сирих одиницях і має масштабуватися разом із ними.', '',
  '## Рекомендація', '',
  'Розвивати геометричний варіант як індекс відносної динаміки, обов’язково показуючи обидві компоненти, зміну YoY та діапазон ваг. Не приховувати компенсацію протилежних сигналів одним числом. Не оцінювати ваги за критерієм гладкості індексу або легкості прогнозування створеної цими ж вагами цілі.',
  'Наступний окремий експеримент: зафіксувати вагу і визначення цілі, порівняти прямий прогноз логарифма індексу з агрегуванням прогнозів компонентів на однакових навчальних вікнах та origins. Перевірка має включати persistence. Для інтервалів потрібна спільна невизначеність компонентів із коваріацією. Не можна множити границі маргінальних інтервалів і називати результат 95% інтервалом індексу.', '',
  '## Графіки та відтворення', '',
  '- [Рівень індексу та компоненти](01-index-trajectories.pdf)',
  '- [Річна зміна й чутливість до ваг](02-yoy-weight-sensitivity.pdf)',
  '- [Чутливість рівня до бази](03-baseline-sensitivity.pdf)',
  '- index-grid.csv містить усі варіанти; direction-stability.csv містить критичні ваги для кожного місяця.',
  '- config.json, session-info.txt і manifest.json фіксують налаштування, середовище та контрольні суми.', '',
  'Повторний запуск: `Rscript research/framework-popularity/experiment/dynamics-index.R output/article-experiment-2026-10-18 output/NEW-DIRECTORY`.', '',
  'Методологічні джерела: OECD/JRC, https://doi.org/10.1787/9789264043466-en; Weights and Importance in Composite Indicators, https://publications.jrc.ec.europa.eu/repository/handle/JRC105460. Пілот не підтверджує пріоритет новизни й не валідований незалежною мірою використання.')
writeLines(report, file.path(out, 'REPORT_UK.md'), useBytes = TRUE)
files <- list.files(out, full.names = TRUE)
jsonlite::write_json(list(checks = c('source hash', 'unique keys', 'complete paired calendar',
  'nonnegative counts', 'formula edge cases', 'no future baseline influence',
  'geometric growth baseline invariance', 'weighted AM-GM inequality'),
  files = lapply(files, function(p) list(path = basename(p), sha256 = sha(p)))),
  file.path(out, 'manifest.json'), pretty = TRUE, auto_unbox = TRUE)
print(default_endpoints[c('framework', 'method', 'index', 'yoy_pct')]); print(robustness)
cat('PASS: source integrity, algebra and temporal checks. Output:', out, '\n')
