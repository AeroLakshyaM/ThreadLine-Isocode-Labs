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

export async function prepareProductionPhoto(file: File): Promise<File> {
  const maxBytes = 4.5 * 1024 * 1024
  const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (file.size <= maxBytes && acceptedTypes.includes(file.type)) return file
  if (!('createImageBitmap' in window)) throw new Error('This browser cannot prepare this image. Choose a JPG, PNG or WebP photo under 4.5 MB.')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('This image format is not supported. Choose a JPG, PNG or WebP photo.') }
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the photo. Please choose it again.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.84, 0.74, 0.64, 0.54]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= maxBytes) {
        const name = `${file.name.replace(/\.[^.]+$/, '') || 'production-photo'}.jpg`
        return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
      }
    }
    throw new Error('The photo is still too large after compression. Choose a smaller image.')
  } finally { bitmap.close() }
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

export async function clearOfflineWorkspace(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, DRAFT_STORE], 'readwrite')
    tx.objectStore(STORE).clear()
    tx.objectStore(DRAFT_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('The local workspace data could not be cleared.'))
  })
}

export async function setQueuedState(clientId:string,state:PendingUpdate['syncState'],syncError?:string):Promise<void>{
  const records=await listQueued();const record=records.find(item=>item.update.clientId===clientId);if(!record)return
  await saveQueued({...record,update:{...record.update,syncState:state,syncError:state==='sync failed'?syncError:undefined}})
}

async function uploadEvidence(path:string, file:Blob, contentType:string):Promise<void>{
  if(!supabase)throw new Error('Supabase is not configured; this update remains on this device.')
  const {error}=await supabase.storage.from('production-evidence').upload(path,file,{upsert:false,contentType})
  if(!error)return
  // A previous attempt may have stored the uniquely named object before the
  // database insert failed. Reusing that object makes queue retries idempotent.
  if(/already exists|duplicate/i.test(error.message))return
  throw new Error(error.message)
}

export async function syncQueued(record: QueuedRecord): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured; this update remains on this device.')
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) throw new Error('Sign in is required to sync this production update. The update remains saved on this device.')
  let existingQuery=supabase.from('production_updates').select('client_id,quantity,zero_reason,is_blocked,issue_text,photo_path').eq('order_id',record.update.orderId).eq('stage_id',record.update.stageId).eq('reporting_date',record.update.reportingDate)
  existingQuery=record.update.lineId?existingQuery.eq('line_id',record.update.lineId):existingQuery.is('line_id',null)
  const {data:existing,error:existingError}=await existingQuery.maybeSingle()
  if(existingError)throw new Error(`Could not check for an existing daily update: ${existingError.message}`)
  if(existing&&existing.client_id!==record.update.clientId){
    const sameReport=existing.quantity===record.update.quantity&&(existing.zero_reason??'')===(record.update.zeroReason??'')&&existing.is_blocked===record.update.blocked&&(existing.issue_text??'')===(record.update.issue??'')
    if(sameReport&&existing.photo_path){await removeQueued(record.update.clientId);return}
    if(sameReport&&record.photo&&!existing.photo_path)throw new Error('This daily update is already saved, but it has no photo attached. Ask the merchandiser to review the existing update before retrying this photo.')
    throw new Error('A daily update already exists for this stage and line. Ask the merchandiser to amend it before syncing another entry.')
  }
  let photoPath: string | null = null
  let audioPath: string | null = null
  if (record.photo) {
    const photoExtension = record.photo.type === 'image/png' ? 'png' : record.photo.type === 'image/webp' ? 'webp' : 'jpg'
    photoPath = `${record.update.orderId}/${record.update.clientId}.${photoExtension}`
    try{await uploadEvidence(photoPath,record.photo,record.photo.type||'image/jpeg')}catch(error){throw new Error(`Photo upload failed: ${error instanceof Error?error.message:'Unknown storage error'}`)}
  }
  if (record.audio) {
    const audioType = record.audio.type.split(';')[0] || 'audio/webm'
    const audioExtension = audioType === 'audio/ogg' ? 'ogg' : audioType === 'audio/mp4' ? 'mp4' : audioType === 'audio/mpeg' ? 'mp3' : 'webm'
    audioPath = `${record.update.orderId}/${record.update.clientId}.${audioExtension}`
    try{await uploadEvidence(audioPath,record.audio,audioType)}catch(error){throw new Error(`Audio upload failed: ${error instanceof Error?error.message:'Unknown storage error'}`)}
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
