// "Vault" no navegador: opera sobre um mapa { relPath -> conteudo } em vez do
// sistema de arquivos. Porta buildTree / listMarkdownFiles do servidor.

const IGNORED = new Set(['.obsidian', '.git', 'node_modules'])

/** Normaliza um caminho relativo (separadores em '/', sem '..' nem barra inicial). */
export function normalizeRel(relPath = '') {
  const parts = String(relPath).replace(/\\/g, '/').split('/')
  const out = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return out.join('/')
}

function isIgnored(rel) {
  return rel.split('/').some((seg) => IGNORED.has(seg))
}

/** Lista os caminhos .md do cofre (equivale a listMarkdownFiles). */
export function listMarkdownFiles(files) {
  return Object.keys(files).filter((rel) => rel.toLowerCase().endsWith('.md') && !isIgnored(rel))
}

/** Monta a arvore de pastas/arquivos a partir do mapa de arquivos. */
export function buildTree(files) {
  const root = { dirs: new Map(), files: [] }

  for (const rel of Object.keys(files)) {
    if (isIgnored(rel)) continue
    if (!rel.toLowerCase().endsWith('.md')) continue
    const parts = rel.split('/')
    const fileName = parts.pop()
    let node = root
    let acc = []
    for (const dir of parts) {
      acc.push(dir)
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [], path: acc.join('/') })
      node = node.dirs.get(dir)
    }
    node.files.push({ type: 'file', name: fileName, path: rel })
  }

  function toNodes(node) {
    const dirNodes = [...node.dirs.entries()].map(([name, child]) => ({
      type: 'dir', name, path: child.path, children: toNodes(child),
    }))
    const all = [...dirNodes, ...node.files]
    all.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'pt-BR')
    })
    return all
  }

  return toNodes(root)
}
