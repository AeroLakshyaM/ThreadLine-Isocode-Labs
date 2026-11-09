import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Order, OrderMilestone, OrderStage, Role } from './types'

type OrderRow = {
  id: string; buyer_id: string; unit_id: string; po_number: string; style: string; colour: string; total_quantity: number; ex_factory_date: string; released_at:string|null; buyer_visible: boolean; state: 'draft'|'released'|'complete'|'cancelled'
  buyers: { name: string } | { name: string }[] | null
  production_units?: { id: string; name: string; timezone: string; working_days: number[] } | { id: string; name: string; timezone: string; working_days: number[] }[] | null
  order_stages?: { id: string; stage_name: string; sequence_no: number; applicable: boolean; target_quantity: number | null; tna_milestone_name:string|null; stage_line_assignments: { line_id: string; production_lines: { id: string; name: string } | { id: string; name: string }[] | null }[] }[]
  production_updates?: { id: string; stage_id: string; quantity: number; reporting_date: string; received_at: string; issue_text: string | null; audio_path: string | null; is_blocked:boolean }[]
  order_milestones?: { id:string; name: string; target_date: string; status: string; buyer_visible: boolean; sequence_no: number }[]
}
type RiskConfigRow = { unit_id: string; recent_workdays: number; amber_required_rate_ratio: number; red_required_rate_ratio: number; stale_after_hours: number; provisional: boolean; approved_at: string | null }

const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value

export async function loadProfile(user: User): Promise<{ role: Role; displayName: string; buyerName: string }> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('profiles').select('role,display_name,active').eq('id', user.id).single()
  if (error || !data || !data.active) throw new Error('This account has no active Threadline profile. Ask an administrator to provision access.')
  let buyerName = ''
  if (data.role === 'buyer') {
    const { data: access } = await supabase.from('buyer_user_access').select('buyers(name)').eq('user_id', user.id).maybeSingle()
    const buyer = access?.buyers as { name: string } | { name: string }[] | null | undefined
    buyerName = one(buyer)?.name ?? ''
    if (!buyerName) throw new Error('This buyer account is not linked to an authorised buyer. Ask your administrator for access.')
  }
  return { role: data.role as Role, displayName: data.display_name as string, buyerName }
}

