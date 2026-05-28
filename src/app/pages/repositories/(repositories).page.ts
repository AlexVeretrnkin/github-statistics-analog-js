import { CommonModule, DatePipe } from '@angular/common';
import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';

import { type AnalyzedRepositoryListItem } from '../../core/github-statistics.models';

@Component({
  standalone: true,
  imports: [CommonModule, DatePipe, MatCardModule, RouterLink],
  templateUrl: './(repositories).page.html',
  styleUrl: './(repositories).page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class RepositoriesPageComponent {
  // readonly load = toSignal(injectLoad<typeof serverLoad>());
  readonly load = input.required<any>();

  protected readonly repositories = computed<AnalyzedRepositoryListItem[]>(() =>
    this.load()?.repositories ?? [],
  );
}
