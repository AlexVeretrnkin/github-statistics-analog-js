import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  type RepositoryLabelAnalysisItem,
  type RepositoryLabelAnalysisResponse,
} from '../../core/github-statistics.models';

@Component({
  selector: 'app-label-analysis',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './label-analysis.html',
  styleUrl: './label-analysis.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelAnalysisComponent {
  readonly analysis = input<RepositoryLabelAnalysisResponse | null>(null);

  protected readonly technicalDebtLabels = computed(() =>
    (this.analysis()?.labels ?? []).filter((label) => label.primary_category === 'technical_debt'),
  );

  protected readonly hasEmergentCategories = computed(
    () => (this.analysis()?.emergent_categories.length ?? 0) > 0,
  );

  protected readonly trackLabelAnalysis = (
    _index: number,
    item: RepositoryLabelAnalysisItem,
  ) => item.label_name;
}
