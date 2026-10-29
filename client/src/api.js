// API do cofre-viewer SEM backend. Toda a logica roda no navegador sobre
// dados persistidos localmente (IndexedDB). A interface publica (metodos
// assincronos) e a mesma de antes, entao os componentes nao mudam.

import { store } from './browser/store.js'
import { buildTree, normalizeRel, listMarkdownFiles } from './browser/vault.js'
import { buildStats } from './browser/stats.js'
import { buildBoard, countTasks, COLUMNS } from './browser/kanban.js'
import { answer, analyzeDraft, HAS_LLM } from './browser/assistant.js'
// JSZip so e necessario ao importar/exportar: carregado sob demanda
const importZip = async (input) => (await import('./browser/importZip.js')).importZip(input)
const loadJSZip = async () => (await import('jszip')).default

// leitura leve da config da IA (sem importar o SDK no carregamento inicial)
const llmConfigured = () => {
  try { return Boolean(JSON.parse(localStorage.getItem('cofre.llm') || '{}').apiKey) } catch { return false }
}

const BACKUP_FORMAT = 'cofre-hub-backup'
const TASK_FIELDS = ['priority', 'due', 'assignee', 'labels', 'points', 'sprint']
export const LINK_TYPES = ['blocks', 'relates']
export const PRIORITY_IDS = ['urgente', 'alta', 'media', 'baixa']

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

/** Prefixo das chaves das tarefas: "Login Portal" -> "LP", "Sope" -> "SOP". */
function keyPrefixOf(name = '') {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]+/g) || []
  if (!words.length) return 'TSK'
  if (words.length === 1) return words[0].slice(0, 3)
  return words.map((w) => w[0]).join('').slice(0, 4)
}

/** Board + campos das tarefas ja normalizados (chaves geradas, orfaos limpos). */
async function boardOf(projectId) {
  const files = await filesOf(projectId)
  const built = buildBoard(files, await store.getKanban(projectId), await store.getMeta(projectId),
    keyPrefixOf(store.getProject(projectId).name))
  if (built.changed) await store.setKanban(projectId, built.statusMap)
  if (built.metaChanged) await store.setMeta(projectId, built.taskMeta)
  return { files, ...built }
}

function logChange(task, entry) {
  task.history = [...(task.history || []), { at: new Date().toISOString(), ...entry }].slice(-200)
}

