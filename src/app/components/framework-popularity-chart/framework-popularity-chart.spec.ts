import { TestBed } from '@angular/core/testing';
import { FrameworkPopularityChartComponent } from './framework-popularity-chart';

it('anchors a forecast to its saved training value when newer observations exist', () => {
  const fixture = TestBed.createComponent(FrameworkPopularityChartComponent);
  fixture.componentRef.setInput('series', [{
    framework: 'React', points: [{ date: '2026-07', value: 999 }, { date: '2026-10', value: 500 }],
  }]);
  const forecast = {
    framework: 'React', model: 'ARIMA', isBest: true, validationRmse: 1,
    originDate: '2026-07', originValue: 100,
    points: [{ date: '2026-08', mean: 120, lo80: 90, hi80: 150, lo95: 80, hi95: 170 }],
  };
  fixture.componentRef.setInput('forecasts', [forecast]);
  const data = fixture.componentInstance['chartData']();
  const path = data.datasets.find(dataset => dataset.label?.endsWith('forecast'))!;
  expect(data.labels).toEqual(['2026-07', '2026-08', '2026-10']);
  expect(path.data).toEqual([100, 120, null]);
  fixture.componentRef.setInput('forecasts', [{ ...forecast, originValue: null }]);
  expect(fixture.componentInstance['chartData']().datasets.find(dataset => dataset.label?.endsWith('forecast'))?.data)
    .toEqual([null, 120, null]);
});
