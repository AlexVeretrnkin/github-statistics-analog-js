export interface LabelComparisonSet {
  id: string;
  labels: string[];
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
