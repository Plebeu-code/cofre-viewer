// Persistencia local (sem backend). Cada projeto guarda:
//  - metadados (id, name, createdAt)  -> indice em 'cofre.projects'
//  - arquivos do cofre                -> { [relPath]: conteudoMarkdown }
//  - status do kanban                 -> { [relPath]: coluna }
//  - campos das tarefas               -> { seq, tasks: { [relPath]: { key, priority, due, assignee,
//                                         labels, points, rank, comments, history } } }
//    (ficam fora dos .md para nao alterar o cofre original)
// Tudo no IndexedDB (via idb-keyval). O indice de projetos tambem espelha em
// localStorage para leitura sincrona rapida na inicializacao.

import { get, set, del } from 'idb-keyval'

// avisa quem quiser saber que um projeto mudou (ex.: sincronizacao automatica)
const listeners = new Set()
export function onStoreChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
let muted = 0 // gravacoes vindas da propria sincronizacao nao disparam envio
export async function withoutNotify(fn) { muted++; try { return await fn() } finally { muted-- } }
const changed = (id) => { if (!muted) for (const fn of listeners) fn(id) }

const INDEX_KEY = 'cofre.projects'
const filesKey = (id) => `cofre.files.${id}`
const kanbanKey = (id) => `cofre.board.${id}`
// formato antigo: toda tarefa entrava automaticamente no Backlog
const legacyKanbanKey = (id) => `cofre.kanban.${id}`
const metaKey = (id) => `cofre.meta.${id}`

function readIndexSync() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') } catch { return [] }
}
function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list))
}

export const store = {
  // ---- indice de projetos ----
  listProjects() {
    return readIndexSync()
  },
  getProject(id) {
    return readIndexSync().find((p) => p.id === id) || null
  },
  addProjectMeta(meta) {
    const list = readIndexSync()
    list.push(meta)
    writeIndex(list)
    return meta
  },
  updateProjectMeta(id, patch) {
    writeIndex(readIndexSync().map((p) => (p.id === id ? { ...p, ...patch } : p)))
  },
  async removeProject(id) {
    writeIndex(readIndexSync().filter((p) => p.id !== id))
    await del(filesKey(id))
    await del(kanbanKey(id))
    await del(legacyKanbanKey(id))
    await del(metaKey(id))
  },

  // ---- arquivos do cofre ----
  async getFiles(id) {
    return (await get(filesKey(id))) || {}
  },
  async setFiles(id, files) {
    await set(filesKey(id), files)
    changed(id)
  },

  // ---- status do kanban ----
  async getKanban(id) {
    const map = await get(kanbanKey(id))
    if (map) return map
    // migracao: no formato antigo o Backlog era preenchido automaticamente,
    // entao so os cards movidos de proposito para outra coluna seguem no quadro
    const legacy = (await get(legacyKanbanKey(id))) || {}
    const next = Object.fromEntries(Object.entries(legacy).filter(([, s]) => s !== 'backlog'))
    await set(kanbanKey(id), next)
    await del(legacyKanbanKey(id))
    return next
  },
  async setKanban(id, map) {
    await set(kanbanKey(id), map)
    changed(id)
  },

  // ---- campos das tarefas (prioridade, prazo, comentarios...) ----
  async getMeta(id) {
    const m = (await get(metaKey(id))) || {}
    // wip: { coluna: limite }; sprints: [{ id, name, start, end, goal, state }]
    return { seq: m.seq || 0, tasks: m.tasks || {}, wip: m.wip || {}, sprints: m.sprints || [] }
  },
  async setMeta(id, meta) {
    await set(metaKey(id), meta)
    changed(id)
  },
}
