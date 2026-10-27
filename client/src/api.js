// API do cofre-viewer SEM backend. Toda a logica roda no navegador sobre
// dados persistidos localmente (IndexedDB). A interface publica (metodos
// assincronos) e a mesma de antes, entao os componentes nao mudam.

import { store } from './browser/store.js'
import { buildTree, normalizeRel, listMarkdownFiles } from './browser/vault.js'
import { buildStats } from './browser/stats.js'
import { buildBoard, countTasks, COLUMNS } from './browser/kanban.js'
import { answer, analyzeDraft, HAS_LLM } from './browser/assistant.js'
import { importZip } from './browser/importZip.js'

function fail(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    || Math.random().toString(16).slice(2, 10)
}

async function filesOf(projectId) {
  if (!store.getProject(projectId)) throw fail('Projeto não encontrado', 404)
  return store.getFiles(projectId)
}

export const api = {
  // ---------- projetos ----------
  async projects() {
    const list = store.listProjects()
    const out = []
    for (const p of list) {
      const files = await store.getFiles(p.id)
      out.push({ ...p, path: p.path || '(cofre importado)', exists: true, taskCount: countTasks(files) })
    }
    return out
  },

  // mantido por compatibilidade; sem backend nao ha "caminho", use importZipProject
  async addProject() {
    throw fail('Adicione um projeto importando o .zip do cofre.')
  },

  async importZipProject(name, fileOrBuffer) {
    const trimmed = (name || '').trim()
    if (!trimmed) throw fail('Informe o nome do projeto.')
    const files = await importZip(fileOrBuffer)

    const existing = store.listProjects()
    let id = slugify(trimmed)
    while (existing.some((p) => p.id === id)) id = id + '-' + Math.random().toString(16).slice(2, 4)

    await store.setFiles(id, files)
    await store.setKanban(id, {})
    const meta = { id, name: trimmed, path: '', createdAt: new Date().toISOString() }
    store.addProjectMeta(meta)
    return { ...meta, taskCount: countTasks(files), exists: true }
  },

  async removeProject(id) {
    await store.removeProject(id)
    return { ok: true }
  },

  // ---------- documentos ----------
  async tree(projectId) {
    const files = await filesOf(projectId)
    return { tree: buildTree(files) }
  },

  async read(projectId, path) {
    const files = await filesOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Arquivo não encontrado.', 404)
    return { path: rel, content: files[rel], bytes: new Blob([files[rel]]).size }
  },

  async save(projectId, path, content) {
    const files = await filesOf(projectId)
    const rel = normalizeRel(path)
    if (!rel.toLowerCase().endsWith('.md')) throw fail('Só .md.')
    files[rel] = content
    await store.setFiles(projectId, files)
    return { ok: true, path: rel }
  },

  async create(projectId, path, content = '') {
    const files = await filesOf(projectId)
    const rel = normalizeRel(path)
    if (!rel.toLowerCase().endsWith('.md')) throw fail('Só .md.')
    if (rel in files) throw fail('Arquivo já existe.', 409)
    files[rel] = content
    await store.setFiles(projectId, files)
    return { ok: true, path: rel }
  },

  async remove(projectId, path) {
    const files = await filesOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Arquivo não encontrado.', 404)
    if (!rel.toLowerCase().endsWith('.md')) throw fail('Só .md.')
    delete files[rel]
    await store.setFiles(projectId, files)
    // limpa status do kanban desse arquivo
    const map = await store.getKanban(projectId)
    if (rel in map) { delete map[rel]; await store.setKanban(projectId, map) }
    return { ok: true, path: rel }
  },

  async search(projectId, q) {
    const files = await filesOf(projectId)
    const needle = (q || '').trim().toLowerCase()
    if (!needle) return { query: q, results: [] }
    const results = []
    for (const rel of listMarkdownFiles(files)) {
      const lines = (files[rel] || '').split(/\r?\n/)
      const hits = []
      lines.forEach((line, i) => { if (line.toLowerCase().includes(needle)) hits.push({ line: i + 1, text: line.trim().slice(0, 240) }) })
      if (hits.length) results.push({ path: rel, count: hits.length, hits: hits.slice(0, 5) })
    }
    results.sort((a, b) => b.count - a.count)
    return { query: q, total: results.length, results }
  },

  async stats(projectId) {
    const files = await filesOf(projectId)
    return buildStats(files)
  },

  // ---------- kanban ----------
  async kanban(projectId) {
    const files = await filesOf(projectId)
    const statusMap = await store.getKanban(projectId)
    const { board, statusMap: next, changed } = buildBoard(files, statusMap)
    if (changed) await store.setKanban(projectId, next)
    return board
  },

  async moveCard(projectId, path, status) {
    if (!COLUMNS.includes(status)) throw fail('Coluna inválida')
    const files = await filesOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Card não encontrado', 404)
    const map = await store.getKanban(projectId)
    map[rel] = status
    await store.setKanban(projectId, map)
    return { path: rel, status }
  },

  // ---------- assistente ----------
  async assistantStatus() {
    return { llm: HAS_LLM, mode: HAS_LLM ? 'llm' : 'heuristic' }
  },

  async chat(projectId, question) {
    const files = await filesOf(projectId)
    return answer(files, question)
  },

  async analyze(projectId, draft) {
    const files = await filesOf(projectId)
    return analyzeDraft(files, draft)
  },
}
