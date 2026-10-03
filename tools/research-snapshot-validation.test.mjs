import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSeries } from './research-snapshot-validation.mjs';

function fixture() {
  return {
    daily: Array.from({ length: 31 }, (_, i) => ({ package: 'react', date: `2026-01-${String(i + 1).padStart(2, '0')}`, downloads: '2' })),
    monthly: [{ package: 'react', period: '2026-01-01', downloads: '62' }],
  };
}
function check({ daily, monthly }) { return validateSeries(daily, monthly, 'package', 'downloads', ['react'], '2026-02-01'); }
test('accepts complete observations and exact monthly totals', () => assert.equal(check(fixture()).coverage[0].dailyRows, 31));
test('rejects missing day', () => { const f = fixture(); f.daily.splice(5, 1); assert.throws(() => check(f), /missing daily/); });
test('rejects duplicate day', () => { const f = fixture(); f.daily[5] = f.daily[4]; assert.throws(() => check(f), /duplicate/); });
test('rejects incorrect monthly sum', () => { const f = fixture(); f.monthly[0].downloads = '61'; assert.throws(() => check(f), /differs/); });
test('rejects incomplete final month', () => { const f = fixture(); f.daily.pop(); f.monthly[0].downloads = '60'; assert.throws(() => check(f), /incomplete final/); });
test('rejects negative count', () => { const f = fixture(); f.daily[0].downloads = '-1'; assert.throws(() => check(f), /invalid count/); });
test('rejects cutoff month', () => { const f = fixture(); f.monthly[0].period = '2026-02-01'; assert.throws(() => check(f), /invalid monthly/); });
test('rejects missing series', () => { const f = fixture(); f.monthly = []; assert.throws(() => check(f), /missing series/); });
test('rejects duplicate month', () => { const f = fixture(); f.monthly.push(f.monthly[0]); assert.throws(() => check(f), /duplicate monthly/); });
test('rejects invalid daily date', () => { const f = fixture(); f.daily[0].date = 'not-a-date'; assert.throws(() => check(f), /invalid daily date/); });
test('rejects unexpected daily series', () => { const f = fixture(); f.daily.push({ ...f.daily[0], package: 'other' }); assert.throws(() => check(f), /daily series/); });
