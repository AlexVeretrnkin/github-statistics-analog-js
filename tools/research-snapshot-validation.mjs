export function validateSeries(daily, monthly, key, value, expected, cutoff) {
  if (JSON.stringify([...new Set(daily.map(r => r[key]))].sort()) !== JSON.stringify(expected)) {
    throw new Error(`${key}: unexpected or missing daily series.`);
  }
  if (JSON.stringify([...new Set(monthly.map(r => r[key]))].sort()) !== JSON.stringify(expected)) {
    throw new Error(`${key}: unexpected or missing series.`);
  }
  const sums = new Map();
  const coverage = [];
  for (const id of expected) {
    const rows = daily.filter(r => r[key] === id);
    if (!rows.length) throw new Error(`${id}: missing daily observations.`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date))
        || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date >= cutoff) {
        throw new Error(`${id}: invalid daily date.`);
      }
      if (!/^\d+$/.test(row[value])) throw new Error(`${id}: invalid count.`);
      if (i && Date.parse(row.date) - Date.parse(rows[i - 1].date) !== 86400000) {
        throw new Error(`${id}: duplicate or missing daily date.`);
      }
      const month = `${row.date.slice(0, 7)}-01`;
      const bucket = `${id}|${month}`;
      sums.set(bucket, (sums.get(bucket) ?? 0n) + BigInt(row[value]));
    }
    const months = monthly.filter(r => r[key] === id);
    if (new Set(months.map(r => r.period)).size !== months.length) {
      throw new Error(`${id}: duplicate monthly date.`);
    }
    const first = rows[0].date;
    const last = rows.at(-1).date;
    for (const row of months) {
      if (!/^\d+$/.test(row[value]) || row.period >= cutoff || !row.period.endsWith('-01')) {
        throw new Error(`${id}: invalid monthly observation.`);
      }
      if (sums.get(`${id}|${row.period}`) !== BigInt(row[value])) {
        throw new Error(`${id}: monthly count differs from daily sum.`);
      }
      const monthEnd = new Date(`${row.period}T00:00:00Z`);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
      if (monthEnd.toISOString().slice(0, 10) > last) {
        throw new Error(`${id}: incomplete final source month.`);
      }
    }
    if (months.length !== [...sums.keys()].filter(k => k.startsWith(`${id}|`)).length) {
      throw new Error(`${id}: missing or extra canonical monthly row.`);
    }
    coverage.push({ series: id, firstDate: first, lastDate: last, dailyRows: rows.length,
      monthlyRows: months.length, initialMonthStartsMidMonth: !first.endsWith('-01') });
  }
  return { key, checks: 'unique gap-free daily dates; integer counts; monthly sums and coverage; completed final months', coverage };
}
