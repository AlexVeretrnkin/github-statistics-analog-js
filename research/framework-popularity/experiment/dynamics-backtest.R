# Rscript --vanilla dynamics-backtest.R PILOT_DIR NEW_OUTPUT_DIR [WEIGHT] [COMPONENT_CACHE]
args <- commandArgs(TRUE); stopifnot(length(args) %in% 2:4)
input <- normalizePath(args[1]); out <- args[2]
weight <- if(length(args)>=3) as.numeric(args[3]) else .5
stopifnot(length(weight)==1, is.finite(weight), weight>0, weight<1)
cache <- if(length(args)==4) normalizePath(args[4]) else NULL
stopifnot(!dir.exists(out))
for (pkg in c('forecast','prophet','digest','jsonlite')) stopifnot(requireNamespace(pkg,quietly=TRUE))
script <- normalizePath(sub('^--file=', '', commandArgs(FALSE)[startsWith(commandArgs(FALSE),'--file=')][1]))
source(file.path(dirname(script),'models.R'))
sha <- function(p) digest::digest(file=p,algo='sha256')
m <- jsonlite::read_json(file.path(input,'manifest.json'),simplifyVector=TRUE)
for(i in seq_len(nrow(m$files))) stopifnot(sha(file.path(input,m$files$path[i]))==m$files$sha256[i])
if(!is.null(cache)) {
 cm <- jsonlite::read_json(file.path(cache,'manifest.json'),simplifyVector=TRUE)
 stopifnot(cm$status=='complete',cm$fits==1080)
 for(i in seq_len(nrow(cm$files))) stopifnot(sha(file.path(cache,cm$files$path[i]))==cm$files$sha256[i])
 cc <- jsonlite::read_json(file.path(cache,'config.json'))
 stopifnot(cc$input_manifest_sha256==sha(file.path(input,'manifest.json')),
   sha(file.path(cache,'models.R'))==sha(file.path(dirname(script),'models.R')),
   sha(file.path(cache,'paired-observations.csv'))==sha(file.path(input,'paired-observations.csv')))
 # Cache reuse is restricted to exactly the same fitting and prediction code.
 old_code <- readLines(file.path(cache,'dynamics-backtest.R'))
 current_code <- readLines(script)
 fit_code <- function(x) x[seq(which(startsWith(x,'fit_log <-')),which(startsWith(x,'rows <-'))-1)]
 stopifnot(identical(fit_code(old_code),fit_code(current_code)))
}
panel <- read.csv(file.path(input,'paired-observations.csv')); panel$date <- as.Date(panel$date)
origins <- seq(as.Date('2023-09-01'),as.Date('2025-08-01'),by='month'); horizons <- c(1,3,6,12)
dir.create(out,recursive=TRUE); dir.create(file.path(out,'fits'))
file.copy(script,file.path(out,'dynamics-backtest.R')); file.copy(file.path(dirname(script),'models.R'),out)
file.copy(file.path(input,'paired-observations.csv'),out)
writeLines(capture.output(sessionInfo()),file.path(out,'session-info.txt'))
jsonlite::write_json(list(weight=weight,offset=1,base=c('2022-09-01','2023-08-01'),origins=as.character(origins),horizons=horizons,
 training_start='2018-09-01',origin_convention='completed month; cutoff at month end',
 target='100 exp(w log normalized downloads + (1-w) log normalized monthly stars)',
 component_cache_manifest_sha256=if(is.null(cache))NULL else sha(file.path(cache,'manifest.json')),
 ets='additive.only=TRUE, otherwise article AICc settings',
 point='exponentiated log forecast, no mean bias adjustment, no component clipping',
 scope='point forecasts only; no interval coverage claim; exploratory ex-post comparison on frozen revised history',
 input_manifest_sha256=sha(file.path(input,'manifest.json'))),file.path(out,'config.json'),pretty=TRUE,auto_unbox=TRUE)
