import type { FrameworkName, FrameworkPopularityPoint } from './framework-popularity.models';

export type ExperimentModel = 'SARIMA' | 'ETS' | 'PROPHET' | 'NAIVE' | 'SNAIVE';
export type ExperimentHorizon = 1 | 3 | 6 | 12;
export interface ExperimentAccuracy {
  model: ExperimentModel; horizon: ExperimentHorizon; n_origins: number;
  mae: number; rmse: number; wape_pct: number;
  absolute_error_sd: number; absolute_error_p10: number; absolute_error_p90: number;
  coverage80: number; coverage95: number; width80: number; width95: number;
  interval_score80: number; interval_score95: number;
}
export interface ExperimentPrediction {
  model: ExperimentModel; origin: string; date: string; horizon: number;
  point: number; actual: number | null; lo80: number; hi80: number; lo95: number; hi95: number;
}
export interface ExperimentFit {
  model: ExperimentModel; origin: string; train_start: string; n_train: number; seed: number;
  specification: string; loglik: number | null; aicc: number | null;
  convergence_code: number | null; optimizer: string;
}
export interface ExperimentParameter {
  model: ExperimentModel; parameter: string; estimate: number; standard_error: number | null;
  lower95: number | null; upper95: number | null; scale: string; interval_method: string;
}
export interface ExperimentDiagnostic {
  model: ExperimentModel; n_residuals: number; lag: number; fitdf: number;
  alpha: number; ljung_box_q: number; p_value: number; interpretation: string;
}
export interface ExperimentSeries {
  id: string; metric: 'npm-downloads' | 'github-stars'; framework: FrameworkName;
  preparation: { start: string; end: string; months: number; raw_months: number;
    excluded_initial_partial: boolean; excluded_leading_zeros: number };
  history: FrameworkPopularityPoint[];
  accuracy: ExperimentAccuracy[];
  stability: { horizon: ExperimentHorizon; model: ExperimentModel; wins: number }[];
  fits: ExperimentFit[]; parameters: ExperimentParameter[]; diagnostics: ExperimentDiagnostic[];
  residuals: { model: ExperimentModel; date: string; residual: number | null; residual_type: string }[];
  acf: { model: ExperimentModel; lag: number; acf: number }[];
  outlook: ExperimentPrediction[]; backtest: ExperimentPrediction[];
}
export interface ResearchExperiment {
  id: string;
  config: { snapshot_as_of: string; source: string; horizons: ExperimentHorizon[]; origins: number;
    min_training_months: number; models: ExperimentModel[]; seed: number; forecast_version: string;
    prophet_version: string; R_version: string; transformation: string; preparation: string };
  status: { fits: number; failed_fits: number };
  sourceFiles: { file: string; sha256: string }[];
  series: ExperimentSeries[];
}
