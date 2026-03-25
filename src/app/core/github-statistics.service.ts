import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import {
  type AnalyzedRepositoryListItem,
  type RepositoryLabelAnalysisResponse,
  type IssuesTimeseriesResponse,
  type RepositoryLabelsResponse,
} from './github-statistics.models';

export interface IssuesTimeseriesRequest {
  owner: string;
  repo: string;
  from: string;
  to: string;
  labels: string[];
}

@Injectable({
  providedIn: 'root',
})
export class GithubStatisticsService {
  private readonly http = inject(HttpClient);

  getIssuesTimeseries(filters: IssuesTimeseriesRequest) {
    let params = new HttpParams()
      .set('owner', filters.owner)
      .set('repo', filters.repo)
      .set('from', filters.from)
      .set('to', filters.to);

    if (filters.labels.length) {
      params = params.set('labels', filters.labels.join(','));
    }

    return this.http.get<IssuesTimeseriesResponse>('/api/v1/issues', { params });
  }

  getRepositoryLabels(owner: string, repo: string) {
    const params = new HttpParams()
      .set('owner', owner)
      .set('repo', repo);

    return this.http.get<RepositoryLabelsResponse>('/api/v1/labels', { params });
  }

  analyzeRepositoryLabels(owner: string, repo: string, refresh = false) {
    let params = new HttpParams()
      .set('owner', owner)
      .set('repo', repo);

    if (refresh) {
      params = params.set('refresh', 'true');
    }

    return this.http.get<RepositoryLabelAnalysisResponse>('/api/v1/labels/analyze', { params });
  }

  getAnalyzedRepositories() {
    return this.http.get<AnalyzedRepositoryListItem[]>('/api/v1/analysis/repositories');
  }

  getAnalyzedRepositoryDetails(owner: string, repo: string) {
    return this.http.get<RepositoryLabelAnalysisResponse>(
      `/api/v1/analysis/repositories/${owner}/${repo}`,
    );
  }
}
