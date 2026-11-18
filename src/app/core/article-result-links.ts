/** Frozen article presets shared by legacy redirects and PDF generation. */
export const articleResultLinks: Record<string, { queryParams: Record<string, string>; fragment: string }> = {};
for (const metric of ['npm-downloads', 'github-stars']) {
  for (const framework of ['React', 'Angular', 'Vue']) {
    for (const [suffix, fragment] of [['point-errors', 'point-accuracy'], ['intervals', 'interval-accuracy']]) {
      articleResultLinks[`${metric}-${framework.toLowerCase()}-${suffix}`] = {
        queryParams: { experiment: 'article-experiment-2026-10-18', series: `${metric}_${framework}`, h: 'all' }, fragment,
      };
    }
  }
}
articleResultLinks['rmse-by-horizon'] = {
  queryParams: { experiment: 'article-experiment-2026-10-18', h: 'all' }, fragment: 'model-overview',
};

for (const [slug, summary] of Object.entries({ 'data-design': 'coverage', 'rmse-12-months': 'rmse', 'intervals-12-months': 'intervals', 'residual-diagnostics': 'diagnostics', 'full-history-models': 'models', 'sarima-coefficients': 'parameters', 'origin-frequencies': 'stability' })) {
  articleResultLinks[slug] = { queryParams: { experiment: 'article-experiment-2026-10-18', summary, h: summary === 'stability' ? 'all' : '12', model: 'SARIMA' }, fragment: 'research-summary' };
}
for (const metric of ['github-stars','npm-downloads']) {
  articleResultLinks[metric+'-heldout']={queryParams:{experiment:'article-experiment-2026-10-18',view:'heldout',metric,framework:'all',origin:'2025-08',level:'80',scale:'log'},fragment:'article-explorer'};
}
for (const framework of ['React','Angular','Vue']) {
  for (const [suffix,view] of [['point-errors','index-accuracy'],['intervals','index-intervals']]) {
    articleResultLinks[`index-${framework.toLowerCase()}-${suffix}`]={queryParams:{experiment:'article-experiment-2026-10-18',view,framework,indexModel:'all',indexH:'all',route:'all',weight:'0.5',block:'1'},fragment:'article-explorer'};
  }
}
for (const [slug,view] of Object.entries({'index-direction-classes':'index-classes','index-route-comparison':'index-comparison','index-direction-accuracy':'index-directions','index-weight-sensitivity':'index-sensitivity','index-weight-range':'index-range','index-component-sarima-6-months':'index-forecast'})) {
  articleResultLinks[slug]={queryParams:{experiment:'article-experiment-2026-10-18',view,framework:'all',indexModel:view==='index-forecast'?'SARIMA':'all',indexH:view==='index-forecast'?'6':'all',route:view==='index-forecast'?'components':'all',weight:'0.5',radius:'0.25',block:'1',level:'80'},fragment:'article-explorer'};
}
