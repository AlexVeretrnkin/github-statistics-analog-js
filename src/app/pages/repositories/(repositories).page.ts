import { CommonModule, DatePipe } from '@angular/common';
import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, input, signal } from '@angular/core';
import {injectLoad, LoadResult} from '@analogjs/router';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';

import { type AnalyzedRepositoryListItem } from '../../core/github-statistics.models';
import { GithubStatisticsService } from '../../core/github-statistics.service';
import { load as serverLoad } from './(repositories).server';
import {toSignal} from "@angular/core/rxjs-interop";

@Component({
  standalone: true,
  imports: [CommonModule, DatePipe, MatCardModule, RouterLink],
  template: `
    <section class="archive-page">
      <header class="archive-page__hero">
        <p class="archive-page__eyebrow">Research Archive</p>
        <h1>Analyzed repositories</h1>
        <p class="archive-page__lead">
          Browse repositories that already have saved label analysis results.
        </p>
        <a class="text-blue-600 underline hover:text-blue-800" routerLink="../">Go Back to dashboard</a>
      </header>

      @if (repositories().length > 0) {
        <div class="archive-page__grid">
          @for (repository of repositories(); track repository.repositoryId) {
            <a
              class="archive-page__card-link"
              [routerLink]="['/repositories', repository.owner, repository.repo]"
            >
              <mat-card appearance="outlined" class="archive-page__card p-4">
                <p class="archive-page__repo">{{ repository.owner }}/{{ repository.repo }}</p>
                <p class="archive-page__meta">
                  {{ repository.provider }} · {{ repository.model }}
                </p>
                <p class="archive-page__meta">
                  Analyzed {{ repository.analyzedAt | date: 'medium' }}
                </p>
              </mat-card>
            </a>
          }
        </div>
      } @else {
        <mat-card appearance="outlined" class="archive-page__empty">
          Analyze at least one repository from the dashboard to see it here.
        </mat-card>
      }
    </section>
  `,
  styles: `
    .archive-page {
      min-height: 100dvh;
      padding: 2rem clamp(1rem, 3vw, 2.5rem) 3rem;
      display: grid;
      gap: 1.25rem;
      background:
        radial-gradient(circle at top left, rgba(244, 185, 66, 0.2), transparent 32%),
        radial-gradient(circle at top right, rgba(25, 60, 184, 0.14), transparent 28%),
        linear-gradient(180deg, #f8f5ee 0%, #eef3fb 52%, #ffffff 100%);
    }

    .archive-page__hero {
      max-width: 44rem;
    }

    .archive-page__eyebrow {
      margin: 0 0 0.75rem;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #193cb8;
    }

    .archive-page__hero h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3.2rem);
      line-height: 1;
    }

    .archive-page__lead {
      margin: 1rem 0 0;
      color: #46566e;
      line-height: 1.6;
    }

    .archive-page__grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    }

    .archive-page__card-link {
      text-decoration: none;
      color: inherit;
    }

    .archive-page__card,
    .archive-page__empty {
      border-radius: 1.35rem;
      border-color: rgba(25, 60, 184, 0.14);
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 18px 38px rgba(16, 29, 58, 0.08);
    }

    .archive-page__card {
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .archive-page__card:hover {
      transform: translateY(-2px);
      box-shadow: 0 24px 46px rgba(16, 29, 58, 0.12);
    }

    .archive-page__repo {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
    }

    .archive-page__meta {
      margin: 0.45rem 0 0;
      color: #5c6b81;
    }

    .archive-page__empty {
      padding: 1.2rem;
      color: #5c6b81;
    }
  `,
})
export default class RepositoriesPageComponent {
  private readonly githubStatisticsService = inject(GithubStatisticsService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly load = toSignal(injectLoad<typeof serverLoad>(), { requireSync: true });
  private readonly repositoriesState = signal<AnalyzedRepositoryListItem[]>([]);

  protected readonly repositories = computed<AnalyzedRepositoryListItem[]>(() =>
    this.repositoriesState(),
  );

  constructor() {
    effect(() => {
      console.log('RepositoriesPageComponent loaded', this.load());

      this.load()?.repositories && this.repositoriesState.set(this.load()?.repositories!);
    });

    if (isPlatformBrowser(this.platformId) && !this.load()?.repositories?.length) {
      console.log('Fetching repositories');

      this.githubStatisticsService.getAnalyzedRepositories().subscribe({
        next: (repositories) => {
          this.repositoriesState.set(repositories);
        },
        error: (error) => {
          console.error('Failed to refresh analyzed repositories list', error);
        },
      });
    }
  }
}
