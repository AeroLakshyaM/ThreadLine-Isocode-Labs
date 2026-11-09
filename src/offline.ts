import { supabase } from './supabase'
import type { PendingUpdate } from './types'

const DB_NAME = 'threadline-offline-v1'
const STORE = 'updates'
const DRAFT_STORE = 'update-drafts'
export type QueuedRecord = { update: PendingUpdate; photo?: Blob; audio?: Blob }
export type UpdateDraftRecord = {
  id: string
  clientId: string
  orderId: string
  stageId: string
  lineId: string
  quantity: string
  issue: string
  zeroReason: string
  blocked: boolean
  photo?: File
  audio?: Blob
  updatedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'update.clientId' })
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
  })
}

export async function getUpdateDraft(id: string): Promise<UpdateDraftRecord | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE).get(id)
    request.onsuccess = () => resolve(request.result as UpdateDraftRecord | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function saveUpdateDraft(draft: UpdateDraftRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite')
    tx.objectStore(DRAFT_STORE).put(draft)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('The local draft could not be saved.'))
  })
}

export async function removeUpdateDraft(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite')
    tx.objectStore(DRAFT_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('The saved draft could not be removed.'))
  })
}

export async function listQueued(): Promise<QueuedRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as QueuedRecord[])
    req.onerror = () => reject(req.error)
  })
}

export async function saveQueued(record: QueuedRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeQueued(clientId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(clientId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function setQueuedState(clientId:string,state:PendingUpdate['syncState']):Promise<void>{
  const records=await listQueued();const record=records.find(item=>item.update.clientId===clientId);if(!record)return
  await saveQueued({...record,update:{...record.update,syncState:state}})
}

export async function syncQueued(record: QueuedRecord): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured; this update remains on this device.')
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) throw new Error('Sign in is required to sync this production update. The update remains saved on this device.')
  let photoPath: string | null = null
  let audioPath: string | null = null
  if (record.photo) {
    photoPath = `${record.update.orderId}/${record.update.clientId}.jpg`
    const { error } = await supabase.storage.from('production-evidence').upload(photoPath, record.photo, { upsert: true, contentType: record.photo.type || 'image/jpeg' })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
  }
  if (record.audio) {
    audioPath = `${record.update.orderId}/${record.update.clientId}.webm`
    const { error } = await supabase.storage.from('production-evidence').upload(audioPath, record.audio, { upsert: true, contentType: record.audio.type || 'audio/webm' })
    if (error) throw new Error(`Audio upload failed: ${error.message}`)
  }
  const { error } = await supabase.from('production_updates').upsert({
    client_id: record.update.clientId,
    order_id: record.update.orderId,
    stage_id: record.update.stageId,
    line_id: record.update.lineId || null,
    reporting_date: record.update.reportingDate,
    quantity: record.update.quantity,
    zero_reason: record.update.zeroReason || null,
    is_blocked: record.update.blocked,
    issue_text: record.update.issue || null,
    captured_at: record.update.createdAt,
    photo_path: photoPath,
    audio_path: audioPath,
    submitted_by: authData.user.id
  }, { onConflict: 'client_id', ignoreDuplicates: true })
  if (error) throw new Error(`Update sync failed: ${error.message}`)
  await removeQueued(record.update.clientId)
}
