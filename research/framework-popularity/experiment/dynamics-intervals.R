# Conditional residual-bootstrap intervals; paired innovations for components.
# Rscript --vanilla dynamics-intervals.R BACKTEST_DIR NEW_OUTPUT_DIR
args<-commandArgs(TRUE);stopifnot(length(args)==2)
input<-normalizePath(args[1]);out<-args[2];stopifnot(!dir.exists(out))
for(pkg in c('forecast','prophet','jsonlite','digest'))stopifnot(requireNamespace(pkg,quietly=TRUE))
sha<-function(p)digest::digest(file=p,algo='sha256')
m<-jsonlite::read_json(file.path(input,'manifest.json'),simplifyVector=TRUE)
for(i in seq_len(nrow(m$files)))stopifnot(sha(file.path(input,m$files$path[i]))==m$files$sha256[i])
cfg<-jsonlite::read_json(file.path(input,'config.json'));stopifnot(cfg$weight==.5)
panel<-read.csv(file.path(input,'paired-observations.csv'));panel$date<-as.Date(panel$date)
points<-read.csv(file.path(input,'predictions.csv'))
B<-4000L;H<-12L;origins<-as.Date(unlist(cfg$origins));models<-c('SARIMA','ETS','PROPHET','NAIVE','SNAIVE')
script<-normalizePath(sub('^--file=','',commandArgs(FALSE)[startsWith(commandArgs(FALSE),'--file=')][1]))
dir.create(out,recursive=TRUE);dir.create(file.path(out,'audit'))
file.copy(script,out);file.copy(file.path(input,'predictions.csv'),file.path(out,'point-predictions.csv'))
writeLines(capture.output(sessionInfo()),file.path(out,'session-info.txt'))
jsonlite::write_json(list(draws=B,weight=.5,levels=c(.8,.95),blocks=c(1,3),primary_block=1,
 seed=20261109,source_manifest_sha256=sha(file.path(input,'manifest.json')),
 method='centered residual bootstrap, joint month indices; circular blocks; first 12 training residuals discarded',
 conditional='fixed fitted parameters and terminal states; excludes parameter and model selection uncertainty',
 prophet='residual-only additive future noise around fixed forecast; excludes future trend/changepoint uncertainty',
 independence_control='permute complete star simulation columns; identical marginal empirical paths',
 no_calibration='no held-out observations used to build intervals or choose block length'),file.path(out,'config.json'),pretty=TRUE,auto_unbox=TRUE)
