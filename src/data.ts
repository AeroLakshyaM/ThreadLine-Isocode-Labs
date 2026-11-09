import type { Order } from './types'

// Preview mode starts empty. Add approved synthetic records through a reviewed fixture.
export const previewOrders: Order[] = []

export const moneyless = (value: number) => new Intl.NumberFormat('en-IN').format(value)

export function calculateRisk(order: Pick<Order, 'quantity' | 'completed' | 'recentDailyOutput' | 'workdaysLeft'>): Order['status'] {
  if (order.recentDailyOutput <= 0 || order.workdaysLeft <= 0) return 'insufficient'
  const remaining = Math.max(0, order.quantity - order.completed)
  const requiredPerDay = remaining / order.workdaysLeft
  const ratio = requiredPerDay / order.recentDailyOutput
  // Illustrative preview defaults only. Company A must approve production thresholds.
  if (ratio > 1.35) return 'red'
  if (ratio > 1.05) return 'amber'
  return 'green'
}
