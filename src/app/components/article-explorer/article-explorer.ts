import { CommonModule, ViewportScroller } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ChangeDetectionStrategy, computed, signal, inject, afterNextRender, Injector } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, registerables, type ChartConfiguration } from 'chart.js';
Chart.register(...registerables);
type Row = Record<string, string | number | boolean | null>;
interface SavedResults { id: string; heldout: Row[]; indexScores: Row[]; indexDirections: Row[]; indexIntervals: Row[]; indexPredictions: Row[]; indexSensitivity: Row[]; }
@Component({ selector:'app-article-explorer', standalone:true, imports:[CommonModule,BaseChartDirective], templateUrl:'./article-explorer.html', styleUrl:'../research-experiment/research-experiment.scss', changeDetection:ChangeDetectionStrategy.OnPush })
export class ArticleExplorerComponent {
  private readonly router=inject(Router);
  private readonly route=inject(ActivatedRoute);
  protected readonly data=signal<SavedResults|null>(null);
  protected readonly error=signal(false);
  protected readonly view=signal('heldout');
  protected readonly framework=signal('all');
  protected readonly metric=signal('github-stars');
  protected readonly model=signal('SARIMA');
  protected readonly horizon=signal('6');
  protected readonly forecastRoute=signal('components');
  protected readonly level=signal('80');
  protected readonly weight=signal(0.5);
  protected readonly radius=signal(0.25);
  protected readonly models=['SARIMA','ETS','PROPHET','NAIVE','SNAIVE'];
  protected readonly frameworks=['React','Angular','Vue'];
  protected readonly views=[['heldout','Forecast vs actual · held-out year'],['index-accuracy','Index · point accuracy'],['index-intervals','Index · interval quality'],['index-directions','Index · direction accuracy'],['index-comparison','Index · direct vs components'],['index-sensitivity','Index · weight sensitivity'],['index-classes','Index · direction classes'],['index-range','Index · weight-range robustness'],['index-forecast','Index · forecast vs actual']];
  protected readonly selectedFrameworks=computed(()=>this.framework()==='all'?this.frameworks:[this.framework()]);
  private includes(row:Row):boolean {return this.selectedFrameworks().includes(String(row['framework'])) && (this.horizon()==='all'||Number(row['horizon'])===Number(this.horizon()));}
  protected readonly columns=computed(()=>{
    switch(this.view()) {
      case 'heldout':return ['Framework','Month','Observed','SARIMA','Naive','80% lower','80% upper'];
      case 'index-accuracy':return ['Framework','h','Model','Route','MAE','RMSE','WAPE %'];
      case 'index-intervals':return ['Framework','h','Model','Route','Level %','Covered / 24','Mean width','Interval score'];
      case 'index-directions':return ['Framework','h','Model','Route','Direction hits / 24','WAPE %'];
      case 'index-comparison':return ['Framework','h','Optimal fit','WAPE − naive (pp)','SARIMA C − D','ETS C − D','Prophet C − D','Selected direction hits','Naive hits','Last-direction hits'];
      case 'index-classes':return ['Framework','Same component direction','Opposite, robust over range','Opposite, weight-sensitive'];
      case 'index-range':return ['Half-width around 0.5','Robust opposing-direction months','All opposing-direction months'];
      case 'index-forecast':return ['Framework','Origin','Target','Actual','Forecast','Lower','Upper'];
      default:return ['Framework','Month','Downloads YoY %','Stars YoY %','Index YoY %','Zero-growth weight','Robust over selected range'];
    }
  });
  protected readonly rows=computed<(string|number|boolean|null)[][]>(()=>{
    const d=this.data();if(!d)return [];
    const f=(r:Row)=>this.includes(r);
    const model=(r:Row)=>this.model()==='all'||r['model']===this.model();
    const route=(r:Row)=>(this.forecastRoute()==='all'&&['direct','components'].includes(String(r['route'])))||r['route']===this.forecastRoute();
    const prefix=(r:Row)=>[r['framework'],r['horizon'],r['model'],r['route']];
    if(this.view()==='heldout')return d.heldout.filter(r=>r['metric']===this.metric()&&this.selectedFrameworks().includes(String(r['framework']))).map(r=>[r['framework'],r['date'],r['observed'],r['sarima'],r['persistence'],r['lo80'],r['hi80']]);
    if(this.view()==='index-accuracy')return d.indexScores.filter(r=>f(r)&&model(r)&&route(r)).map(r=>[...prefix(r),r['mae'],r['rmse'],r['wape_pct']]);
    if(this.view()==='index-intervals')return d.indexIntervals.filter(r=>f(r)&&model(r)&&route(r)&&r['block']===1&&r['scope']==='all'&&[80,95].includes(Number(r['level']))).map(r=>[...prefix(r),r['level'],r['covered'],r['mean_width'],r['mean_interval_score']]);
    if(this.view()==='index-directions')return d.indexDirections.filter(r=>f(r)&&model(r)&&route(r)).map(r=>[...prefix(r),r['direction_hits'],r['wape_pct']]);
    if(this.view()==='index-comparison') {
      const rows:(string|number|boolean|null)[][]=[];
      for(const framework of this.selectedFrameworks()) for(const h of [1,3,6,12]) {
        if(this.horizon()!=='all'&&Number(this.horizon())!==h)continue;
        const scores=d.indexDirections.filter(r=>r['framework']===framework&&r['horizon']===h);
        const eligible=scores.filter(r=>!['NAIVE','SNAIVE'].includes(String(r['model']))&&model(r)&&route(r)).sort((a,b)=>Number(a['wape_pct'])-Number(b['wape_pct']));
        if(!eligible.length)continue;
        const best=eligible[0],naive=scores.find(r=>r['model']==='NAIVE'&&r['route']==='direct');
        rows.push([framework,h,String(best['model'])+' '+(best['route']==='components'?'C':'D'),best['wape_minus_naive_pp'],...['SARIMA','ETS','PROPHET'].map(m=>scores.find(r=>r['model']===m&&r['route']==='components')?.['components_minus_direct_pp']??null),best['direction_hits'],naive?.['direction_hits']??null,best['last_direction_hits']]);
      }
      return rows;
    }
    if(this.view()==='index-forecast')return d.indexPredictions.filter(r=>f(r)&&model(r)&&route(r)&&r['block']===1).map(r=>[r['framework'],r['origin'],r['date'],r['actual'],r['point'],r['lo'+this.level()],r['hi'+this.level()]]);
    const sensitivity=d.indexSensitivity.filter(r=>this.selectedFrameworks().includes(String(r['framework'])));
    const robust=(r:Row,radius:number)=>{const a=Number(r['log_change_downloads']),b=Number(r['log_change_stars']);return Math.sign((.5-radius)*a+(.5+radius)*b)===Math.sign((.5+radius)*a+(.5-radius)*b);};
    if(this.view()==='index-classes')return this.selectedFrameworks().map(fr=>{const rows=sensitivity.filter(r=>r['framework']===fr);return [fr,rows.filter(r=>!r['component_disagreement']).length,rows.filter(r=>r['component_disagreement']&&robust(r,this.radius())).length,rows.filter(r=>r['component_disagreement']&&!robust(r,this.radius())).length];});
    if(this.view()==='index-range'){const opposing=sensitivity.filter(r=>r['component_disagreement']);return Array.from({length:51},(_,i)=>[i/100,opposing.filter(r=>robust(r,i/100)).length,opposing.length]);}
    return sensitivity.map(r=>[r['framework'],r['date'],r['downloads_yoy_pct'],r['stars_yoy_pct'],100*Math.expm1(this.weight()*Number(r['log_change_downloads'])+(1-this.weight())*Number(r['log_change_stars'])),r['zero_growth_weight'],robust(r,this.radius())]);
  });
  protected readonly chartData=computed<ChartConfiguration<'line'>['data']>(()=>{
    const rows=this.rows(); const datasets: ChartConfiguration<'line'>['data']['datasets']=[];
    const add=(label:string,values:(number|null)[],color:string,dash=false)=>datasets.push({label,data:values,borderColor:color,backgroundColor:color,borderWidth:2,pointRadius:1,borderDash:dash?[5,4]:[]});
    if(this.view()==='index-range'){add('Robust months',rows.map(r=>Number(r[1])),'#087ea4');return {labels:rows.map(r=>String(r[0])),datasets};}
    const dateColumn=this.view()==='index-forecast'?2:1;
    const labels=[...new Set(rows.map(r=>String(r[dateColumn])))].sort();
    for(const [i,framework] of this.selectedFrameworks().entries()){
      const fr=rows.filter(r=>r[0]===framework); const colors=['#087ea4','#a64913','#25623c'];
      const values=(column:number,log=false)=>labels.map(date=>{const r=fr.find(r=>r[dateColumn]===date);return r?.[column]==null?null:log?Math.log10(Number(r[column])+1):Number(r[column]);});
      if(this.view()==='heldout'){add(framework+' observed',values(2,true),colors[i]);add(framework+' SARIMA',values(3,true),colors[i],true);add(framework+' naive',values(4,true),'#777',true);add(framework+' lower 80%',values(5,true),'#aaa',true);add(framework+' upper 80%',values(6,true),'#aaa',true);}
      else if(this.view()==='index-forecast'){add(framework+' actual',values(3),colors[i]);add(framework+' forecast',values(4),colors[i],true);add(framework+' lower',values(5),'#aaa',true);add(framework+' upper',values(6),'#aaa',true);}
      else add(framework+' index YoY %',values(4),colors[i]);
    }
    return {labels,datasets};
  });
  protected readonly hasChart=computed(()=>['heldout','index-forecast','index-sensitivity','index-range'].includes(this.view()) && (this.view() !== 'index-forecast' || (this.model() !== 'all' && this.horizon() !== 'all' && this.forecastRoute() !== 'all')));
  protected readonly options:ChartConfiguration<'line'>['options']={responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom'}},scales:{x:{ticks:{maxTicksLimit:8}}}};
  protected display(v:string|number|boolean|null):string {return v==null?'—':typeof v==='number'?v.toLocaleString('en-US',{maximumFractionDigits:2}):String(v);}
  protected change(key:string,value:string):void {void this.router.navigate([], {relativeTo:this.route,queryParams:{[key]:value},queryParamsHandling:'merge',fragment:'article-explorer'});}
  constructor(){const scroller=inject(ViewportScroller), injector=inject(Injector);combineLatest([inject(HttpClient).get<SavedResults>('/research/article-experiment/explorer.json'),this.route.queryParamMap,this.route.fragment]).pipe(takeUntilDestroyed()).subscribe({next:([d,p,fragment])=>{
    this.data.set(d);this.error.set(!!p.get('experiment')&&p.get('experiment')!==d.id);
    this.view.set(p.get('view')??'heldout'); this.framework.set(p.get('framework')??'all');this.metric.set(p.get('metric')??'github-stars');this.model.set(p.get('indexModel')??'SARIMA');this.horizon.set(p.get('indexH')??'6');this.forecastRoute.set(p.get('route')??'components');this.level.set(p.get('level')==='95'?'95':'80');
    const w=Number(p.get('weight')??.5),r=Number(p.get('radius')??.25);this.weight.set(Number.isFinite(w)?Math.max(0,Math.min(1,w)):.5);this.radius.set(Number.isFinite(r)?Math.max(0,Math.min(.5,r)):.25);
    if(fragment==='article-explorer')afterNextRender(()=>scroller.scrollToAnchor(fragment),{injector});
  },error:()=>this.error.set(true)});}
}
