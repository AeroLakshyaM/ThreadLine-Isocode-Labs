import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowRight, AudioLines, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronUp, ClipboardList, Clock3, Download, Factory,
  FileSpreadsheet, Filter, ImagePlus, LayoutDashboard, ListFilter, LockKeyhole,
  Menu, MoreHorizontal, PackageCheck, Plus, Radio, Search, Settings2,
  ShieldCheck, ShoppingBag, SlidersHorizontal, TriangleAlert, UserCircle, Users, Wifi, WifiOff, X
} from 'lucide-react'
import { calculateRisk, moneyless, previewOrders } from './data'
import { addDaysToDateOnly, buildWeeklyReportSnapshot, orderProgressPercent, type WeeklyUpdateInput } from './domain'
import { listQueued, saveQueued, setQueuedState, syncQueued } from './offline'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Order, OrderMilestone, OrderStage, PendingUpdate, Role } from './types'
import { loadOrders, loadProfile } from './liveData'
import type { User } from '@supabase/supabase-js'
import { invokeProtectedFunction } from './supabase'

type Page = 'board' | 'orders' | 'issues' | 'photos' | 'reports' | 'production' | 'sync' | 'buyer' | 'workspace' | 'users' | 'profile'
const roleLabels: Record<Role, string> = { merchandiser: 'Merchandiser', supervisor: 'Factory supervisor', buyer: 'Buyer', admin: 'Administrator' }

function App() {
  const [authMode, setAuthMode] = useState<'preview' | 'checking' | 'signedOut' | 'loadingWorkspace' | 'signedIn'>(isSupabaseConfigured ? 'checking' : 'preview')
  const [sessionUser, setSessionUser] = useState<User | null>(null)
  const [profileName, setProfileName] = useState('')
  const [buyerAccount, setBuyerAccount] = useState('Northstar Kids')
  const [workspaceError, setWorkspaceError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [role, setRole] = useState<Role>('merchandiser')
  const [page, setPage] = useState<Page>('board')
  const [orders, setOrders] = useState<Order[]>(previewOrders)
  const [demoPhotos, setDemoPhotos] = useState<{id:string;orderId:string;storage_path:string;approved_for_buyer:boolean;reporting_date:string;po:string;style:string;buyer:string;url:string}[]>([])
  const [updates, setUpdates] = useState<PendingUpdate[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [buyerFilter, setBuyerFilter] = useState('All buyers')
  const [unitFilter, setUnitFilter] = useState('All units')
  const [shipWeekFilter,setShipWeekFilter]=useState('All ship weeks')
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [modal, setModal] = useState<'order' | 'update' | 'plan' | null>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingPasswordRequests,setPendingPasswordRequests]=useState(0)

  useEffect(() => {
    if (!supabase) { setAuthMode('preview'); return }
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setSessionUser(session?.user ?? null)
      setAuthMode(session ? 'loadingWorkspace' : 'signedOut')
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSessionUser(data.session?.user ?? null)
      setAuthMode(data.session ? 'loadingWorkspace' : 'signedOut')
    }).catch(() => { if (active) setAuthMode('signedOut') })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase || !sessionUser) return
    let active = true
    setAuthMode('loadingWorkspace'); setWorkspaceError('')
    void (async () => {
      try {
        const profile = await loadProfile(sessionUser)
        const liveOrders = await loadOrders(profile.role)
        if (!active) return
        setProfileName(profile.displayName); setBuyerAccount(profile.buyerName || 'Northstar Kids'); setRole(profile.role); setOrders(liveOrders)
        setPage(profile.role === 'buyer' ? 'buyer' : profile.role === 'supervisor' ? 'production' : profile.role === 'admin' ? 'workspace' : 'board')
        setAuthMode('signedIn')
      } catch (error) {
        if (!active) return
        setWorkspaceError(error instanceof Error ? error.message : 'Could not load the workspace.')
        setAuthMode('signedIn')
      }
    })()
    return () => { active = false }
  }, [sessionUser])

  useEffect(()=>{
    if(!supabase||authMode!=='signedIn'||role!=='admin'){setPendingPasswordRequests(0);return}
    let active=true
    const refresh=async()=>{const {count,error}=await supabase!.from('password_change_requests').select('id',{count:'exact',head:true}).eq('status','pending');if(active&&!error)setPendingPasswordRequests(count??0)}
    void refresh()
    const timer=window.setInterval(()=>void refresh(),30000)
    return()=>{active=false;window.clearInterval(timer)}
  },[authMode,role])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refreshQueue()
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    if (!supabase || authMode !== 'signedIn' || !online) return
    void listQueued().then(async queue => {
      for (const item of queue.filter(item => !item.update.previewOnly)) {
        try { await setQueuedState(item.update.clientId,'syncing'); await syncQueued(item) } catch { await setQueuedState(item.update.clientId,'sync failed').catch(()=>undefined) }
      }
      await refreshQueue()
    }).catch(() => undefined)
  }, [online, authMode])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function refreshQueue() {
    try {
      const queue = await listQueued()
      setUpdates(queue.map(record => record.update))
    } catch { /* IndexedDB may be unavailable in a restricted browser. */ }
  }

  const filteredOrders = useMemo(() => orders.filter(order => {
    const matchesBuyer = buyerFilter === 'All buyers' || order.buyer === buyerFilter
    const matchesUnit = unitFilter === 'All units' || order.unit.includes(unitFilter)
    const matchesWeek = shipWeekFilter === 'All ship weeks' || weekStartFor(order.shipDate) === shipWeekFilter
    const matchesSearch = !search || `${order.po} ${order.buyer} ${order.style} ${order.colour}`.toLowerCase().includes(search.toLowerCase())
    const buyerScoped = authMode !== 'preview' || role !== 'buyer' || (order.buyer === 'Northstar Kids' && order.state !== 'draft' && order.buyerVisible !== false)
    return matchesBuyer && matchesUnit && matchesWeek && matchesSearch && buyerScoped
  }), [orders, buyerFilter, unitFilter, shipWeekFilter, search, role, authMode])

  const activeOrders=orders.filter(o=>o.state!=='draft'&&o.state!=='cancelled')
  const redCount = activeOrders.filter(o => o.status === 'red').length
  const amberCount = activeOrders.filter(o => o.status === 'amber').length
  const pendingCount = updates.length

  async function signIn(email: string, password: string) {
    if (!supabase) return
    setAuthBusy(true); setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError('Sign-in failed. Check your details or contact your workspace administrator.')
    setAuthBusy(false)
  }
  function startDemo(){setOrders(previewOrders);setDemoPhotos([]);setRole('merchandiser');setPage('board');setSelectedOrder(null);setModal(null);setAuthMode('preview')}
  async function returnToWorkspace(){
    if(!sessionUser){setAuthMode('signedOut');return}
    setAuthMode('loadingWorkspace');setWorkspaceError('')
    try{const profile=await loadProfile(sessionUser);const liveOrders=await loadOrders(profile.role);setProfileName(profile.displayName);setBuyerAccount(profile.buyerName||'Northstar Kids');setRole(profile.role);setOrders(liveOrders);setPage(profile.role==='buyer'?'buyer':profile.role==='supervisor'?'production':profile.role==='admin'?'workspace':'board');setSelectedOrder(null);setAuthMode('signedIn')}
    catch(error){setWorkspaceError(error instanceof Error?error.message:'Could not load the workspace.');setAuthMode('signedIn')}
  }
  async function signOut() { await supabase?.auth.signOut(); setOrders([]); setSessionUser(null) }
  async function changeMilestoneStatus(order:Order,milestone:OrderMilestone,status:OrderMilestone['status']){
    try{
      if(authMode==='preview'){
        const update=(current:Order)=>current.id===order.id?{...current,milestones:current.milestones?.map(item=>item.name===milestone.name?{...item,status}:item)}:current
        setOrders(current=>current.map(update));setSelectedOrder(current=>current?update(current):current);notify('Demo milestone status updated locally.');return
      }
      if(!supabase||!milestone.id||!['admin','merchandiser'].includes(role))throw new Error('Milestone changes require an authorised merchandiser or administrator.')
      const {error}=await supabase.from('order_milestones').update({status}).eq('id',milestone.id).eq('order_id',order.id)
      if(error)throw new Error(`Could not update milestone: ${error.message}`)
      const refreshed=await loadOrders(role);setOrders(refreshed);setSelectedOrder(refreshed.find(item=>item.id===order.id)??null);notify('Milestone status saved.')
    }catch(error){notify(error instanceof Error?error.message:'Could not update milestone status.')}
  }

  if (authMode === 'checking' || authMode === 'loadingWorkspace') return <div className="auth-loading"><div className="brand-mark"><span /></div><b>{authMode === 'checking' ? 'Connecting to Threadline' : 'Loading your workspace'}</b><span>Please wait a moment.</span></div>
  if (authMode === 'signedOut') return <SignInScreen onSignIn={signIn} onDemo={startDemo} busy={authBusy} error={authError} />
  if (workspaceError) return <WorkspaceError message={workspaceError} onSignOut={signOut} />

  function navigate(next: Page) { setPage(next); setSelectedOrder(null); setMenuOpen(false) }
  function notify(message: string) { setToast(message) }

  return <div className="app-shell">
    <aside id="threadline-navigation" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span /></div><span>threadline</span><button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
      <div className="workspace-switch"><div className="workspace-avatar">TL</div><div className="workspace-label"><b>Threadline workspace</b><span>Production operations</span></div><ChevronDown size={15} /></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="primary-nav">
        {role === 'merchandiser' && <>
          <NavItem icon={<LayoutDashboard size={18} />} label="Order board" active={page === 'board'} onClick={() => navigate('board')} />
          <NavItem icon={<ClipboardList size={18} />} label="Orders" active={page === 'orders'} onClick={() => navigate('orders')} />
          <NavItem icon={<Activity size={18} />} label="Issue review" active={page === 'issues'} badge={orders.filter(o => o.issue).length} onClick={() => navigate('issues')} />
          <NavItem icon={<ImagePlus size={18} />} label="Photo approvals" active={page === 'photos'} onClick={() => navigate('photos')} />
          <NavItem icon={<FileSpreadsheet size={18} />} label="Buyer reports" active={page === 'reports'} onClick={() => navigate('reports')} />
        </>}
        {role === 'supervisor' && <>
          <NavItem icon={<Factory size={18} />} label="My production" active={page === 'production'} onClick={() => navigate('production')} />
          <NavItem icon={<Radio size={18} />} label="Pending sync" active={page === 'sync'} badge={pendingCount || undefined} onClick={() => navigate('sync')} />
          <NavItem icon={<Activity size={18} />} label="My issues" active={page === 'issues'} onClick={() => navigate('issues')} />
        </>}
        {role === 'buyer' && <NavItem icon={<ShoppingBag size={18} />} label="My orders" active={page === 'buyer'} onClick={() => navigate('buyer')} />}
        {role === 'admin' && <>
          <NavItem icon={<Settings2 size={18} />} label="Workspace setup" active={page === 'workspace'} onClick={() => navigate('workspace')} />
          <NavItem icon={<Users size={18} />} label="User management" active={page === 'users'} badge={pendingPasswordRequests||undefined} onClick={() => navigate('users')} />
        </>}
      </nav>
      <NavItem icon={<UserCircle size={18}/>} label="My profile" active={page==='profile'} onClick={()=>navigate('profile')}/>
      <div className="sidebar-spacer" />
      {role !== 'buyer' && <div className="sidebar-health"><div className="health-icon"><ShieldCheck size={16} /></div><div><b>{authMode==='preview'?'Preview mode':'Workspace'}</b><span>{authMode==='preview'?'Sample records only':online?'Connected':'Offline · local queue'}</span></div><span className="health-dot" /></div>}
      <div className="profile-row"><div className="profile-avatar">{(profileName||buyerAccount||roleLabels[role]).slice(0,2).toUpperCase()}</div><div className="profile-meta"><b>{authMode==='preview'?`Preview ${roleLabels[role]}`:profileName||buyerAccount}</b><span>{roleLabels[role]}</span></div><button className="icon-button" aria-label="Open profile" onClick={() => navigate('profile')}><MoreHorizontal size={18} /></button></div>
    </aside>
    <button className={`sidebar-backdrop ${menuOpen ? 'is-visible' : ''}`} type="button" aria-label="Close navigation menu" tabIndex={menuOpen ? 0 : -1} onClick={() => setMenuOpen(false)} />

    <main className="main-area">
      <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Open menu" aria-controls="threadline-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumb">Workspace <ChevronRight size={14} /> <b>{pageTitle(page, role)}</b></div>
        <div className="topbar-actions">
          <span className={`connection-pill ${online ? 'is-online' : 'is-offline'}`}><span />{online ? 'Online' : 'Offline'}{pendingCount > 0 && <b>{pendingCount} pending</b>}</span>
          <button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('You’re all caught up.')}><Bell size={18} /><i /></button>
          {authMode === 'preview' ? <div className="role-select-wrap"><span className="role-caption">Preview role</span><select aria-label="Preview role" value={role} onChange={e => { setRole(e.target.value as Role); setPage(e.target.value === 'buyer' ? 'buyer' : e.target.value === 'supervisor' ? 'production' : e.target.value === 'admin' ? 'workspace' : 'board') }}><option value="merchandiser">Merchandiser</option><option value="supervisor">Supervisor</option><option value="buyer">Buyer</option><option value="admin">Admin</option></select><ChevronDown size={13} /></div> : <div className="role-select-wrap signed-role"><span className="role-caption">{profileName || sessionUser?.email}</span><b>{roleLabels[role]}</b><button className="signout-button" onClick={startDemo}>Try demo</button><button className="signout-button" onClick={() => void signOut()}>Sign out</button></div>}
        </div>
      </header>

      <div className="content-wrap">
        {authMode === 'preview' && <div className="preview-banner"><span className="preview-dot" /><div><b>Interactive demo · local only</b><span>Try the order handoff across roles. Demo changes stay in this browser session and never go to Supabase.</span></div><button onClick={() => { setRole('merchandiser'); setPage('orders'); setSelectedOrder(orders.find(order=>order.id==='ord-demo-draft')??null) }}>Start walkthrough <ArrowRight size={14}/></button><button className="demo-reset" onClick={() => { setOrders(previewOrders); setDemoPhotos([]); setRole('merchandiser'); setPage('board'); setSelectedOrder(null); setModal(null); notify('Interactive demo reset.') }}>Reset</button>{sessionUser&&<button className="demo-return" onClick={()=>void returnToWorkspace()}>Return to workspace</button>}</div>}
        {page === 'board' && <BoardPage orders={filteredOrders.filter(order => order.state !== 'draft' && order.state !== 'cancelled')} allOrders={activeOrders} preview={authMode==='preview'} buyerFilter={buyerFilter} unitFilter={unitFilter} shipWeekFilter={shipWeekFilter} search={search} filtersOpen={filtersOpen} setBuyerFilter={setBuyerFilter} setUnitFilter={setUnitFilter} setShipWeekFilter={setShipWeekFilter} setSearch={setSearch} setFiltersOpen={setFiltersOpen} setSelected={setSelectedOrder} setModal={setModal} redCount={redCount} amberCount={amberCount} />}
        {page === 'orders' && <OrdersPage orders={filteredOrders} setSelected={setSelectedOrder} setModal={setModal} />}
        {page === 'production' && <ProductionPage orders={filteredOrders} supervisorName={profileName} setModal={setModal} />}
        {page === 'sync' && <SyncPage updates={updates} online={online} onRetry={async () => { const q = await listQueued(); for (const item of q.filter(item => !item.update.previewOnly)) { try { await setQueuedState(item.update.clientId,'syncing'); await syncQueued(item) } catch { await setQueuedState(item.update.clientId,'sync failed').catch(()=>undefined) } } await refreshQueue(); notify('Sync queue checked. Any failed items remain saved on this device.') }} />}
        {page === 'issues' && <IssuesPage orders={filteredOrders} live={authMode==='signedIn'} canManage={role==='admin'||role==='merchandiser'} notify={notify} />}
        {page === 'photos' && <PhotoApprovalsPage live={authMode==='signedIn'} demoRows={demoPhotos} onDemoApproval={(id,approved)=>setDemoPhotos(current=>current.map(photo=>photo.id===id?{...photo,approved_for_buyer:approved}:photo))} notify={notify} />}
        {page === 'reports' && <ReportsPage orders={filteredOrders} notify={notify} />}
      {page === 'buyer' && <BuyerPage buyerName={authMode==='preview'?'Northstar Kids':buyerAccount} orders={filteredOrders} setSelected={setSelectedOrder} />}
        {page === 'workspace' && <WorkspacePage live={authMode==='signedIn'} demoMode={authMode==='preview'} notify={notify} />}
        {page === 'users' && role === 'admin' && <UserManagementPage live={authMode==='signedIn'} demoMode={authMode==='preview'} notify={notify} onPendingChange={setPendingPasswordRequests} />}
        {page === 'profile' && <ProfilePage user={sessionUser} displayName={profileName} role={role} buyerAccount={buyerAccount} live={authMode==='signedIn'} demoMode={authMode==='preview'} notify={notify} />}
      </div>
    </main>

    {selectedOrder && (role === 'buyer' ? <BuyerOrderDrawer order={selectedOrder} demoPhotos={demoPhotos.filter(photo=>photo.orderId===selectedOrder.id&&photo.approved_for_buyer).map(photo=>({url:photo.url,capturedAt:photo.reporting_date}))} demoMode={authMode==='preview'} onClose={() => setSelectedOrder(null)} /> : <OrderDrawer order={selectedOrder} live={authMode === 'signedIn'} preview={authMode==='preview'} canManageMilestones={role==='admin'||role==='merchandiser'} onMilestoneStatusChange={(milestone,status)=>void changeMilestoneStatus(selectedOrder,milestone,status)} onPlan={() => setModal('plan')} onClose={() => setSelectedOrder(null)} />)}
    {modal === 'order' && <OrderModal live={authMode === 'signedIn'} onClose={() => setModal(null)} onSave={async submission => {
      if (authMode === 'signedIn' && supabase) {
        if (!submission.buyerId || !submission.unitId) throw new Error('Select a buyer and production unit from the connected workspace.')
        const { error } = await supabase.rpc('create_order_draft', {
          buyer_id_input: submission.buyerId, unit_id_input: submission.unitId, po_number_input: submission.order.po,
          style_input: submission.order.style, colour_input: submission.order.colour, ex_factory_date_input: submission.order.shipDate,
          stated_total_input: submission.statedTotal, sizes_input: submission.sizes, mismatch_acknowledged_input: submission.mismatchAcknowledged
        })
        if (error) throw new Error(error.message.includes('purchase_orders_buyer_id_po_number_key') ? 'This buyer already has that PO number.' : error.message)
        const refreshed = await loadOrders(role)
        setOrders(refreshed); setModal(null); notify('Draft order saved to the workspace.')
      } else { setOrders(current => [{ ...submission.order, state: 'draft' }, ...current]); setModal(null); notify('Draft order saved in this preview session.') }
    }} />}
    {modal === 'update' && <UpdateModal previewOnly={authMode === 'preview'} orders={orders.filter(order=>authMode!=='preview'||(order.state==='released'&&order.stageOptions?.length))} onClose={() => setModal(null)} onSave={async (record, photo, audio) => {
      if(authMode==='preview'){
        const order=orders.find(item=>item.id===record.orderId)
        if(order){const completed=Math.min(order.quantity,order.completed+record.quantity);const updated={...order,completed,stage:record.stage,blocked:record.blocked,issue:record.issue||undefined,updatedAt:'Today, now',recentDailyOutput:record.quantity,workdaysLeft:Math.max(1,Math.ceil((new Date(`${order.shipDate}T00:00:00`).getTime()-Date.now())/86400000)),freshness:'Fresh' as const};updated.status=calculateRisk(updated);setOrders(current=>current.map(item=>item.id===order.id?updated:item))}
        if(photo&&order)setDemoPhotos(current=>[{id:record.clientId,orderId:order.id,storage_path:'demo-local',approved_for_buyer:false,reporting_date:record.reportingDate,po:order.po,style:order.style,buyer:order.buyer,url:URL.createObjectURL(photo)},...current])
        setModal(null);notify('Demo update recorded locally. Switch to Merchandiser to review its issue and photo.');return
      }
      await saveQueued({ update: record, photo, audio })
      setUpdates(current => [record, ...current])
      setModal(null)
      if (online && isSupabaseConfigured) {
        try { await setQueuedState(record.clientId,'syncing'); await syncQueued({ update: record, photo, audio }); setUpdates(current => current.filter(item => item.clientId !== record.clientId)); notify('Production update synced successfully.') }
        catch { await setQueuedState(record.clientId,'sync failed').catch(()=>undefined); await refreshQueue(); notify('Update saved on this device. Sync failed and can be retried.') }
      } else notify('Update saved on this device and waiting to sync.')
    }} />}
    {modal === 'plan' && selectedOrder && <PlanModal order={selectedOrder} live={authMode === 'signedIn'} demoMode={authMode==='preview'} onClose={() => setModal(null)} onSaved={async (plan) => {
      if (authMode === 'signedIn') setOrders(await loadOrders(role))
      else if(plan)setOrders(current=>current.map(order=>order.id===selectedOrder.id?{...order,state:plan.release?'released':'draft',buyerVisible:plan.release&&plan.buyerVisible,stage:plan.stages.find(stage=>stage.sequence===1&&stage.targetQuantity)?.name??plan.stages.find(stage=>stage.targetQuantity)?.name??'Production planning',stageOptions:plan.stages.filter(stage=>stage.targetQuantity!==null),milestones:plan.milestones.filter(milestone=>!plan.release||(plan.buyerVisible&&milestone.buyerVisible)),status:'insufficient',freshness:'No update',workdaysLeft:Math.max(1,Math.ceil((new Date(`${order.shipDate}T00:00:00`).getTime()-Date.now())/86400000))}:order))
      setModal(null); setSelectedOrder(null); notify('Production plan saved.')
    }} />}
    {toast && <div className="toast"><CheckCircle2 size={17} />{toast}<button className="icon-button" onClick={() => setToast('')} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>
}

