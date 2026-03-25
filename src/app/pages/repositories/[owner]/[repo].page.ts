import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type LoadResult } from '@analogjs/router';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

import {
  type LabelResearchCategory,
  type RepositoryLabelAnalysisItem,
  type RepositoryLabelAnalysisResponse,
} from '../../../core/github-statistics.models';
import { load as serverLoad } from './[repo].server';

interface CategoryGroup {
  category: LabelResearchCategory;
  items: RepositoryLabelAnalysisItem[];
}

@Component({
  standalone: true,
  imports: [CommonModule, MatCardModule, MatExpansionModule, RouterLink],
  template: `
    <section class="analysis-page">
      <a routerLink="/repositories" class="analysis-page__back">← Back to analyzed repositories</a>

      @if (analysis(); as currentAnalysis) {
        <header class="analysis-page__hero">
          <p class="analysis-page__eyebrow">Repository Analysis</p>
          <h1>{{ currentAnalysis.repository.owner }}/{{ currentAnalysis.repository.name }}</h1>
          <p class="analysis-page__lead">
            Grouped label analysis with a focus on technical debt and adjacent categories.
          </p>
        </header>

        <mat-card appearance="outlined" class="analysis-page__summary p-4">
          <p>Provider: {{ currentAnalysis.provider }}</p>
          <p>Model: {{ currentAnalysis.model }}</p>
          <p>Prompt version: {{ currentAnalysis.prompt_version }}</p>
        </mat-card>

        <mat-accordion class="analysis-page__accordion" multi>
          @for (group of groupedCategories(); track group.category) {
            <mat-expansion-panel
              class="analysis-page__panel"
              [expanded]="group.category === 'technical_debt'"
            >
              <mat-expansion-panel-header>
                <mat-panel-title>{{ group.category }}</mat-panel-title>
                <mat-panel-description>{{ group.items.length }} labels</mat-panel-description>
              </mat-expansion-panel-header>

              <div class="analysis-page__category-list">
                @for (item of group.items; track item.label_name) {
                  <article class="analysis-page__label-card">
                    <div class="analysis-page__label-head">
                      <p class="analysis-page__label-name">{{ item.label_name }}</p>
                      <p class="analysis-page__confidence">{{ item.confidence | number: '1.2-2' }}</p>
                    </div>

                    <p class="analysis-page__reason">{{ item.reason }}</p>

                    @if (item.secondary_categories.length > 0) {
                      <p class="analysis-page__meta">
                        Secondary: {{ item.secondary_categories.join(', ') }}
                      </p>
                    }

                    @if (item.suggested_category) {
                      <p class="analysis-page__meta">
                        Suggested category: {{ item.suggested_category }}
                      </p>
                    }
                  </article>
                }
              </div>
            </mat-expansion-panel>
          }
        </mat-accordion>
      }
    </section>
  `,
  styles: `
    .analysis-page {
      min-height: 100dvh;
      padding: 2rem clamp(1rem, 3vw, 2.5rem) 3rem;
      display: grid;
      gap: 1rem;
      background:
        radial-gradient(circle at top left, rgba(244, 185, 66, 0.2), transparent 32%),
        radial-gradient(circle at top right, rgba(25, 60, 184, 0.14), transparent 28%),
        linear-gradient(180deg, #f8f5ee 0%, #eef3fb 52%, #ffffff 100%);
    }

    .analysis-page__back {
      color: #193cb8;
      text-decoration: none;
      font-weight: 700;
      width: fit-content;
    }

    .analysis-page__eyebrow {
      margin: 0 0 0.75rem;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #193cb8;
    }

    .analysis-page__hero h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1;
    }

    .analysis-page__lead {
      margin: 1rem 0 0;
      color: #46566e;
      line-height: 1.6;
    }

    .analysis-page__summary,
    .analysis-page__panel {
      border-radius: 1.35rem;
      border-color: rgba(25, 60, 184, 0.14);
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 18px 38px rgba(16, 29, 58, 0.08);
    }

    .analysis-page__summary p,
    .analysis-page__meta,
    .analysis-page__reason {
      color: #46566e;
    }

    .analysis-page__accordion {
      display: grid;
      gap: 0.85rem;
    }

    .analysis-page__category-list {
      display: grid;
      gap: 0.8rem;
      padding-top: 0.25rem;
    }

    .analysis-page__label-card {
      padding: 0.95rem 1rem;
      border-radius: 1rem;
      border: 1px solid rgba(25, 60, 184, 0.1);
      background: rgba(248, 250, 255, 0.92);
    }

    .analysis-page__label-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: baseline;
    }

    .analysis-page__label-name {
      margin: 0;
      font-weight: 700;
      color: #132033;
    }

    .analysis-page__confidence {
      margin: 0;
      font-weight: 700;
      color: #193cb8;
    }

    .analysis-page__reason {
      margin: 0.55rem 0 0;
    }

    .analysis-page__meta {
      margin: 0.45rem 0 0;
    }
  `,
})
export default class RepositoryAnalysisDetailsPageComponent {
  readonly load = input.required<LoadResult<typeof serverLoad>>();

  protected readonly analysis = computed<RepositoryLabelAnalysisResponse>(
    () => this.load().analysis,
  );

  protected readonly groupedCategories = computed<CategoryGroup[]>(() => {
    const analysis = this.analysis();

    const categoryMap = new Map<LabelResearchCategory, RepositoryLabelAnalysisItem[]>();

    for (const item of analysis.labels) {
      const existingItems = categoryMap.get(item.primary_category) ?? [];
      existingItems.push(item);
      categoryMap.set(item.primary_category, existingItems);
    }

    return [...categoryMap.entries()]
      .map(([category, items]) => ({
        category,
        items: [...items].sort((left, right) => left.label_name.localeCompare(right.label_name)),
      }))
      .sort((left, right) => {
        if (left.category === 'technical_debt') {
          return -1;
        }

        if (right.category === 'technical_debt') {
          return 1;
        }

        return right.items.length - left.items.length || left.category.localeCompare(right.category);
      });
  });
}
