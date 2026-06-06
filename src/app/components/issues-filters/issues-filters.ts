import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  type FormControl,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import {
  type AnalyzedRepositoryListItem,
  type CategoryPresetOption,
  type IssuesFilters,
  type LabelComparisonSet,
  type LabelResearchCategory,
  type RepositoryLabel,
} from '../../core/github-statistics.models';

@Component({
  selector: 'app-issues-filters',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './issues-filters.html',
  styleUrl: './issues-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuesFiltersComponent {
  readonly analyzedRepositories = input<AnalyzedRepositoryListItem[]>([]);
  readonly categoryPresets = input<CategoryPresetOption[]>([]);
  readonly initialFilters = input.required<IssuesFilters>();
  readonly labelOptions = input<RepositoryLabel[]>([]);
  readonly loadingLabels = input(false);
  readonly loadingStats = input(false);

  readonly applyFilters = output<IssuesFilters>();
  readonly addCategoryPreset = output<CategoryPresetOption>();
  readonly loadLabels = output<{ owner: string; repo: string }>();

  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly labelSearch = signal<Record<string, string>>({});
  protected readonly monthOptions = this.buildMonthOptions(84);
  protected readonly filtersForm = this.buildFiltersForm();

  constructor() {
    effect(() => {
      this.syncForm(this.initialFilters());
    });
  }

  protected submit(): void {
    if (this.filtersForm.invalid) {
      this.filtersForm.markAllAsTouched();
      return;
    }

    const rawValue = this.filtersForm.getRawValue();

    this.applyFilters.emit({
      ...rawValue,
      comparisonSets: rawValue.comparisonSets.map((comparisonSet) => ({
        ...comparisonSet,
        category: comparisonSet.category ?? undefined,
        owner: comparisonSet.owner.trim() || undefined,
        repo: comparisonSet.repo.trim() || undefined,
        name: comparisonSet.name.trim() || undefined,
      })),
    });
  }

  protected requestLabels(): void {
    const { owner, repo } = this.filtersForm.getRawValue();

    if (!owner?.trim() || !repo?.trim()) {
      this.filtersForm.controls.owner.markAsTouched();
      this.filtersForm.controls.repo.markAsTouched();
      return;
    }

    this.loadLabels.emit({
      owner: owner.trim(),
      repo: repo.trim(),
    });
  }

  protected addComparisonSet(): void {
    this.comparisonSets.push(this.createComparisonSetGroup());
  }

  protected addRepositoryComparisonSet(): void {
    this.comparisonSets.push(
      this.createComparisonSetGroup({
        id: this.createComparisonSetId(),
        labels: [],
        name: 'All issues',
        source: 'manual',
      }),
    );
  }

  protected selectAnalyzedRepository(setIndex: number, repositoryKey: string): void {
    const [owner, repo] = repositoryKey.split('/');

    if (!owner || !repo) {
      return;
    }

    const comparisonSet = this.comparisonSets.at(setIndex);

    comparisonSet.patchValue({
      owner,
      repo,
    });

    if (!comparisonSet.controls.name.value.trim()) {
      comparisonSet.controls.name.setValue('All issues');
    }
  }

  protected selectCategoryPreset(category: LabelResearchCategory): void {
    const preset = this.categoryPresets().find((item) => item.category === category);

    if (!preset) {
      return;
    }

    this.addCategoryPreset.emit(preset);
  }

  protected removeComparisonSet(index: number): void {
    if (this.comparisonSets.length === 1) {
      return;
    }

    const comparisonSet = this.comparisonSets.at(index).getRawValue();

    this.comparisonSets.removeAt(index);
    this.updateLabelSearch(comparisonSet.id, '');
  }

  protected getLabelSearch(setId: string): string {
    return this.labelSearch()[setId] ?? '';
  }

  protected updateLabelSearch(setId: string, value: string): void {
    this.labelSearch.update((state) => ({
      ...state,
      [setId]: value,
    }));
  }

  protected getFilteredLabelOptions(setIndex: number): RepositoryLabel[] {
    const comparisonSet = this.comparisonSets.at(setIndex);
    const setId = comparisonSet.controls.id.value;
    const selectedLabels = new Set(comparisonSet.controls.labels.value);
    const search = this.getLabelSearch(setId).trim().toLowerCase();

    return this.labelOptions().filter((label) => {
      if (selectedLabels.has(label.name)) {
        return false;
      }

      if (!search) {
        return true;
      }

      return (
        label.name.toLowerCase().includes(search) ||
        label.description?.toLowerCase().includes(search)
      );
    });
  }

  protected addLabel(setIndex: number, labelName: string): void {
    const labelsControl = this.comparisonSets.at(setIndex).controls.labels;
    const currentLabels = labelsControl.value;

    if (currentLabels?.includes(labelName)) {
      this.updateLabelSearch(this.comparisonSets.at(setIndex).controls.id.value, '');
      return;
    }

    labelsControl.setValue([...currentLabels, labelName]);
    this.updateLabelSearch(this.comparisonSets.at(setIndex).controls.id.value, '');
  }

  protected removeLabel(setIndex: number, labelName: string): void {
    const labelsControl = this.comparisonSets.at(setIndex).controls.labels;

    labelsControl.setValue(
      labelsControl.value.filter((label) => label !== labelName),
    );
  }

  protected getSetTitle(index: number): string {
    return this.comparisonSets.at(index).controls.name.value || `Set ${index + 1}`;
  }

  protected getSetRepositoryName(index: number): string {
    const comparisonSet = this.comparisonSets.at(index);
    const owner = comparisonSet.controls.owner.value.trim() || this.filtersForm.controls.owner.value;
    const repo = comparisonSet.controls.repo.value.trim() || this.filtersForm.controls.repo.value;

    return owner && repo ? `${owner}/${repo}` : 'Default repository';
  }

  protected readonly availableCategoryPresets = computed(() => {
    const usedCategories = new Set(
      this.comparisonSets.controls
        .map((control) => control.controls.category.value)
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    );

    return this.categoryPresets().filter((preset) => !usedCategories.has(preset.category));
  });

  protected readonly displayLabelName = (value: string | null): string => value ?? '';

  protected get comparisonSets(): FormArray<ComparisonSetGroup> {
    return this.filtersForm.controls.comparisonSets;
  }

  private buildFiltersForm(): FiltersFormGroup {
    return this.formBuilder.group({
      owner: this.formBuilder.control('', Validators.required),
      repo: this.formBuilder.control('', Validators.required),
      from: this.formBuilder.control('', Validators.required),
      to: this.formBuilder.control('', Validators.required),
      comparisonSets: this.formBuilder.array([this.createComparisonSetGroup()]),
    });
  }

  private syncForm(filters: IssuesFilters): void {
    this.filtersForm.patchValue(
      {
        owner: filters.owner,
        repo: filters.repo,
        from: filters.from,
        to: filters.to,
      },
      { emitEvent: false },
    );

    this.filtersForm.setControl(
      'comparisonSets',
      this.formBuilder.array(
        filters.comparisonSets.map((comparisonSet) => this.createComparisonSetGroup(comparisonSet)),
      ),
    );
  }

  private createComparisonSetGroup(comparisonSet?: LabelComparisonSet): ComparisonSetGroup {
    return this.formBuilder.group({
      category: this.formBuilder.control(comparisonSet?.category ?? null),
      id: this.formBuilder.control(comparisonSet?.id ?? this.createComparisonSetId()),
      labels: this.formBuilder.control(comparisonSet?.labels ?? []),
      name: this.formBuilder.control(comparisonSet?.name ?? ''),
      owner: this.formBuilder.control(comparisonSet?.owner ?? ''),
      repo: this.formBuilder.control(comparisonSet?.repo ?? ''),
      source: this.formBuilder.control(comparisonSet?.source ?? 'manual'),
    });
  }

  private buildMonthOptions(count: number): MonthOption[] {
    const now = new Date();
    const options: MonthOption[] = [];

    for (let index = 0; index < count; index += 1) {
      const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
      const value = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('en', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(current);

      options.push({ value, label });
    }

    return options;
  }

  private createComparisonSetId(): string {
    return `set-${Math.random().toString(36).slice(2, 10)}`;
  }
}

type FiltersFormGroup = FormGroup<{
  owner: FormControl<string>;
  repo: FormControl<string>;
  from: FormControl<string>;
  to: FormControl<string>;
  comparisonSets: FormArray<ComparisonSetGroup>;
}>;

type ComparisonSetGroup = FormGroup<{
  category: FormControl<LabelResearchCategory | null>;
  id: FormControl<string>;
  labels: FormControl<string[]>;
  name: FormControl<string>;
  owner: FormControl<string>;
  repo: FormControl<string>;
  source: FormControl<'analysis-category' | 'manual'>;
}>;

interface MonthOption {
  value: string;
  label: string;
}
