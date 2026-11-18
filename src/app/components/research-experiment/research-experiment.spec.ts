import { TestBed, DeferBlockBehavior } from '@angular/core/testing';
import { ViewportScroller } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import data from '../../../../public/research/article-experiment/results.json';
import { ResearchExperimentComponent } from './research-experiment';

describe('research experiment view', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResearchExperimentComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
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
    const models = Array.from(view.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'PROPHET'))!;
    models.value = 'PROPHET'; models.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(view.querySelector('#diagnostics')?.textContent).toContain('Prophet internal normalized');
    const jump = view.querySelector('a[href$="#diagnostics"]');
    expect(jump).not.toBeNull();
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

  it('shows a failure state instead of presenting empty results as successful research', () => {
    const fixture = TestBed.createComponent(ResearchExperimentComponent);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/research/article-experiment/results.json').flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    http.verify();
  });
});
