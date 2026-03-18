import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { type RepositoryLabel } from '../../core/github-statistics.models';

export interface SelectedLabelSetView {
  id: string;
  name: string;
  accentColor: string;
  labels: RepositoryLabel[];
}

@Component({
  selector: 'app-selected-labels',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './selected-labels.html',
  styleUrl: './selected-labels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectedLabelsComponent {
  readonly sets = input<SelectedLabelSetView[]>([]);
}
