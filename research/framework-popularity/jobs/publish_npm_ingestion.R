# Publish an ephemeral npm ingestion payload through the authenticated server API.

required_packages <- c("httr", "jsonlite")
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop("Missing R packages: ", paste(missing_packages, collapse = ", "))
}

base_url <- sub("/+$", "", Sys.getenv("RESEARCH_INGESTION_URL", ""))
token <- Sys.getenv("RESEARCH_INGESTION_TOKEN", "")
allow_unauthenticated <- tolower(
  Sys.getenv("RESEARCH_INGESTION_ALLOW_UNAUTHENTICATED", "false")
) == "true"
input_path <- Sys.getenv("RESEARCH_NPM_INGESTION_FILE", "out/npm_ingestion.rds")
batch_size <- as.integer(Sys.getenv("RESEARCH_INGESTION_BATCH_SIZE", "500"))

if (!nzchar(base_url)) stop("RESEARCH_INGESTION_URL is required.")
if (!nzchar(token) && !allow_unauthenticated) {
  stop(paste(
    "RESEARCH_INGESTION_TOKEN is required.",
    "Set RESEARCH_INGESTION_ALLOW_UNAUTHENTICATED=true only for a loopback local service."
  ))
}
if (!file.exists(input_path)) stop("npm ingestion handoff file does not exist: ", input_path)
if (!is.finite(batch_size) || batch_size < 1 || batch_size > 1000) {
  stop("RESEARCH_INGESTION_BATCH_SIZE must be between 1 and 1000.")
}

payload <- readRDS(input_path)
run_id <- NULL

request_json <- function(method, path, body = NULL) {
  headers <- if (nzchar(token)) {
    httr::add_headers(Authorization = paste("Bearer", token))
  } else {
    httr::add_headers()
  }
  request_body <- if (is.null(body)) NULL else jsonlite::toJSON(
    body,
    auto_unbox = TRUE,
    na = "null",
    null = "null",
    digits = NA
  )

  response <- httr::VERB(
    method,
    paste0(base_url, path),
    headers,
    httr::content_type_json(),
    body = request_body,
    encode = "raw",
    httr::timeout(120)
  )

  content <- httr::content(response, as = "text", encoding = "UTF-8")
  if (httr::http_error(response)) {
    stop(method, " ", path, " failed (HTTP ", httr::status_code(response), "): ", content)
  }

  if (!nzchar(content)) return(list())
  jsonlite::fromJSON(content, simplifyVector = TRUE)
}

fail_run <- function(message) {
  if (is.null(run_id)) return(invisible(NULL))
  try(
    request_json(
      "POST",
      paste0("/api/internal/v1/ingestions/npm-downloads/runs/", run_id, "/fail"),
      list(error = substr(message, 1, 4000))
    ),
    silent = TRUE
  )
}

tryCatch({
  run <- request_json(
    "POST",
    "/api/internal/v1/ingestions/npm-downloads/runs",
    list(
      schemaVersion = as.integer(payload$schema_version),
      sourceDataThrough = payload$source_data_through,
      gitSha = Sys.getenv("GITHUB_SHA", ""),
      metadata = list(
        githubRunId = Sys.getenv("GITHUB_RUN_ID", ""),
        githubRunAttempt = Sys.getenv("GITHUB_RUN_ATTEMPT", ""),
        fetchedFrom = payload$fetched_from
      )
    )
  )
  run_id <- run$runId
  if (is.null(run_id) || !nzchar(run_id)) stop("The ingestion API did not return a run ID.")

  rows <- payload$rows
  starts <- seq(1, nrow(rows), by = batch_size)

  for (batch_index in seq_along(starts)) {
    left <- starts[[batch_index]]
    right <- min(left + batch_size - 1, nrow(rows))
    batch <- rows[left:right, , drop = FALSE]
    body <- list(rows = lapply(seq_len(nrow(batch)), function(index) {
      list(
        package = as.character(batch$package[[index]]),
        date = as.character(batch$date[[index]]),
        downloads = as.numeric(batch$downloads[[index]])
      )
    }))

    request_json(
      "PUT",
      paste0(
        "/api/internal/v1/ingestions/npm-downloads/runs/",
        run_id,
        "/batches/",
        batch_index - 1L
      ),
      body
    )
    message("Published npm batch ", batch_index, "/", length(starts))
  }

  committed <- request_json(
    "POST",
    paste0("/api/internal/v1/ingestions/npm-downloads/runs/", run_id, "/commit")
  )
  message(
    "Committed npm ingestion run ", committed$runId,
    " through ", committed$sourceDataThrough,
    " with ", committed$rowCount, " staged rows."
  )
}, error = function(error) {
  fail_run(conditionMessage(error))
  stop(error)
})
