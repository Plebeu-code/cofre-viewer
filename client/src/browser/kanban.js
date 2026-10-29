// Kanban no navegador. Cada .md de tarefa vira um card; o status e persistido
// no store (IndexedDB), nao em .kanban.json. Porta server/kanban.js.
// Um card so esta NO QUADRO se tiver status salvo; os demais ficam fora
// (status null) ate serem arrastados da sidebar para uma coluna.

import { listMarkdownFiles } from './vault.js'

export const COLUMNS = ['backlog', 'a-fazer', 'fazendo', 'feito']

const baseName = (rel) => rel.split('/').pop()
const dirName = (rel) => rel.split('/').slice(0, -1).join('/')

function isTaskFile(rel) {
  const lower = rel.toLowerCase()
  if (lower.endsWith('readme.md') || lower.includes('_template')) return false
  return lower.startsWith('backlog') || lower.startsWith('transversais')
}

function classifyLayer(name) {
  const n = name.toLowerCase()
  if (n.startsWith('formulário e interface') || n.startsWith('comportamento e interface')) return 'front'
  if (n.startsWith('api e regras de negócio')) return 'back'
  if (n.startsWith('visão geral e integração')) return 'shared'
  return 'outro'
}

function metaOf(content) {
  const c = content || ''
  const red = (c.match(/🔴/g) || []).length
  const yellow = (c.match(/🟡/g) || []).length
  const green = (c.match(/🟢/g) || []).length
  const severity = red ? 'red' : yellow ? 'yellow' : green ? 'green' : null

  const h1 = (c.match(/^#\s+(.+)$/m) || [])[1] || ''
  let excerpt = (c.match(/\*\*Descrição:\*\*\s*(.+)/) || [])[1] || ''
  if (!excerpt) {
    const para = c.split(/\r?\n/).find((l) => l.trim() && !/^(#|>|\||-|\*|`)/.test(l.trim()))
    excerpt = para || ''
  }
  excerpt = excerpt.replace(/[*`_]/g, '').trim().slice(0, 140)

  const checkTotal = (c.match(/^\s*- \[[ xX]\]/gm) || []).length
  const checkDone = (c.match(/^\s*- \[[xX]\]/gm) || []).length
  const ids = [...new Set(c.match(/\b(FRONT|BACK|INT)-\d+\b/g) || [])]
  // IDs que aparecem em titulos (# ...) sao os que a tarefa "define"; os demais sao citacoes
  const headingIds = c.split(/\r?\n/).filter((l) => /^#/.test(l)).join(' ').match(/\b(FRONT|BACK|INT)-\d+\b/g) || []

  return { severity, red, yellow, green, heading: h1.trim(), excerpt, checkTotal, checkDone, ids, headingIds }
}

/** Ordem de exibicao: posicao manual (rank) primeiro; sem rank, por pasta e nome. */
export function compareCards(a, b) {
  const ra = a.rank ?? Infinity, rb = b.rank ?? Infinity
  if (ra !== rb) return ra - rb
  return a.feature.localeCompare(b.feature, 'pt-BR') || a.fileName.localeCompare(b.fileName, 'pt-BR')
}

/** Monta o board. Pode limpar o statusMap (arquivos removidos/status invalido) e
 *  completar os campos das tarefas (gera a chave, ex.: LOG-12, para quem nao tem);
 *  devolve os mapas possivelmente alterados e flags para persistir.
 *  `cards` traz TODAS as tarefas (ja ordenadas); `columns` so as que estao no quadro. */
export function buildBoard(files, statusMapInput, metaInput, keyPrefix = 'TSK') {
  const statusMap = { ...(statusMapInput || {}) }
  const taskMeta = {
    seq: metaInput?.seq || 0, tasks: { ...(metaInput?.tasks || {}) },
    wip: { ...(metaInput?.wip || {}) }, sprints: [...(metaInput?.sprints || [])],
  }
  const taskFiles = listMarkdownFiles(files).filter(isTaskFile)
  let changed = false
  let metaChanged = false

  // chaves estaveis: atribuidas em ordem de caminho, uma unica vez por arquivo
  for (const rel of [...taskFiles].sort()) {
    if (taskMeta.tasks[rel]?.key) continue
    taskMeta.seq++
    taskMeta.tasks[rel] = { ...(taskMeta.tasks[rel] || {}), key: `${keyPrefix}-${taskMeta.seq}` }
    metaChanged = true
  }

  const cards = taskFiles.map((rel) => {
    let status = statusMap[rel] ?? null
    if (status && !COLUMNS.includes(status)) { status = null; delete statusMap[rel]; changed = true }
    const name = baseName(rel).replace(/\.md$/, '')
    const folder = dirName(rel).split('/').pop()
    const group = rel.toLowerCase().startsWith('transversais') ? 'Transversais' : 'Backlog Técnico'
    const meta = metaOf(files[rel])
    const short = name.includes(' — ') ? name.split(' — ').slice(1).join(' — ') : name
    const kind = name.includes(' — ') ? name.split(' — ')[0] : ''
    const t = taskMeta.tasks[rel] || {}
    meta.defines = [...new Set([...(name.match(/\b(FRONT|BACK|INT)-\d+\b/g) || []), ...meta.headingIds])]
    delete meta.headingIds
    return {
      path: rel, title: short, kind, fileName: name, feature: folder, group, layer: classifyLayer(name), status, ...meta,
      key: t.key, priority: t.priority || null, due: t.due || null, assignee: t.assignee || '',
      labels: t.labels || [], points: t.points ?? null, rank: t.rank ?? null,
      sprint: t.sprint || null, links: t.links || [],
      commentCount: (t.comments || []).length,
      // quando foi concluida (ultima entrada em "feito"), base do burndown
      doneAt: status === 'feito' ? [...(t.history || [])].reverse().find((h) => h.type === 'status' && h.to === 'feito')?.at || null : null,
      // linha do tempo de status (fluxo cumulativo e tempo de ciclo)
      statusLog: (t.history || []).filter((h) => h.type === 'status').map((h) => ({ at: h.at, to: h.to })),
    }
  }).sort(compareCards)

  // vinculos: "A bloqueia B" fica salvo em A; B recebe o inverso calculado aqui
  const byPath = new Map(cards.map((c) => [c.path, c]))
  for (const c of cards) { c.blockedBy = []; c.related = [] }
  for (const c of cards) {
    c.links = c.links.filter((l) => byPath.has(l.to))
    for (const l of c.links) {
      if (l.type === 'blocks') byPath.get(l.to).blockedBy.push(c.path)
      else { c.related.push(l.to); byPath.get(l.to).related.push(c.path) }
    }
  }
  for (const c of cards) {
    c.blocks = c.links.filter((l) => l.type === 'blocks').map((l) => l.to)
    c.related = [...new Set(c.related)]
    c.blocked = c.status !== 'feito' && c.blockedBy.some((p) => byPath.get(p).status !== 'feito')
  }

  const valid = new Set(cards.map((c) => c.path))
  for (const key of Object.keys(statusMap)) {
    if (!valid.has(key)) { delete statusMap[key]; changed = true }
  }
  for (const key of Object.keys(taskMeta.tasks)) {
    if (!valid.has(key)) { delete taskMeta.tasks[key]; metaChanged = true }
  }

  const columns = COLUMNS.map((id) => ({ id, cards: cards.filter((c) => c.status === id) }))
  return {
    board: { columns, cards, total: cards.length, wip: taskMeta.wip, sprints: taskMeta.sprints },
    statusMap, changed, taskMeta, metaChanged,
  }
}

export function countTasks(files) {
  return listMarkdownFiles(files).filter(isTaskFile).length
}
