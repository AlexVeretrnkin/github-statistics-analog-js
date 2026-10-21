export type FrameworkName = 'React' | 'Angular' | 'Vue';

export type FrameworkPopularityMetricId =
  | 'google-trends'
  | 'npm-downloads'
  | 'github-stars';

export type FrameworkPopularityScale = 'absolute' | 'index-100' | 'log-10';
export type FrameworkForecastModel = 'ARIMA' | 'ETS' | 'PROPHET';
export type FrameworkForecastMode = 'best' | FrameworkForecastModel | 'off';

export interface FrameworkPopularityPoint {
  date: string;
  value: number;
}

export interface FrameworkPopularitySeries {
  framework: FrameworkName;
  points: FrameworkPopularityPoint[];
}

export interface FrameworkForecastPoint {
  date: string;
  hi80: number;
  hi95: number;
  lo80: number;
  lo95: number;
  mean: number;
}

export interface FrameworkForecastSeries {
  framework: FrameworkName;
  isBest: boolean;
  model: FrameworkForecastModel;
  points: FrameworkForecastPoint[];
  validationRmse: number;
}

export interface FrameworkPopularityMetric {
  description: string;
  id: FrameworkPopularityMetricId;
  label: string;
  methodology: string;
  sourceLabel: string;
  unit: string;
  forecasts: FrameworkForecastSeries[];
  series: FrameworkPopularitySeries[];
}

export interface FrameworkPopularityDiagnostic {
  arimaPValue: number | null;
  etsPValue: number | null;
  framework: FrameworkName;
  metric: FrameworkPopularityMetricId;
}

export type FrameworkRetrospectiveEvidence = 'frozen' | 'reconstructed' | 'operational';

export interface FrameworkRetrospectivePoint {
  date: string;
  forecast: number;
  hi80: number;
  lo80: number;
  observed: number | null;
}

export interface FrameworkRetrospectiveStatistics {
  coverage80: number | null;
  evaluatedMonths: number;
  mae: number | null;
  meanError: number | null;
  rmse: number | null;
  wape: number | null;
}

export interface FrameworkRetrospectiveSeries {
  framework: FrameworkName;
  model: FrameworkForecastModel;
  points: FrameworkRetrospectivePoint[];
  statistics: FrameworkRetrospectiveStatistics;
}

export interface FrameworkRetrospectiveStudy {
  description: string;
  evidence: FrameworkRetrospectiveEvidence;
  evaluationEnd: string;
  evaluationStart: string;
  metric: FrameworkPopularityMetricId;
  note: string;
  originDate: string;
  scale: 'linear' | 'logarithmic';
  series: FrameworkRetrospectiveSeries[];
  title: string;
  unit: string;
}

export interface FrameworkPopularityResearch {
  diagnostics: FrameworkPopularityDiagnostic[];
  generatedAt: string;
  metrics: FrameworkPopularityMetric[];
  provenanceNotes: string[];
  retrospectives: FrameworkRetrospectiveStudy[];
}