export async function loadOrders(role: Role): Promise<Order[]> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const states = role === 'merchandiser' || role === 'admin' ? ['draft','released','complete'] : role === 'buyer' ? ['released','complete'] : ['released']
  const select = role === 'buyer'
    ? 'id,buyer_id,unit_id,po_number,style,colour,total_quantity,ex_factory_date,released_at,buyer_visible,state,buyers(name),order_milestones(id,name,target_date,status,buyer_visible,sequence_no)'
    : 'id,buyer_id,unit_id,po_number,style,colour,total_quantity,ex_factory_date,released_at,buyer_visible,state,buyers(name),production_units(id,name,timezone,working_days),order_stages(id,stage_name,sequence_no,applicable,target_quantity,tna_milestone_name,stage_line_assignments(line_id,production_lines(id,name))),order_milestones(id,name,target_date,status,buyer_visible,sequence_no),production_updates(id,stage_id,quantity,reporting_date,received_at,issue_text,audio_path,is_blocked)'
  const { data, error } = await supabase.from('purchase_orders').select(select).in('state', states).order('ex_factory_date')
  if (error) throw new Error(`Could not load orders: ${error.message}`)
  const rows = (data ?? []) as unknown as OrderRow[]
  const unitIds = [...new Set(rows.map(row => one(row.production_units ?? null)?.id).filter((id): id is string => Boolean(id)))]
  const { data: riskRows } = unitIds.length ? await supabase.from('risk_configuration').select('unit_id,recent_workdays,amber_required_rate_ratio,red_required_rate_ratio,stale_after_hours,provisional,approved_at').in('unit_id', unitIds).eq('provisional', false).not('approved_at','is',null) : { data: [] }
  const approvedConfig = new Map<string,RiskConfigRow>()
  for (const config of (riskRows ?? []) as unknown as RiskConfigRow[]) approvedConfig.set(config.unit_id, config)
  const todayKey = dateInZone(new Date(), 'Asia/Kolkata')
  const recentStart = new Date(`${todayKey}T00:00:00`)
  recentStart.setDate(recentStart.getDate()-21)
  const holidayResult = unitIds.length ? await supabase.from('unit_holidays').select('unit_id,holiday_date').in('unit_id',unitIds).gte('holiday_date',dateKey(recentStart)).lte('holiday_date',rows.map(row=>row.ex_factory_date).sort().at(-1) ?? todayKey) : { data: [] }
  const holidaysByUnit = new Map<string,Set<string>>()
  for (const holiday of holidayResult.data ?? []) {
    const dates = holidaysByUnit.get(holiday.unit_id) ?? new Set<string>(); dates.add(holiday.holiday_date); holidaysByUnit.set(holiday.unit_id,dates)
  }
  const output: Order[] = []

  for (const row of rows) {
    const unit = one(row.production_units ?? null)
    const buyer = one(row.buyers)
    const stages = (row.order_stages ?? []).filter(stage => stage.applicable).sort((a,b) => a.sequence_no - b.sequence_no)
    const milestones: OrderMilestone[] = (row.order_milestones ?? []).filter(milestone => role !== 'buyer' || milestone.buyer_visible).sort((a,b)=>a.sequence_no-b.sequence_no).map(milestone => ({ id:milestone.id, name: milestone.name, date: milestone.target_date, status: milestone.status as OrderMilestone['status'], buyerVisible: milestone.buyer_visible }))
    const stageOptions: OrderStage[] = stages.map(stage => ({ id: stage.id, name: stage.stage_name, sequence: stage.sequence_no, targetQuantity: stage.target_quantity, targetDate: milestones.find(milestone=>milestone.name===stage.tna_milestone_name)?.date, lines: (stage.stage_line_assignments ?? []).map(assignment => one(assignment.production_lines)).filter((line): line is {id:string;name:string} => Boolean(line)) }))
    const updates = row.production_updates ?? []
    let completed = 0
    let stageName = row.state === 'draft' ? 'Draft' : stages[0]?.stage_name ?? 'Production planning'
    let recentDailyOutput = 0
    let workdaysLeft = 0
    let status: Order['status'] = 'insufficient'
    let updatedAt = '—'
    let freshness: Order['freshness'] = 'No update'
    let buyerSafeRemarks: {text:string;date:string}[] = []
    let progressTarget: number | undefined
    const latestUpdate = [...updates].sort((a,b) => b.received_at.localeCompare(a.received_at))[0]
    const latestIssueUpdate = [...updates].filter(update => update.issue_text || update.audio_path).sort((a,b)=>b.received_at.localeCompare(a.received_at))[0]

    if (role === 'buyer') {
      const { data: buyerViewRaw, error: buyerViewError } = await supabase.rpc('get_buyer_order_progress', { target_order: row.id }).maybeSingle()
      if(buyerViewError)throw new Error(`Could not load buyer-safe order progress: ${buyerViewError.message}`)
      const buyerView = buyerViewRaw as unknown as {reported_quantity:number;current_stage_name:string|null;current_stage_target:number|null;last_update:string|null;buyer_remarks:{text:string;date:string}[]}|null
      completed = buyerView?.reported_quantity ?? 0
      stageName = buyerView?.current_stage_name ?? 'Production planning'
      progressTarget = buyerView?.current_stage_target ?? row.total_quantity
      updatedAt = buyerView?.last_update ? new Date(buyerView.last_update).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
      freshness = buyerView?.last_update ? freshnessFor(buyerView.last_update,24) : 'No update'
      stageName = 'In production'
      buyerSafeRemarks = (buyerView?.buyer_remarks ?? []) as {text:string;date:string}[]
    } else if (latestUpdate) {
      const latestStage = stages.find(stage => stage.id === latestUpdate.stage_id)
      stageName = latestStage?.stage_name ?? stageName
      progressTarget = latestStage?.target_quantity ?? row.total_quantity
      completed = updates.filter(update => update.stage_id === latestUpdate.stage_id).reduce((sum, update) => sum + update.quantity, 0)
      updatedAt = new Date(latestUpdate.received_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      const unitConfig = unit ? approvedConfig.get(unit.id) : undefined
      freshness = unitConfig ? freshnessFor(latestUpdate.received_at, unitConfig.stale_after_hours) : freshnessFor(latestUpdate.received_at,24)
      if (unitConfig && unit) {
        const holidays = holidaysByUnit.get(unit.id) ?? new Set<string>()
        const candidates = stages.map(stage => {
          const stageUpdates = updates.filter(update => update.stage_id === stage.id)
          const cumulative = stageUpdates.reduce((sum, update) => sum + update.quantity, 0)
          const target = stage.target_quantity
          const deadline = stageOptions.find(option=>option.id===stage.id)?.targetDate ?? row.ex_factory_date
          const daysLeft = countWorkdays(todayKey, deadline, unit.working_days, holidays)
          const startKey = subtractWorkdays(todayKey, unitConfig.recent_workdays, unit.working_days, holidays)
          const periodOutput = stageUpdates.filter(update=>update.reporting_date>=startKey&&update.reporting_date<=todayKey).reduce((sum,update)=>sum+update.quantity,0)
          const periodDays = countWorkdays(startKey, todayKey, unit.working_days, holidays)
          const rate = periodDays ? periodOutput/periodDays : 0
          const risk = target === null || !daysLeft || !rate ? 'insufficient' as const : classifyRisk(Math.max(0,target-cumulative)/daysLeft/rate,unitConfig)
          return {stage,risk,cumulative,daysLeft,rate}
        })
        const severity = {green:0,insufficient:0,amber:1,red:2}
        candidates.sort((a,b)=>severity[b.risk]-severity[a.risk]||a.stage.sequence_no-b.stage.sequence_no)
        const driver = candidates[0]
        if (driver) { status=driver.risk; stageName=driver.stage.stage_name; completed=driver.cumulative; progressTarget=driver.stage.target_quantity??row.total_quantity; recentDailyOutput=Math.round(driver.rate); workdaysLeft=driver.daysLeft }
      }
    }

    output.push({
      id: row.id, buyerId: row.buyer_id, unitId: row.unit_id, po: row.po_number, buyer: buyer?.name ?? 'Buyer', unit: unit?.name ?? 'Production unit', style: row.style, colour: row.colour,
      quantity: row.total_quantity, completed: Math.min(completed, progressTarget??row.total_quantity), progressTarget, stage: stageName, shipDate: row.ex_factory_date, releaseDate:row.released_at??undefined, updatedAt,
      recentDailyOutput, workdaysLeft, status, freshness, stageOptions, state: row.state, milestones,
      issue: role === 'buyer' ? undefined : latestIssueUpdate?.issue_text ?? undefined, latestUpdateId: role === 'buyer' ? undefined : latestIssueUpdate?.id, latestAudioPath: role === 'buyer' ? undefined : latestIssueUpdate?.audio_path ?? undefined,
      buyerSafeRemarks, riskPolicyApproved: role !== 'buyer' && Boolean(unit && approvedConfig.get(unit.id)),
      blocked: role!=='buyer'&&Boolean(latestUpdate?.is_blocked)
    })
  }
  return output
}

