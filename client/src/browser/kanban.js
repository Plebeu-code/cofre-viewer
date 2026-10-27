// Kanban no navegador. Cada .md de tarefa vira um card; o status e persistido
// no store (IndexedDB), nao em .kanban.json. Porta server/kanban.js.

import { listMarkdownFiles } from './vault.js'

export const COLUMNS = ['backlog', 'a-fazer', 'fazendo', 'feito']
const DEFAULT_COLUMN = 'backlog'

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

  return { severity, red, yellow, green, heading: h1.trim(), excerpt, checkTotal, checkDone, ids }
}

/** Monta o board. Pode ajustar o statusMap (defaults/limpeza); devolve tambem
 *  o mapa possivelmente alterado e um flag `changed` para persistir. */
export function buildBoard(files, statusMapInput) {
  const statusMap = { ...(statusMapInput || {}) }
  const taskFiles = listMarkdownFiles(files).filter(isTaskFile)
  let changed = false

  const cards = taskFiles.map((rel) => {
    let status = statusMap[rel]
    if (!COLUMNS.includes(status)) {
      status = DEFAULT_COLUMN
      if (statusMap[rel] !== status) { statusMap[rel] = status; changed = true }
    }
    const name = baseName(rel).replace(/\.md$/, '')
    const folder = dirName(rel).split('/').pop()
    const group = rel.toLowerCase().startsWith('transversais') ? 'Transversais' : 'Backlog Técnico'
    const meta = metaOf(files[rel])
    const short = name.includes(' — ') ? name.split(' — ').slice(1).join(' — ') : name
    const kind = name.includes(' — ') ? name.split(' — ')[0] : ''
    return { path: rel, title: short, kind, fileName: name, feature: folder, group, layer: classifyLayer(name), status, ...meta }
  })

  const valid = new Set(cards.map((c) => c.path))
  for (const key of Object.keys(statusMap)) {
    if (!valid.has(key)) { delete statusMap[key]; changed = true }
  }

  const columns = COLUMNS.map((id) => ({
    id,
    cards: cards.filter((c) => c.status === id).sort((a, b) => a.feature.localeCompare(b.feature, 'pt-BR')),
  }))
  return { board: { columns, total: cards.length }, statusMap, changed }
}

export function countTasks(files) {
  return listMarkdownFiles(files).filter(isTaskFile).length
}
