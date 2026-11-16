import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import catalog from '../../../core/article-results-2026-11.json';

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