function freshnessFor(timestamp: string, staleAfterHours: number): Order['freshness'] {
  const ageHours = (Date.now() - new Date(timestamp).getTime()) / 3600000
  return ageHours <= staleAfterHours ? 'Fresh' : 'Stale'
}
function classifyRisk(ratio: number, config: RiskConfigRow): Order['status'] {
  if (ratio > config.red_required_rate_ratio) return 'red'
  if (ratio > config.amber_required_rate_ratio) return 'amber'
  return 'green'
}
function countWorkdays(startKey: string, endKey: string, workingDays: number[], holidays: Set<string>) {
  if (!workingDays.length || endKey <= startKey) return 0
  let count = 0
  const day = new Date(`${startKey}T00:00:00`)
  day.setDate(day.getDate()+1)
  const end = new Date(`${endKey}T00:00:00`)
  while (day <= end) { const key=dateKey(day); if (workingDays.includes(day.getDay())&&!holidays.has(key)) count += 1; day.setDate(day.getDate() + 1) }
  return count
}
function subtractWorkdays(todayKey:string, workdays:number, workingDays:number[], holidays:Set<string>) {
  const day=new Date(`${todayKey}T00:00:00`);let counted=0
  while(counted<workdays){day.setDate(day.getDate()-1);if(workingDays.includes(day.getDay())&&!holidays.has(dateKey(day)))counted++}
  return dateKey(day)
}
function dateKey(day:Date){return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`}
function dateInZone(day:Date,zone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(day);return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`}