fit_log <- function(z,dates,model,seed) {
 set.seed(seed); y <- ts(z,frequency=12,start=c(2018,9))
 switch(model,
 SARIMA=forecast::auto.arima(y,seasonal=TRUE,stepwise=TRUE,approximation=FALSE,ic='aicc',method='CSS-ML',test='kpss',seasonal.test='seas',allowmean=TRUE,allowdrift=TRUE),
 ETS=forecast::ets(y,model='ZZZ',additive.only=TRUE,damped=NULL,opt.crit='lik',ic='aicc',bounds='both',allow.multiplicative.trend=FALSE),
 PROPHET=prophet::prophet(data.frame(ds=dates,y=z),growth='linear',n.changepoints=25,changepoint.range=.8,yearly.seasonality=10,weekly.seasonality=FALSE,daily.seasonality=FALSE,seasonality.mode='additive',seasonality.prior.scale=10,changepoint.prior.scale=.05,mcmc.samples=0,uncertainty.samples=0,algorithm=if(length(z)<100)'Newton' else 'LBFGS',seed=seed,verbose=FALSE),
 NAIVE=forecast::naive(y,h=12),SNAIVE=forecast::snaive(y,h=12))
}
predict_log <- function(fit,model,dates) {
 if(model=='PROPHET') return(as.numeric(predict(fit,data.frame(ds=dates))$yhat))
 if(model %in% c('NAIVE','SNAIVE')) return(as.numeric(fit$mean))
 as.numeric(forecast::forecast(fit,h=length(dates))$mean)
}
rows <- list(); statuses <- list(); params <- list(); job <- 0L
for(f in c('React','Angular','Vue')) {
 p <- panel[panel$framework==f,]; p <- p[order(p$date),]
 stopifnot(nrow(p)==96,identical(p$date,seq(as.Date('2018-09-01'),as.Date('2026-08-01'),by='month')))
 base <- p$date>=as.Date('2022-09-01') & p$date<=as.Date('2023-08-01')
 zd <- log((p$downloads+1)/(mean(p$downloads[base])+1)); zs <- log((p$stars+1)/(mean(p$stars[base])+1)); zi <- weight*zd+(1-weight)*zs
 for(oi in seq_along(origins)) {
 origin <- origins[oi]; train <- which(p$date<=origin); future <- seq(origin,by='month',length.out=13)[-1]; target <- match(future,p$date)
 stopifnot(length(train)>=36,all(is.finite(target)),max(p$date[base])<origin)
 for(model in model_names) {
 preds <- list()
 for(component in c('index','downloads','stars')) {
 job <- job+1L; seed <- 20261108L+job; z <- switch(component,index=zi,downloads=zd,stars=zs)
 id <- paste(f,origin,model,component,sep='_'); warnings <- character(); messages <- character()
 reused <- !is.null(cache) && component!='index'
 result <- if(reused) {
  saved <- readRDS(file.path(cache,'fits',paste0(id,'.rds')))
  stopifnot(saved$status=='ok',saved$identity$seed==seed,saved$identity$n_train==length(train),
    saved$identity$origin==as.character(origin),saved$identity$framework==f,
    saved$identity$model==model,saved$identity$component==component)
  warnings <- saved$warnings; messages <- saved$messages
  saved
 } else tryCatch(withCallingHandlers({
 fit <- fit_log(z[train],p$date[train],model,seed)
 meta <- candidate_metadata(fit,model)
 if(is.finite(meta$convergence_code) && meta$convergence_code!=0) stop('Optimizer did not converge')
 pred <- predict_log(fit,model,future); stopifnot(length(pred)==12,all(is.finite(pred)))
 list(status='ok',fit=fit,prediction=pred,metadata=meta)
 },warning=function(w){warnings <<- c(warnings,conditionMessage(w));invokeRestart('muffleWarning')},message=function(m){messages <<- c(messages,conditionMessage(m));invokeRestart('muffleMessage')}),error=function(e)list(status='failed',error=conditionMessage(e)))
 result$identity <- list(framework=f,origin=as.character(origin),model=model,component=component,seed=seed,n_train=length(train),train_start=as.character(p$date[1]),scale='log normalized ratio')
 result$warnings <- warnings; result$messages <- messages; saveRDS(result,file.path(out,'fits',paste0(id,'.rds')))
 statuses[[id]] <- data.frame(job=id,status=result$status,reused=reused,error=if(is.null(result$error))'' else result$error,warnings=paste(warnings,collapse=' | '))
 if(result$status=='ok') {
 preds[[component]] <- result$prediction
 par <- parameter_table(result$fit,model); par$scale <- 'log normalized ratio (Prophet parameters internally scaled; see RDS)'
 params[[id]] <- cbind(job=id,par)
 }
 }
 if(length(preds)==3) {
 for(route in c('direct','components')) {
 predicted <- if(route=='direct')preds$index else weight*preds$downloads+(1-weight)*preds$stars
 rows[[length(rows)+1]] <- data.frame(framework=f,origin=origin,model=model,route=route,horizon=1:12,date=future,actual=100*exp(zi[target]),point=100*exp(predicted),actual_log=zi[target],point_log=predicted)
 }
 if(model %in% c('NAIVE','SNAIVE')) stopifnot(max(abs(preds$index-weight*preds$downloads-(1-weight)*preds$stars))<1e-10)
 }
 }
 cat(sprintf('%s %s: %d / 1080 fits\n',f,origin,job));flush.console()
 }
}
write.csv(do.call(rbind,statuses),file.path(out,'fit-status.csv'),row.names=FALSE)
write.csv(do.call(rbind,params),file.path(out,'parameters.csv'),row.names=FALSE)
d <- do.call(rbind,rows); stopifnot(all(is.finite(d$point)),all(d$point>0))
write.csv(d,file.path(out,'predictions.csv'),row.names=FALSE)
if(any(vapply(statuses,function(s)s$status!='ok',logical(1)))) stop('Failed fits; inspect status. No rankings produced.')
e <- d[d$horizon %in% horizons,]; scores <- do.call(rbind,lapply(split(e,list(e$framework,e$model,e$route,e$horizon),drop=TRUE),function(x){
 stopifnot(nrow(x)==24); err <- x$point-x$actual; le <- x$point_log-x$actual_log
 data.frame(framework=x$framework[1],model=x$model[1],route=x$route[1],horizon=x$horizon[1],n=24,mae=mean(abs(err)),rmse=sqrt(mean(err^2)),wape_pct=100*sum(abs(err))/sum(x$actual),log_mae=mean(abs(le)))
}))
write.csv(scores,file.path(out,'scores.csv'),row.names=FALSE)
comparison <- do.call(rbind,lapply(split(e,list(e$framework,e$model,e$horizon),drop=TRUE),function(x){
 a<-x[x$route=='direct',];b<-x[x$route=='components',];stopifnot(identical(a$origin,b$origin))
 delta<-abs(b$point-b$actual)-abs(a$point-a$actual)
 data.frame(framework=a$framework[1],model=a$model[1],horizon=a$horizon[1],components_wins=sum(delta< -1e-9),ties=sum(abs(delta)<=1e-9),direct_wins=sum(delta>1e-9),mean_ae_components_minus_direct=mean(delta),median_ae_difference=median(delta))
}))
write.csv(comparison,file.path(out,'origin-comparison.csv'),row.names=FALSE)
files<-list.files(out,recursive=TRUE);jsonlite::write_json(list(status='complete',fits=job,files=data.frame(path=files,sha256=vapply(file.path(out,files),sha,character(1)))),file.path(out,'manifest.json'),pretty=TRUE,auto_unbox=TRUE)
cat('COMPLETE\n')
