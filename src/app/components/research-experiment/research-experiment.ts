import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, type ChartConfiguration, type ChartDataset, type Plugin, registerables } from 'chart.js';
import type { ExperimentHorizon, ExperimentModel, ResearchExperiment } from '../../core/research-experiment.models';

Chart.register(...registerables);
const COLORS: Record<ExperimentModel, string> = {
  SARIMA: '#087ea4', ETS: '#a64913', PROPHET: '#7a4bc2', NAIVE: '#25623c', SNAIVE: '#c12d62',
};

@Component({
  selector: 'app-research-experiment', standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './research-experiment.html', styleUrl: './research-experiment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResearchExperimentComponent {
  protected readonly experiment = signal<ResearchExperiment | null>(null);
  protected readonly error = signal(false);
  protected readonly seriesId = signal('npm-downloads_React');
  protected readonly horizon = signal<ExperimentHorizon>(12);
  protected readonly model = signal<ExperimentModel>('SARIMA');
  protected readonly origin = signal('2025-08-01');
  protected readonly interval = signal<'80' | '95' | 'off'>('80');
  protected readonly logScale = signal(true);
  protected readonly assetRoot = '/research/article-experiment/';
  protected readonly models: ExperimentModel[] = ['SARIMA', 'ETS', 'PROPHET', 'NAIVE', 'SNAIVE'];
  protected readonly horizons: ExperimentHorizon[] = [1, 3, 6, 12];
  protected readonly current = computed(() => this.experiment()?.series.find(s => s.id === this.seriesId()));
  protected readonly accuracy = computed(() => [...(this.current()?.accuracy ?? [])]
    .filter(r => r.horizon === this.horizon()).sort((a, b) => a.rmse - b.rmse));
  protected readonly winner = computed(() => this.accuracy()[0]);
  protected readonly baselineGain = computed(() => {
    const naive = this.accuracy().find(x => x.model === 'NAIVE');
    return naive && this.winner() ? 100 * (1 - this.winner()!.rmse / naive.rmse) : 0;
  });
  protected readonly stability = computed(() => this.current()?.stability.filter(r => r.horizon === this.horizon()) ?? []);
  protected readonly modelFit = computed(() => this.current()?.fits.find(f => f.model === this.model()));
  protected readonly parameters = computed(() => this.current()?.parameters.filter(p => p.model === this.model()) ?? []);
  protected readonly diagnostic = computed(() => this.current()?.diagnostics.find(d => d.model === this.model()));
  protected readonly residuals = computed(() => this.current()?.residuals.filter(r => r.model === this.model()) ?? []);
  protected readonly origins = computed(() => [...new Set(this.current()?.backtest.map(p => p.origin) ?? [])].sort());
  protected readonly originRows = computed(() => this.current()?.backtest.filter(p => p.origin === this.origin() && p.horizon === this.horizon()) ?? []);
  protected readonly overview = computed(() => this.experiment()?.series.map(s => ({
    series: s,
    winners: this.horizons.map(h => [...s.accuracy].filter(r => r.horizon === h).sort((a, b) => a.rmse - b.rmse)[0]),
  })) ?? []);

  protected readonly errorData = computed<ChartConfiguration<'line'>['data']>(() => ({
    labels: this.origins(),
    datasets: this.models.map(model => ({ label: this.label(model), borderColor: COLORS[model],
      backgroundColor: COLORS[model], pointRadius: 2, borderWidth: 1.5,
      data: this.origins().map(origin => {
        const p = this.current()?.backtest.find(p => p.model === model && p.origin === origin && p.horizon === this.horizon());
        return p?.actual != null ? Math.abs(p.actual - p.point) : null;
      }),
    })),
  }));
  protected readonly winData = computed<ChartConfiguration<'bar'>['data']>(() => ({
    labels: this.stability().map(r => this.label(r.model)),
    datasets: [{ label: 'Weighted wins / 24', data: this.stability().map(r => r.wins),
      backgroundColor: this.stability().map(r => COLORS[r.model]) }],
  }));
  protected readonly residualData = computed<ChartConfiguration<'line'>['data']>(() => ({
    labels: this.residuals().map(r => r.date),
    datasets: [{ label: 'Saved-fit residual', data: this.residuals().map(r => r.residual), borderColor: COLORS[this.model()],
      borderWidth: 1, pointRadius: 0 }],
  }));
  protected readonly acfData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const acf = this.current()?.acf.filter(r => r.model === this.model() && r.lag > 0) ?? [];
    return { labels: acf.map(r => r.lag), datasets: [
      { label: 'Residual ACF (lag 0 omitted)', data: acf.map(r => r.acf), backgroundColor: COLORS[this.model()] },
    ] };
  });
  protected readonly histogramData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const values = this.residuals().map(r => r.residual).filter((v): v is number => v !== null && Number.isFinite(v));
    if (!values.length) return { labels: [], datasets: [] };
    const min = Math.min(...values), max = Math.max(...values), width = (max - min || 1) / 15;
    const bins = Array<number>(15).fill(0);
    for (const v of values) bins[Math.min(14, Math.floor((v - min) / width))]++;
    return { labels: bins.map((_, i) => `${this.num(min + i * width)} to ${this.num(min + (i + 1) * width)}`),
      datasets: [{ label: 'Residual count', data: bins, backgroundColor: COLORS[this.model()] }] };
  });
  protected readonly forecastData = computed<ChartConfiguration<'line'>['data']>(() => {
    const observed = this.current()?.history.slice(-36) ?? [];
    const outlook = this.current()?.outlook.filter(p => p.model === this.model()) ?? [];
    const labels = [...observed.map(p => p.date), ...outlook.map(p => p.date)];
    const transform = (v: number) => this.logScale() ? Math.log10(v + 1) : v;
    const blank: (number | null)[] = observed.map(() => null);
    const ds: ChartDataset<'line'>[] = [];
    if (this.interval() !== 'off') {
      ds.push({ label: `${this.interval()}% lower`, data: [...blank, ...outlook.map(p => transform(this.interval() === '80' ? p.lo80 : p.lo95))],
        pointRadius: 0, borderWidth: 0, backgroundColor: 'transparent', borderColor: 'transparent' });
      ds.push({ label: `${this.interval()}% interval`, data: [...blank, ...outlook.map(p => transform(this.interval() === '80' ? p.hi80 : p.hi95))],
        fill: '-1', pointRadius: 0, borderWidth: 0, borderColor: 'transparent', backgroundColor: '#087ea426' });
    }
    ds.push({ label: 'Observed', data: [...observed.map(p => transform(p.value)), ...outlook.map(() => null)],
      pointRadius: 1, borderColor: '#172033', borderWidth: 2 });
    ds.push({ label: `${this.label(this.model())} forecast`, data: [...blank.slice(0, -1), observed.length ? transform(observed.at(-1)!.value) : null, ...outlook.map(p => transform(p.point))],
      pointRadius: 1, borderColor: COLORS[this.model()], borderWidth: 2, borderDash: [5, 4] });
    return { labels, datasets: ds };
  });

  protected readonly lineOptions = this.options('Original count units');
  protected readonly residualOptions = this.options('Model residual units');
  protected readonly forecastOptions = computed(() => this.options(this.logScale() ? 'log₁₀(count + 1)' : 'Original count units'));
  protected readonly barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } } },
  };
  protected readonly acfPlugins: Plugin<'bar'>[] = [{
    id: 'residual-reference-bands',
    afterDatasetsDraw: chart => {
      const y = chart.scales['y'];
      if (!y) return;
      const band = 1.96 / Math.sqrt(this.diagnostic()?.n_residuals ?? 1);
      const { ctx, chartArea } = chart;
      ctx.save(); ctx.strokeStyle = '#526078'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      for (const value of [-band, band]) {
        const pixel = y.getPixelForValue(value);
        ctx.beginPath(); ctx.moveTo(chartArea.left, pixel); ctx.lineTo(chartArea.right, pixel); ctx.stroke();
      }
      ctx.restore();
    },
  }];
  protected readonly acfOptions: ChartConfiguration<'bar'>['options'] = {
    ...this.barOptions, scales: { y: { min: -1, max: 1 }, x: { title: { display: true, text: 'Lag (months)' }, ticks: { maxTicksLimit: 8 } } },
  };

  constructor() {
    inject(HttpClient).get<ResearchExperiment>(`${this.assetRoot}results.json`).pipe(takeUntilDestroyed()).subscribe({
      next: data => this.experiment.set(data), error: () => this.error.set(true),
    });
  }

  protected label(model: ExperimentModel): string {
    return ({ PROPHET: 'Prophet', NAIVE: 'Naive', SNAIVE: 'Seasonal naive', SARIMA: 'SARIMA', ETS: 'ETS' })[model];
  }
  protected num(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', { maximumSignificantDigits: 5 });
  }
  protected percent(value: number): string { return `${this.num(value * 100)}%`; }
  protected modelChange(value: string): void { if (this.models.includes(value as ExperimentModel)) this.model.set(value as ExperimentModel); }
  protected intervalChange(value: string): void { if (value === '80' || value === '95' || value === 'off') this.interval.set(value); }
  protected referenceBand(): string { return this.num(1.96 / Math.sqrt(this.diagnostic()?.n_residuals ?? 1)); }

  private options(unit: string): ChartConfiguration<'line'>['options'] {
    return { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
        y: { title: { display: true, text: unit }, ticks: { callback: v => Number(v).toLocaleString('en-US', { notation: 'compact' }) } } },
    };
  }
}