# Additive ARIMA and ETS have exact affine innovation responses. Verify against native simulation.
kernel<-function(saved,model) {
 if(model=='PROPHET')return(list(center=saved$prediction,T=diag(H)))
 if(model=='NAIVE')return(list(center=saved$prediction,T=1*(row(diag(H))>=col(diag(H)))))
 if(model=='SNAIVE')return(list(center=saved$prediction,T=diag(H)))
 if(model=='ETS')stopifnot(all(saved$fit$components[c(1,3)] %in% c('A','N')),saved$fit$components[2] %in% c('A','N'))
 sim<-function(e)as.numeric(simulate(saved$fit,nsim=H,innov=e,future=TRUE))
 center<-sim(rep(0,H));T<-sapply(seq_len(H),function(j)sim(diag(H)[,j])-center)
 center_gap<-max(abs(center-saved$prediction))
 test<-sin(seq_len(H))*.17
 stopifnot(max(abs(sim(test)-as.numeric(center+T%*%test)))<1e-7)
 # simulate.Arima and forecast.Arima may initialize conditional states differently.
 # Preserve the frozen point forecast; use simulate only for innovation responses.
 list(center=saved$prediction,T=T,simulation_center_gap=center_gap)
}
get_residuals<-function(saved,model,z,dates) {
 if(model=='PROPHET') {
 fit<-saved$fit;fit$uncertainty.samples<-0L
 return(z-as.numeric(predict(fit,data.frame(ds=dates))$yhat))
 }
 as.numeric(residuals(saved$fit))
}
indices<-function(n,block) {
 starts<-matrix(sample.int(n,ceiling(H/block)*B,replace=TRUE),nrow=ceiling(H/block))
 ans<-matrix(0L,ceiling(H/block)*block,B)
 for(j in seq_len(nrow(starts)))for(k in seq_len(block))ans[(j-1)*block+k,]<-(starts[j,]+k-2L)%%n+1L
 ans[seq_len(H),,drop=FALSE]
}
rows<-list();dependence<-list();job<-0L
for(f in c('React','Angular','Vue')) {
 p<-panel[panel$framework==f,];p<-p[order(p$date),]
 base<-p$date>=as.Date('2022-09-01') & p$date<=as.Date('2023-08-01')
 zd<-log((p$downloads+1)/(mean(p$downloads[base])+1));zs<-log((p$stars+1)/(mean(p$stars[base])+1))
 for(oi in seq_along(origins)) {
 origin<-origins[oi];train<-which(p$date<=origin);future<-seq(origin,by='month',length.out=13)[-1]
 for(model in models) {
 job<-job+1L;id<-paste(f,origin,model,sep='_');seed<-20261109L+job
 saved<-lapply(c('index','downloads','stars'),function(c)readRDS(file.path(input,'fits',paste0(id,'_',c,'.rds'))));names(saved)<-c('index','downloads','stars')
 for(s in saved)stopifnot(s$status=='ok',s$identity$n_train==length(train),s$identity$origin==as.character(origin))
 z<-list(index=(zd[train]+zs[train])/2,downloads=zd[train],stars=zs[train])
 res<-sapply(names(saved),function(c)get_residuals(saved[[c]],model,z[[c]],p$date[train]))
 stopifnot(nrow(res)==length(train))
 valid<-which(seq_len(nrow(res))>12 & apply(is.finite(res),1,all));stopifnot(length(valid)>=36,all(diff(valid)==1))
 res<-res[valid,,drop=FALSE];res<-sweep(res,2,colMeans(res))
 k<-lapply(saved,kernel,model=model)
 dep<-data.frame(framework=f,origin=origin,model=model,n_residuals=nrow(res),correlation=cor(res[,'downloads'],res[,'stars']))
 dependence[[id]]<-dep
 audit<-list(identity=list(framework=f,origin=as.character(origin),model=model,seed=seed),residual_dates=p$date[train][valid],centered_residuals=res,kernels=k,bootstrap=list())
 for(block in c(1L,3L)) {
 set.seed(seed+10000L*block);ix<-indices(nrow(res),block)
 innovations<-lapply(seq_len(3),function(j)matrix(res[,j][ix],H,B));names(innovations)<-names(saved)
 paths<-lapply(names(saved),function(c)k[[c]]$center+k[[c]]$T%*%innovations[[c]]);names(paths)<-names(saved)
 permutation<-sample.int(B)
 sims<-list(direct=paths$index,components=(paths$downloads+paths$stars)/2,components_independent=(paths$downloads+paths$stars[,permutation])/2)
 if(model %in% c('NAIVE','SNAIVE'))stopifnot(max(abs(sims$direct-sims$components))<1e-9)
 # Paired and shuffled component paths have identical marginal samples.
 audit$bootstrap[[as.character(block)]]<-list(indices=ix,independence_permutation=permutation)
 for(route in names(sims)) {
 samples<-100*exp(sims[[route]]);stopifnot(all(is.finite(samples)),all(samples>0))
 q<-t(apply(samples,1,quantile,probs=c(.025,.1,.9,.975),type=7,names=FALSE))
 stopifnot(all(q[,1]<=q[,2]),all(q[,2]<=q[,3]),all(q[,3]<=q[,4]))
 original_route<-if(route=='direct')'direct' else 'components'
 pt<-points[points$framework==f & points$origin==as.character(origin) & points$model==model & points$route==original_route,];pt<-pt[order(pt$horizon),]
 stopifnot(nrow(pt)==12,identical(as.character(future),pt$date))
 rows[[length(rows)+1L]]<-data.frame(framework=f,origin=origin,model=model,route=route,block=block,horizon=1:H,date=future,actual=pt$actual,point=pt$point,lo80=q[,2],hi80=q[,3],lo95=q[,1],hi95=q[,4])
 }
 }
 saveRDS(audit,file.path(out,'audit',paste0(id,'.rds')))
 }
 cat(sprintf('%s %s: %d / 360\n',f,origin,job));flush.console()
 }
}
d<-do.call(rbind,rows);write.csv(d,file.path(out,'interval-predictions.csv'),row.names=FALSE)
write.csv(do.call(rbind,dependence),file.path(out,'residual-dependence.csv'),row.names=FALSE)
scores<-list()
for(block in c(1,3))for(f in c('React','Angular','Vue'))for(model in models)for(route in c('direct','components','components_independent'))for(h in c(1,3,6,12))for(scope in c('all','early','late')) {
 x<-d[d$block==block & d$framework==f & d$model==model & d$route==route & d$horizon==h,]
 if(scope=='early')x<-x[x$origin<=as.Date('2024-08-01'),]
 if(scope=='late')x<-x[x$origin>=as.Date('2024-09-01'),]
 for(level in c(80,95)) {
 lo<-x[[paste0('lo',level)]];hi<-x[[paste0('hi',level)]];alpha<-1-level/100
 width<-hi-lo;score<-width+2/alpha*pmax(lo-x$actual,0)+2/alpha*pmax(x$actual-hi,0)
 scores[[length(scores)+1]]<-data.frame(framework=f,model=model,route=route,block=block,horizon=h,scope=scope,level=level,n=nrow(x),covered=sum(x$actual>=lo & x$actual<=hi),coverage=mean(x$actual>=lo & x$actual<=hi),mean_width=mean(width),mean_interval_score=mean(score),normalized_width_pct=100*sum(width)/sum(x$actual),normalized_interval_score_pct=100*sum(score)/sum(x$actual))
 }
}
write.csv(do.call(rbind,scores),file.path(out,'interval-scores.csv'),row.names=FALSE)
files<-list.files(out,recursive=TRUE);jsonlite::write_json(list(status='complete',jobs=job,files=data.frame(path=files,sha256=vapply(file.path(out,files),sha,character(1)))),file.path(out,'manifest.json'),pretty=TRUE,auto_unbox=TRUE)
cat('COMPLETE\n')
