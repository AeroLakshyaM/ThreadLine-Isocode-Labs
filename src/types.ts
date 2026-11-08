export type Role = 'merchandiser' | 'supervisor' | 'buyer' | 'admin'
export type Risk = 'green' | 'amber' | 'red' | 'insufficient'
export interface OrderStage {
  id: string
  name: string
  sequence: number
  targetQuantity: number | null
  targetDate?: string
  lines: { id: string; name: string }[]
}
export interface OrderMilestone {
  name: string
  date: string
  status: string
  buyerVisible: boolean
}

export interface Order {
  id: string
  po: string
  buyerId?: string
  unitId?: string
  buyer: string
  unit: string
  style: string
  colour: string
  quantity: number
  zeroReason?: string
  blocked?: boolean
  completed: number
  stage: string
  shipDate: string
  updatedAt: string
  issue?: string
  latestUpdateId?: string
  latestAudioPath?: string
  recentDailyOutput: number
  workdaysLeft: number
  status: Risk
  freshness: 'Fresh' | 'Stale' | 'No update'
  state?: 'draft' | 'released' | 'complete' | 'cancelled'
  buyerVisible?: boolean
  stageOptions?: OrderStage[]
  milestones?: OrderMilestone[]
  buyerSafeRemarks?: { text: string; date: string }[]
  riskPolicyApproved?: boolean
}

export interface PendingUpdate {
  clientId: string
  previewOnly?: boolean
  orderId: string
  stageId: string
  stage: string
  lineId?: string
  line: string
  reportingDate: string
  quantity: number
  zeroReason?: string
  blocked: boolean
  issue: string
  createdAt: string
  syncState: 'saved locally' | 'waiting to sync' | 'syncing' | 'synced' | 'sync failed'
}
