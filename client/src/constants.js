// Constantes e helpers visuais compartilhados.

export const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#85868f' },
  { id: 'a-fazer', label: 'A fazer', color: '#5aa9f5' },
  { id: 'fazendo', label: 'Fazendo', color: '#f2c14e' },
  { id: 'feito', label: 'Feito', color: '#4fd18b' },
]
export const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]))
export const COLUMN_COLOR = Object.fromEntries(COLUMNS.map((c) => [c.id, c.color]))

// tipos de drag-and-drop: DND_TASK = qualquer tarefa (sidebar ou quadro);
// DND_CARD = card que ja esta no quadro (pode voltar para a sidebar)
export const DND_TASK = 'application/x-cofre-task'
export const DND_CARD = 'application/x-cofre-card'

export const LAYERS ={ front: 'Front', back: 'Back', shared: 'Geral', outro: 'Outro' }

export const SEV = {
  red: { color: '#f2665f', label: 'Crítico' },
  yellow: { color: '#f2c14e', label: 'Risco' },
  green: { color: '#4fd18b', label: 'Melhoria' },
}

// prioridade de execucao (diferente da severidade do diagnostico)
export const PRIORITIES = {
  urgente: { label: 'Urgente', color: '#f2665f', icon: 'chevronsUp' },
  alta: { label: 'Alta', color: '#f29a5a', icon: 'arrowUp' },
  media: { label: 'Média', color: '#5aa9f5', icon: 'equal' },
  baixa: { label: 'Baixa', color: '#85868f', icon: 'arrowDown' },
}
export const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baixa: 3 }

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Situacao do prazo: 'overdue' (vencido e nao concluido), 'soon' (ate 2 dias) ou 'ok'. */
export function dueState(card) {
  if (!card?.due || card.status === 'feito') return 'ok'
  const today = todayISO()
  if (card.due < today) return 'overdue'
  const diff = (new Date(card.due) - new Date(today)) / 86400000
  return diff <= 2 ? 'soon' : 'ok'
}
/** "2026-10-27" -> "27/10" (ou "27/10/2027" fora do ano corrente). */
export function formatDue(due) {
  if (!due) return ''
  const [y, m, d] = due.split('-')
  return y === String(new Date().getFullYear()) ? `${d}/${m}` : `${d}/${m}/${y}`
}

const PALETTE =['#7c6cf2', '#5aa9f5', '#4fd18b', '#f29a5a', '#e06aa8', '#f2c14e', '#5ad1d1']

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
