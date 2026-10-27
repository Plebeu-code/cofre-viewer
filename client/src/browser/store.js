// Persistencia local (sem backend). Cada projeto guarda:
//  - metadados (id, name, createdAt)  -> indice em 'cofre.projects'
//  - arquivos do cofre                -> { [relPath]: conteudoMarkdown }
//  - status do kanban                 -> { [relPath]: coluna }
// Tudo no IndexedDB (via idb-keyval). O indice de projetos tambem espelha em
// localStorage para leitura sincrona rapida na inicializacao.

import { get, set, del } from 'idb-keyval'

const INDEX_KEY = 'cofre.projects'
const filesKey = (id) => `cofre.files.${id}`
const kanbanKey = (id) => `cofre.kanban.${id}`

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
  async removeProject(id) {
    writeIndex(readIndexSync().filter((p) => p.id !== id))
    await del(filesKey(id))
    await del(kanbanKey(id))
  },

  // ---- arquivos do cofre ----
  async getFiles(id) {
    return (await get(filesKey(id))) || {}
  },
  async setFiles(id, files) {
    await set(filesKey(id), files)
  },

  // ---- status do kanban ----
  async getKanban(id) {
    return (await get(kanbanKey(id))) || {}
  },
  async setKanban(id, map) {
    await set(kanbanKey(id), map)
  },
}
