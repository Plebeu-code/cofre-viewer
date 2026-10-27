// Importa um .zip do cofre e devolve o mapa { relPath -> conteudo } apenas
// com os .md relevantes. Remove um eventual diretorio-raiz comum (ex.: quando
// o zip contem uma pasta "cofre-new/..." no topo).

import JSZip from 'jszip'
import { normalizeRel } from './vault.js'

const IGNORED_SEG = new Set(['.obsidian', '.git', 'node_modules', '__MACOSX'])

function isIgnored(rel) {
  return rel.split('/').some((seg) => IGNORED_SEG.has(seg))
}

/** Maior prefixo de pasta comum a todos os caminhos (para "desembrulhar"). */
function commonRoot(paths) {
  if (!paths.length) return ''
  const split = paths.map((p) => p.split('/').slice(0, -1)) // so pastas
  let prefix = split[0]
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix.length) break
  }
  // so considera raiz unica se TODOS os arquivos estao dentro dela
  return prefix.length ? prefix[0] + '/' : ''
}

export async function importZip(fileOrBuffer) {
  const zip = await JSZip.loadAsync(fileOrBuffer)

  const entries = []
  zip.forEach((relPath, entry) => {
    if (entry.dir) return
    const rel = normalizeRel(relPath)
    if (!rel || isIgnored(rel)) return
    if (!rel.toLowerCase().endsWith('.md')) return
    entries.push({ rel, entry })
  })

  if (!entries.length) {
    throw new Error('O ZIP não contém arquivos .md. Compacte a pasta do cofre (com Backlog Técnico/, Transversais/ etc.) e tente novamente.')
  }

  // desembrulha pasta-raiz comum, se houver
  const root = commonRoot(entries.map((e) => e.rel))
  const stripLen = root.length

  const files = {}
  for (const { rel, entry } of entries) {
    const key = stripLen && rel.startsWith(root) ? rel.slice(stripLen) : rel
    if (!key) continue
    files[key] = await entry.async('string')
  }

  // valida minimamente a estrutura do cofre. Comparacao tolerante a acentos
  // (remove diacriticos) para aceitar zips gravados em encodings diferentes.
  const deaccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const hasVaultShape = Object.keys(files).some((k) => {
    const top = deaccent(k.split('/')[0])
    return top.startsWith('backlog') || top.startsWith('transversais')
  })
  if (!hasVaultShape) {
    const topFolders = [...new Set(Object.keys(files).map((k) => k.split('/')[0]))].slice(0, 6)
    const encontrei = topFolders.length ? ` Encontrei no topo: ${topFolders.join(', ')}.` : ''
    throw new Error(
      'O ZIP não parece ser um cofre válido (não encontrei "Backlog Técnico/" nem "Transversais/").' +
      encontrei +
      ' Compacte a pasta do cofre (ex.: "cofre-new"), não a pasta do aplicativo.'
    )
  }

  return files
}
