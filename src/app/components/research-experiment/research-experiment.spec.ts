import { TestBed, DeferBlockBehavior } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import data from '../../../../public/research/article-experiment/results.json';
import { ResearchExperimentComponent } from './research-experiment';

describe('research experiment view', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResearchExperimentComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
    horizon.click(); fixture.detectChanges();
    expect(view.querySelector('[data-testid="accuracy-table"] tbody tr th')?.textContent).toContain('Naive');
    const selector = view.querySelector('select')!;
    selector.value = 'github-stars_Vue'; selector.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(view.querySelector('[data-testid="accuracy-table"] tbody tr th')?.textContent).toContain('ETS');
    const models = Array.from(view.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'PROPHET'))!;
    models.value = 'PROPHET'; models.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(view.querySelector('#diagnostics')?.textContent).toContain('Prophet internal normalized');
    const jump = view.querySelector('a[href="/framework-popularity#diagnostics"]');
    expect(jump).not.toBeNull();
    const originSelector = Array.from(view.querySelectorAll('select')).find(s => s.options.length === 24)!;
    expect(originSelector.options[0].text).toBe('2023-09');
    expect(originSelector.options[23].text).toBe('2025-08');
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
