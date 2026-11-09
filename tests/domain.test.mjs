import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'

const code = await readFile(new URL('../src/domain.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const source = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('date-only offsets preserve calendar days across month and year boundaries', () => {
  assert.equal(source.addDaysToDateOnly('2026-01-02', -30), '2025-12-03')
  assert.equal(source.addDaysToDateOnly('2026-03-31', 1), '2026-04-01')
})

test('date-only offsets reject malformed dates and fractional offsets', () => {
  assert.throws(() => source.addDaysToDateOnly('2026-02-30', 1))
  assert.throws(() => source.addDaysToDateOnly('2026-03-01', 1.5))
})

test('weekly reports filter by selected week, group by stage and keep buyer-safe fields', () => {
  const orders = [{ id: 'o1', po: 'PO-1', style: 'Style', colour: 'Blue', quantity: 100, completed: 30, progressTarget: 60, currentStage: 'Stitching', shipDate: '2026-12-01', status: 'green', stageOptions: [{ id: 'cut', name: 'Cutting', sequence: 1 }, { id: 'sew', name: 'Stitching', sequence: 2 }], milestones: [{ name: 'Packing', date: '2026-11-20', status: 'upcoming', buyerVisible: true }, { name: 'Internal', date: '2026-11-21', status: 'upcoming', buyerVisible: false }] }]
  const updates = [
    { order_id: 'o1', stage_id: 'cut', quantity: 20, reporting_date: '2026-11-02' },
    { order_id: 'o1', stage_id: 'cut', quantity: 10, reporting_date: '2026-11-08' },
    { order_id: 'o1', stage_id: 'sew', quantity: 25, reporting_date: '2026-11-09' },
  ]
  const firstWeek = source.buildWeeklyReportSnapshot(orders, updates, '2026-11-02', '2026-11-08')
  assert.equal(firstWeek[0].progressPercent, 50)
  assert.equal(firstWeek[0].remaining, 30)
  assert.deepEqual(firstWeek[0].stageOutputs, [{ name: 'Cutting', quantity: 30 }])
  assert.deepEqual(firstWeek[0].buyerVisibleMilestones.map(row => row.name), ['Packing'])
  assert.equal(source.buildWeeklyReportSnapshot(orders, updates, '2026-11-09', '2026-11-15')[0].stageOutputs[0].quantity, 25)
})
