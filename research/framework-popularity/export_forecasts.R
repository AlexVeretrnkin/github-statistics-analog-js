# Export app-ready forecasts for the framework-popularity dashboard.
#
# Each series is evaluated on a 12-month holdout. The model with the lower
# validation RMSE is marked as "best", then both models are refit on the full
# history and exported with 80% and 95% prediction intervals.

pkgs <- c("forecast", "prophet", "readr", "dplyr", "lubridate", "tidyr", "tibble")
missing_packages <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_packages) > 0) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    ". Run `pnpm research:setup` first."
  )
}

library(forecast)
library(prophet)
library(readr)
library(dplyr)
library(lubridate)
library(tidyr)
library(tibble)

HORIZON <- 24
HOLDOUT <- 12
OUT_FILE <- "out/framework_popularity_forecasts.csv"

trim_leading_zeros <- function(values, dates) {
  first_positive <- which(is.finite(values) & values > 0)[1]
  if (is.na(first_positive)) first_positive <- 1
  list(values = values[first_positive:length(values)], dates = dates[first_positive:length(dates)])
}

fit_model <- function(values, dates, model_name, use_log, uncertainty_samples = 1000) {
  transformed <- if (use_log) log1p(pmax(values, 0)) else values

  if (model_name == "PROPHET") {
    fit <- prophet::prophet(
      tibble(ds = as.Date(dates), y = transformed),
      yearly.seasonality = length(values) >= 24,
      weekly.seasonality = FALSE,
      daily.seasonality = FALSE,
      interval.width = 0.80,
      uncertainty.samples = uncertainty_samples,
      verbose = FALSE
    )

    return(list(kind = "PROPHET", fit = fit))
  }

  series <- ts(transformed, frequency = 12)
  fit <- if (model_name == "ARIMA") {
    forecast::auto.arima(series, seasonal = TRUE, stepwise = TRUE, approximation = FALSE)
  } else {
    forecast::ets(series)
  }

  list(kind = model_name, fit = fit)
}

forecast_values <- function(model, horizon, use_log) {
  invert <- function(values) {
    numeric_values <- as.numeric(values)
    if (use_log) pmax(expm1(numeric_values), 0) else numeric_values
  }

  if (model$kind == "PROPHET") {
    future <- prophet::make_future_dataframe(
      model$fit,
      periods = horizon,
      freq = "month",
      include_history = FALSE
    )
    model$fit$interval.width <- 0.80
    result80 <- predict(model$fit, future)
    model$fit$interval.width <- 0.95
    result95 <- predict(model$fit, future)

    return(list(
      mean = invert(result80$yhat),
      lo80 = invert(result80$yhat_lower),
      hi80 = invert(result80$yhat_upper),
      lo95 = invert(result95$yhat_lower),
      hi95 = invert(result95$yhat_upper)
    ))
  }

  result <- forecast::forecast(model$fit, h = horizon, level = c(80, 95))

  list(
    mean = invert(result$mean),
    lo80 = invert(result$lower[, "80%"]),
    hi80 = invert(result$upper[, "80%"]),
    lo95 = invert(result$lower[, "95%"]),
    hi95 = invert(result$upper[, "95%"])
  )
}

validation_rmse <- function(values, dates, model_name, use_log) {
  if (length(values) <= HOLDOUT + 24) return(NA_real_)

  train <- head(values, -HOLDOUT)
  train_dates <- head(dates, -HOLDOUT)
  actual <- tail(values, HOLDOUT)
  fit <- tryCatch(
    fit_model(train, train_dates, model_name, use_log, uncertainty_samples = 0),
    error = function(e) NULL
  )
  if (is.null(fit)) return(Inf)

  prediction <- tryCatch(
    forecast_values(fit, HOLDOUT, use_log)$mean,
    error = function(e) rep(NA_real_, HOLDOUT)
  )

  sqrt(mean((actual - prediction)^2, na.rm = TRUE))
}

export_series <- function(metric, framework, values, dates, bounded = FALSE, use_log = FALSE) {
  trimmed <- trim_leading_zeros(as.numeric(values), as.Date(dates))
  values <- trimmed$values
  dates <- trimmed$dates

  scores <- c(
    ARIMA = validation_rmse(values, dates, "ARIMA", use_log),
    ETS = validation_rmse(values, dates, "ETS", use_log),
    PROPHET = validation_rmse(values, dates, "PROPHET", use_log)
  )
  best_model <- names(which.min(scores))[1]
  future_dates <- seq(floor_date(max(dates), "month") %m+% months(1), by = "month", length.out = HORIZON)

  bind_rows(lapply(c("ARIMA", "ETS", "PROPHET"), function(model_name) {
    fit <- fit_model(values, dates, model_name, use_log)
    prediction <- forecast_values(fit, HORIZON, use_log)

    if (bounded) {
      prediction <- lapply(prediction, function(column) pmin(pmax(column, 0), 100))
    }

    tibble(
      metric = metric,
      framework = framework,
      model = model_name,
      date = future_dates,
      mean = prediction$mean,
      lo80 = prediction$lo80,
      hi80 = prediction$hi80,
      lo95 = prediction$lo95,
      hi95 = prediction$hi95,
      validation_rmse = unname(scores[model_name]),
      is_best = model_name == best_model
    )
  }))
}

# Google Trends monthly interest.
google <- read_csv("ts_out/gt_ui_5y_monthly_cat31.csv", show_col_types = FALSE) %>%
  mutate(date = as.Date(date))

google_forecasts <- bind_rows(lapply(c("React", "Angular", "Vue"), function(framework) {
  export_series("google-trends", framework, google[[framework]], google$date, bounded = TRUE)
}))

# npm monthly package downloads.
npm_frameworks <- c("react" = "React", "@angular/core" = "Angular", "vue" = "Vue")
npm <- read_csv("out/npm_downloads_monthly.csv", show_col_types = FALSE) %>%
  mutate(period = as.Date(period))

npm_forecasts <- bind_rows(lapply(names(npm_frameworks), function(package_name) {
  rows <- npm %>% filter(package == package_name) %>% arrange(period)
  export_series(
    "npm-downloads",
    unname(npm_frameworks[package_name]),
    rows$downloads,
    rows$period,
    use_log = TRUE
  )
}))

# GitHub monthly star additions from the archived daily histories.
github_files <- c(
  "React" = "git_stars/facebook_react-stars-history.csv",
  "Angular" = "git_stars/angular_angular-stars-history.csv",
  "Vue" = "git_stars/vuejs_core-stars-history.csv"
)

github_forecasts <- bind_rows(lapply(names(github_files), function(framework) {
  rows <- read_csv(github_files[[framework]], show_col_types = FALSE) %>%
    mutate(date = dmy(date), month = floor_date(date, "month")) %>%
    group_by(month) %>%
    summarise(value = sum(`day-stars`, na.rm = TRUE), .groups = "drop") %>%
    arrange(month)

  export_series("github-stars", framework, rows$value, rows$month, use_log = TRUE)
}))

forecasts <- bind_rows(google_forecasts, npm_forecasts, github_forecasts) %>%
  arrange(metric, framework, model, date)

write_csv(forecasts, OUT_FILE)
message("Saved ", nrow(forecasts), " forecast rows to ", OUT_FILE)
