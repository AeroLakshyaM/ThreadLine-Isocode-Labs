import type { Order } from './types'

// Synthetic records are shown only in Preview mode; they are never sent to Supabase.
export const previewOrders: Order[] = [
  { id: 'ord-1', po: 'PO-2481', buyer: 'Northstar Kids', unit: 'Unit 01 · Avinashi', style: 'Ribbed crew sweatshirt', colour: 'Moss / Chalk', quantity: 4800, completed: 2860, stage: 'Stitching', shipDate: '2026-11-24', updatedAt: 'Today, 10:42 AM', issue: 'One line awaiting replacement needles', recentDailyOutput: 345, workdaysLeft: 13, status: 'amber', freshness: 'Fresh', stageOptions: [{id:'stage-demo-1',name:'Stitching',sequence:2,targetQuantity:4800,lines:[{id:'line-demo-a',name:'Line A'},{id:'line-demo-b',name:'Line B'}]}] },
  { id: 'ord-2', po: 'PO-2476', buyer: 'Harbor & Pine', unit: 'Unit 02 · Tiruppur', style: 'Cotton pointelle set', colour: 'Oat', quantity: 3200, completed: 1420, stage: 'Printing', shipDate: '2026-11-18', updatedAt: 'Yesterday, 4:18 PM', issue: 'Print screens delayed from vendor', recentDailyOutput: 190, workdaysLeft: 8, status: 'red', freshness: 'Stale', stageOptions: [{id:'stage-demo-2',name:'Printing',sequence:3,targetQuantity:3200,lines:[{id:'line-demo-c',name:'Line C'}]}] },
  { id: 'ord-3', po: 'PO-2492', buyer: 'Northstar Kids', unit: 'Unit 01 · Avinashi', style: 'Organic cotton polo', colour: 'Cloud blue', quantity: 5600, completed: 3970, stage: 'Quality check', shipDate: '2026-12-02', updatedAt: 'Today, 9:06 AM', recentDailyOutput: 510, workdaysLeft: 19, status: 'green', freshness: 'Fresh' },
  { id: 'ord-4', po: 'PO-2469', buyer: 'Westwind Studio', unit: 'Unit 03 · Palladam', style: 'Fleece jogger', colour: 'Charcoal', quantity: 2400, completed: 860, stage: 'Cutting', shipDate: '2026-11-28', updatedAt: '—', issue: 'First production update is pending', recentDailyOutput: 0, workdaysLeft: 16, status: 'insufficient', freshness: 'No update' },
  { id: 'ord-5', po: 'PO-2501', buyer: 'Harbor & Pine', unit: 'Unit 02 · Tiruppur', style: 'Waffle henley', colour: 'Rust stripe', quantity: 4100, completed: 2500, stage: 'Stitching', shipDate: '2026-12-05', updatedAt: 'Today, 8:51 AM', recentDailyOutput: 420, workdaysLeft: 21, status: 'green', freshness: 'Fresh' },
  { id: 'ord-demo-draft', po: 'DEMO-PO-1001', buyer: 'Northstar Kids', unit: 'Unit 01 · Avinashi', style: 'Interactive demo sweatshirt', colour: 'Sage / Cream', quantity: 1200, completed: 0, stage: 'Draft', shipDate: '2026-12-18', updatedAt: 'Not released', recentDailyOutput: 0, workdaysLeft: 0, status: 'insufficient', freshness: 'No update', state: 'draft', buyerVisible: false }
]

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
