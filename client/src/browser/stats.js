// Agregacoes/consolidados de um projeto no navegador. Porta server/stats.js.

import { listMarkdownFiles } from './vault.js'

const ID_REGEX = /\b(CONF|RISK|MEL|FRONT|BACK|INT|RN|DEC)-[A-Z]*-?\d+\b/g

function classifyLayer(relPath) {
  const name = relPath.toLowerCase()
  if (name.includes('formulário e interface') || name.includes('comportamento e interface')) return 'front'
  if (name.includes('api e regras de negócio')) return 'back'
  if (name.includes('visão geral e integração')) return 'shared'
  return 'outro'
}

export function buildStats(files) {
  const mdFiles = listMarkdownFiles(files)

  // contagem de IDs unicos por prefixo
  const sets = { CONF: new Set(), RISK: new Set(), MEL: new Set(), FRONT: new Set(), BACK: new Set(), INT: new Set(), RN: new Set(), DEC: new Set() }
  // severidade por arquivo
  const perFile = []
  let totalRed = 0, totalYellow = 0, totalGreen = 0

  for (const rel of mdFiles) {
    const content = files[rel] || ''
    for (const m of content.match(ID_REGEX) || []) {
      const prefix = m.split('-')[0]
      if (sets[prefix]) sets[prefix].add(m)
    }
    const red = (content.match(/🔴/g) || []).length
    const yellow = (content.match(/🟡/g) || []).length
    const green = (content.match(/🟢/g) || []).length
    if (red || yellow || green) perFile.push({ path: rel, red, yellow, green, layer: classifyLayer(rel) })
    totalRed += red; totalYellow += yellow; totalGreen += green
  }

  const counts = {}
  for (const [k, v] of Object.entries(sets)) counts[k] = v.size

  // inventario de funcionalidades
  const inventory = collectInventory(files)

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      ...counts,
      red: totalRed, yellow: totalYellow, green: totalGreen,
      funcionalidades: inventory.length,
      funcionalidadesConcluidas: inventory.filter((r) => r.done).length,
    },
    severityByFile: perFile.sort((a, b) => b.red - a.red || b.yellow - a.yellow),
    inventory,
  }
}

function collectInventory(files) {
  const key = Object.keys(files).find((k) => k.endsWith('Inventário e Decisões/Inventário Preliminar de Funcionalidades.md'))
  if (!key) return []
  const rows = []
  for (const line of (files[key] || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*(.+?)\*\*\s*\|.*\|(.*)\|\s*$/)
    if (m) {
      const statusCell = m[3]
      rows.push({
        num: Number(m[1]),
        nome: m[2],
        done: statusCell.includes('✅'),
        severity: statusCell.includes('🔴') ? 'red' : statusCell.includes('🟡') ? 'yellow' : statusCell.includes('🟢') ? 'green' : null,
      })
    }
  }
  return rows
}
