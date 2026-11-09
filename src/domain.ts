export type WeeklyUpdateInput = {
  order_id: string
  stage_id: string
  quantity: number
  reporting_date: string
}

export type WeeklyOrderInput = {
  id: string
  po: string
  style: string
  colour: string
  quantity: number
  completed: number
  progressTarget?: number
  currentStage?: string
  shipDate: string
  status: 'green' | 'amber' | 'red' | 'insufficient'
  stageOptions?: { id: string; name: string; sequence: number }[]
  milestones?: { name: string; date: string; status: string; buyerVisible: boolean }[]
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || !Number.isInteger(days)) {
    throw new Error('Expected a YYYY-MM-DD date and a whole-number day offset.')
  }
  const [year, month, day] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.toISOString().slice(0, 10) !== dateOnly) throw new Error('The date is not valid.')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function orderProgressPercent(completed: number, target: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(target) || target <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(completed / target * 100)))
}

export function buildWeeklyReportSnapshot(
  orders: WeeklyOrderInput[],
  updates: WeeklyUpdateInput[],
  weekStart: string,
  weekEnd: string,
) {
  const stageOutput = new Map<string, Map<string, number>>()
  for (const update of updates) {
    if (update.reporting_date < weekStart || update.reporting_date > weekEnd) continue
    const perOrder = stageOutput.get(update.order_id) ?? new Map<string, number>()
    perOrder.set(update.stage_id, (perOrder.get(update.stage_id) ?? 0) + update.quantity)
    stageOutput.set(update.order_id, perOrder)
  }

  return orders.map(order => {
    const byStage = stageOutput.get(order.id) ?? new Map<string, number>()
    const stages = [...byStage.entries()]
      .map(([stageId, quantity]) => ({
        name: order.stageOptions?.find(stage => stage.id === stageId)?.name ?? 'Other stage',
        sequence: order.stageOptions?.find(stage => stage.id === stageId)?.sequence ?? Number.MAX_SAFE_INTEGER,
        quantity,
      }))
      .sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name))
      .map(({ name, quantity }) => ({ name, quantity }))
    const status = order.status === 'insufficient' ? 'Update pending'
      : order.status === 'green' ? 'On track'
      : order.status === 'amber' ? 'Watch' : 'At risk'
    return {
      orderId: order.id,
      po: order.po,
      style: order.style,
      colour: order.colour,
      quantity: order.quantity,
      currentStage: order.currentStage ?? 'Production',
      progressTarget: order.progressTarget ?? order.quantity,
      currentProgress: order.completed,
      remaining: Math.max(0, (order.progressTarget ?? order.quantity) - order.completed),
      progressPercent: orderProgressPercent(order.completed, order.progressTarget ?? order.quantity),
      exFactory: order.shipDate,
      statusAtExport: status,
      stageOutputs: stages,
      buyerVisibleMilestones: (order.milestones ?? [])
        .filter(milestone => milestone.buyerVisible)
        .map(({ name, date, status: milestoneStatus }) => ({ name, date, status: milestoneStatus })),
    }
  })
}
