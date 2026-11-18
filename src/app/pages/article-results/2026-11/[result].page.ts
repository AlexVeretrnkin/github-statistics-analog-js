import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import type { RouteMeta } from '@analogjs/router';

import catalog from '../../../core/article-results-2026-11.json';

export const routeMeta: RouteMeta = {
  canActivate: [(route) => route.paramMap.get('result') === 'npm-downloads-react-point-errors'
    ? inject(Router).createUrlTree(['/framework-popularity'], {
        queryParams: { experiment: 'article-experiment-2026-10-18', series: 'npm-downloads_React', h: 'all' },
        fragment: 'point-accuracy',
      })
    : true],
};

interface ArticleResult {
  label: string;
  caption: string;
  columns?: string[];
  rows?: string[][];
  note?: string;
  figure?: boolean;
}

const results = new Map<string, ArticleResult>(Object.entries(catalog));

@Component({
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './result.html',
  styleUrl: './result.scss',
})
export default class ArticleResultPage {
  readonly result = input.required<string>();
  protected readonly entry = computed(() => results.get(this.result()));
  protected readonly asset = computed(() => '/research/article-experiment/2026-11/' + this.result());
}
