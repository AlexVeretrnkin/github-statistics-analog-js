import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { type SelectedLabelSetView } from '../../core/github-statistics.models';

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
