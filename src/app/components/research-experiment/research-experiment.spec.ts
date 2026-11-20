import { TestBed, DeferBlockBehavior } from '@angular/core/testing';
import { ViewportScroller } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { articleResultLinks } from '../../core/article-result-links';
import explorerData from '../../../../public/research/article-experiment/explorer.json';
import data from '../../../../public/research/article-experiment/results.json';
import { ResearchExperimentComponent } from './research-experiment';

describe('research experiment view', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResearchExperimentComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
    vi.spyOn(TestBed.inject(ViewportScroller), 'scrollToAnchor').mockImplementation(() => {});
  });

  it('switches horizons, series and saved model parameters without refitting', async () => {
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading the verified');
    http.expectOne('/research/article-experiment/results.json').flush(data);
    fixture.detectChanges();
    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('[data-testid="accuracy-table"] tbody tr th')?.textContent).toContain('SARIMA');
    const horizon = Array.from(view.querySelectorAll('button')).find(b => b.textContent?.trim() === '1m')!;
    horizon.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(view.querySelector('[data-testid="accuracy-table"] tbody tr th')?.textContent).toContain('Naive');
    const selector = view.querySelector('select')!;
    selector.value = 'github-stars_Vue'; selector.dispatchEvent(new Event('change')); await fixture.whenStable(); fixture.detectChanges();
    expect(view.querySelector('[data-testid="accuracy-table"] tbody tr th')?.textContent).toContain('ETS');
    await TestBed.inject(Router).navigate([], { queryParamsHandling: 'preserve', fragment: 'diagnostics' });
    fixture.detectChanges(); await fixture.whenStable();
    expect(view.querySelector('#comparison')).toBeNull();
    const models = Array.from(view.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'PROPHET'))!;
    models.value = 'PROPHET'; models.dispatchEvent(new Event('change')); await fixture.whenStable(); fixture.detectChanges();
    expect(view.querySelector('#diagnostics')?.textContent).toContain('Prophet internal normalized');
    const jump = view.querySelector('a[href$="#diagnostics"]');
    expect(jump).not.toBeNull();
    await TestBed.inject(Router).navigate([], { queryParamsHandling: 'preserve', fragment: 'stability' });
    fixture.detectChanges(); await fixture.whenStable();
    const originSelector = Array.from(view.querySelectorAll('select')).find(s => s.options.length === 24)!;
    expect(originSelector.options[0].text).toBe('2023-09');
    expect(originSelector.options[23].text).toBe('2025-08');
    http.verify();
  });

  it('opens the linked series and model once the residual plot is rendered', async () => {
    await TestBed.inject(Router).navigateByUrl('/?series=github-stars_Vue&model=ETS#residuals');
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    const scroll = vi.spyOn(TestBed.inject(ViewportScroller), 'scrollToAnchor').mockImplementation(anchor => {
      expect(fixture.nativeElement.querySelector('#' + anchor)?.textContent).toBe('Residuals · Vue · GitHub stars · ETS');
    });
    fixture.detectChanges();
    expect(scroll).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectOne('/research/article-experiment/results.json').flush(data);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(scroll).toHaveBeenCalledWith('residuals');
    expect(fixture.nativeElement.querySelector('#diagnostics select').value).toBe('ETS');
  });

  it('opens S1 with all 20 rows and restores horizon changes through navigation', async () => {
    const router = TestBed.inject(Router);
    const link = '/?experiment=article-experiment-2026-10-18&series=npm-downloads_React&h=all#point-accuracy';
    await router.navigateByUrl(link);
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    const scroll = vi.spyOn(TestBed.inject(ViewportScroller), 'scrollToAnchor');
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/research/article-experiment/results.json').flush(data);
    fixture.detectChanges();
    await fixture.whenStable();
    const rows = () => fixture.nativeElement.querySelectorAll('[data-testid="accuracy-table"] tbody tr');
    expect(rows()).toHaveLength(20);
    expect(rows()[0].textContent).toContain('8.78');
    expect(fixture.nativeElement.querySelector('#point-accuracy').textContent).toContain('millions of downloads');
    expect(scroll).toHaveBeenCalledWith('point-accuracy');
    const button = [...fixture.nativeElement.querySelectorAll('button')].find(b => b.textContent.trim() === '3m');
    button.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(router.url).toContain('h=3');
    expect(rows()).toHaveLength(5);
    await router.navigateByUrl(link); fixture.detectChanges(); await fixture.whenStable();
    expect(rows()).toHaveLength(20);
    await router.navigateByUrl('/?experiment=unknown#point-accuracy'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Experiment version unavailable');
  });

  it('restores all three residual models for every article series and keeps their data and bands separate', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?experiment=' + data.id + '&series=npm-downloads_React&model=all#residuals');
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/research/article-experiment/results.json').flush(data);
    for (const series of data.series) {
      await router.navigateByUrl('/?experiment=' + data.id + '&series=' + series.id + '&model=all#residuals');
      fixture.detectChanges(); await fixture.whenStable();
      const view: HTMLElement = fixture.nativeElement;
      expect(view.querySelector('#comparison')).toBeNull();
      expect(view.querySelector('#residuals')?.textContent).toContain(series.framework);
      expect(Array.from(view.querySelectorAll('.residual-panel')).map(p => p.getAttribute('data-model'))).toEqual(['SARIMA', 'ETS', 'PROPHET']);
      for (const panel of fixture.componentInstance['residualPanels']()) {
        const saved = series.residuals.filter(r => r.model === panel.model);
        expect(panel.residualData.datasets[0].data).toEqual(saved.map(r => r.residual));
        expect(panel.acfData.datasets[0].data).toEqual(series.acf.filter(r => r.model === panel.model && r.lag > 0).map(r => r.acf));
        expect(panel.histogramData.datasets[0].data.reduce((sum, count) => Number(sum) + Number(count), 0)).toBe(saved.filter(r => r.residual !== null && Number.isFinite(r.residual)).length);
        expect(panel.band).toBeCloseTo(1.96 / Math.sqrt(series.diagnostics.find(d => d.model === panel.model)!.n_residuals));
      }
    }
    const selection: HTMLSelectElement = fixture.nativeElement.querySelector('label select[value="all"]') ?? fixture.nativeElement.querySelector('#residuals + label select');
    selection.value = 'ETS'; selection.dispatchEvent(new Event('change')); await fixture.whenStable(); fixture.detectChanges();
    expect(router.url).toContain('model=ETS');
    expect(fixture.nativeElement.querySelectorAll('.residual-panel')).toHaveLength(1);
    await router.navigateByUrl('/?series=github-stars_Vue&model=all#residuals'); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.residual-panel')).toHaveLength(3);
  });

  it('reveals linked collapsed tables and restores the section when navigating back', async () => {
    const router = TestBed.inject(Router);
    const link = '/?experiment=' + data.id + '&series=npm-downloads_React&h=all#interval-accuracy';
    await router.navigateByUrl(link);
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/research/article-experiment/results.json').flush(data);
    fixture.detectChanges(); await fixture.whenStable();
    const table = fixture.nativeElement.querySelector('#interval-accuracy') as HTMLDetailsElement;
    expect(table.open).toBe(true);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20);
    table.open = false; fixture.detectChanges();
    expect(table.open).toBe(false);
    await router.navigateByUrl('/?series=github-stars_Angular&model=all#residuals'); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#interval-accuracy')).toBeNull();
    await router.navigateByUrl(link); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#interval-accuracy').open).toBe(true);
    await router.navigateByUrl('/?model=ETS#parameter-estimates'); fixture.detectChanges(); await fixture.whenStable();
    const parameters = fixture.nativeElement.querySelector('#parameter-estimates');
    expect(parameters.open).toBe(true);
    expect(parameters.parentElement.closest('details').open).toBe(true);
  });

  it('reveals the correct section and nonempty table for every published article preset', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/research/article-experiment/results.json').flush(data);
    for (const preset of Object.values(articleResultLinks)) {
      await router.navigateByUrl('/?' + new URLSearchParams(preset.queryParams) + '#' + preset.fragment);
      fixture.detectChanges();
      for (const request of http.match('/research/article-experiment/explorer.json')) request.flush(explorerData);
      fixture.detectChanges(); await fixture.whenStable();
      const target = fixture.nativeElement.querySelector('#' + preset.fragment) as HTMLElement;
      expect(target, preset.fragment).not.toBeNull();
      expect(target.querySelectorAll('tbody tr').length, JSON.stringify(preset)).toBeGreaterThan(0);
      const disclosure = target instanceof HTMLDetailsElement ? target : target.querySelector('details.result-table');
      expect((disclosure as HTMLDetailsElement).open).toBe(true);
      if (preset.queryParams['series']) expect(fixture.componentInstance['seriesId']()).toBe(preset.queryParams['series']);
      expect(fixture.nativeElement.querySelectorAll('.section-nav [aria-current="page"]')).toHaveLength(1);
    }
    http.verify();
  });

  it('shows a failure state instead of presenting empty results as successful research', () => {
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/research/article-experiment/results.json').flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    http.verify();
  });
});