/** Aplica um patch de campos numa tarefa, registrando cada mudanca no historico. */
function applyFields(t, patch) {
  for (const field of TASK_FIELDS) {
    if (!(field in patch)) continue
    const next = cleanField(field, patch[field])
    const prev = t[field] ?? null
    if (JSON.stringify(prev) === JSON.stringify(next)) continue
    if (next == null) delete t[field]
    else t[field] = next
    logChange(t, { type: 'field', field, from: prev, to: next })
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Normaliza um campo editavel; devolve null para "vazio". */
function cleanField(field, value) {
  if (field === 'labels') {
    const list = [...new Set((value || []).map((l) => String(l).trim()).filter(Boolean))]
    return list.length ? list : null
  }
  if (field === 'points') {
    const n = Number(value)
    return value === '' || value == null || Number.isNaN(n) ? null : Math.max(0, n)
  }
  if (field === 'priority') return PRIORITY_IDS.includes(value) ? value : null
  if (field === 'due') return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
  if (field === 'sprint') return value ? String(value) : null
  return String(value || '').trim() || null
}

/** Diferenca entre duas versoes do cofre; `tasks*` sao as que viram cards. */
export function diffVault(current, next) {
  const added = Object.keys(next).filter((k) => !(k in current)).sort()
  const removed = Object.keys(current).filter((k) => !(k in next)).sort()
  const changed = Object.keys(next).filter((k) => k in current && current[k] !== next[k]).sort()
  const isTask = (p) => countTasks({ [p]: '' }) > 0
  return {
    added, removed, changed,
    tasksAdded: added.filter(isTask), tasksRemoved: removed.filter(isTask), tasksChanged: changed.filter(isTask),
    unchanged: Object.keys(next).length - added.length - changed.length,
  }
}

function createProject(name, files, kanban = {}, meta = null) {
  const existing = store.listProjects()
  let id = slugify(name)
  while (existing.some((p) => p.id === id)) id = id + '-' + Math.random().toString(16).slice(2, 4)
  return Promise.all([
    store.setFiles(id, files),
    store.setKanban(id, kanban),
    meta ? store.setMeta(id, meta) : null,
  ]).then(() => {
    const info = { id, name, path: '', createdAt: new Date().toISOString() }
    store.addProjectMeta(info)
    return { ...info, taskCount: countTasks(files), exists: true }
  })
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
    return createProject(trimmed, files)
  },

  // ---------- desfazer ----------
  /** Retrato do estado do projeto antes de uma acao (quadro + campos; arquivos se pedido). */
  async snapshot(projectId, withFiles = false) {
    return {
      kanban: await store.getKanban(projectId),
      meta: await store.getMeta(projectId),
      files: withFiles ? await filesOf(projectId) : null,
    }
  },
  async restore(projectId, snap) {
    await store.setKanban(projectId, snap.kanban)
    await store.setMeta(projectId, snap.meta)
    if (snap.files) await store.setFiles(projectId, snap.files)
    return { ok: true }
  },

  // ---------- atualizar cofre (nova versao do .zip) ----------
  /** Compara o .zip novo com o cofre atual, sem salvar nada. */
  async previewVaultUpdate(projectId, fileOrBuffer) {
    const current = await filesOf(projectId)
    const next = await importZip(fileOrBuffer)
    return diffVault(current, next)
  },

  /** Troca os arquivos mantendo quadro, campos, comentarios e historico.
   *  Tarefas alteradas ganham uma entrada no historico. */
  async applyVaultUpdate(projectId, fileOrBuffer) {
    const current = await filesOf(projectId)
    const next = await importZip(fileOrBuffer)
    const diff = diffVault(current, next)
    const taskMeta = await store.getMeta(projectId)
    for (const rel of diff.changed) {
      if (taskMeta.tasks[rel]) logChange(taskMeta.tasks[rel], { type: 'file', change: 'changed' })
    }
    await store.setFiles(projectId, next)
    await store.setMeta(projectId, taskMeta)
    store.updateProjectMeta(projectId, {
      updatedAt: new Date().toISOString(),
      lastUpdate: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
    })
    await boardOf(projectId) // gera chaves das tarefas novas e limpa as removidas
    return diff
  },

  // ---------- backup / exportacao ----------
  /** .zip com os .md do cofre (incluindo edicoes feitas aqui) para devolver ao cofre real. */
  async exportZip(projectId) {
    const files = await filesOf(projectId)
    const JSZip = await loadJSZip()
    const zip = new JSZip()
    for (const [rel, content] of Object.entries(files)) zip.file(rel, content)
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  },

  /** Backup completo: arquivos + quadro + campos das tarefas (comentarios, historico...). */
  async exportBackup(projectId) {
    const p = store.getProject(projectId)
    const data = {
      format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      project: { name: p.name },
      files: await filesOf(projectId),
      kanban: await store.getKanban(projectId),
      meta: await store.getMeta(projectId),
    }
    store.updateProjectMeta(projectId, { lastBackupAt: data.exportedAt }) // base do lembrete de backup
    return new Blob([JSON.stringify(data)], { type: 'application/json' })
  },

  async importBackup(text, name) {
    let data
    try { data = JSON.parse(text) } catch { throw fail('Arquivo de backup inválido (JSON malformado).') }
    if (data?.format !== BACKUP_FORMAT || typeof data.files !== 'object') throw fail('Este arquivo não é um backup do Cofre Hub.')
    const trimmed = (name || data.project?.name || 'Projeto restaurado').trim()
    return createProject(trimmed, data.files, data.kanban || {}, data.meta || null)
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
    return (await boardOf(projectId)).board
  },

  /** Move para `status`, na posicao antes de `beforePath` (ou no fim da coluna). */
  async moveCard(projectId, path, status, beforePath = null) {
    if (!COLUMNS.includes(status)) throw fail('Coluna inválida')
    const { files, board, statusMap, taskMeta } = await boardOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Card não encontrado', 404)
    const prev = statusMap[rel] ?? null

    // renumera a coluna destino na ordem exibida, inserindo o card na posicao pedida
    const order = board.cards.filter((c) => c.status === status && c.path !== rel).map((c) => c.path)
    const at = beforePath ? order.indexOf(normalizeRel(beforePath)) : -1
    order.splice(at < 0 ? order.length : at, 0, rel)
    order.forEach((p, i) => { taskMeta.tasks[p] = { ...(taskMeta.tasks[p] || {}), rank: (i + 1) * 1000 } })

    statusMap[rel] = status
    if (prev !== status) logChange(taskMeta.tasks[rel], { type: 'status', from: prev, to: status })
    await store.setKanban(projectId, statusMap)
    await store.setMeta(projectId, taskMeta)
    return { path: rel, status }
  },

  async removeFromBoard(projectId, path) {
    const { statusMap, taskMeta } = await boardOf(projectId)
    const rel = normalizeRel(path)
    if (rel in statusMap) {
      const prev = statusMap[rel]
      delete statusMap[rel]
      const t = taskMeta.tasks[rel] || (taskMeta.tasks[rel] = {})
      delete t.rank
      logChange(t, { type: 'status', from: prev, to: null })
      await store.setKanban(projectId, statusMap)
      await store.setMeta(projectId, taskMeta)
    }
    return { path: rel, status: null }
  },

  // ---------- campos das tarefas ----------
  /** Comentarios e historico de uma tarefa (os demais campos ja vem no card). */
  async taskMeta(projectId, path) {
    const { taskMeta } = await boardOf(projectId)
    const t = taskMeta.tasks[normalizeRel(path)] || {}
    return { comments: t.comments || [], history: t.history || [] }
  },

  /** Atualiza prioridade, prazo, responsavel, etiquetas e estimativa, registrando no historico. */
  async updateTask(projectId, path, patch) {
    const { files, taskMeta } = await boardOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Tarefa não encontrada', 404)
    applyFields(taskMeta.tasks[rel] || (taskMeta.tasks[rel] = {}), patch)
    await store.setMeta(projectId, taskMeta)
    return { path: rel }
  },

  /** Edicao em massa. patch aceita os campos normais, `addLabel` e `status`
   *  (coluna, ou '' para tirar do quadro). Grava tudo de uma vez. */
  async bulkUpdate(projectId, paths, patch) {
    const { files, board, statusMap, taskMeta } = await boardOf(projectId)
    const rels = paths.map(normalizeRel).filter((r) => r in files)
    for (const rel of rels) {
      const t = taskMeta.tasks[rel] || (taskMeta.tasks[rel] = {})
      const p = { ...patch }
      if (patch.addLabel) p.labels = [...(t.labels || []), patch.addLabel]
      applyFields(t, p)
      if ('status' in patch) {
        const prev = statusMap[rel] ?? null
        const next = COLUMNS.includes(patch.status) ? patch.status : null
        if (prev === next) continue
        if (next) {
          statusMap[rel] = next
          // entra no fim da coluna destino
          const last = Math.max(0, ...board.cards.filter((c) => c.status === next).map((c) => c.rank || 0))
          t.rank = last + 1000
          board.cards.find((c) => c.path === rel).rank = t.rank
          board.cards.find((c) => c.path === rel).status = next
        } else { delete statusMap[rel]; delete t.rank }
        logChange(t, { type: 'status', from: prev, to: next })
      }
    }
    await store.setKanban(projectId, statusMap)
    await store.setMeta(projectId, taskMeta)
    return { count: rels.length }
  },

  // ---------- vinculos ----------
  /** type: 'blocks' (path bloqueia toPath), 'blocked_by' (inverso) ou 'relates'. */
  async addLink(projectId, path, type, toPath) {
    const { files, taskMeta } = await boardOf(projectId)
    let from = normalizeRel(path), to = normalizeRel(toPath)
    if (!(from in files) || !(to in files)) throw fail('Tarefa não encontrada', 404)
    if (from === to) throw fail('Uma tarefa não pode ser vinculada a ela mesma.')
    if (type === 'blocked_by') { [from, to] = [to, from]; type = 'blocks' }
    if (!LINK_TYPES.includes(type)) throw fail('Tipo de vínculo inválido.')
    // um vinculo por par de tarefas (evita duplicado e bloqueio circular A<->B)
    const linked = (x, y) => (taskMeta.tasks[x]?.links || []).some((l) => l.to === y)
    if (linked(from, to) || linked(to, from)) throw fail('Essas tarefas já estão vinculadas.')
    const src = taskMeta.tasks[from] || (taskMeta.tasks[from] = {})
    const dst = taskMeta.tasks[to] || (taskMeta.tasks[to] = {})
    src.links = [...(src.links || []), { type, to }]
    logChange(src, { type: 'link', link: type, to, added: true })
    logChange(dst, { type: 'link', link: type === 'blocks' ? 'blocked_by' : type, to: from, added: true })
    await store.setMeta(projectId, taskMeta)
    return { ok: true }
  },

  /** Remove o vinculo entre as duas tarefas, seja qual for o lado em que foi salvo. */
  async removeLink(projectId, path, toPath) {
    const { taskMeta } = await boardOf(projectId)
    const a = normalizeRel(path), b = normalizeRel(toPath)
    for (const [x, y] of [[a, b], [b, a]]) {
      const t = taskMeta.tasks[x]
      if (!t?.links?.some((l) => l.to === y)) continue
      t.links = t.links.filter((l) => l.to !== y)
      logChange(t, { type: 'link', to: y, added: false })
      if (taskMeta.tasks[y]) logChange(taskMeta.tasks[y], { type: 'link', to: x, added: false })
    }
    await store.setMeta(projectId, taskMeta)
    return { ok: true }
  },

  // ---------- quadro: limite de WIP ----------
  async setWip(projectId, column, limit) {
    if (!COLUMNS.includes(column)) throw fail('Coluna inválida')
    const { taskMeta } = await boardOf(projectId)
    const n = Number(limit)
    if (!limit || Number.isNaN(n) || n <= 0) delete taskMeta.wip[column]
    else taskMeta.wip[column] = Math.floor(n)
    await store.setMeta(projectId, taskMeta)
    return { wip: taskMeta.wip }
  },

  // ---------- sprints ----------
  async createSprint(projectId, { name, start, end, goal }) {
    const { taskMeta } = await boardOf(projectId)
    if (!start || !end || end < start) throw fail('Informe início e fim válidos (o fim não pode ser antes do início).')
    const sprint = {
      id: newId(), name: String(name || '').trim() || `Sprint ${taskMeta.sprints.length + 1}`,
      start, end, goal: String(goal || '').trim(), state: 'planned',
    }
    taskMeta.sprints.push(sprint)
    await store.setMeta(projectId, taskMeta)
    return sprint
  },

  async updateSprint(projectId, id, patch) {
    const { taskMeta } = await boardOf(projectId)
    const s = taskMeta.sprints.find((x) => x.id === id)
    if (!s) throw fail('Sprint não encontrada', 404)
    for (const k of ['name', 'start', 'end', 'goal']) if (k in patch) s[k] = String(patch[k] || '').trim()
    if (s.end < s.start) throw fail('O fim não pode ser antes do início.')
    await store.setMeta(projectId, taskMeta)
    return s
  },

  /** So uma sprint ativa por vez. */
  async startSprint(projectId, id) {
    const { taskMeta } = await boardOf(projectId)
    if (taskMeta.sprints.some((s) => s.state === 'active')) throw fail('Já existe uma sprint ativa. Encerre-a antes de iniciar outra.')
    const s = taskMeta.sprints.find((x) => x.id === id)
    if (!s) throw fail('Sprint não encontrada', 404)
    s.state = 'active'
    s.startedAt = new Date().toISOString()
    await store.setMeta(projectId, taskMeta)
    return s
  },

  /** Encerra a sprint; o que nao foi concluido vai para `moveTo` (outra sprint) ou sai de sprint. */
  async closeSprint(projectId, id, moveTo = null) {
    const { board, taskMeta } = await boardOf(projectId)
    const s = taskMeta.sprints.find((x) => x.id === id)
    if (!s) throw fail('Sprint não encontrada', 404)
    const pending = board.cards.filter((c) => c.sprint === id && c.status !== 'feito')
    for (const c of pending) applyFields(taskMeta.tasks[c.path] || (taskMeta.tasks[c.path] = {}), { sprint: moveTo })
    s.state = 'closed'
    s.closedAt = new Date().toISOString()
    s.result = { done: board.cards.filter((c) => c.sprint === id && c.status === 'feito').length, carried: pending.length }
    await store.setMeta(projectId, taskMeta)
    return s
  },

  async deleteSprint(projectId, id) {
    const { taskMeta } = await boardOf(projectId)
    taskMeta.sprints = taskMeta.sprints.filter((s) => s.id !== id)
    for (const t of Object.values(taskMeta.tasks)) if (t.sprint === id) applyFields(t, { sprint: null })
    await store.setMeta(projectId, taskMeta)
    return { ok: true }
  },

  async addComment(projectId, path, text) {
    const body = String(text || '').trim()
    if (!body) throw fail('O comentário está vazio.')
    const { files, taskMeta } = await boardOf(projectId)
    const rel = normalizeRel(path)
    if (!(rel in files)) throw fail('Tarefa não encontrada', 404)
    const t = taskMeta.tasks[rel] || (taskMeta.tasks[rel] = {})
    const comment = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: body, at: new Date().toISOString() }
    t.comments = [...(t.comments || []), comment]
    await store.setMeta(projectId, taskMeta)
    return comment
  },

  async deleteComment(projectId, path, commentId) {
    const { taskMeta } = await boardOf(projectId)
    const t = taskMeta.tasks[normalizeRel(path)]
    if (t?.comments) {
      t.comments = t.comments.filter((c) => c.id !== commentId)
      await store.setMeta(projectId, taskMeta)
    }
    return { ok: true }
  },

  // ---------- assistente ----------
  // Com chave configurada usa o Claude (./browser/llm.js, carregado sob demanda);
  // sem chave, o motor heuristico offline.
  async assistantStatus() {
    const llm = HAS_LLM || llmConfigured()
    return { llm, mode: llm ? 'llm' : 'heuristic' }
  },

  async chat(projectId, question, history = [], onText) {
    const files = await filesOf(projectId)
    if (!llmConfigured()) return answer(files, question)
    const { llmAnswer, llmErrorMessage } = await import('./browser/llm.js')
    try { return await llmAnswer(files, question, history, onText) } catch (e) { throw fail(llmErrorMessage(e)) }
  },

  async analyze(projectId, draft) {
    const files = await filesOf(projectId)
    if (!llmConfigured()) return analyzeDraft(files, draft)
    const { llmReview, llmErrorMessage } = await import('./browser/llm.js')
    try { return await llmReview(files, draft) } catch (e) { throw fail(llmErrorMessage(e)) }
  },
}
