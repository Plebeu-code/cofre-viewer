// Constantes e helpers visuais compartilhados.

export const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#85868f' },
  { id: 'a-fazer', label: 'A fazer', color: '#5aa9f5' },
  { id: 'fazendo', label: 'Fazendo', color: '#f2c14e' },
  { id: 'feito', label: 'Feito', color: '#4fd18b' },
]
export const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]))
export const COLUMN_COLOR = Object.fromEntries(COLUMNS.map((c) => [c.id, c.color]))

export const LAYERS = { front: 'Front', back: 'Back', shared: 'Geral', outro: 'Outro' }

export const SEV = {
  red: { color: '#f2665f', label: 'Crítico' },
  yellow: { color: '#f2c14e', label: 'Risco' },
  green: { color: '#4fd18b', label: 'Melhoria' },
}

const PALETTE = ['#7c6cf2', '#5aa9f5', '#4fd18b', '#f29a5a', '#e06aa8', '#f2c14e', '#5ad1d1']

export function colorFor(str = '') {
  let h = 0
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function initials(name = '') {
  return name
    .split(/[\s/—–-]+/)
    .filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?'
}

/** Cor da barrinha do card: severidade, ou azul neutro. */
export function barColor(card) {
  return card.severity ? SEV[card.severity].color : '#5aa9f5'
}

/** Nome legivel de pasta: "Ocorrencias-Vigilancia" -> "Ocorrencias Vigilancia". */
export function prettyFolder(name = '') {
  return name.replace(/-/g, ' ')
}