function NavItem({ icon, label, active, badge, onClick }: { icon: ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{badge !== undefined && <b className="nav-badge">{badge}</b>}</button>
}

function SignInScreen({ onSignIn, onDemo, busy, error }: { onSignIn: (email: string, password: string) => void; onDemo:()=>void; busy: boolean; error: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return <div className="auth-page"><div className="auth-brand"><div className="brand-mark"><span /></div><span>threadline</span></div><form className="auth-card" onSubmit={e => { e.preventDefault(); onSignIn(email, password) }}><span className="eyebrow">PRODUCTION WORKSPACE</span><h1>Welcome back</h1><p>Sign in with the account provided by your workspace administrator.</p><label className="form-label">Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></label><label className="form-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" /></label>{error && <div className="form-error"><LockKeyhole size={15} />{error}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={15} /></button><button type="button" className="button button-secondary auth-submit" onClick={onDemo}>Explore interactive demo</button><div className="auth-help"><LockKeyhole size={14} /> Demo changes stay in this browser and never reach your workspace.</div></form><span className="auth-footer">Threadline · Production order tracking</span></div>
}

function WorkspaceError({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return <div className="auth-page"><div className="auth-brand"><div className="brand-mark"><span /></div><span>threadline</span></div><div className="auth-card auth-error-card"><span className="error-mark"><TriangleAlert size={18} /></span><h1>Workspace unavailable</h1><p>{message}</p><button className="button button-secondary" onClick={onSignOut}>Sign out</button></div><span className="auth-footer">Contact your workspace administrator for help.</span></div>
}

function pageTitle(page: Page, role: Role) {
  if (page === 'board') return 'Order board'
  if (page === 'orders') return 'Orders'
  if (page === 'production') return 'My production'
  if (page === 'sync') return 'Pending sync'
  if (page === 'issues') return role === 'supervisor' ? 'My issues' : 'Issue review'
  if (page === 'photos') return 'Photo approvals'
  if (page === 'reports') return 'Buyer reports'
  if (page === 'buyer') return 'My orders'
  if (page === 'users') return 'User management'
  if (page === 'profile') return 'My profile'
  return 'Workspace setup'
}

function BoardPage(props: {
  orders: Order[]; allOrders:Order[]; preview:boolean; buyerFilter: string; unitFilter: string; shipWeekFilter:string; search: string; filtersOpen: boolean
  setBuyerFilter: (s: string) => void; setUnitFilter: (s: string) => void; setShipWeekFilter:(s:string)=>void; setSearch: (s: string) => void
  setFiltersOpen: (v: boolean) => void; setSelected: (o: Order) => void; setModal: (m: 'order' | 'update' | null) => void
  redCount: number; amberCount: number
}) {
  const atRisk = props.orders.filter(o => o.status === 'red' || o.status === 'amber').length
  const totalUnits = props.orders.reduce((sum, o) => sum + o.quantity, 0)
  const completed = props.orders.reduce((sum, o) => sum + o.completed, 0)
  const insufficient=props.orders.filter(o=>o.status==='insufficient').length
  const buyers=[...new Set(props.allOrders.map(o=>o.buyer))]
  const units=[...new Set(props.allOrders.map(o=>o.unit))]
  const weeks=[...new Set(props.allOrders.map(o=>weekStartFor(o.shipDate)))].sort()
  return <>
    <div className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat('en-IN',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date()).toUpperCase()} <span className="eyebrow-line" /></div><h1>Production overview</h1><p>Here’s how your orders are moving across the floor.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => props.setFiltersOpen(!props.filtersOpen)}><SlidersHorizontal size={16} /> Filters</button><button className="button button-primary" onClick={() => props.setModal('order')}><Plus size={17} /> New order</button></div></div>
    <div className="metric-grid">
      <Metric label="Active orders" value={String(props.orders.length).padStart(2, '0')} foot={<><span className="metric-neutral">Across {units.length} production units</span></>} icon={<ClipboardList size={17} />} />
      <Metric label="Order quantity" value={moneyless(totalUnits)} foot={<><span className="metric-neutral">Pieces in active production</span></>} icon={<PackageCheck size={17} />} />
      <Metric label="Completed" value={`${totalUnits ? Math.round(completed / totalUnits * 100) : 0}%`} foot={<><span className="metric-neutral">{moneyless(completed)} pieces reported</span></>} icon={<Check size={17} />} />
      <Metric label="Needs attention" value={String(atRisk).padStart(2, '0')} foot={<><span className="metric-alert"><span /> {props.redCount} at risk</span><span className="metric-neutral"> · {props.amberCount} watch · {insufficient} insufficient data</span></>} icon={<TriangleAlert size={17} />} alert />
    </div>
    <div className="section-heading"><div><h2>Active production</h2><span className="section-subtitle">Live view of order progress and production risk</span></div><div className="section-tools"><div className="search-field"><Search size={16} /><input value={props.search} onChange={e => props.setSearch(e.target.value)} placeholder="Search PO, style, buyer" /></div><button className="button button-quiet" onClick={() => props.setFiltersOpen(!props.filtersOpen)}><Filter size={15} /> Filter</button><button className="button button-quiet icon-only" aria-label="More options"><MoreHorizontal size={18} /></button></div></div>
    {props.filtersOpen && <div className="filter-bar"><span><ListFilter size={15} /> Showing</span><select value={props.buyerFilter} onChange={e => props.setBuyerFilter(e.target.value)}><option>All buyers</option>{buyers.map(b=><option key={b}>{b}</option>)}</select><select value={props.unitFilter} onChange={e => props.setUnitFilter(e.target.value)}><option>All units</option>{units.map(u=><option key={u} value={u}>{u}</option>)}</select><select value={props.shipWeekFilter} onChange={e=>props.setShipWeekFilter(e.target.value)}><option>All ship weeks</option>{weeks.map(week=><option key={week} value={week}>Week of {new Date(`${week}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</option>)}</select><button onClick={() => { props.setBuyerFilter('All buyers'); props.setUnitFilter('All units'); props.setShipWeekFilter('All ship weeks'); props.setSearch('') }}>Clear filters</button></div>}
    <div className="table-card"><div className="table-scroll"><table><thead><tr><th>ORDER</th><th>BUYER / UNIT</th><th>PRODUCTION</th><th>PROGRESS</th><th>EX-FACTORY</th><th>LAST UPDATE</th><th>STATUS</th><th /></tr></thead><tbody>
      {props.orders.map(order => <OrderRow key={order.id} order={order} onClick={() => props.setSelected(order)} />)}
      {props.orders.length === 0 && <tr><td colSpan={8} className="empty-cell">No orders match these filters. Try clearing the search or filters.</td></tr>}
    </tbody></table></div><div className="table-footer"><span>Showing <b>{props.orders.length}</b> of <b>{props.orders.length}</b> active orders</span><button className="button button-quiet" onClick={() => props.setModal('order')}>View all orders <ArrowRight size={15} /></button></div></div>
    <div className="bottom-grid"><div className="panel-card"><div className="panel-heading"><div><h3>Production risk summary</h3><span>{props.preview?'Illustrative sample classifications':'Based on approved unit settings and available updates'}</span></div></div><div className="risk-summary-list"><div><span><i className="risk-summary-dot dot-red"/>At risk</span><b>{props.orders.filter(o=>o.status==='red').length}</b></div><div><span><i className="risk-summary-dot dot-amber"/>Watch</span><b>{props.orders.filter(o=>o.status==='amber').length}</b></div><div><span><i className="risk-summary-dot dot-green"/>On track</span><b>{props.orders.filter(o=>o.status==='green').length}</b></div><div><span><i className="risk-summary-dot dot-muted"/>Insufficient data</span><b>{insufficient}</b></div></div><div className="chart-foot"><span>Missing updates and unapproved risk settings remain visible as insufficient data.</span></div></div>
      <div className="panel-card attention-card"><div className="panel-heading"><div><h3>Needs your attention</h3><span>Orders with production risk</span></div></div><div className="attention-list">{props.orders.filter(o=>o.status==='red'||o.status==='amber').slice(0,3).map(o=><button className="attention-item" key={o.id} onClick={()=>props.setSelected(o)}><span className={`attention-icon ${o.status}`}><TriangleAlert size={16}/></span><span className="attention-copy"><b>{o.po} · {o.style}</b><small>{o.issue||'Review the required daily output against recent production.'}</small></span><ChevronRight size={16}/></button>)}{!atRisk&&insufficient>0&&<div className="all-clear"><TriangleAlert size={17}/>Risk cannot be calculated reliably for {insufficient} order{insufficient===1?'':'s'} with current data.</div>}{!atRisk&&!insufficient&&<div className="all-clear"><CheckCircle2 size={17}/>No active orders need attention.</div>}</div></div></div>
  </>
}

function Metric({ label, value, foot, icon, alert }: { label: string; value: string; foot: ReactNode; icon: ReactNode; alert?: boolean }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${alert ? 'metric-icon-alert' : ''}`}>{icon}</span></div><strong>{value}</strong><div className="metric-foot">{foot}</div></div>
}

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const pct = Math.min(100, Math.round(order.completed / order.quantity * 100))
  const risk = order.status
  return <tr className="order-row" onClick={onClick} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onClick() }}>
    <td><div className="po-cell"><b>{order.po}</b><span>{order.style}</span></div></td>
    <td><div className="buyer-cell"><b>{order.buyer}</b><span>{order.unit}</span></div></td>
    <td><div className="stage-cell"><span className="stage-dot" />{order.stage}{order.blocked&&<em className="blocked-badge">Blocked</em>}<small>{order.colour}</small></div></td>
    <td><div className="progress-cell"><div><b>{pct}%</b><span>{moneyless(order.completed)} / {moneyless(order.quantity)}</span></div><div className="progress-track"><i style={{ width: `${pct}%` }} /></div></div></td>
    <td><div className="date-cell"><CalendarDays size={14} />{new Date(`${order.shipDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}<small>{daysLabel(order.shipDate)}</small></div></td>
    <td><div className="updated-cell"><span className={`freshness-dot ${order.freshness.toLowerCase().replace(' ', '-')}`} />{order.updatedAt}<small>{order.freshness === 'No update' ? 'Missing daily update' : order.freshness === 'Stale' ? 'Update is getting stale' : 'Production update'}</small></div></td>
    <td><RiskBadge risk={risk} /></td><td><button className="row-more" aria-label={`Open ${order.po}`}><ChevronRight size={17} /></button></td>
  </tr>
}

function RiskBadge({ risk }: { risk: Order['status'] }) {
  const labels = { green: 'On track', amber: 'Watch', red: 'At risk', insufficient: 'Insufficient data' }
  return <span className={`risk-badge risk-${risk}`}><i />{labels[risk]}</span>
}
function BuyerStatusBadge({state,hasProgress}:{state:Order['state'];hasProgress:boolean}){const label=state==='complete'?'Completed':hasProgress?'In production':'Production scheduled';return <span className={`buyer-status-pill buyer-status-${state==='complete'?'complete':'active'}`}><i/>{label}</span>}

function weekStartFor(date:string){const d=new Date(`${date}T00:00:00`);d.setDate(d.getDate()-((d.getDay()+6)%7));return localInputDate(d)}
function daysLabel(date: string) {
  const today=new Date();today.setHours(0,0,0,0)
  const days = Math.ceil((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000)
  return days < 0 ? `${Math.abs(days)} days past` : `in ${days} days`
}

function OrdersPage({ orders, setSelected, setModal }: { orders: Order[]; setSelected: (o: Order) => void; setModal: (m: 'order' | 'update' | null) => void }) {
  return <><div className="page-heading"><div><div className="eyebrow">ORDER MANAGEMENT</div><h1>Orders</h1><p>Keep each purchase order, plan and production route in one place.</p></div><button className="button button-primary" onClick={() => setModal('order')}><Plus size={17} /> New order</button></div><div className="toolbar-card"><div className="search-field"><Search size={16} /><input placeholder="Search purchase orders" /></div><button className="button button-secondary"><Filter size={15} /> Filters</button><div className="toolbar-spacer" /><span className="quiet-label">{orders.length} active orders</span></div><div className="order-list-grid">{orders.map(o => <button key={o.id} className="order-list-card" onClick={() => setSelected(o)}><div className="list-card-top"><span className="order-code">{o.po}</span><RiskBadge risk={o.status} /></div><h3>{o.style}</h3><p>{o.buyer} <span>·</span> {o.colour}</p><div className="list-card-progress"><div className="progress-track"><i style={{ width: `${Math.round(o.completed / o.quantity * 100)}%` }} /></div><b>{Math.round(o.completed / o.quantity * 100)}%</b></div><div className="list-card-foot"><span><Factory size={14} />{o.unit}</span><span><CalendarDays size={14} />{new Date(`${o.shipDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div></button>)}</div></>
}

function ProductionPage({orders,supervisorName,setModal}:{orders:Order[];supervisorName:string;setModal:(m:'order'|'update'|null)=>void}) {
  const unit=orders[0]?.unit??'No assigned production unit'
  const today=new Intl.DateTimeFormat('en-IN',{weekday:'short',day:'numeric',month:'short'}).format(new Date())
  return <><div className="page-heading supervisor-heading"><div><div className="eyebrow">{unit.toUpperCase()}</div><h1>{supervisorName?`Good morning, ${supervisorName}`:'My production'}</h1><p>Production orders assigned to your account.</p></div><button className="button button-primary" onClick={()=>setModal('update')} disabled={!orders.length}><Plus size={17}/> Add update</button></div><div className="supervisor-note"><div className="note-icon"><Wifi size={17}/></div><div><b>Updates save on this device first</b><span>When offline, saved work stays queued here and syncs when connectivity returns.</span></div><ChevronRight size={17}/></div><div className="section-heading supervisor-section"><div><h2>Assigned production</h2><span className="section-subtitle">Tap Add update to record this reporting period’s output</span></div><span className="today-date"><CalendarDays size={15}/> Today · {today}</span></div><div className="work-cards">{orders.slice(0,8).map(o=>{const stage=o.stageOptions?.find(s=>s.name===o.stage)??o.stageOptions?.[0];return <div className="work-card" key={o.id}><div className="work-card-main"><div className="work-order-top"><span className="order-code">{o.po}</span><span className="work-stage-chip"><span className="stage-dot"/>{stage?.name??'Production planning'}</span></div><h3>{o.style}</h3><p>{o.buyer} <span>·</span> {o.colour}</p><div className="work-progress"><div className="progress-track"><i style={{width:`${orderProgressPercent(o.completed,o.progressTarget??o.quantity)}%`}}/></div><span>{moneyless(o.completed)} of {moneyless(o.quantity)} pieces reported</span></div><div className="assigned-lines"><span>Assigned lines</span><b>{stage?.lines.length?stage.lines.map(line=>line.name).join(' · '):'Stage-level reporting'}</b></div></div><button className="button button-secondary work-update" onClick={()=>setModal('update')}><Plus size={15}/> Add update</button></div>})}{!orders.length&&<div className="empty-state"><Factory size={20}/><b>No orders are assigned to your account</b><span>Ask your merchandiser to add you to an order stage.</span></div>}</div></>
}
function SyncPage({ updates, online, onRetry }: { updates: PendingUpdate[]; online: boolean; onRetry: () => void }) {
  return <><div className="page-heading"><div><div className="eyebrow">DEVICE QUEUE</div><h1>Pending sync</h1><p>Updates waiting to reach the production workspace.</p></div><button className="button button-secondary" disabled={!online || updates.every(update => update.previewOnly)} onClick={onRetry}><Radio size={16} /> Sync now</button></div><div className={`sync-status-card ${online ? '' : 'sync-offline'}`}><div className="sync-status-icon">{online ? <Wifi size={19} /> : <WifiOff size={19} />}</div><div><b>{online ? 'This device is online' : 'You’re offline right now'}</b><span>{online ? 'Queued updates will sync when the workspace is connected.' : 'Your saved work stays on this device. Reconnect to sync it.'}</span></div><span className="sync-counter">{updates.length} pending</span></div><div className="table-card sync-table"><div className="table-scroll"><table><thead><tr><th>ORDER / STAGE</th><th>REPORTING DATE</th><th>QUANTITY</th><th>SAVED</th><th>SYNC STATUS</th></tr></thead><tbody>{updates.map(u => <tr key={u.clientId}><td><div className="po-cell"><b>{u.orderId}</b><span>{u.stage} · {u.line}{u.previewOnly ? ' · preview only' : ''}</span></div></td><td>{new Date(`${u.reportingDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td><td><b>{moneyless(u.quantity)} pcs</b></td><td>{new Date(u.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td><span className="sync-state"><span />{u.previewOnly ? 'preview only' : u.syncState}</span></td></tr>)}{updates.length === 0 && <tr><td className="empty-cell" colSpan={5}>No pending updates. New records will appear here until they sync.</td></tr>}</tbody></table></div></div><div className="storage-note"><LockKeyhole size={15} /> Pending entries are stored in this browser on this device. Clearing browser data may remove unsynced work.</div></>
}

type RecoveryActionRow={id:string;order_id:string;stage_id:string|null;action_text:string;owner_id:string|null;follow_up_date:string|null;status:'open'|'in_progress'|'complete'|'blocked';updated_at:string}
function IssuesPage({orders,live,canManage,notify}:{orders:Order[];live:boolean;canManage:boolean;notify:(s:string)=>void}){
  const issues=orders.filter(order=>order.issue||order.latestAudioPath)
  const [reviewing,setReviewing]=useState<Order|null>(null)
  const [actionOrder,setActionOrder]=useState<Order|null>(null)
  const [actions,setActions]=useState<RecoveryActionRow[]>([])
  const [owners,setOwners]=useState<{id:string;display_name:string}[]>([])
  const [loadingActions,setLoadingActions]=useState(false)
  async function reloadActions(){
    if(!live||!canManage||!supabase){setActions([]);return}
    setLoadingActions(true)
    try{
      const [{data:rows,error:rowsError},{data:people,error:peopleError}]=await Promise.all([
        supabase.from('recovery_actions').select('id,order_id,stage_id,action_text,owner_id,follow_up_date,status,updated_at').order('follow_up_date',{ascending:true,nullsFirst:false}),
        supabase.from('profiles').select('id,display_name').eq('active',true).in('role',['admin','merchandiser','supervisor']).order('display_name')
      ])
      if(rowsError)throw rowsError;if(peopleError)throw peopleError
      setActions((rows??[]) as RecoveryActionRow[]);setOwners((people??[]) as {id:string;display_name:string}[])
    }catch(error){notify(error instanceof Error?error.message:'Could not load recovery actions.')}
    finally{setLoadingActions(false)}
  }
  useEffect(()=>{void reloadActions()},[live,canManage])
  async function updateActionStatus(action:RecoveryActionRow,status:RecoveryActionRow['status']){
    if(!supabase)return
    const {error}=await supabase.from('recovery_actions').update({status}).eq('id',action.id)
    if(error){notify(`Could not update recovery action: ${error.message}`);return}
    setActions(current=>current.map(item=>item.id===action.id?{...item,status,updated_at:new Date().toISOString()}:item));notify('Recovery action status saved.')
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">PRODUCTION FOLLOW-UP</div><h1>Issue review</h1><p>Review original notes and keep recovery work assigned and traceable.</p></div><button className="button button-secondary" onClick={()=>notify('Issue list is scoped to the orders available to your account.')}><Filter size={15}/> Filters</button></div>
    <div className="issue-stack">{issues.map((order,index)=><div className="issue-card" key={order.id}><div className={`issue-severity ${index===0?'high':'medium'}`}><TriangleAlert size={17}/></div><div className="issue-content"><div className="issue-meta"><b>{order.po} · {order.stage}</b><span>{order.updatedAt}</span></div><h3>{order.issue||'Voice note received — transcription pending'}</h3><p>{order.buyer} · {order.style} · {order.unit}</p><div className="issue-actions"><span className="issue-category"><Activity size={13}/>{order.latestAudioPath?'Original audio retained':'Text issue note'}</span>{canManage&&<><button className="text-button" onClick={()=>setReviewing(order)}><AudioLines size={15}/> Review note</button><button className="text-button" onClick={()=>setActionOrder(order)}>Add recovery action</button></>}</div></div></div>)}{issues.length===0&&<div className="empty-card"><CheckCircle2 size={20}/><b>No open issues</b><span>Newly reported text and voice notes will appear here.</span></div>}</div>
    {canManage&&live&&<section className="panel-card recovery-actions-panel"><div className="panel-heading"><div><h3>Recovery actions</h3><span>Owner, follow-up date, and completion status</span></div>{orders.length>0&&<button className="button button-secondary" onClick={()=>setActionOrder(issues[0]??orders[0])}><Plus size={15}/> Add action</button>}</div>{loadingActions?<p className="modal-intro">Loading recovery actions…</p>:actions.length?<div className="recovery-action-list">{actions.map(action=>{const order=orders.find(item=>item.id===action.order_id);return <article className="recovery-action-row" key={action.id}><div><b>{order?.po??'Order'}{order?` · ${order.style}`:''}</b><span>{action.action_text}</span><small>{owners.find(owner=>owner.id===action.owner_id)?.display_name??'Unassigned'} · Follow up {action.follow_up_date??'date not set'}</small></div><label className="form-label">Status<select value={action.status} onChange={event=>void updateActionStatus(action,event.target.value as RecoveryActionRow['status'])}><option value="open">Open</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="blocked">Blocked</option></select></label></article>})}</div>:<div className="buyer-empty-note">No recovery actions have been recorded.</div>}</section>}
    {reviewing&&<IssueReviewModal order={reviewing} onClose={()=>setReviewing(null)} notify={notify}/>}
    {actionOrder&&<RecoveryActionModal key={actionOrder.id} order={actionOrder} owners={owners} onClose={()=>setActionOrder(null)} onSaved={()=>{setActionOrder(null);void reloadActions()}} notify={notify}/>}
  </>
}

function RecoveryActionModal({order,owners,onClose,onSaved,notify}:{order:Order;owners:{id:string;display_name:string}[];onClose:()=>void;onSaved:()=>void;notify:(message:string)=>void}){
  const [stageId,setStageId]=useState(order.stageOptions?.[0]?.id??'');const [ownerId,setOwnerId]=useState('');const [actionText,setActionText]=useState('');const [followUpDate,setFollowUpDate]=useState('');const [status,setStatus]=useState<RecoveryActionRow['status']>('open');const [saving,setSaving]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();if(!supabase)return;setSaving(true);try{const {data,error:userError}=await supabase.auth.getUser();if(userError||!data.user)throw new Error('Sign in again before recording a recovery action.');const {error}=await supabase.from('recovery_actions').insert({order_id:order.id,stage_id:stageId||null,action_text:actionText.trim(),owner_id:ownerId||null,follow_up_date:followUpDate||null,status,created_by:data.user.id});if(error)throw new Error(`Could not save recovery action: ${error.message}`);notify('Recovery action recorded.');onSaved()}catch(error){notify(error instanceof Error?error.message:'Could not save recovery action.')}finally{setSaving(false)}}
  return <ModalFrame title="Add recovery action" eyebrow={`${order.po} · ${order.stage}`} onClose={onClose}><form onSubmit={event=>void submit(event)}><p className="modal-intro">Record the agreed action that should help production recover.</p><label className="form-label">Related stage<select value={stageId} onChange={event=>setStageId(event.target.value)}><option value="">Order-level action</option>{order.stageOptions?.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="form-label">Action description<textarea required maxLength={1000} rows={3} value={actionText} onChange={event=>setActionText(event.target.value)} placeholder="Describe the action and expected outcome"/></label><div className="form-grid"><label className="form-label">Owner<select value={ownerId} onChange={event=>setOwnerId(event.target.value)}><option value="">Unassigned</option>{owners.map(owner=><option key={owner.id} value={owner.id}>{owner.display_name}</option>)}</select></label><label className="form-label">Follow-up date<input type="date" value={followUpDate} onChange={event=>setFollowUpDate(event.target.value)}/></label></div><label className="form-label">Status<select value={status} onChange={event=>setStatus(event.target.value as RecoveryActionRow['status'])}><option value="open">Open</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="blocked">Blocked</option></select></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving?'Saving…':'Save recovery action'}</button></div></form></ModalFrame>
}

type PhotoReviewRow={id:string;storage_path:string;approved_for_buyer:boolean;reporting_date:string;po:string;style:string;buyer:string;url:string}
function PhotoApprovalsPage({live,demoRows,onDemoApproval,notify}:{live:boolean;demoRows:PhotoReviewRow[];onDemoApproval:(id:string,approved:boolean)=>void;notify:(message:string)=>void}){
  const [rows,setRows]=useState<PhotoReviewRow[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('')
  async function reload(){if(!supabase||!live){setRows(demoRows);setLoading(false);return}setLoading(true);try{const {data,error}=await supabase.from('photo_approvals').select('id,storage_path,approved_for_buyer,production_updates!inner(reporting_date,order_id,purchase_orders!inner(po_number,style,buyer_visible,buyers(name)))').order('created_at',{ascending:false});if(error)throw error;const results:PhotoReviewRow[]=[];for(const item of (data??[]) as unknown as {id:string;storage_path:string;approved_for_buyer:boolean;production_updates:{reporting_date:string;purchase_orders:{po_number:string;style:string;buyers:{name:string}|{name:string}[]|null}|{po_number:string;style:string;buyers:{name:string}|{name:string}[]|null}[]}[]}[]){const update=Array.isArray(item.production_updates)?item.production_updates[0]:item.production_updates;const poValue=update?.purchase_orders;const po=Array.isArray(poValue)?poValue[0]:poValue;if(!po)continue;const buyerValue=po.buyers;const buyer=Array.isArray(buyerValue)?buyerValue[0]?.name:buyerValue?.name;const {data:signed,error:signedError}=await supabase.storage.from('production-evidence').createSignedUrl(item.storage_path,60);if(signedError||!signed)continue;results.push({id:item.id,storage_path:item.storage_path,approved_for_buyer:item.approved_for_buyer,reporting_date:update.reporting_date,po:po.po_number,style:po.style,buyer:buyer??'Buyer',url:signed.signedUrl})}setRows(results)}catch(reason){notify(reason instanceof Error?reason.message:'Could not load production photos for review.')}finally{setLoading(false)}}
  useEffect(()=>{void reload()},[live])
  async function approve(row:PhotoReviewRow){if(!live){onDemoApproval(row.id,!row.approved_for_buyer);setRows(current=>current.map(item=>item.id===row.id?{...item,approved_for_buyer:!row.approved_for_buyer}:item));notify(row.approved_for_buyer?'Demo approval removed.':'Demo photo approved; switch to Buyer to view it.');return}if(!supabase)return;setBusy(row.id);try{const {data:userData}=await supabase.auth.getUser();if(!userData.user)throw new Error('Sign in again to review photos.');const {error}=await supabase.from('photo_approvals').update({approved_for_buyer:!row.approved_for_buyer,reviewed_by:userData.user.id,reviewed_at:new Date().toISOString()}).eq('id',row.id);if(error)throw error;setRows(current=>current.map(item=>item.id===row.id?{...item,approved_for_buyer:!row.approved_for_buyer}:item));notify(row.approved_for_buyer?'Photo approval removed.':'Photo approved for buyer visibility after the order is shared.')}catch(reason){notify(reason instanceof Error?reason.message:'Photo review failed.')}finally{setBusy('')}}
  return <><div className="page-heading"><div><div className="eyebrow">BUYER-SAFE MEDIA</div><h1>Photo approvals</h1><p>Review each production image before a buyer can see it.</p></div><button className="button button-secondary" onClick={()=>void reload()} disabled={!live||loading}>Refresh</button></div>{!live&&<div className="workspace-warning"><LockKeyhole size={17}/><div><b>Interactive demo photo queue.</b><span>Approve a photo here, then switch to Buyer to see it.</span></div></div>}<div className="workspace-warning"><ShieldCheck size={17}/><div><b>Approval is separate from order sharing.</b><span>Approved photos appear only when their order is shared with the buyer and only in that buyer's account.</span></div></div>{loading?<p className="modal-intro">Loading photo queue…</p>:<div className="photo-review-grid">{rows.map(row=><article className="photo-review-card" key={row.id}><img src={row.url} alt={`Production photo for ${row.po}`}/><div className="photo-review-copy"><span className="eyebrow">{row.po} · {row.reporting_date}</span><h3>{row.style}</h3><p>{row.buyer}</p><button className={`button ${row.approved_for_buyer?'button-secondary':'button-primary'}`} disabled={busy===row.id} onClick={()=>void approve(row)}>{busy===row.id?'Saving…':row.approved_for_buyer?'Remove buyer approval':'Approve for buyer'}{row.approved_for_buyer?<ShieldCheck size={15}/>:<Check size={15}/>}</button></div></article>)}{!rows.length&&<div className="empty-card"><ImagePlus size={20}/><b>No production photos are waiting for review</b><span>New uploads appear here. Unapproved photos stay private.</span></div>}</div>}</>
}

function IssueReviewModal({ order, onClose, notify }: { order: Order; onClose: () => void; notify: (message:string) => void }) {
  const [originalTranscript,setOriginalTranscript]=useState('')
  const [transcript,setTranscript]=useState(order.issue??'')
  const [translation,setTranslation]=useState('')
  const [category,setCategory]=useState('other')
  const [buyerSafeText,setBuyerSafeText]=useState('')
  const [buyerApproved,setBuyerApproved]=useState(false)
  const [audioConsent,setAudioConsent]=useState(false)
  const [aiConsent,setAiConsent]=useState(false)
  const [provider,setProvider]=useState('')
  const [audioUrl,setAudioUrl]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [preview,setPreview]=useState(!isSupabaseConfigured)
  useEffect(()=>{
    if(!supabase||!order.latestUpdateId)return
    let active=true
    void (async()=>{
      const {data}=await supabase.from('issue_reviews').select('original_transcription,corrected_transcription,translation,issue_category,buyer_safe_text,buyer_safe_approved,ai_provider').eq('update_id',order.latestUpdateId).maybeSingle()
      if(data&&active){setOriginalTranscript(data.original_transcription??'');setTranscript(data.corrected_transcription??data.original_transcription??order.issue??'');setTranslation(data.translation??'');setCategory(data.issue_category??'other');setBuyerSafeText(data.buyer_safe_text??'');setBuyerApproved(data.buyer_safe_approved??false);setProvider(data.ai_provider??'')}
      if(order.latestAudioPath){const signed=await supabase.storage.from('production-evidence').createSignedUrl(order.latestAudioPath,60);if(active&&signed.data)setAudioUrl(signed.data.signedUrl)}
    })().catch(()=>undefined)
    return()=>{active=false}
  },[order.latestUpdateId,order.latestAudioPath,order.issue])
  async function transcribe(){
    if(!audioConsent){setError('Confirm that you have permission to send this original recording to Gemini before transcription.');return}
    if(!supabase||!order.latestUpdateId){setError('This is a synthetic preview note; it has no original audio to transcribe.');return}
    setBusy(true);setError('')
    try{
      const result=await invokeProtectedFunction<{transcript:string;provider:string}>('transcribe-issue',{updateId:order.latestUpdateId})
      setOriginalTranscript(result.transcript);setTranscript(result.transcript);setProvider(result.provider)
      const {error:saveError}=await supabase.from('issue_reviews').update({original_transcription:result.transcript,ai_provider:result.provider,ai_state:'pending'}).eq('update_id',order.latestUpdateId)
      if(saveError)throw new Error(saveError.message)
    }catch(reason){setError(reason instanceof Error?reason.message:'Transcription failed. Original audio is retained; retry or use typed text.')}
    setBusy(false)
  }
  async function translate(){
    if(!aiConsent){setError('Confirm that this note may be sent to the configured AI provider for a review suggestion.');return}
    if(!transcript.trim()){setError('Add or transcribe the source note first.');return}
    setBusy(true);setError('')
    try{
      const result=await invokeProtectedFunction<{translation:string;category:string;provider:string}>('issue-assist',{transcript,sourceLanguage:'Tamil',targetLanguage:'English'})
      setTranslation(result.translation);setCategory(result.category);setProvider(result.provider)
    }catch(reason){setError(reason instanceof Error?reason.message:'AI assistance failed. You can still review the source note manually.')}
    setBusy(false)
  }
  async function saveReview(approve:boolean){
    if(!supabase||!order.latestUpdateId){setPreview(true);notify('Preview review edits are not written to a live workspace.');return}
    setBusy(true);setError('')
    const {data:userData}=await supabase.auth.getUser()
    const {error:saveError}=await supabase.from('issue_reviews').update({original_transcription:originalTranscript||null,corrected_transcription:transcript!==originalTranscript?transcript:null,translation:translation||null,issue_category:category,ai_provider:provider||null,ai_state:approve?'approved':'pending',buyer_safe_text:buyerSafeText||null,buyer_safe_approved:approve&&buyerApproved,reviewed_by:userData.user?.id??null,reviewed_at:new Date().toISOString()}).eq('update_id',order.latestUpdateId)
    setBusy(false)
    if(saveError){setError(`Could not save the review: ${saveError.message}`);return}
    notify(approve?'Review saved. Buyer visibility follows the separate approval selection.':'Review draft saved.')
    onClose()
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal-card issue-review-modal" role="dialog" aria-modal="true" aria-label="Review production issue"><div className="modal-heading"><div><span className="eyebrow">{order.po} · {order.stage}</span><h2>Review issue note</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div><p className="modal-intro">The original note stays attached. Transcription and translation are suggestions for a person to review.</p>{audioUrl&&<audio className="issue-audio" controls src={audioUrl}/>}{order.latestAudioPath&&<><div className="ai-data-note"><LockKeyhole size={14}/> Transcription sends the original audio to Gemini 3 Flash Preview. Google's free tier may use submitted content to improve its products. Use only with factory/customer approval; the original remains stored in Threadline.</div><label className="ai-consent"><input type="checkbox" checked={audioConsent} onChange={e=>setAudioConsent(e.target.checked)}/><span>I have permission to send this recording to Gemini for transcription. I understand provider data-use terms must be approved.</span></label></>}<label className="form-label">Tamil transcription<textarea rows={4} value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="Type a correction or transcribe the original note…"/></label><div className="review-ai-row"><button type="button" className="button button-secondary" disabled={busy||!order.latestAudioPath||!audioConsent} onClick={()=>void transcribe()}><AudioLines size={15}/>{busy?'Working…':'Transcribe with Gemini 3 Flash'}</button><span>{originalTranscript?'Machine transcription kept for traceability':preview?'Preview note · not sent to a provider':''}</span></div><label className="ai-consent"><input type="checkbox" checked={aiConsent} onChange={e=>setAiConsent(e.target.checked)}/><span>Allow this text to be sent to Nemotron 3 Ultra, with Gemini 3 Flash Preview as fallback, for an English translation and category suggestion. NVIDIA API Trial and Gemini free-tier content may be logged or used to improve provider products. Use only after approving provider data handling.</span></label><div className="review-ai-row"><button type="button" className="button button-secondary" disabled={busy||!aiConsent} onClick={()=>void translate()}><Activity size={15}/>{busy?'Working…':'Suggest English translation'}</button>{provider&&<span>Suggestion from {provider} · requires review</span>}</div><label className="form-label">English translation<textarea rows={3} value={translation} onChange={e=>setTranslation(e.target.value)} placeholder="Review or enter an English translation…"/></label><label className="form-label">Issue category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="material">Material availability</option><option value="equipment">Machine / equipment</option><option value="capacity">Production capacity</option><option value="quality">Quality / rework</option><option value="printing_finishing">Printing / finishing</option><option value="other">Other</option></select></label><div className="buyer-safe-editor"><label className="form-label">Buyer-safe remark <span className="optional-label">Optional</span><textarea rows={2} value={buyerSafeText} onChange={e=>setBuyerSafeText(e.target.value)} placeholder="Write only what is approved for the buyer portal…"/></label><label className="mismatch-ack"><input type="checkbox" checked={buyerApproved} onChange={e=>setBuyerApproved(e.target.checked)}/><span>Approve this separate remark for buyer visibility. Translation approval alone does not publish it.</span></label></div>{error&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}<div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Close</button><button className="button button-secondary" disabled={busy} onClick={()=>void saveReview(false)}>Save review</button><button className="button button-primary" disabled={busy} onClick={()=>void saveReview(true)}>Approve review <Check size={15}/></button></div></section></div>
}

function ReportsPage({ orders, notify }: { orders: Order[]; notify: (s: string) => void }) {
  const [buyer, setBuyer] = useState(''); const [weekStart,setWeekStart]=useState(()=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));return localInputDate(d)})
  const [busy,setBusy]=useState(false)
  const [weeklyUpdates,setWeeklyUpdates]=useState<WeeklyUpdateInput[]>([])
  const [loadingWeeklyUpdates,setLoadingWeeklyUpdates]=useState(false)
  const [weeklyLoadError,setWeeklyLoadError]=useState('')
  const buyers=[...new Map(orders.filter(o=>o.buyerId).map(o=>[o.buyerId!,{id:o.buyerId!,name:o.buyer}])).values()]
  useEffect(()=>{if(!buyer&&buyers[0])setBuyer(buyers[0].id)},[buyers,buyer])
  const chosenBuyer=buyers.find(b=>b.id===buyer)
  const weekEnd=(()=>{const d=new Date(`${weekStart}T00:00:00`);d.setDate(d.getDate()+6);return localInputDate(d)})()
  const reportOrders=orders.filter(order=>order.buyerId===buyer&&order.state!=='draft'&&order.state!=='cancelled'&&(!order.releaseDate||order.releaseDate.slice(0,10)<=weekEnd))
  const reportOrderKey=reportOrders.map(order=>order.id).sort().join(',')
  useEffect(()=>{
    if(!supabase||!buyer||!reportOrderKey){setWeeklyUpdates([]);setLoadingWeeklyUpdates(false);return}
    let active=true;setLoadingWeeklyUpdates(true);setWeeklyLoadError('')
    void (async()=>{
      try{
        const {data,error}=await supabase.from('production_updates').select('order_id,stage_id,quantity,reporting_date').in('order_id',reportOrderKey.split(',')).gte('reporting_date',weekStart).lte('reporting_date',weekEnd).order('reporting_date')
        if(error)throw new Error(`Could not load production activity for this week: ${error.message}`)
        if(active)setWeeklyUpdates((data??[]) as WeeklyUpdateInput[])
      }catch(error){if(active){setWeeklyUpdates([]);const message=error instanceof Error?error.message:'Could not load this week’s production activity.';setWeeklyLoadError(message);notify(message)}}
      finally{if(active)setLoadingWeeklyUpdates(false)}
    })()
    return()=>{active=false}
  },[buyer,reportOrderKey,weekStart,weekEnd])
  const snapshot=buildWeeklyReportSnapshot(reportOrders,weeklyUpdates,weekStart,weekEnd)
  const totalStageOutput=snapshot.reduce((sum,row)=>sum+row.stageOutputs.reduce((stageSum,stage)=>stageSum+stage.quantity,0),0)
  async function recordReport(format:'pdf'|'xlsx'){
    if(!supabase||!chosenBuyer){notify('Sign in to a connected workspace and select a buyer account.');return}
    setBusy(true)
    try{
      const {data:userData}=await supabase.auth.getUser();if(!userData.user)throw new Error('Your session has expired. Please sign in again.')
      if(loadingWeeklyUpdates)throw new Error('Wait for the selected week’s production activity to finish loading.')
      if(weeklyLoadError)throw new Error(`Report blocked because weekly activity did not load: ${weeklyLoadError}`)
      let outputBlob:Blob;const filename=`Threadline-${chosenBuyer.name.replace(/[^a-z0-9]+/gi,'-')}-${weekStart}.${format}`
      if(format==='pdf'){
        const {jsPDF}=await import('jspdf')
        const doc=new jsPDF();doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text('Threadline · Production update',16,20);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.text(chosenBuyer.name,16,29);doc.text(`Reporting week: ${weekStart} to ${weekEnd}`,16,36);doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`,16,43)
        let y=56
        for(const row of snapshot){if(y>260){doc.addPage();y=20}doc.setFont('helvetica','bold');doc.text(`${row.po} · ${row.style}`,16,y);doc.setFont('helvetica','normal');doc.text(`${row.colour} · ${row.currentStage} progress ${row.progressPercent}% · ${moneyless(row.currentProgress)} / ${moneyless(row.progressTarget)} pcs`,16,y+7);doc.text(`Remaining ${moneyless(row.remaining)} · Ex-factory ${row.exFactory} · ${row.statusAtExport}`,16,y+14);const weeklyText=row.stageOutputs.length?row.stageOutputs.map(stage=>`${stage.name}: ${moneyless(stage.quantity)}`).join(' · '):'No production updates recorded';const lines=doc.splitTextToSize(`Stage output during selected week: ${weeklyText}`,175);doc.text(lines,16,y+21);const milestones=doc.splitTextToSize(`Buyer-visible milestones at export: ${row.buyerVisibleMilestones.length?row.buyerVisibleMilestones.map(milestone=>`${milestone.name}: ${milestone.date} (${milestone.status})`).join(' | '):'None shared'}`,175);doc.text(milestones,16,y+21+lines.length*5);y+=31+(lines.length+milestones.length)*5}
        if(!snapshot.length)doc.text('No released or completed orders for this buyer.',16,y);outputBlob=doc.output('blob')
      }else{
        const ExcelJS=(await import('exceljs')).default
        const reportRows=snapshot.map(row=>({po:row.po,style:row.style,colour:row.colour,quantity:row.quantity,currentStage:row.currentStage,completed:row.currentProgress,remaining:row.remaining,progress:row.progressPercent,exFactory:row.exFactory,status:row.statusAtExport,stageOutput:row.stageOutputs.map(stage=>`${stage.name}: ${moneyless(stage.quantity)}`).join(' | ')||'No updates',milestones:row.buyerVisibleMilestones.map(milestone=>`${milestone.name}: ${milestone.date} (${milestone.status})`).join(' | ')}))
        const workbook=new ExcelJS.Workbook();workbook.creator='Threadline';workbook.created=new Date();const sheet=workbook.addWorksheet('Buyer report');sheet.columns=[{header:'PO',key:'po',width:18},{header:'Style',key:'style',width:30},{header:'Current stage',key:'currentStage',width:22},{header:'Colour',key:'colour',width:22},{header:'Order qty',key:'quantity',width:14},{header:'Current progress',key:'completed',width:16},{header:'Remaining',key:'remaining',width:14},{header:'Progress %',key:'progress',width:14},{header:'Ex-factory',key:'exFactory',width:16},{header:'Status at export',key:'status',width:18},{header:'Stage output during selected week',key:'stageOutput',width:48},{header:'Buyer-visible milestones at export',key:'milestones',width:56}];sheet.addRows(reportRows);sheet.autoFilter={from:'A1',to:'L1'};sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244C45'}};sheet.addRow([]);sheet.addRow(['Buyer',chosenBuyer.name]);sheet.addRow(['Reporting week',`${weekStart} to ${weekEnd}`]);sheet.addRow(['Generated',new Date().toLocaleString('en-IN')]);sheet.addRow(['Historical note','Stage quantities are filtered by reporting date; status and milestone state reflect export time.']);const buffer=await workbook.xlsx.writeBuffer();outputBlob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      }
      const {error:logError}=await supabase.from('weekly_reports').insert({buyer_id:buyer,week_start:weekStart,week_end:weekEnd,format,snapshot_data:snapshot,generated_by:userData.user.id})
      if(logError)throw logError
      downloadBlob(outputBlob,filename)
      notify(`${format.toUpperCase()} report generated and logged.`)
    }catch(reason){notify(reason instanceof Error?`Report failed: ${reason.message}`:'Report generation failed.')}
    finally{setBusy(false)}
  }
  const avg=reportOrders.length?Math.round(reportOrders.reduce((s,o)=>s+orderProgressPercent(o.completed,o.progressTarget??o.quantity),0)/reportOrders.length):0
  return <><div className="page-heading"><div><div className="eyebrow">BUYER COMMUNICATION</div><h1>Weekly reports</h1><p>Prepare a buyer-ready progress update with approved information.</p></div></div><div className="report-layout"><div className="panel-card report-config"><div className="panel-heading"><div><h3>Build a report</h3><span>Select an account and week</span></div></div><label className="form-label">Buyer account<select value={buyer} onChange={e=>setBuyer(e.target.value)}><option value="">Select buyer from live workspace</option>{buyers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="form-label">Week starting<input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)}/></label><div className="report-includes"><b>Included in this report</b><span><Check size={15}/> Buyer-authorised released and complete orders</span><span><Check size={15}/> Progress, ex-factory dates and buyer-visible milestones</span><span><ShieldCheck size={15}/> Internal issues, unapproved photos and notes are excluded</span></div>{!supabase&&<div className="form-error"><TriangleAlert size={15}/> Preview mode cannot generate a report from synthetic data.</div>}{loadingWeeklyUpdates&&<div className="inline-loading">Loading production activity for the selected week…</div>}{weeklyLoadError&&<div className="form-error"><TriangleAlert size={15}/>{weeklyLoadError} Change the week or buyer to retry.</div>}<div className="report-actions"><button className="button button-secondary" disabled={busy||loadingWeeklyUpdates||Boolean(weeklyLoadError)||!supabase||!chosenBuyer} onClick={()=>void recordReport('pdf')}><Download size={15}/>{busy?'Generating…':'Export PDF'}</button><button className="button button-primary" disabled={busy||loadingWeeklyUpdates||Boolean(weeklyLoadError)||!supabase||!chosenBuyer} onClick={()=>void recordReport('xlsx')}><FileSpreadsheet size={15}/>{busy?'Generating…':'Export Excel'}</button></div></div><div className="panel-card report-preview"><div className="preview-doc-top"><span className="preview-brand">threadline<span> / </span>weekly update</span><span className="doc-period">{weekStart} — {weekEnd}</span></div><h2>{chosenBuyer?.name??'Select a buyer'}</h2><p>Production snapshot · {new Date().toLocaleDateString('en-IN')}</p><div className="preview-stats"><div><span>ORDERS IN REPORT</span><b>{reportOrders.length.toString().padStart(2,'0')}</b></div><div><span>OUTPUT THIS WEEK</span><b>{moneyless(totalStageOutput)}</b></div><div><span>AVERAGE STAGE PROGRESS</span><b>{avg}%</b></div></div><div className="preview-list">{reportOrders.map(o=><div key={o.id}><span><b>{o.po}</b><small>{o.style} · {o.colour}</small></span><span className="mini-progress"><i style={{width:`${orderProgressPercent(o.completed,o.progressTarget??o.quantity)}%`}}/></span><b>{orderProgressPercent(o.completed,o.progressTarget??o.quantity)}%</b></div>)}</div><div className="preview-safe"><ShieldCheck size={14}/> Buyer-safe fields only · unapproved photos and remarks excluded</div></div></div></>
}
function localInputDate(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

type PlanStage = { stage_name: string; sequence_no: number; applicable: boolean; target_quantity: string; tna_milestone_name: string; lines: string[]; submitter_ids:string[] }
type PlanMilestone = { name: string; target_date: string; sequence_no: number; buyer_visible: boolean; notes: string }
function PlanModal({ order, live, demoMode, onClose, onSaved }: { order: Order; live: boolean; demoMode:boolean; onClose: () => void; onSaved: (plan?:{release:boolean;buyerVisible:boolean;stages:OrderStage[];milestones:OrderMilestone[]}) => Promise<void> }) {
  const [stageTemplates,setStageTemplates]=useState<{id:string;name:string;steps:{stage_name:string;sequence_no:number;default_applicable:boolean}[]}[]>([])
  const [tnaTemplates,setTnaTemplates]=useState<{id:string;name:string;date_basis:string;milestones:{name:string;offset_days:number|null;sequence_no:number}[]}[]>([])
  const [lines,setLines]=useState<{id:string;name:string}[]>([])
  const [supervisors,setSupervisors]=useState<{id:string;display_name:string}[]>([])
  const [stageTemplate,setStageTemplate]=useState(''); const [tnaTemplate,setTnaTemplate]=useState('')
  const [stages,setStages]=useState<PlanStage[]>([]); const [milestones,setMilestones]=useState<PlanMilestone[]>([]); const [shareBuyer,setShareBuyer]=useState(false)
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState('')
  useEffect(()=>{
    if(demoMode&&!live){setStageTemplates([{id:'demo-route',name:'Demo knitwear route',steps:[{stage_name:'Cutting',sequence_no:1,default_applicable:true},{stage_name:'Stitching',sequence_no:2,default_applicable:true},{stage_name:'Quality check',sequence_no:3,default_applicable:true},{stage_name:'Packing',sequence_no:4,default_applicable:true}]}]);setTnaTemplates([{id:'demo-tna',name:'Demo export schedule',date_basis:'ex_factory_offset',milestones:[{name:'Fabric in-house',offset_days:-30,sequence_no:1},{name:'Cutting start',offset_days:-20,sequence_no:2},{name:'Packing complete',offset_days:-3,sequence_no:3}]}]);setLines([{id:'demo-line-a',name:'Line A'},{id:'demo-line-b',name:'Line B'}]);setSupervisors([{id:'demo-supervisor-1',display_name:'Asha Supervisor'},{id:'demo-supervisor-2',display_name:'Ravi Supervisor'}]);setLoading(false);return}
    if(!live||!supabase||!order.unitId){setLoading(false);return}
    let active=true
    void (async()=>{
      try {
        const [st,tm,ln,sp]=await Promise.all([
          supabase!.from('stage_templates').select('id,name,stage_template_steps(stage_name,sequence_no,default_applicable)').eq('active',true).or(`unit_id.eq.${order.unitId},unit_id.is.null`).order('name'),
          supabase!.from('tna_templates').select('id,name,date_basis,tna_template_milestones(name,offset_days,sequence_no)').eq('active',true).or(`unit_id.eq.${order.unitId},unit_id.is.null`).order('name'),
          supabase!.from('production_lines').select('id,name').eq('unit_id',order.unitId).eq('active',true).order('name'),
          supabase!.from('profiles').select('id,display_name').eq('role','supervisor').eq('active',true).order('display_name')
        ])
        if(st.error)throw st.error;if(tm.error)throw tm.error;if(ln.error)throw ln.error;if(sp.error)throw sp.error
        const stageRows=(st.data??[]) as unknown as {id:string;name:string;stage_template_steps:{stage_name:string;sequence_no:number;default_applicable:boolean}[]}[]
        const tnaRows=(tm.data??[]) as unknown as {id:string;name:string;date_basis:string;tna_template_milestones:{name:string;offset_days:number|null;sequence_no:number}[]}[]
        if(!active)return
        setStageTemplates(stageRows.map(t=>({...t,steps:[...t.stage_template_steps].sort((a,b)=>a.sequence_no-b.sequence_no)})))
        setTnaTemplates(tnaRows.map(t=>({...t,milestones:[...t.tna_template_milestones].sort((a,b)=>a.sequence_no-b.sequence_no)})))
        setLines((ln.data??[]) as {id:string;name:string}[])
        setSupervisors((sp.data??[]) as {id:string;display_name:string}[])
      } catch(reason){if(active)setError(reason instanceof Error?reason.message:'Could not load planning templates.')}
      finally{if(active)setLoading(false)}
    })()
    return()=>{active=false}
  },[live,order.unitId])
  const selectedStageTemplate=stageTemplates.find(t=>t.id===stageTemplate)
  const selectedTnaTemplate=tnaTemplates.find(t=>t.id===tnaTemplate)
  function chooseStageTemplate(id:string){setStageTemplate(id);const template=stageTemplates.find(t=>t.id===id);setStages((template?.steps??[]).map((step,i)=>({stage_name:step.stage_name,sequence_no:i+1,applicable:step.default_applicable,target_quantity:String(order.quantity),tna_milestone_name:'',lines:[],submitter_ids:[]})))}
  function moveStage(index:number,direction:number){setStages(current=>{const target=index+direction;if(target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next.map((stage,i)=>({...stage,sequence_no:i+1}))})}
  function chooseTnaTemplate(id:string){setTnaTemplate(id);const template=tnaTemplates.find(t=>t.id===id);setMilestones((template?.milestones??[]).map((item,i)=>({name:item.name,target_date:item.offset_days===null?'':addDaysToDateOnly(order.shipDate,item.offset_days),sequence_no:i+1,buyer_visible:true,notes:''})))}
  async function savePlan(shouldRelease:boolean){
    setSaving(true);setError('')
    try{
      if(!live&& !demoMode)throw new Error('Planning changes require a connected workspace. Preview data is not saved.')
      if(!stageTemplate||!tnaTemplate)throw new Error('Choose both an active production route and TNA template.')
      if(!stages.some(stage=>stage.applicable))throw new Error('At least one production stage must apply to this order.')
      if(!milestones.length||milestones.some(m=>!m.target_date))throw new Error('Add a target date for every TNA milestone.')
      if(shouldRelease&&stages.some(s=>s.applicable&&!s.submitter_ids.length))throw new Error('Assign at least one supervisor to every applicable stage before release.')
      if(demoMode&&!live){await onSaved({release:shouldRelease,buyerVisible:shouldRelease&&shareBuyer,stages:stages.map((stage,index)=>({id:`${order.id}-stage-${index+1}`,name:stage.stage_name,sequence:index+1,targetQuantity:stage.applicable?Number(stage.target_quantity)||order.quantity:null,lines:stage.lines.map((id,lineIndex)=>({id,name:lines.find(line=>line.id===id)?.name??`Line ${lineIndex+1}`}))})),milestones:milestones.map(milestone=>({name:milestone.name,date:milestone.target_date,status:'upcoming',buyerVisible:milestone.buyer_visible}))});return}
      if(!supabase)throw new Error('The workspace connection is unavailable.')
      const {error:rpcError}=await supabase.rpc('save_order_plan',{order_id_input:order.id,stage_template_id_input:stageTemplate,tna_template_id_input:tnaTemplate,stages_input:stages.map((s,i)=>({...s,sequence_no:i+1,target_quantity:Number(s.target_quantity)||order.quantity,lines:s.lines.map(line_id=>({line_id,submitter_ids:[]}))})),milestones_input:milestones.map((m,i)=>({...m,sequence_no:i+1})),release_input:shouldRelease,buyer_visible_input:shouldRelease&&shareBuyer})
      if(rpcError)throw new Error([rpcError.message,rpcError.details,rpcError.hint,rpcError.code?`Code: ${rpcError.code}`:''].filter(Boolean).join(' · '))
      await onSaved()
    }catch(reason){setError(reason instanceof Error?reason.message:typeof reason==='object'&&reason!==null&&'message' in reason?String(reason.message):'Could not save the production plan.')}
    finally{setSaving(false)}
  }
  return <ModalFrame title="Plan production" eyebrow={`${order.po} · ${order.unit}`} onClose={onClose}>
    <div className="plan-modal-content">
    {!live&&<div className="workspace-warning"><Settings2 size={17}/><div><b>Planning needs a connected workspace.</b><span>This preview order has no real template, line, or calendar records. Configure Supabase to create its production plan.</span></div></div>}
    {loading?<p className="modal-intro">Loading active templates and production lines…</p>:<>
      <p className="modal-intro">Choose the route and milestone template, then review the generated sequence and dates before releasing the PO.</p>
      <div className="form-grid"><label className="form-label">Production route<select value={stageTemplate} onChange={e=>chooseStageTemplate(e.target.value)}><option value="">Select active template</option>{stageTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="form-label">TNA template<select value={tnaTemplate} onChange={e=>chooseTnaTemplate(e.target.value)}><option value="">Select active template</option>{tnaTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
      {selectedStageTemplate&&<section className="plan-editor"><div className="panel-heading"><div><h3>Production stages</h3><span>{stages.filter(stage=>stage.applicable).length} of {stages.length} stages included · {moneyless(order.quantity)} pieces</span></div></div>{stages.map((stage,index)=><details className="plan-stage" key={`${stage.stage_name}-${index}`}><summary><label className="plan-applicable" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={stage.applicable} onChange={e=>setStages(xs=>xs.map((x,i)=>i===index?{...x,applicable:e.target.checked}:x))}/><b>{String(index+1).padStart(2,'0')} · {stage.stage_name}</b></label><span className={`plan-stage-state ${stage.applicable?'is-included':''}`}>{stage.applicable?(stage.submitter_ids.length?`${stage.submitter_ids.length} supervisor${stage.submitter_ids.length===1?'':'s'}`:'Needs supervisor'):'Skipped'}</span><span className="plan-stage-reorder"><button type="button" aria-label={`Move ${stage.stage_name} up`} disabled={index===0} onClick={e=>{e.preventDefault();e.stopPropagation();moveStage(index,-1)}}><ChevronUp size={13}/></button><button type="button" aria-label={`Move ${stage.stage_name} down`} disabled={index===stages.length-1} onClick={e=>{e.preventDefault();e.stopPropagation();moveStage(index,1)}}><ChevronDown size={13}/></button></span></summary><div className="plan-stage-fields"><label className="form-label">Target quantity<input type="number" min="0" value={stage.target_quantity} onChange={e=>setStages(xs=>xs.map((x,i)=>i===index?{...x,target_quantity:e.target.value}:x))}/></label><label className="form-label">Production lines<select multiple value={stage.lines} onChange={e=>setStages(xs=>xs.map((x,i)=>i===index?{...x,lines:Array.from(e.target.selectedOptions,o=>o.value)}:x))}>{lines.map(line=><option key={line.id} value={line.id}>{line.name}</option>)}</select><small>Use Ctrl/⌘ to select more than one.</small></label><label className="form-label">Assigned supervisors<select multiple value={stage.submitter_ids} onChange={e=>setStages(xs=>xs.map((x,i)=>i===index?{...x,submitter_ids:Array.from(e.target.selectedOptions,o=>o.value)}:x))}>{supervisors.map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}</select><small>Required before release.</small></label><label className="form-label">Related milestone<select value={stage.tna_milestone_name} onChange={e=>setStages(xs=>xs.map((x,i)=>i===index?{...x,tna_milestone_name:e.target.value}:x))}><option value="">Ex-factory date</option>{milestones.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label></div></details>)}</section>}
      {selectedTnaTemplate&&<section className="plan-editor"><div className="panel-heading"><div><h3>TNA milestone dates</h3><span>Template dates are generated from ex-factory and can be adjusted here.</span></div></div>{milestones.map((m,index)=><div className="plan-milestone" key={`${m.name}-${index}`}><b>{m.name}</b><label className="form-label">Target date<input type="date" value={m.target_date} onChange={e=>setMilestones(xs=>xs.map((x,i)=>i===index?{...x,target_date:e.target.value}:x))}/></label><label className="mismatch-ack"><input type="checkbox" checked={m.buyer_visible} onChange={e=>setMilestones(xs=>xs.map((x,i)=>i===index?{...x,buyer_visible:e.target.checked}:x))}/><span>Share milestone with buyer</span></label></div>)}</section>}
      {selectedTnaTemplate&&<label className="mismatch-ack buyer-plan-approval"><input type="checkbox" checked={shareBuyer} onChange={e=>setShareBuyer(e.target.checked)}/><span>Share this released order in the buyer portal. Only milestones and remarks separately marked buyer-visible will appear.</span></label>}
      {demoMode&&!live&&<div className="demo-inline-note"><ShieldCheck size={15}/>Sample route, supervisors and dates. Saving here only changes this demo session.</div>}
      {live&&!loading&&!stageTemplates.length&&<div className="form-error"><TriangleAlert size={15}/>No active stage templates exist for this unit. Ask an administrator to configure templates.</div>}
      {error&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}
      <div className="plan-release-note"><span className="plan-release-count">{stages.filter(stage=>stage.applicable).length}</span><span><b>Production stages included</b><small>{milestones.length} milestones · {shareBuyer?'Buyer portal sharing on':'Buyer portal sharing off'}</small></span></div>
      <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-secondary" disabled={saving||(!live&&!demoMode)||!stageTemplate||!tnaTemplate} onClick={()=>void savePlan(false)}>Save draft</button><button className="button button-primary" disabled={saving||(!live&&!demoMode)||!stageTemplate||!tnaTemplate} onClick={()=>void savePlan(true)}>{saving?'Saving…':demoMode?'Release demo plan':'Release plan'} <ArrowRight size={15}/></button></div>
    </>}
    </div>
  </ModalFrame>
}

function BuyerPage({ buyerName, orders, setSelected }: { buyerName: string; orders: Order[]; setSelected: (o: Order) => void }) {
  return <>
    <div className="buyer-welcome"><div className="eyebrow">{buyerName.toUpperCase()} · BUYER PORTAL</div><h1>Your production, at a glance.</h1><p>View current progress and milestones for your authorised orders.</p></div>
    <div className="buyer-banner"><div className="buyer-banner-icon"><ShieldCheck size={19} /></div><div><b>Your orders are private</b><span>This portal only shows orders shared with your account.</span></div><span className="read-only-label"><LockKeyhole size={13} /> Read only</span></div>
    <div className="section-heading buyer-list-heading"><div><h2>Your orders</h2><span className="section-subtitle">Progress for the most advanced stage with reported output</span></div><span className="buyer-order-count">{orders.length} orders</span></div>
    <div className="buyer-order-grid">{orders.map(order=>{const target=order.progressTarget??order.quantity;const pct=orderProgressPercent(order.completed,target);return <button className="buyer-order-card" key={order.id} onClick={()=>setSelected(order)}>
      <div className="buyer-card-top"><span>{order.po}</span><BuyerStatusBadge state={order.state} hasProgress={order.completed>0}/></div><h3>{order.style}</h3>
      <p>{order.colour} <i/> Ex-factory {new Date(`${order.shipDate}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</p>
      <div className="buyer-card-progress"><div><b>{pct}%</b><span>of {moneyless(target)} pcs</span></div><div className="progress-track"><i style={{width:`${pct}%`}}/></div></div>
      <div className="buyer-card-foot"><span>Current stage <b>{order.stage}</b></span><span>Updated {order.updatedAt}</span></div>
    </button>})}</div>
  </>
}

type WorkspaceEditRecord =
  | {kind:'buyer';id:string;name:string;active:boolean}
  | {kind:'unit';id:string;name:string;timezone:string;working_days:number[];active:boolean}
  | {kind:'line';id:string;unit_id:string;name:string;active:boolean}
  | {kind:'stage';id:string;unit_id:string;name:string;active:boolean;steps:{stage_name:string;default_applicable:boolean}[]}
  | {kind:'tna';id:string;unit_id:string;name:string;active:boolean;milestones:{name:string;offset_days:number|null}[]}
  | {kind:'holiday';unit_id:string;original_date:string;holiday_date:string;label:string}
  | {kind:'risk';id:string;unit_id:string;config_name:string;recent_workdays:number;amber_required_rate_ratio:number;red_required_rate_ratio:number;stale_after_hours:number;provisional:boolean}

function WorkspacePage({live,demoMode,notify}:{live:boolean;demoMode:boolean;notify:(message:string)=>void}) {
  const [buyers,setBuyers]=useState<{id:string;name:string;active:boolean}[]>([])
  const [units,setUnits]=useState<{id:string;name:string;working_days:number[];timezone:string;active:boolean}[]>([])
  const [lines,setLines]=useState<{id:string;unit_id:string;name:string;active:boolean}[]>([])
  const [stageTemplates,setStageTemplates]=useState<{id:string;unit_id:string|null;name:string;active:boolean;version:number;stage_template_steps:{stage_name:string;sequence_no:number;default_applicable:boolean}[]}[]>([])
  const [tnaTemplates,setTnaTemplates]=useState<{id:string;unit_id:string|null;name:string;active:boolean;version:number;date_basis:string;tna_template_milestones:{name:string;offset_days:number|null;sequence_no:number}[]}[]>([])
  const [loading,setLoading]=useState(live);const [busy,setBusy]=useState(false)
  const [buyerName,setBuyerName]=useState('');const [unitName,setUnitName]=useState('');const [workingDays,setWorkingDays]=useState<number[]>([])
  const [lineName,setLineName]=useState('');const [lineUnit,setLineUnit]=useState('')
  const [templateName,setTemplateName]=useState('');const [templateUnit,setTemplateUnit]=useState('');const [templateSteps,setTemplateSteps]=useState('');const [templateActive,setTemplateActive]=useState(false)
  const [tnaName,setTnaName]=useState('');const [tnaUnit,setTnaUnit]=useState('');const [tnaSteps,setTnaSteps]=useState('');const [tnaActive,setTnaActive]=useState(false)
  const [riskUnit,setRiskUnit]=useState('');const [recentDays,setRecentDays]=useState('');const [amberRatio,setAmberRatio]=useState('');const [redRatio,setRedRatio]=useState('');const [staleHours,setStaleHours]=useState('');const [approveRisk,setApproveRisk]=useState(false)
  const [holidayUnit,setHolidayUnit]=useState('');const [holidayDate,setHolidayDate]=useState('');const [holidayLabel,setHolidayLabel]=useState('')
  const [holidays,setHolidays]=useState<{unit_id:string;holiday_date:string;label:string}[]>([])
  const [riskPolicies,setRiskPolicies]=useState<{id:string;unit_id:string|null;config_name:string;recent_workdays:number;amber_required_rate_ratio:number;red_required_rate_ratio:number;stale_after_hours:number;provisional:boolean;approved_at:string|null}[]>([])
  const [releasedOrders,setReleasedOrders]=useState<{id:string;buyer_id:string;unit_id:string;stage_template_id:string|null;tna_template_id:string|null}[]>([])
  const [releasedLineIds,setReleasedLineIds]=useState<string[]>([])
  const [editRecord,setEditRecord]=useState<WorkspaceEditRecord|null>(null)
  async function reload(){if(!supabase||!live){setLoading(false);return}setLoading(true);try{const [b,u,l,s,t,h,r,p]=await Promise.all([supabase.from('buyers').select('id,name,active').order('name'),supabase.from('production_units').select('id,name,working_days,timezone,active').order('name'),supabase.from('production_lines').select('id,unit_id,name,active').order('name'),supabase.from('stage_templates').select('id,unit_id,name,active,version,stage_template_steps(stage_name,sequence_no,default_applicable)').order('name'),supabase.from('tna_templates').select('id,unit_id,name,active,version,date_basis,tna_template_milestones(name,offset_days,sequence_no)').order('name'),supabase.from('unit_holidays').select('unit_id,holiday_date,label').order('holiday_date'),supabase.from('risk_configuration').select('id,unit_id,config_name,recent_workdays,amber_required_rate_ratio,red_required_rate_ratio,stale_after_hours,provisional,approved_at').order('config_name'),supabase.from('purchase_orders').select('id,buyer_id,unit_id,stage_template_id,tna_template_id').in('state',['released','complete'])]);for(const q of[b,u,l,s,t,h,r,p])if(q.error)throw q.error;setBuyers(b.data??[]);setUnits(u.data??[]);setLines(l.data??[]);setStageTemplates((s.data??[]) as unknown as typeof stageTemplates);setTnaTemplates((t.data??[]) as unknown as typeof tnaTemplates);setHolidays(h.data??[]);setRiskPolicies((r.data??[]) as typeof riskPolicies);setReleasedOrders(p.data??[]);const releasedIds=(p.data??[]).map(row=>row.id);const {data:stageRows,error:stageError}=releasedIds.length?await supabase.from('order_stages').select('id,stage_line_assignments(line_id)').in('order_id',releasedIds):{data:[],error:null};if(stageError)throw stageError;const assignedRows=(stageRows??[]) as unknown as {stage_line_assignments:{line_id:string}[]}[];setReleasedLineIds([...new Set(assignedRows.flatMap(row=>row.stage_line_assignments.map(line=>line.line_id)))])}catch(reason){notify(reason instanceof Error?reason.message:'Could not load workspace configuration.')}finally{setLoading(false)}}
  useEffect(()=>{void reload()},[live])
  async function save(action:()=>Promise<void>):Promise<boolean>{if(!supabase||!live){notify('Configuration requires a signed-in administrator.');return false}setBusy(true);try{await action();await reload();notify('Workspace configuration saved.');return true}catch(reason){notify(reason instanceof Error?reason.message:'Configuration could not be saved.');return false}finally{setBusy(false)}}
  function isLocked(kind:WorkspaceEditRecord['kind'],id:string){return kind==='buyer'?releasedOrders.some(order=>order.buyer_id===id):kind==='unit'?releasedOrders.some(order=>order.unit_id===id):kind==='stage'?releasedOrders.some(order=>order.stage_template_id===id):kind==='tna'?releasedOrders.some(order=>order.tna_template_id===id):kind==='line'?releasedLineIds.includes(id):kind==='holiday'||kind==='risk'?releasedOrders.some(order=>order.unit_id===(kind==='holiday'?id:riskPolicies.find(policy=>policy.id===id)?.unit_id)):false}
  function openEdit(record:WorkspaceEditRecord){if(isLocked(record.kind,record.kind==='holiday'?record.unit_id:record.id)){notify('This workspace setting is locked because it is used by a released order. Create a new record for future orders.');return}setEditRecord(record)}
  function startTemplateVersion(record:WorkspaceEditRecord){if(record.kind==='stage'){setTemplateName(record.name);setTemplateUnit(record.unit_id);setTemplateSteps(record.steps.map(step=>step.stage_name).join('\n'));setTemplateActive(false);window.scrollTo({top:0,behavior:'smooth'});notify('Template copied into the editor. Saving it creates the next version.')}
    else if(record.kind==='tna'){setTnaName(record.name);setTnaUnit(record.unit_id);setTnaSteps(record.milestones.map(item=>`${item.name} | ${item.offset_days??''}`).join('\n'));setTnaActive(false);window.scrollTo({top:0,behavior:'smooth'});notify('TNA template copied into the editor. Saving it creates the next version.')}
  }
  async function saveEdited(record:WorkspaceEditRecord):Promise<boolean>{const saved=await save(async()=>{if(!supabase)throw new Error('Connect the workspace first.');if(record.kind==='buyer'){const {error}=await supabase.from('buyers').update({name:record.name.trim(),active:record.active}).eq('id',record.id);if(error)throw error}
    else if(record.kind==='unit'){const {error}=await supabase.from('production_units').update({name:record.name.trim(),timezone:record.timezone,working_days:record.working_days,active:record.active}).eq('id',record.id);if(error)throw error}
    else if(record.kind==='line'){const {error}=await supabase.from('production_lines').update({unit_id:record.unit_id,name:record.name.trim(),active:record.active}).eq('id',record.id);if(error)throw error}
    else if(record.kind==='stage'){const {error}=await supabase.from('stage_templates').update({unit_id:record.unit_id,name:record.name.trim(),active:record.active}).eq('id',record.id);if(error)throw error;const {error:deleteError}=await supabase.from('stage_template_steps').delete().eq('template_id',record.id);if(deleteError)throw deleteError;const {error:insertError}=await supabase.from('stage_template_steps').insert(record.steps.map((step,index)=>({...step,template_id:record.id,sequence_no:index+1})));if(insertError)throw insertError}
    else if(record.kind==='tna'){const {error}=await supabase.from('tna_templates').update({unit_id:record.unit_id,name:record.name.trim(),active:record.active,date_basis:record.milestones.some(row=>row.offset_days===null)?'manual':'ex_factory_offset'}).eq('id',record.id);if(error)throw error;const {error:deleteError}=await supabase.from('tna_template_milestones').delete().eq('template_id',record.id);if(deleteError)throw deleteError;const {error:insertError}=await supabase.from('tna_template_milestones').insert(record.milestones.map((row,index)=>({...row,template_id:record.id,sequence_no:index+1})));if(insertError)throw insertError}
    else if(record.kind==='holiday'){if(holidays.some(row=>row.unit_id===record.unit_id&&row.holiday_date===record.holiday_date&&row.holiday_date!==record.original_date))throw new Error('This unit already has a holiday on that date.');const {error:deleteError}=await supabase.from('unit_holidays').delete().eq('unit_id',record.unit_id).eq('holiday_date',record.original_date);if(deleteError)throw deleteError;const {error}=await supabase.from('unit_holidays').insert({unit_id:record.unit_id,holiday_date:record.holiday_date,label:record.label.trim()});if(error)throw error}
    else{const {error}=await supabase.from('risk_configuration').update({unit_id:record.unit_id,config_name:record.config_name.trim(),recent_workdays:record.recent_workdays,amber_required_rate_ratio:record.amber_required_rate_ratio,red_required_rate_ratio:record.red_required_rate_ratio,stale_after_hours:record.stale_after_hours,provisional:true,approved_by:null,approved_at:null}).eq('id',record.id);if(error)throw error}
  });if(saved)setEditRecord(null);return saved}
  async function createTemplate(kind:'stage'|'tna'){
    const name=(kind==='stage'?templateName:tnaName).trim(),unitId=kind==='stage'?templateUnit:tnaUnit,raw=kind==='stage'?templateSteps:tnaSteps,active=kind==='stage'?templateActive:tnaActive
    const rows=raw.split('\n').map(line=>line.trim()).filter(Boolean)
    if(!name||!unitId||!rows.length)throw new Error('Add a template name, production unit and at least one row.')
    if(kind==='stage'){
      const parsed=rows.map(stage_name=>({stage_name,sequence_no:0,default_applicable:true}))
      await save(async()=>{const {data:prior,error:priorError}=await supabase!.from('stage_templates').select('version').eq('unit_id',unitId).eq('name',name).order('version',{ascending:false}).limit(1).maybeSingle();if(priorError)throw priorError;const version=(prior?.version??0)+1;const {data,error}=await supabase!.from('stage_templates').insert({unit_id:unitId,name,version,active:false}).select('id').single();if(error)throw error;const {error:stepError}=await supabase!.from('stage_template_steps').insert(parsed.map((step,i)=>({...step,template_id:data.id,sequence_no:i+1})));if(stepError)throw stepError;if(active){const {error:activateError}=await supabase!.from('stage_templates').update({active:true}).eq('id',data.id);if(activateError)throw activateError}})
      setTemplateName('');setTemplateSteps('');setTemplateActive(false)
    }else{
      const parsed=rows.map((line,i)=>{const [milestone,offset]=line.split('|').map(value=>value.trim());if(!milestone)throw new Error(`Add a milestone name on line ${i+1}.`);const offsetDays=offset===''||offset===undefined?null:Number(offset);if(offsetDays!==null&&!Number.isInteger(offsetDays))throw new Error(`Offset on line ${i+1} must be whole days, or blank for manual date entry.`);return{name:milestone,offset_days:offsetDays,sequence_no:i+1}})
      await save(async()=>{const {data:prior,error:priorError}=await supabase!.from('tna_templates').select('version').eq('unit_id',unitId).eq('name',name).order('version',{ascending:false}).limit(1).maybeSingle();if(priorError)throw priorError;const version=(prior?.version??0)+1;const {data,error}=await supabase!.from('tna_templates').insert({unit_id:unitId,name,version,date_basis:parsed.some(m=>m.offset_days===null)?'manual':'ex_factory_offset',active:false}).select('id').single();if(error)throw error;const {error:stepError}=await supabase!.from('tna_template_milestones').insert(parsed.map(m=>({...m,template_id:data.id})));if(stepError)throw stepError;if(active){const {error:activateError}=await supabase!.from('tna_templates').update({active:true}).eq('id',data.id);if(activateError)throw activateError}})
      setTnaName('');setTnaSteps('');setTnaActive(false)
    }
  }
  const weekdays=[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]] as const
  return <><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>Workspace setup</h1><p>Use confirmed factory information. Unapproved thresholds and calendars stay unset.</p></div><button className="button button-secondary" onClick={()=>void reload()} disabled={!live||loading}>Refresh</button></div>{!live&&<div className="workspace-warning"><Settings2 size={17}/><div><b>{demoMode?'Sample administrator view':'Connect a Supabase project and sign in as an administrator.'}</b><span>{demoMode?'Example buyers, units and templates are shown for the walkthrough. Live setup changes require an administrator account.':'Preview mode does not save workspace configuration.'}</span></div></div>}{demoMode&&<><div className="settings-grid"><SetupSummary title="Buyers" count={3} detail="Sample buyer accounts"/><SetupSummary title="Production units" count={3} detail="Sample factory units"/><SetupSummary title="Production lines" count={3} detail="Lines in Unit 01"/><SetupSummary title="Templates" count={2} detail="One route and one TNA schedule"/></div><section className="panel-card config-card demo-admin-snapshot"><div className="panel-heading"><div><h3>Sample workspace records</h3><span>These examples show what an administrator prepares before orders are planned.</span></div></div><div className="config-record-list"><div><span><b>Buyers</b><small>Northstar Kids · Harbor & Pine · Westwind Studio</small></span><span>3</span></div><div><span><b>Production unit</b><small>Unit 01 · Avinashi · Monday–Saturday</small></span><span>3 lines</span></div><div><span><b>Stage route</b><small>Cutting → Stitching → Quality check → Packing</small></span><span>Example</span></div><div><span><b>TNA schedule</b><small>Fabric in-house → Cutting start → Packing complete</small></span><span>Example</span></div></div></section></>}{loading&&<p className="modal-intro">Loading workspace configuration…</p>}
    {live&&<><div className="settings-grid"><SetupSummary title="Buyers" count={buyers.length} detail="Buyer accounts"/><SetupSummary title="Production units" count={units.length} detail="Units with configured calendars"/><SetupSummary title="Production lines" count={lines.length} detail="Active and inactive lines"/><SetupSummary title="Templates" count={stageTemplates.length+tnaTemplates.length} detail="Stage routes and TNA schedules"/></div>
    <div className="config-forms"><section className="panel-card config-card"><div className="panel-heading"><div><h3>Buyers and production units</h3><span>Use verified customer names and calendars.</span></div></div><form onSubmit={e=>{e.preventDefault();void save(async()=>{const {error}=await supabase!.from('buyers').insert({name:buyerName.trim()});if(error)throw error});setBuyerName('')}}><label className="form-label">Add buyer<input required value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="Confirmed buyer name"/></label><button className="button button-secondary" disabled={busy}>Add buyer</button></form><form onSubmit={e=>{e.preventDefault();if(!workingDays.length){notify('Select the confirmed working days before saving this unit.');return}void save(async()=>{const {error}=await supabase!.from('production_units').insert({name:unitName.trim(),timezone:'Asia/Kolkata',working_days:workingDays});if(error)throw error});setUnitName('')}}><label className="form-label">Add production unit<input required value={unitName} onChange={e=>setUnitName(e.target.value)} placeholder="Factory/unit name"/></label><div className="weekday-picks">{weekdays.map(([label,value])=><label key={value}><input type="checkbox" checked={workingDays.includes(value)} onChange={e=>setWorkingDays(current=>e.target.checked?[...current,value]:current.filter(day=>day!==value))}/>{label}</label>)}</div><button className="button button-secondary" disabled={busy}>Add unit</button></form></section>
    <section className="panel-card config-card"><div className="panel-heading"><div><h3>Production lines</h3><span>Assign lines to a unit before order planning.</span></div></div><form onSubmit={e=>{e.preventDefault();void save(async()=>{const {error}=await supabase!.from('production_lines').insert({unit_id:lineUnit,name:lineName.trim()});if(error)throw error});setLineName('')}}><label className="form-label">Production unit<select required value={lineUnit} onChange={e=>setLineUnit(e.target.value)}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="form-label">Line name<input required value={lineName} onChange={e=>setLineName(e.target.value)} placeholder="Line name or code"/></label><button className="button button-secondary" disabled={busy||!units.length}>Add production line</button></form></section>
    <section className="panel-card config-card"><div className="panel-heading"><div><h3>Stage route templates</h3><span>Enter one stage per line in its intended sequence.</span></div></div><form onSubmit={e=>{e.preventDefault();void createTemplate('stage')}}><label className="form-label">Template name<input required value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Customer-approved route"/></label><label className="form-label">Production unit<select required value={templateUnit} onChange={e=>setTemplateUnit(e.target.value)}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="form-label">Stages<textarea required rows={5} value={templateSteps} onChange={e=>setTemplateSteps(e.target.value)} placeholder={'Cutting\nStitching\nQuality check\nPacking'}/></label><label className="mismatch-ack"><input type="checkbox" checked={templateActive} onChange={e=>setTemplateActive(e.target.checked)}/><span>Activate this template after checking it against the approved factory route.</span></label><button className="button button-secondary" disabled={busy}>Save stage template</button></form><TemplateList rows={stageTemplates} units={units} isLocked={id=>isLocked('stage',id)} onToggle={(id,active)=>void save(async()=>{const {error}=await supabase!.from('stage_templates').update({active}).eq('id',id);if(error)throw error})}/></section>
    <section className="panel-card config-card"><div className="panel-heading"><div><h3>TNA templates</h3><span>Use one milestone per line: “Name | days from ex-factory”. Negative numbers are before ship date.</span></div></div><form onSubmit={e=>{e.preventDefault();void createTemplate('tna')}}><label className="form-label">Template name<input required value={tnaName} onChange={e=>setTnaName(e.target.value)} placeholder="Customer-approved TNA"/></label><label className="form-label">Production unit<select required value={tnaUnit} onChange={e=>setTnaUnit(e.target.value)}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="form-label">Milestones<textarea required rows={5} value={tnaSteps} onChange={e=>setTnaSteps(e.target.value)} placeholder={'Fabric in-house | -30\nCutting start | -20\nPacking complete | -3'}/></label><label className="mismatch-ack"><input type="checkbox" checked={tnaActive} onChange={e=>setTnaActive(e.target.checked)}/><span>Activate only after confirming every milestone and offset with the customer.</span></label><button className="button button-secondary" disabled={busy}>Save TNA template</button></form><TemplateList rows={tnaTemplates} units={units} isLocked={id=>isLocked('tna',id)} onToggle={(id,active)=>void save(async()=>{const {error}=await supabase!.from('tna_templates').update({active}).eq('id',id);if(error)throw error})}/></section>
    <section className="panel-card config-card"><div className="panel-heading"><div><h3>Working days and holidays</h3><span>Unit working days are stored on the production unit.</span></div></div><div className="config-record-list">{units.map(unit=><div key={unit.id}><b>{unit.name}</b><span>{unit.working_days.length?unit.working_days.map(d=>weekdays.find(day=>day[1]===d)?.[0]??d).join(', '):'No working calendar configured'}</span></div>)}</div><form onSubmit={e=>{e.preventDefault();void save(async()=>{const {error}=await supabase!.from('unit_holidays').insert({unit_id:holidayUnit,holiday_date:holidayDate,label:holidayLabel.trim()});if(error)throw error});setHolidayLabel('')}}><label className="form-label">Unit<select required value={holidayUnit} onChange={e=>setHolidayUnit(e.target.value)}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="form-label">Holiday<input required type="date" value={holidayDate} onChange={e=>setHolidayDate(e.target.value)}/></label><label className="form-label">Reason<input required value={holidayLabel} onChange={e=>setHolidayLabel(e.target.value)} placeholder="Holiday label"/></label><button className="button button-secondary" disabled={busy||!units.length}>Add holiday</button></form></section>
    <section className="panel-card config-card"><div className="panel-heading"><div><h3>Production risk policy</h3><span>Set thresholds only after company approval. Empty fields mean no policy is active.</span></div></div><form onSubmit={e=>{e.preventDefault();if(!approveRisk){notify('Only save thresholds after the authorised company approver confirms them.');return}void save(async()=>{const {error}=await supabase!.from('risk_configuration').upsert({unit_id:riskUnit,config_name:'Approved unit policy',recent_workdays:Number(recentDays),amber_required_rate_ratio:Number(amberRatio),red_required_rate_ratio:Number(redRatio),stale_after_hours:Number(staleHours),provisional:!approveRisk,approved_by:approveRisk?(await supabase!.auth.getUser()).data.user?.id:null,approved_at:approveRisk?new Date().toISOString():null},{onConflict:'unit_id'});if(error)throw error});setAmberRatio('');setRedRatio('');setApproveRisk(false)}}><label className="form-label">Production unit<select required value={riskUnit} onChange={e=>setRiskUnit(e.target.value)}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><div className="form-grid"><label className="form-label">Recent workdays<input required type="number" min="1" value={recentDays} onChange={e=>setRecentDays(e.target.value)}/></label><label className="form-label">Amber required-rate ratio<input required type="number" min="0" step="0.01" value={amberRatio} onChange={e=>setAmberRatio(e.target.value)} placeholder="Company approved"/></label><label className="form-label">Red required-rate ratio<input required type="number" min="0" step="0.01" value={redRatio} onChange={e=>setRedRatio(e.target.value)} placeholder="Company approved"/></label><label className="form-label">Stale after hours<input required type="number" min="1" value={staleHours} onChange={e=>setStaleHours(e.target.value)}/></label></div><label className="mismatch-ack"><input type="checkbox" checked={approveRisk} onChange={e=>setApproveRisk(e.target.checked)}/><span>I am authorised to approve these company risk thresholds.</span></label><button className="button button-secondary" disabled={busy||!units.length}>Save risk policy</button></form></section>
    </div><WorkspaceRecords buyers={buyers} units={units} lines={lines} stageTemplates={stageTemplates} tnaTemplates={tnaTemplates} holidays={holidays} riskPolicies={riskPolicies} isLocked={isLocked} onEdit={openEdit} onNewVersion={startTemplateVersion}/>{editRecord&&<WorkspaceEditModal record={editRecord} units={units} onClose={()=>setEditRecord(null)} onSave={record=>saveEdited(record)}/>}<div className="workspace-warning"><Users size={17}/><div><b>User provisioning and buyer access</b><span>Create accounts, assign roles, reset passwords, and map buyer users from the User management page. Keep the initial administrator and project secrets secure.</span></div></div></>}
  </>
}
type ManagedUser = { id:string; email:string; display_name:string; role:Role; active:boolean; created_at:string; buyerId:string }
type ManagedBuyer = { id:string; name:string; active:boolean }
type PasswordRequest = {id:string;user_id:string;request_note:string|null;status:'pending'|'completed'|'declined';admin_note:string|null;requested_at:string;reviewed_at:string|null}

function UserManagementPage({live,demoMode,notify,onPendingChange}:{live:boolean;demoMode:boolean;notify:(message:string)=>void;onPendingChange:(count:number)=>void}) {
  const [users,setUsers]=useState<ManagedUser[]>([])
  const [buyers,setBuyers]=useState<ManagedBuyer[]>([])
  const [passwordRequests,setPasswordRequests]=useState<PasswordRequest[]>([])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [editingId,setEditingId]=useState('')
  const [displayName,setDisplayName]=useState('')
  const [email,setEmail]=useState('')
  const [role,setRole]=useState<Role>('merchandiser')
  const [buyerId,setBuyerId]=useState('')
  const [password,setPassword]=useState('')
  const [active,setActive]=useState(true)
  const [handlingRequestId,setHandlingRequestId]=useState('')

  async function reload(){
    if(!live){setLoading(false);return}
    setLoading(true)
    try{const [result,requestResult]=await Promise.all([invokeProtectedFunction<{users:ManagedUser[];buyers:ManagedBuyer[]}>('manage-users',{action:'list'}),supabase!.from('password_change_requests').select('id,user_id,request_note,status,admin_note,requested_at,reviewed_at').order('requested_at',{ascending:false})]);if(requestResult.error)throw requestResult.error;setUsers(result.users);setBuyers(result.buyers);setPasswordRequests((requestResult.data??[]) as PasswordRequest[]);onPendingChange((requestResult.data??[]).filter(request=>request.status==='pending').length)}
    catch(error){notify(error instanceof Error?error.message:'Could not load workspace users.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{void reload()},[live])

  function clearForm(){setEditingId('');setDisplayName('');setEmail('');setRole('merchandiser');setBuyerId('');setPassword('');setActive(true);setHandlingRequestId('')}
  function editUser(user:ManagedUser){setEditingId(user.id);setDisplayName(user.display_name);setEmail(user.email);setRole(user.role);setBuyerId(user.buyerId);setPassword('');setActive(user.active);setHandlingRequestId('');window.scrollTo({top:0,behavior:'smooth'})}
  function resetForRequest(request:PasswordRequest){const user=users.find(item=>item.id===request.user_id);if(!user){notify('The account for this request could not be found. Refresh the user list.');return}editUser(user);setHandlingRequestId(request.id);setPassword('');window.scrollTo({top:0,behavior:'smooth'})}
  async function submit(event:FormEvent){
    event.preventDefault()
    if(role==='buyer'&&!buyerId){notify('Select the buyer account this user may access.');return}
    if(!editingId&&password.length<8){notify('Set a temporary password with at least 8 characters.');return}
    setSaving(true)
    try{
      const result=await invokeProtectedFunction<{message:string}>('manage-users',editingId?{action:'update',userId:editingId,displayName,email:email.trim(),role,buyerId,active,password}:{action:'create',displayName,email:email.trim(),role,buyerId,password})
      notify(result.message);const completedRequestId=handlingRequestId;clearForm();if(completedRequestId&&supabase){const {data:userData}=await supabase.auth.getUser();const {error:requestError}=await supabase.from('password_change_requests').update({status:'completed',reviewed_by:userData.user?.id??null,reviewed_at:new Date().toISOString(),admin_note:'Temporary password reset by an administrator. Share it securely with the user.'}).eq('id',completedRequestId).eq('status','pending');if(requestError)notify('Password reset succeeded, but the request could not be marked complete. Refresh and review it.')}await reload()
    }catch(error){notify(error instanceof Error?error.message:'Could not save this user.')}
    finally{setSaving(false)}
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>User management</h1><p>Create sign-in accounts, assign workspace roles, and control buyer access.</p></div><button className="button button-secondary" onClick={()=>void reload()} disabled={!live||loading}>Refresh</button></div>
    {!live&&<div className="workspace-warning"><LockKeyhole size={17}/><div><b>{demoMode?'Sample team access':'Connect a workspace and sign in as an administrator.'}</b><span>{demoMode?'These are example roles for exploring the workflow; use the role selector in the header to switch views.':'Preview mode cannot create accounts or change access.'}</span></div></div>}
    {demoMode&&<section className="panel-card config-card demo-admin-snapshot"><div className="panel-heading"><div><h3>Example workspace users</h3><span>In the live workspace, administrators create and manage these accounts here.</span></div></div><div className="managed-users-list">{[['Mira Merchandiser','Merchandiser'],['Asha Supervisor','Factory supervisor'],['Northstar Buyer','Buyer · Northstar Kids'],['Workspace Admin','Administrator']].map(([name,roleName])=><article className="managed-user" key={name}><div className="managed-user-main"><div className="managed-user-avatar">{name.slice(0,2).toUpperCase()}</div><div><b>{name}</b><span>Sample account · no sign-in credentials</span><small>{roleName}</small></div></div><span className="managed-user-state is-active">Demo</span></article>)}</div></section>}
    {live&&<>
      <section className="panel-card config-card password-request-panel"><div className="panel-heading"><div><h3>Password change requests</h3><span>Users can’t change their own password here. Reset it below, then share a temporary password securely.</span></div><span className="setting-count">{passwordRequests.filter(request=>request.status==='pending').length} pending</span></div>{loading?<p className="modal-intro">Loading requests…</p>:<div className="managed-users-list">{passwordRequests.map(request=>{const user=users.find(item=>item.id===request.user_id);return <article className="managed-user password-request-row" key={request.id}><div className="managed-user-main"><div className="managed-user-avatar">{(user?.display_name??'U').slice(0,2).toUpperCase()}</div><div><b>{user?.display_name??'Workspace user'}</b><span>{user?.email??'Account email unavailable'}</span><small>{request.request_note||'No additional details'} · {new Date(request.requested_at).toLocaleString()}</small></div></div><div className="managed-user-actions"><span className={`managed-user-state ${request.status==='pending'?'':'is-active'}`}>{request.status==='pending'?'Pending':request.status==='completed'?'Password reset':'Declined'}</span>{request.status==='pending'&&<button className="button button-primary" onClick={()=>resetForRequest(request)}>Reset password</button>}</div></article>})}{!passwordRequests.length&&<p className="buyer-empty-note">No password change requests.</p>}</div>}</section>
      <div className="config-forms user-management-layout">
      <section className="panel-card config-card"><div className="panel-heading"><div><h3>{editingId?'Edit workspace user':'Create a user'}</h3><span>{editingId?'Change this user’s role, buyer access, or active status.':'Create the login and ThreadLine profile together.'}</span></div></div>
        <form onSubmit={event=>void submit(event)}>
          <label className="form-label">Full name<input id="managed-user-name" name="displayName" required maxLength={120} value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Name shown in ThreadLine"/></label>
          <label className="form-label">Email address<input id="managed-user-email" name="email" required type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="person@company.com"/></label>
          <label className="form-label">Workspace role<select id="managed-user-role" name="role" value={role} onChange={event=>setRole(event.target.value as Role)}><option value="admin">Administrator</option><option value="merchandiser">Merchandiser</option><option value="supervisor">Factory supervisor</option><option value="buyer">Buyer</option></select></label>
          {role==='buyer'&&<label className="form-label">Buyer account<select id="managed-user-buyer" name="buyerId" required value={buyerId} onChange={event=>setBuyerId(event.target.value)}><option value="">Select buyer</option>{buyers.filter(buyer=>buyer.active).map(buyer=><option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}</select><small>Buyer users can see only orders shared with this account.</small></label>}
          <label className="form-label">{editingId?'Reset password (optional)':'Temporary password'}<input id="managed-user-password" name="password" required={!editingId} minLength={8} type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={editingId?'Leave blank to keep current password':'At least 8 characters'}/></label>
          {editingId&&<label className="mismatch-ack"><input id="managed-user-active" name="active" type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/><span>Account is active</span></label>}
          <div className="user-form-note"><ShieldCheck size={15}/><span>Share temporary passwords securely. Administrators cannot see existing passwords.</span></div>
          <div className="user-form-actions"><button className="button button-primary" disabled={saving}>{saving?'Saving…':editingId?'Save changes':'Create account'}</button>{editingId&&<button type="button" className="button button-secondary" onClick={clearForm} disabled={saving}>Cancel</button>}</div>
        </form>
      </section>
      <section className="panel-card config-card"><div className="panel-heading"><div><h3>Workspace users</h3><span>{users.length} account{users.length===1?'':'s'} · buyer access is managed here.</span></div></div>
        {loading?<p className="modal-intro">Loading users…</p>:<div className="managed-users-list">{users.map(user=><article className="managed-user" key={user.id}><div className="managed-user-main"><div className="managed-user-avatar">{user.display_name.slice(0,2).toUpperCase()}</div><div><b>{user.display_name}</b><span>{user.email||'No email on auth account'}</span><small>{roleLabels[user.role]}{user.role==='buyer'&&user.buyerId?` · ${buyers.find(buyer=>buyer.id===user.buyerId)?.name??'Buyer account'}`:''}</small></div></div><div className="managed-user-actions"><span className={`managed-user-state ${user.active?'is-active':''}`}>{user.active?'Active':'Inactive'}</span><button className="text-button" onClick={()=>editUser(user)}>Manage</button></div></article>)}{users.length===0&&<p className="buyer-empty-note">No workspace users were found.</p>}</div>}
      </section>
      </div>
    </>}
  </>
}

function ProfilePage({user,displayName,role,buyerAccount,live,demoMode,notify}:{user:User|null;displayName:string;role:Role;buyerAccount:string;live:boolean;demoMode:boolean;notify:(message:string)=>void}){
  const [requests,setRequests]=useState<PasswordRequest[]>([])
  const [note,setNote]=useState('')
  const [loading,setLoading]=useState(live)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const pending=requests.some(request=>request.status==='pending')
  async function reload(){if(!supabase||!user||!live){setLoading(false);return}setLoading(true);setError('');const {data,error:loadError}=await supabase.from('password_change_requests').select('id,user_id,request_note,status,admin_note,requested_at,reviewed_at').eq('user_id',user.id).order('requested_at',{ascending:false});if(loadError){setError(`Could not load password request status: ${loadError.message}`);setRequests([])}else setRequests((data??[]) as PasswordRequest[]);setLoading(false)}
  useEffect(()=>{void reload()},[live,user?.id])
  async function submit(event:FormEvent){event.preventDefault();if(!supabase||!user){setError('Sign in to send a request to your workspace administrator.');return}setSaving(true);setError('');const {error:requestError}=await supabase.from('password_change_requests').insert({user_id:user.id,request_note:note.trim()||null});if(requestError){setError(requestError.code==='23505'?'You already have a pending password request.':'Could not send the request: '+requestError.message)}else{setNote('');notify('Password change request sent to your workspace administrator. They will set a temporary password and contact you securely.');await reload()}setSaving(false)}
  return <><div className="page-heading"><div><div className="eyebrow">ACCOUNT</div><h1>My profile</h1><p>View your workspace account details and request help with your password.</p></div>{live&&<button className="button button-secondary" onClick={()=>void reload()} disabled={loading}>Refresh</button>}</div>
    {demoMode&&<div className="workspace-warning"><UserCircle size={17}/><div><b>Preview profile</b><span>This is sample information. Sign in to see your real account and contact an administrator.</span></div></div>}
    <section className="panel-card config-card profile-detail-card"><div className="profile-detail-avatar">{(displayName||roleLabels[role]).slice(0,2).toUpperCase()}</div><div className="profile-detail-content"><div className="eyebrow">WORKSPACE ACCOUNT</div><h2>{displayName||`Preview ${roleLabels[role]}`}</h2><div className="profile-detail-grid"><div><span>Email</span><b>{user?.email??(demoMode?'Demo account':'Unavailable')}</b></div><div><span>Role</span><b>{roleLabels[role]}</b></div>{role==='buyer'&&<div><span>Buyer account</span><b>{buyerAccount||'Not linked'}</b></div>}<div><span>Account status</span><b>{live?'Active':'Preview'}</b></div></div></div></section>
    <section className="panel-card config-card profile-password-card"><div className="panel-heading"><div><h3>Password assistance</h3><span>For security, an administrator will set a temporary password and give it to you directly.</span></div><LockKeyhole size={18}/></div>
      {!live&&<p className="buyer-empty-note">Sign in to send a password change request.</p>}
      {live&&<>{loading?<p className="modal-intro">Loading request status…</p>:error&&requests.length===0&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}{pending&&<div className="workspace-warning"><Clock3 size={17}/><div><b>Request sent · awaiting administrator</b><span>{requests.find(request=>request.status==='pending')?.requested_at?new Date(requests.find(request=>request.status==='pending')!.requested_at).toLocaleString():''}</span></div></div>}{!pending&&<form onSubmit={event=>void submit(event)}><label className="form-label">Optional note<textarea id="password-request-note" name="requestNote" maxLength={1000} rows={3} value={note} onChange={event=>setNote(event.target.value)} placeholder="Add a short note for your administrator"/></label>{error&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}<div className="user-form-note"><ShieldCheck size={15}/><span>This sends an in-app alert to workspace administrators. Your current password is never shared or displayed.</span></div><div className="user-form-actions"><button className="button button-primary" disabled={saving||loading}>{saving?'Sending request…':'Request password change'}</button></div></form>}{requests.filter(request=>request.status!=='pending').slice(0,3).map(request=><div className="profile-request-history" key={request.id}><b>{request.status==='completed'?'Password reset by administrator':'Request declined'}</b><span>{request.reviewed_at?new Date(request.reviewed_at).toLocaleString():new Date(request.requested_at).toLocaleString()}</span></div>)}</>}
    </section>
  </>
}

function WorkspaceRecords({buyers,units,lines,stageTemplates,tnaTemplates,holidays,riskPolicies,isLocked,onEdit,onNewVersion}:{buyers:{id:string;name:string;active:boolean}[];units:{id:string;name:string;working_days:number[];timezone:string;active:boolean}[];lines:{id:string;unit_id:string;name:string;active:boolean}[];stageTemplates:{id:string;unit_id:string|null;name:string;active:boolean;version:number;stage_template_steps:{stage_name:string;sequence_no:number;default_applicable:boolean}[]}[];tnaTemplates:{id:string;unit_id:string|null;name:string;active:boolean;version:number;date_basis:string;tna_template_milestones:{name:string;offset_days:number|null;sequence_no:number}[]}[];holidays:{unit_id:string;holiday_date:string;label:string}[];riskPolicies:{id:string;unit_id:string|null;config_name:string;recent_workdays:number;amber_required_rate_ratio:number;red_required_rate_ratio:number;stale_after_hours:number;provisional:boolean}[];isLocked:(kind:WorkspaceEditRecord['kind'],id:string)=>boolean;onEdit:(record:WorkspaceEditRecord)=>void;onNewVersion:(record:WorkspaceEditRecord)=>void}){
  const lock=(value:boolean)=><small className={value?'configuration-lock':'configuration-editable'}>{value?'Locked · released plan':'Editable'}</small>
  return <section className="panel-card config-card workspace-records"><div className="panel-heading"><div><h3>Manage existing workspace settings</h3><span>Edit records before they are used in a released plan. Locked records remain available for history.</span></div></div><div className="workspace-record-groups">
    <RecordGroup title="Buyer accounts" rows={buyers.map(row=>({key:row.id,title:row.name,detail:row.active?'Active':'Inactive',locked:isLocked('buyer',row.id),record:{kind:'buyer' as const,...row}}))} lock={lock} onEdit={onEdit}/>
    <RecordGroup title="Production units" rows={units.map(row=>({key:row.id,title:row.name,detail:`${row.timezone} · ${row.working_days.join(', ')||'No working days'}`,locked:isLocked('unit',row.id),record:{kind:'unit' as const,...row}}))} lock={lock} onEdit={onEdit}/>
    <RecordGroup title="Production lines" rows={lines.map(row=>({key:row.id,title:row.name,detail:`${units.find(unit=>unit.id===row.unit_id)?.name??'Unit'} · ${row.active?'Active':'Inactive'}`,locked:isLocked('line',row.id),record:{kind:'line' as const,...row}}))} lock={lock} onEdit={onEdit}/>
    <RecordGroup title="Stage route templates" rows={stageTemplates.map(row=>({key:row.id,title:`${row.name} · v${row.version}`,detail:`${row.stage_template_steps.slice().sort((a,b)=>a.sequence_no-b.sequence_no).map(step=>step.stage_name).join(' → ')} · ${row.active?'Active':'Inactive'}`,locked:isLocked('stage',row.id),versionable:true,record:{kind:'stage' as const,id:row.id,unit_id:row.unit_id??'',name:row.name,active:row.active,steps:row.stage_template_steps.map(step=>({stage_name:step.stage_name,default_applicable:step.default_applicable}))}}))} lock={lock} onEdit={onEdit} onVersion={onNewVersion}/>
    <RecordGroup title="TNA templates" rows={tnaTemplates.map(row=>({key:row.id,title:`${row.name} · v${row.version}`,detail:`${row.tna_template_milestones.slice().sort((a,b)=>a.sequence_no-b.sequence_no).map(item=>`${item.name} | ${item.offset_days??'manual'}`).join(' → ')} · ${row.active?'Active':'Inactive'}`,locked:isLocked('tna',row.id),versionable:true,record:{kind:'tna' as const,id:row.id,unit_id:row.unit_id??'',name:row.name,active:row.active,milestones:row.tna_template_milestones.map(item=>({name:item.name,offset_days:item.offset_days}))}}))} lock={lock} onEdit={onEdit} onVersion={onNewVersion}/>
    <RecordGroup title="Unit holidays" rows={holidays.map(row=>({key:`${row.unit_id}-${row.holiday_date}`,title:`${row.holiday_date} · ${row.label}`,detail:units.find(unit=>unit.id===row.unit_id)?.name??'Production unit',locked:isLocked('holiday',row.unit_id),record:{kind:'holiday' as const,unit_id:row.unit_id,original_date:row.holiday_date,holiday_date:row.holiday_date,label:row.label}}))} lock={lock} onEdit={onEdit}/>
    <RecordGroup title="Production risk policies" rows={riskPolicies.map(row=>({key:row.id,title:row.config_name,detail:`${units.find(unit=>unit.id===row.unit_id)?.name??'Unit'} · ${row.provisional?'Provisional':'Approved'}`,locked:Boolean(row.unit_id&&isLocked('risk',row.id)),record:{kind:'risk' as const,id:row.id,unit_id:row.unit_id??'',config_name:row.config_name,recent_workdays:row.recent_workdays,amber_required_rate_ratio:row.amber_required_rate_ratio,red_required_rate_ratio:row.red_required_rate_ratio,stale_after_hours:row.stale_after_hours,provisional:true}}))} lock={lock} onEdit={onEdit}/>
  </div></section>
}

function RecordGroup({title,rows,lock,onEdit,onVersion}:{title:string;rows:{key:string;title:string;detail:string;locked:boolean;versionable?:boolean;record:WorkspaceEditRecord}[];lock:(locked:boolean)=>ReactNode;onEdit:(record:WorkspaceEditRecord)=>void;onVersion?:(record:WorkspaceEditRecord)=>void}){return <div className="workspace-record-group"><h4>{title}</h4>{rows.map(row=><div className="workspace-record-row" key={row.key}><span><b>{row.title}</b>{lock(row.locked)}<small>{row.detail}</small></span><div className="workspace-record-actions"><button className="text-button" disabled={row.locked} onClick={()=>onEdit(row.record)}>Edit</button>{row.locked&&row.versionable&&onVersion&&<button className="text-button" onClick={()=>onVersion(row.record)}>New version</button>}</div></div>)}{!rows.length&&<small>No records.</small>}</div>}

function WorkspaceEditModal({record,units,onClose,onSave}:{record:WorkspaceEditRecord;units:{id:string;name:string;working_days:number[];timezone:string;active:boolean}[];onClose:()=>void;onSave:(record:WorkspaceEditRecord)=>Promise<boolean>}){
  const [name,setName]=useState('name'in record?record.name:'');const [active,setActive]=useState('active'in record?record.active:true);const [unitId,setUnitId]=useState('unit_id'in record?record.unit_id:'');const [timezone,setTimezone]=useState(record.kind==='unit'?record.timezone:'Asia/Kolkata');const [days,setDays]=useState<number[]>(record.kind==='unit'?record.working_days:[]);const [stages,setStages]=useState(record.kind==='stage'?record.steps.map(step=>step.stage_name).join('\n'):'');const [milestones,setMilestones]=useState(record.kind==='tna'?record.milestones.map(item=>`${item.name} | ${item.offset_days??''}`).join('\n'):'');const [holidayDate,setHolidayDate]=useState(record.kind==='holiday'?record.holiday_date:'');const [holidayLabel,setHolidayLabel]=useState(record.kind==='holiday'?record.label:'');const [risk,setRisk]=useState(record.kind==='risk'?{config_name:record.config_name,recent:String(record.recent_workdays),amber:String(record.amber_required_rate_ratio),red:String(record.red_required_rate_ratio),stale:String(record.stale_after_hours)}:{config_name:'',recent:'',amber:'',red:'',stale:''});const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const weekdays=[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]] as const
  const unitField=<label className="form-label">Production unit<select required value={unitId} onChange={event=>setUnitId(event.target.value)}>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
  const activeField=<label className="mismatch-ack"><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/><span>Active for future orders</span></label>
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{let next:WorkspaceEditRecord=record
    if(record.kind==='buyer')next={...record,name,active}
    else if(record.kind==='unit'){if(!days.length)throw new Error('Select at least one working day.');next={...record,name,active,timezone,working_days:days}}
    else if(record.kind==='line')next={...record,name,active,unit_id:unitId}
    else if(record.kind==='stage'){const rows=stages.split('\n').map(row=>row.trim()).filter(Boolean);if(!rows.length)throw new Error('Add at least one stage.');next={...record,name,active,unit_id:unitId,steps:rows.map(stage_name=>({stage_name,default_applicable:true}))}}
    else if(record.kind==='tna'){const rows=milestones.split('\n').map(row=>row.trim()).filter(Boolean);if(!rows.length)throw new Error('Add at least one milestone.');next={...record,name,active,unit_id:unitId,milestones:rows.map((row,index)=>{const [milestone,offset]=row.split('|').map(part=>part.trim());if(!milestone)throw new Error(`Add a milestone name on line ${index+1}.`);const offset_days=offset===''||offset===undefined?null:Number(offset);if(offset_days!==null&&!Number.isInteger(offset_days))throw new Error(`Offset on line ${index+1} must be a whole number or blank.`);return{name:milestone,offset_days}})}}
    else if(record.kind==='holiday')next={...record,unit_id:unitId,holiday_date:holidayDate,label:holidayLabel}
    else{const amber=Number(risk.amber),red=Number(risk.red),recent=Number(risk.recent),stale=Number(risk.stale);if(red<amber||recent<1||stale<1)throw new Error('Check the risk thresholds and positive day values.');next={...record,unit_id:unitId,config_name:risk.config_name,recent_workdays:recent,amber_required_rate_ratio:amber,red_required_rate_ratio:red,stale_after_hours:stale,provisional:true}}
    await onSave(next)
  }catch(reason){setError(reason instanceof Error?reason.message:'Could not save this setting.')}finally{setSaving(false)}}
  const title=record.kind==='buyer'?'Edit buyer account':record.kind==='unit'?'Edit production unit':record.kind==='line'?'Edit production line':record.kind==='stage'?'Edit stage template':record.kind==='tna'?'Edit TNA template':record.kind==='holiday'?'Edit holiday':'Edit risk policy'
  return <ModalFrame title={title} eyebrow="WORKSPACE SETTINGS" onClose={onClose}><form onSubmit={event=>void submit(event)}>
    {record.kind==='buyer'&&<><label className="form-label">Buyer name<input required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></label>{activeField}</>}
    {record.kind==='unit'&&<><label className="form-label">Unit name<input required value={name} onChange={event=>setName(event.target.value)}/></label><label className="form-label">Timezone<input required value={timezone} onChange={event=>setTimezone(event.target.value)}/></label><div className="weekday-picks">{weekdays.map(([label,value])=><label key={value}><input type="checkbox" checked={days.includes(value)} onChange={event=>setDays(current=>event.target.checked?[...current,value]:current.filter(day=>day!==value))}/>{label}</label>)}</div>{activeField}</>}
    {record.kind==='line'&&<>{unitField}<label className="form-label">Line name<input required value={name} onChange={event=>setName(event.target.value)}/></label>{activeField}</>}
    {record.kind==='stage'&&<><label className="form-label">Template name<input required value={name} onChange={event=>setName(event.target.value)}/></label>{unitField}<label className="form-label">Stages<textarea required rows={6} value={stages} onChange={event=>setStages(event.target.value)}/></label>{activeField}</>}
    {record.kind==='tna'&&<><label className="form-label">Template name<input required value={name} onChange={event=>setName(event.target.value)}/></label>{unitField}<label className="form-label">Milestones<textarea required rows={6} value={milestones} onChange={event=>setMilestones(event.target.value)}/><small>Name | days from ex-factory. Use a blank offset for manual dates.</small></label>{activeField}</>}
    {record.kind==='holiday'&&<><div className="form-label">Production unit<b>{units.find(unit=>unit.id===record.unit_id)?.name??'Production unit'}</b></div><label className="form-label">Holiday date<input required type="date" value={holidayDate} onChange={event=>setHolidayDate(event.target.value)}/></label><label className="form-label">Reason<input required value={holidayLabel} onChange={event=>setHolidayLabel(event.target.value)}/></label></>}
    {record.kind==='risk'&&<>{unitField}<label className="form-label">Policy name<input required value={risk.config_name} onChange={event=>setRisk(current=>({...current,config_name:event.target.value}))}/></label><div className="form-grid">{([['recent','Recent workdays'],['amber','Amber ratio'],['red','Red ratio'],['stale','Stale after hours']] as const).map(([key,label])=><label className="form-label" key={key}>{label}<input required type="number" min={key==='amber'||key==='red'?'0':'1'} step={key==='amber'||key==='red'?'0.01':'1'} value={risk[key]} onChange={event=>setRisk(current=>({...current,[key]:event.target.value}))}/></label>)}</div><div className="user-form-note"><ShieldCheck size={15}/><span>Saving new thresholds clears approval. An authorised administrator must approve them again.</span></div></>}
    {error&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving?'Saving…':'Save changes'}</button></div>
  </form></ModalFrame>
}

function SetupSummary({title,count,detail}:{title:string;count:number;detail:string}){return <div className="setting-card"><div className="setting-icon"><Settings2 size={17}/></div><div className="setting-copy"><b>{title}</b><span>{detail}</span></div><span className="setting-count">{count}</span></div>}
function TemplateList({rows,units,onToggle,isLocked}:{rows:{id:string;unit_id:string|null;name:string;active:boolean;version:number}[];units:{id:string;name:string}[];onToggle:(id:string,active:boolean)=>void;isLocked:(id:string)=>boolean}){return <div className="config-record-list">{rows.map(row=>{const locked=isLocked(row.id);return <div key={row.id}><span><b>{row.name}</b><small>{units.find(u=>u.id===row.unit_id)?.name??'All units'} · v{row.version} · {row.active?'Active':'Inactive'}{locked?' · Locked by released plan':''}</small></span><button className="text-button" disabled={locked} onClick={()=>onToggle(row.id,!row.active)}>{row.active?'Deactivate':'Activate'}</button></div>})}{!rows.length&&<p className="buyer-empty-note">No templates configured yet.</p>}</div>}

function OrderDrawer({ order, live, preview, canManageMilestones, onMilestoneStatusChange, onPlan, onClose }: { order: Order; live: boolean; preview:boolean; canManageMilestones:boolean; onMilestoneStatusChange:(milestone:OrderMilestone,status:OrderMilestone['status'])=>void; onPlan: () => void; onClose: () => void }) {
  const pct = Math.round(order.completed / order.quantity * 100)
  const remaining = Math.max(0, order.quantity - order.completed)
  const requiredRate = order.workdaysLeft > 0 ? Math.ceil(remaining / order.workdaysLeft) : 0
  return <div className="drawer-backdrop" onClick={onClose}><aside className="order-drawer" onClick={e => e.stopPropagation()}><div className="drawer-top"><span className="eyebrow">ORDER DETAIL</span><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button></div><div className="drawer-title"><span className="order-code">{order.po}</span><RiskBadge risk={order.status} /><h2>{order.style}</h2><p>{order.buyer} <i /> {order.colour}</p></div><div className="drawer-summary"><div><span>Order quantity</span><b>{moneyless(order.quantity)} pcs</b></div><div><span>Ex-factory</span><b>{new Date(`${order.shipDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</b></div><div><span>Production unit</span><b>{order.unit}</b></div><div><span>Current stage</span><b><span className="stage-dot" /> {order.stage}</b></div></div><section className="drawer-section"><div className="drawer-section-heading"><h3>Production progress</h3><span>{pct}% complete</span></div><div className="progress-track drawer-progress"><i style={{ width: `${pct}%` }} /></div><div className="progress-numbers"><span>{moneyless(order.completed)} completed</span><span>{moneyless(remaining)} remaining</span></div></section><section className="drawer-section risk-explainer"><div className="risk-explainer-head"><span className="risk-explainer-icon"><Activity size={16} /></span><div><b>Production pace</b><span>{order.riskPolicyApproved?'Approved unit risk settings':preview?'Illustrative preview defaults':'No approved unit risk policy'} · working days</span></div></div><div className="pace-grid"><div><span>Recent output</span><b>{moneyless(order.recentDailyOutput)}<small> / day</small></b></div><div><span>Needed to target</span><b>{moneyless(requiredRate)}<small> / day</small></b></div><div><span>Working days left</span><b>{order.workdaysLeft}</b></div></div><div className={`risk-reason risk-reason-${order.status}`}>{order.status === 'insufficient' ? 'Insufficient production history or approved risk settings to calculate a reliable pace.' : requiredRate > order.recentDailyOutput ? `Required pace is ${Math.round(requiredRate / order.recentDailyOutput * 100)}% of recent output. Review the production plan.` : 'Recent pace currently meets the approved required daily output.'}</div><small className="threshold-note">The calculation uses the configured stage target, recent working-day output and days to its milestone.</small></section><section className="drawer-section"><h3>Latest update</h3><div className="latest-update"><span className="latest-update-icon"><Clock3 size={15} /></span><div><b>{order.updatedAt}</b><span>{order.blocked&&<b className="blocked-inline">Production blocked · </b>}{order.issue || 'No reported issue'}</span></div></div></section><section className="drawer-section milestone-section"><div className="drawer-section-heading"><h3>Upcoming milestones</h3><button className="text-button">View plan</button></div>{order.milestones?.length?order.milestones.map(milestone=><div className="order-milestone-row" key={milestone.id??milestone.name}><Milestone name={milestone.name} date={new Date(milestone.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})} state={milestone.status==='complete'?'done':milestone.status==='in_progress'?'current':milestone.status==='at_risk'||milestone.status==='overdue'?'attention':'next'}/>{canManageMilestones&&<label className="form-label milestone-status-control">Status<select aria-label={'Status for '+milestone.name} value={milestone.status} onChange={event=>onMilestoneStatusChange(milestone,event.target.value as OrderMilestone['status'])}><option value="upcoming">Upcoming</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="at_risk">At risk</option><option value="overdue">Overdue</option></select></label>}</div>):<p className="buyer-empty-note">No milestones have been added to this order.</p>}</section><div className="drawer-footer"><button className="button button-secondary" onClick={onClose}>Close</button>{order.state==='draft'&&<button className="button button-primary" onClick={onPlan} disabled={!live&&!preview}>Plan and release</button>}</div></aside></div>
}

function BuyerOrderDrawer({ order, demoPhotos, demoMode, onClose }: { order: Order; demoPhotos:{url:string;capturedAt:string}[]; demoMode:boolean; onClose: () => void }) {
  const [photos, setPhotos] = useState<{url:string;capturedAt:string}[]>([])
  const [photoState, setPhotoState] = useState<'loading'|'ready'|'unavailable'>('loading')
  useEffect(() => {
    if(demoMode){setPhotos(demoPhotos);setPhotoState('ready');return}
    if (!supabase) { setPhotoState('unavailable'); return }
    let active = true
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_buyer_approved_photo_paths', { target_order: order.id })
        if (error) throw error
        const rows = (data ?? []) as {storage_path:string;captured_at:string}[]
        const result: {url:string;capturedAt:string}[] = []
        for (const item of rows) {
          const signed = await invokeProtectedFunction<{url:string}>('approved-buyer-media', { orderId: order.id, path: item.storage_path })
          result.push({ url: signed.url, capturedAt: item.captured_at })
        }
        if (active) { setPhotos(result); setPhotoState('ready') }
      } catch { if (active) setPhotoState('unavailable') }
    })()
    return () => { active = false }
  }, [order.id,demoMode])
  const progressTarget=order.progressTarget??order.quantity
  const pct=orderProgressPercent(order.completed,progressTarget)
  return <div className="drawer-backdrop" onClick={onClose}><aside className="order-drawer buyer-drawer" onClick={e => e.stopPropagation()}><div className="drawer-top"><span className="eyebrow">YOUR ORDER</span><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button></div><div className="drawer-title"><span className="order-code">{order.po}</span><BuyerStatusBadge state={order.state} hasProgress={order.completed>0}/><h2>{order.style}</h2><p>{order.colour} · Ex-factory {new Date(`${order.shipDate}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</p></div><section className="drawer-section"><div className="drawer-section-heading"><h3>Most advanced stage</h3><span>{pct}% of stage target</span></div><div className="progress-track drawer-progress"><i style={{width:`${pct}%`}}/></div><div className="progress-numbers"><span>{moneyless(order.completed)} reported in {order.stage}</span><span>{moneyless(Math.max(0,progressTarget-order.completed))} stage target remaining</span></div></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Milestones</h3><span>Schedule shared by your team</span></div>{order.milestones?.length ? order.milestones.map((milestone,index)=><Milestone key={`${milestone.name}-${index}`} name={milestone.name} date={new Date(`${milestone.date}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})} state={milestone.status==='complete'?'done':milestone.status==='in_progress'?'current':milestone.status==='at_risk'||milestone.status==='overdue'?'attention':'next'}/>) : <p className="buyer-empty-note">Milestones will appear here once shared by your production team.</p>}</section>{Boolean(order.buyerSafeRemarks?.length)&&<section className="drawer-section"><div className="drawer-section-heading"><h3>Updates from your team</h3></div><div className="buyer-remarks">{order.buyerSafeRemarks?.map((remark,index)=><div key={index}><span>{remark.text}</span><small>{new Date(`${remark.date}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</small></div>)}</div></section>}<section className="drawer-section"><div className="drawer-section-heading"><h3>Production photos</h3><span>Approved for your account</span></div>{photos.length ? <div className="approved-photos">{photos.map((photo,index)=><figure key={index}><img src={photo.url} alt="Approved production update"/><figcaption>Production update · {new Date(photo.capturedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</figcaption></figure>)}</div> : <div className="buyer-photo-empty"><ImagePlus size={17}/><span>{photoState==='loading'?'Loading approved photos…':photoState==='unavailable'&&supabase?'Approved photos could not be loaded right now.':'No approved production photos have been shared yet.'}</span></div>}</section><div className="buyer-detail-foot"><ShieldCheck size={14}/> This view contains information approved for your buyer account.</div></aside></div>
}

function Milestone({ name, date, state }: { name: string; date: string; state: 'done' | 'current' | 'next' | 'attention' }) {
  return <div className={`milestone milestone-${state}`}><span className="milestone-mark">{state === 'done' ? <Check size={12} /> : state==='attention'?<TriangleAlert size={12}/>:<i />}</span><span className="milestone-name">{name}{state === 'current' && <small>In progress</small>}{state==='attention'&&<small>Needs attention</small>}</span><b>{date}</b></div>
}

type OrderDraftSubmission = {
  order: Order; buyerId?: string; unitId?: string; statedTotal: number | null
  mismatchAcknowledged: boolean; sizes: { size_label: string; quantity: number }[]
}

function OrderModal({ live, onClose, onSave }: { live: boolean; onClose: () => void; onSave: (submission: OrderDraftSubmission) => Promise<void> }) {
  const [po, setPo] = useState('')
  const [buyer, setBuyer] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [unit, setUnit] = useState('')
  const [unitId, setUnitId] = useState('')
  const [buyerOptions, setBuyerOptions] = useState<{id:string;name:string}[]>([])
  const [unitOptions, setUnitOptions] = useState<{id:string;name:string}[]>([])
  const [style, setStyle] = useState('')
  const [colour, setColour] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [sizes, setSizes] = useState([{ size: '', quantity: '' }])
  const [statedTotal, setStatedTotal] = useState('')
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(live)
  useEffect(() => {
    if (!live || !supabase) return
    let active = true
    void Promise.all([
      supabase.from('buyers').select('id,name').eq('active', true).order('name'),
      supabase.from('production_units').select('id,name').eq('active', true).order('name')
    ]).then(([buyersResult, unitsResult]) => {
      if (!active) return
      if (buyersResult.error || unitsResult.error) { setError('Could not load buyer and unit options. Check your workspace access.'); return }
      const buyers = buyersResult.data ?? []; const units = unitsResult.data ?? []
      setBuyerOptions(buyers); setUnitOptions(units)
      if (buyers[0]) { setBuyer(buyers[0].name); setBuyerId(buyers[0].id) }
      if (units[0]) { setUnit(units[0].name); setUnitId(units[0].id) }
      setLoadingOptions(false)
    }).catch(() => { if (active) setError('Could not load workspace options.') })
    return () => { active = false }
  }, [live])
  const total = sizes.reduce((sum, row) => sum + (row.quantity === '' ? 0 : Number(row.quantity)), 0)
  const stated = statedTotal.trim() === '' ? null : Number(statedTotal)
  const mismatch = stated !== null && stated !== total

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    const filled = sizes.filter(row => row.size.trim() || row.quantity.trim())
    if (!po.trim() || !buyer || !unit || !style.trim() || !colour.trim() || !shipDate || !filled.length) { setError('Add the buyer, unit, PO, style, colour, ship date and at least one size quantity.'); return }
    if (filled.some(row => !row.size.trim() || !/^\d+$/.test(row.quantity))) { setError('Each size needs a label and a whole-number quantity of zero or more.'); return }
    if (new Set(filled.map(row => row.size.trim().toLowerCase())).size !== filled.length) { setError('Each size label must be unique.'); return }
    if (!Number.isInteger(total) || total < 1) { setError('The calculated size total must be at least one piece.'); return }
    if (stated !== null && (!Number.isInteger(stated) || stated < 0)) { setError('The PO stated total must be a non-negative whole number.'); return }
    if (mismatch && !mismatchAcknowledged) { setError('Review the PO total mismatch and acknowledge it before saving.'); return }
    if (!live && previewOrders.some(order => order.po.toLowerCase() === po.trim().toLowerCase() && order.buyer === buyer)) { setError('This buyer already has an order with that PO number.'); return }
    const order: Order = { id: crypto.randomUUID(), po: po.trim(), buyer, unit, style: style.trim(), colour: colour.trim(), quantity: total, completed: 0, stage: 'Draft', shipDate, updatedAt: '—', recentDailyOutput: 0, workdaysLeft: 0, status: 'insufficient', freshness: 'No update', state: 'draft' }
    setSaving(true)
    try { await onSave({ order, buyerId: buyerId || undefined, unitId: unitId || undefined, statedTotal: stated, mismatchAcknowledged, sizes: filled.map(row => ({ size_label: row.size.trim(), quantity: Number(row.quantity) })) }) }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save this order.'); setSaving(false) }
  }

  return <ModalFrame title="Create an order" eyebrow="ORDER SETUP · DRAFT" onClose={onClose}><form onSubmit={e => void submit(e)}><p className="modal-intro">Add the PO details and size mix. You’ll set the production route and TNA dates before release.</p><div className="form-grid"><label className="form-label">Buyer account{live ? <select value={buyerId} disabled={loadingOptions} onChange={e => { const item = buyerOptions.find(row => row.id === e.target.value); setBuyerId(e.target.value); setBuyer(item?.name ?? '') }}><option value="">Select buyer</option>{buyerOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <select value={buyer} onChange={e => setBuyer(e.target.value)}><option value="">Select buyer</option>{previewOrders.map(order => order.buyer).filter((name,index,all)=>all.indexOf(name)===index).map(name=><option key={name}>{name}</option>)}</select>}</label><label className="form-label">Production unit{live ? <select value={unitId} disabled={loadingOptions} onChange={e => { const item = unitOptions.find(row => row.id === e.target.value); setUnitId(e.target.value); setUnit(item?.name ?? '') }}><option value="">Select unit</option>{unitOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <select value={unit} onChange={e => setUnit(e.target.value)}><option value="">Select unit</option><option>Unit 01 · Avinashi</option><option>Unit 02 · Tiruppur</option><option>Unit 03 · Palladam</option></select>}</label><label className="form-label">PO number<input value={po} onChange={e => setPo(e.target.value)} placeholder="e.g. PO-2510" /></label><label className="form-label">Garment style<input value={style} onChange={e => setStyle(e.target.value)} placeholder="Style name or code" /></label><label className="form-label">Colour / colourway<input value={colour} onChange={e => setColour(e.target.value)} placeholder="Colour name or code" /></label><label className="form-label">Ex-factory date<input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} /></label></div><div className="size-matrix"><div className="size-matrix-head"><b>Size breakdown</b><span>Total is calculated from size quantities</span></div><div className="size-entry-list">{sizes.map((row,index)=><div className="size-entry" key={index}><input aria-label={`Size ${index+1} label`} value={row.size} onChange={e => setSizes(current => current.map((item,i)=>i===index?{...item,size:e.target.value}:item))} placeholder="Size label" /><input aria-label={`Size ${index+1} quantity`} type="number" min="0" step="1" inputMode="numeric" value={row.quantity} onChange={e => setSizes(current => current.map((item,i)=>i===index?{...item,quantity:e.target.value}:item))} placeholder="Qty" />{sizes.length>1&&<button type="button" className="remove-size" aria-label="Remove size" onClick={()=>setSizes(current=>current.filter((_,i)=>i!==index))}><X size={14}/></button>}</div>)}</div><button type="button" className="add-size" onClick={()=>setSizes(current=>[...current,{size:'',quantity:''}])}><Plus size={13}/> Add size</button><div className="size-total"><span>Calculated size total</span><b>{moneyless(total)} <small>pieces</small></b></div><label className="form-label stated-total">PO stated total <span className="optional-label">Optional</span><input type="number" min="0" step="1" value={statedTotal} onChange={e=>{setStatedTotal(e.target.value);setMismatchAcknowledged(false)}} placeholder="Enter only if shown on the PO"/></label>{mismatch&&<label className="mismatch-ack"><input type="checkbox" checked={mismatchAcknowledged} onChange={e=>setMismatchAcknowledged(e.target.checked)}/> <span>PO states {moneyless(stated!)} pieces, but the size total is {moneyless(total)}. I’ve checked and acknowledge this mismatch.</span></label>}</div>{error&&<div className="form-error"><TriangleAlert size={15}/>{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving||loadingOptions}>{saving?'Saving…':'Save draft'} <ArrowRight size={15}/></button></div></form></ModalFrame>
}

function UpdateModal({ orders, previewOnly, onClose, onSave }: { orders: Order[]; previewOnly: boolean; onClose: () => void; onSave: (record: PendingUpdate, photo?: Blob, audio?: Blob) => Promise<void> }) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '')
  const [stageId, setStageId] = useState(orders[0]?.stageOptions?.[0]?.id ?? `${orders[0]?.id}-stage`)
  const [lineId, setLineId] = useState(orders[0]?.stageOptions?.[0]?.lines[0]?.id ?? `${orders[0]?.id}-line`)
  const [quantity, setQuantity] = useState('')
  const [issue, setIssue] = useState('')
  const [zeroReason, setZeroReason] = useState('')
  const [blocked,setBlocked]=useState(false)
  const [photo, setPhoto] = useState<File | undefined>()
  const [audio, setAudio] = useState<Blob | undefined>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedOrder = orders.find(order => order.id === orderId) ?? orders[0]
  if (!selectedOrder) return <ModalFrame title="No assigned orders" eyebrow="DAILY PRODUCTION" onClose={onClose}><p className="modal-intro">There are no assigned production orders available for an update. Ask your merchandiser to assign you to an order stage.</p><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div></ModalFrame>
  const stageOptions = selectedOrder.stageOptions?.length ? selectedOrder.stageOptions : [{ id: `${selectedOrder.id}-stage`, name: selectedOrder.stage, sequence: 1, targetQuantity: selectedOrder.quantity, lines: [{ id: `${selectedOrder.id}-line`, name: 'Line A' }, { id: `${selectedOrder.id}-line-b`, name: 'Line B' }] }]
  const selectedStage = stageOptions.find(stageOption => stageOption.id === stageId) ?? stageOptions[0]
  const lineOptions = selectedStage?.lines ?? []
  const selectedLine = lineOptions.find(option => option.id === lineId) ?? lineOptions[0]
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (quantity === '' || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) { setError('Enter a whole-number quantity, including 0 if there was no output.'); return }
    if (Number(quantity) === 0 && !zeroReason.trim()) { setError('Add a short reason for zero output.'); return }
    if (blocked && !issue.trim() && !audio) { setError('Add a short note or voice note explaining what is blocking this stage.'); return }
    if (!photo) { setError('Add a supporting photo, or contact your workspace administrator about the approved exception policy.'); return }
    setSaving(true); setError('')
    const record: PendingUpdate = { clientId: crypto.randomUUID(), previewOnly, orderId, stageId: selectedStage.id, stage: selectedStage.name, lineId: selectedLine?.id, line: selectedLine?.name ?? 'Stage total', reportingDate: localDate(), quantity: Number(quantity), zeroReason, blocked, issue, createdAt: new Date().toISOString(), syncState: 'waiting to sync' }
    try { await onSave(record, photo, audio); } catch { setError('Could not save this update locally. Keep this screen open and try again.'); setSaving(false) }
  }
  return <ModalFrame title="Add production update" eyebrow="DAILY PRODUCTION · TODAY" onClose={onClose}><form onSubmit={submit}><p className="modal-intro">Record the output for this reporting period. Threadline adds it to the cumulative total automatically.</p><label className="form-label">Assigned order<select value={orderId} onChange={e => { const next = orders.find(order => order.id === e.target.value); setOrderId(e.target.value); setStageId(next?.stageOptions?.[0]?.id ?? `${next?.id}-stage`); setLineId(next?.stageOptions?.[0]?.lines[0]?.id ?? `${next?.id}-line`) }}>{orders.map(o => <option key={o.id} value={o.id}>{o.po} · {o.style}</option>)}</select></label><div className="form-grid"><label className="form-label">Production stage<select value={selectedStage?.id} onChange={e => { setStageId(e.target.value); const stageOption = stageOptions.find(option => option.id === e.target.value); setLineId(stageOption?.lines[0]?.id ?? '') }}>{stageOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><label className="form-label">Production line<select value={selectedLine?.id ?? ''} onChange={e => setLineId(e.target.value)}><option value="">Stage total</option>{lineOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></div><label className="form-label quantity-label">Pieces completed today<div className="quantity-input-wrap"><input autoFocus type="number" min="0" step="1" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" /><span>pieces</span></div><small>Enter today’s output, not the running total.</small></label>{quantity === '0' && <label className="form-label">Reason for zero output<input value={zeroReason} onChange={e => setZeroReason(e.target.value)} placeholder="e.g. Machine maintenance" /></label>}<label className="blocked-toggle"><input type="checkbox" checked={blocked} onChange={e=>setBlocked(e.target.checked)}/><span><b>Production is blocked</b><small>Use this when the stage cannot continue; it is separate from an ordinary issue note.</small></span></label><label className="form-label">Issue note <span className="optional-label">Optional</span><textarea value={issue} onChange={e => setIssue(e.target.value)} placeholder="Anything blocking production? Type a short note…" rows={3} /></label><VoiceNoteCapture onRecorded={setAudio} /><label className="photo-drop"><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0])} /><span className="photo-drop-icon"><ImagePlus size={19} /></span><b>{photo ? photo.name : 'Add a production photo'}</b><small>{photo ? 'Photo will be saved with this update' : 'Tap to take a photo or choose from this device'}</small></label><div className="local-save-note"><LockKeyhole size={14} /> Saved on this device first, then synced when online.</div>{error && <div className="form-error"><TriangleAlert size={15} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary button-large" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save production update'} <ArrowRight size={15} /></button></div></form></ModalFrame>
}

function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`
}

function VoiceNoteCapture({ onRecorded }: { onRecorded: (audio?: Blob) => void }) {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [failure, setFailure] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current)
    stream.current?.getTracks().forEach(track => track.stop())
  }, [])
  async function toggle() {
    setFailure('')
    if (recording) { recorder.current?.stop(); return }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setFailure('Voice recording is not supported here. You can type the issue note.'); return }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      recorder.current = new MediaRecorder(stream.current)
      recorder.current.ondataavailable = event => { if (event.data.size > 0) chunks.current.push(event.data) }
      recorder.current.onstop = () => {
        onRecorded(new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' }))
        stream.current?.getTracks().forEach(track => track.stop())
        stream.current = null
        setRecording(false)
        if (timer.current) window.clearInterval(timer.current)
        timer.current = null
      }
      recorder.current.start(); setRecording(true); setDuration(0)
      timer.current = window.setInterval(() => setDuration(value => value + 1), 1000)
    } catch { setFailure('Microphone access failed. Check device permission or type the issue note instead.') }
  }
  return <div className="voice-note"><button type="button" className={`voice-record ${recording ? 'recording' : ''}`} onClick={() => void toggle()}>{recording ? <span className="recording-square" /> : <AudioLines size={16} />}{recording ? `Stop · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : 'Record voice note'}</button><span>{recording ? 'Recording original audio' : 'Original audio is kept for review'}</span>{failure && <small className="voice-error">{failure}</small>}</div>
}

function ModalFrame({ title, eyebrow, children, onClose }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</section></div>
}

export default App
