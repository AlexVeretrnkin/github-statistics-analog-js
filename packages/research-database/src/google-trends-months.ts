interface WeeklyInterest {
  framework: string;
  date: string;
  interest: number;
}

/** Monthly means retain the existing week-start convention, using fully covered months. */
export function googleTrendsCompletedMonths(
  rows: WeeklyInterest[],
  completedMonthBefore: string,
  completeWeeksThrough?: string,
): Array<{ framework: string; period: string; interest: number }> {
  const byFramework = new Map<string, WeeklyInterest[]>();
  for (const row of rows) {
    const group = byFramework.get(row.framework) ?? [];
    group.push(row);
    byFramework.set(row.framework, group);
  }
  const result: Array<{ framework: string; period: string; interest: number }> = [];
  for (const [framework, observations] of byFramework) {
    observations.sort((a, b) => a.date.localeCompare(b.date));
    const first = observations[0].date;
    const last = observations.at(-1)!.date;
    // Legacy collections have no partial-week flag. A following weekly marker
    // confirms the previous week, while the final week stays unverified.
    const coveredBefore = completeWeeksThrough ? addDays(completeWeeksThrough, 1) : last;
    const values = new Map(observations.map(row => [row.date, row.interest]));
    const periods = [...new Set(observations.map(row => row.date.slice(0, 7) + '-01'))];
    for (const period of periods) {
      const next = new Date(period + 'T00:00:00Z');
      next.setUTCMonth(next.getUTCMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      if (period < first || period >= completedMonthBefore || end > coveredBefore) continue;
      const offset = Math.floor((Date.parse(period) - Date.parse(first)) / (7 * 86400000));
      let week = addDays(first, offset * 7);
      let covered = true;
      const monthly: number[] = [];
      while (week < end) {
        if (!values.has(week)) covered = false;
        if (week >= period && values.has(week)) monthly.push(values.get(week)!);
        week = addDays(week, 7);
      }
      if (covered && monthly.length) {
        result.push({ framework, period, interest: monthly.reduce((a, b) => a + b, 0) / monthly.length });
      }
    }
  }
  return result;
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
