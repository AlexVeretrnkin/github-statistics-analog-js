export interface LabelComparisonSet {
  category?: LabelResearchCategory;
  id: string;
  labels: string[];
  name?: string;
  source?: 'analysis-category' | 'manual';
}

export interface IssuesFilters {
  owner: string;
  repo: string;
  from: string;
  to: string;
  comparisonSets: LabelComparisonSet[];
}

export interface RepositorySummary {
  id: string;
  name: string;
  owner: string;
}

export interface MonthlyIssuePoint {
  month: string;
  total: number;
  open: number;
  closed: number;
}

export interface IssuesTimeseriesResponse {
  from: string;
  to: string;
  repository: RepositorySummary;
  labels: string[];
  months: MonthlyIssuePoint[];
}

export interface ComparisonSeries {
  id: string;
  name: string;
  color: string;
  labels: RepositoryLabel[];
  months: MonthlyIssuePoint[];
}

export interface RepositoryLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

export interface RepositoryLabelsResponse {
  repository: RepositorySummary;
  totalCount: number;
  labels: RepositoryLabel[];
}

export type LabelResearchCategory =
  | 'technical_debt'
  | 'bug_fixing'
  | 'feature_work'
  | 'documentation'
  | 'maintenance'
  | 'testing_quality'
  | 'performance'
  | 'security'
  | 'developer_experience'
  | 'infra_devops'
  | 'community_support'
  | 'other';

export interface LabelEmergentCategory {
  name: string;
  reason: string;
}

export interface RepositoryLabelAnalysisItem {
  confidence: number;
  label_name: string;
  primary_category: LabelResearchCategory;
  reason: string;
  secondary_categories: LabelResearchCategory[];
  suggested_category: string;
}

export interface RepositoryLabelAnalysisResponse {
  emergent_categories: LabelEmergentCategory[];
  labels: RepositoryLabelAnalysisItem[];
  model: string;
  prompt_version: string;
  provider: 'gemini';
  repository: RepositorySummary;
}

export interface AnalyzedRepositoryListItem {
  analyzedAt: string;
  model: string;
  owner: string;
  promptVersion: string;
  provider: string;
  repo: string;
  repositoryId: string;
}

export interface CategoryPresetOption {
  category: LabelResearchCategory;
  labelCount: number;
  labels: string[];
  name: string;
}
