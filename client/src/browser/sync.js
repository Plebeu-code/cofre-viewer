// Sincronizacao opcional com Supabase (ver supabase/schema.sql).
// Por padrao o app e 100% local; com URL + chave publica (anon) configuradas e
// login por link magico, cada projeto pode ser enviado/baixado da nuvem e
// compartilhado por e-mail. Concorrencia otimista pelo campo `version`.

import { createClient } from '@supabase/supabase-js'
import { store, withoutNotify } from './store.js'

const KEY = 'cofre.sync'
const TABLE = 'cofre_projects'

export function getSyncConfig() {
  try { return { url: '', anonKey: '', auto: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { url: '', anonKey: '', auto: false } }
}
export function setSyncConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify({ url: (cfg.url || '').trim(), anonKey: (cfg.anonKey || '').trim(), auto: Boolean(cfg.auto) }))
  client = null
}
export const syncConfigured = () => { const c = getSyncConfig(); return Boolean(c.url && c.anonKey) }

let client = null
function sb() {
  if (!client) {
    const { url, anonKey } = getSyncConfig()
    if (!url || !anonKey) throw new Error('Configure a URL e a chave do Supabase em Configurações.')
    client = createClient(url, anonKey, { auth: { persistSession: true, storageKey: 'cofre.sync.session' } })
  }
  return client
}

// ---------- autenticacao (link magico por e-mail) ----------
export async function getUser() {
  if (!syncConfigured()) return null
  const { data } = await sb().auth.getSession()
  return data.session?.user || null
}
export async function signIn(email) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } })
  if (error) throw new Error(error.message)
}
export async function signOut() { await sb().auth.signOut() }
export function onAuthChange(fn) {
  if (!syncConfigured()) return () => {}
  const { data } = sb().auth.onAuthStateChange((_e, session) => fn(session?.user || null))
  return () => data.subscription.unsubscribe()
}

async function requireUser() {
  const u = await getUser()
  if (!u) throw new Error('Entre com seu e-mail para sincronizar.')
  return u
}

// ---------- projetos ----------
export async function listRemote() {
  await requireUser()
  const { data, error } = await sb().from(TABLE).select('id, owner, name, version, shared_with, updated_by, updated_at').order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

async function payloadOf(id) {
  return { files: await store.getFiles(id), kanban: await store.getKanban(id), meta: await store.getMeta(id) }
}

/** Envia o projeto local. Falha com code 'conflict' se a nuvem tem versao mais nova. */
export async function pushProject(id, { force = false } = {}) {
  const user = await requireUser()
  const p = store.getProject(id)
  if (!p) throw new Error('Projeto não encontrado.')
  const payload = await payloadOf(id)
  const owner = p.syncOwner || user.id
  let row

  if (!p.syncVersion) {
    // primeiro envio: cria (ou, com force, sobrescreve uma copia existente)
    const { data, error } = await sb().from(TABLE)
      .upsert({ id, owner, name: p.name, payload, version: 1, updated_by: user.email }, { onConflict: 'owner,id', ignoreDuplicates: !force })
      .select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw Object.assign(new Error('Já existe um projeto com este identificador na nuvem.'), { code: 'conflict' })
    row = data
  } else {
    let q = sb().from(TABLE).update({ name: p.name, payload, version: p.syncVersion + 1, updated_by: user.email }).eq('owner', owner).eq('id', id)
    if (!force) q = q.eq('version', p.syncVersion)
    const { data, error } = await q.select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw Object.assign(new Error('A versão na nuvem é mais nova que a sua.'), { code: 'conflict' })
    row = data
  }
  store.updateProjectMeta(id, { syncOwner: row.owner, syncVersion: row.version, syncedAt: new Date().toISOString(), syncConflict: false })
  return row
}

/** Baixa um projeto da nuvem, criando ou substituindo a copia local. */
export async function pullProject(id, owner) {
  await requireUser()
  const { data, error } = await sb().from(TABLE).select('*').eq('owner', owner).eq('id', id).single()
  if (error) throw new Error(error.message)
  await withoutNotify(async () => {
    await store.setFiles(id, data.payload.files || {})
    await store.setKanban(id, data.payload.kanban || {})
    await store.setMeta(id, data.payload.meta || {})
  })
  const info = { name: data.name, syncOwner: data.owner, syncVersion: data.version, syncedAt: new Date().toISOString(), syncConflict: false }
  if (store.getProject(id)) store.updateProjectMeta(id, info)
  else store.addProjectMeta({ id, path: '', createdAt: new Date().toISOString(), ...info })
  return data
}

/** So o dono altera; a lista substitui a anterior. */
export async function shareProject(id, emails) {
  const user = await requireUser()
  const p = store.getProject(id)
  if (p?.syncOwner && p.syncOwner !== user.id) throw new Error('Só o dono do projeto pode compartilhá-lo.')
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))]
  const { error } = await sb().from(TABLE).update({ shared_with: list }).eq('owner', user.id).eq('id', id)
  if (error) throw new Error(error.message)
  return list
}

// ---------- envio automatico ----------
const timers = new Map()
/** Envia o projeto alguns segundos depois da ultima mudanca local. */
export function scheduleAutoPush(id, onResult) {
  if (!getSyncConfig().auto) return
  const p = store.getProject(id)
  if (!p?.syncVersion) return // so projetos que ja estao na nuvem
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(async () => {
    try { await pushProject(id); onResult?.(null, id) }
    catch (e) {
      if (e.code === 'conflict') store.updateProjectMeta(id, { syncConflict: true })
      onResult?.(e, id)
    }
  }, 4000))
}
