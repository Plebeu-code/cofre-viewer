// Preferencias deste navegador: tema e lembrete de backup.

const THEME_KEY = 'cofre.theme'        // 'dark' | 'light' | 'system'
const BACKUP_DAYS_KEY = 'cofre.backupDays'
const SNOOZE_KEY = 'cofre.backupSnooze'

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark'
}
export function setTheme(t) {
  localStorage.setItem(THEME_KEY, t)
  applyTheme(t)
}
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
export function applyTheme(t = getTheme()) {
  const resolved = t === 'system' ? (media?.matches ? 'light' : 'dark') : t
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f4f5f7' : '#17181b')
}
// "Sistema" acompanha a troca do tema do sistema operacional
media?.addEventListener?.('change', () => { if (getTheme() === 'system') applyTheme('system') })

/** Dias sem backup ate lembrar (0 = nunca lembrar). */
export function getBackupDays() {
  const v = Number(localStorage.getItem(BACKUP_DAYS_KEY))
  return Number.isFinite(v) && localStorage.getItem(BACKUP_DAYS_KEY) !== null ? v : 7
}
export function setBackupDays(n) { localStorage.setItem(BACKUP_DAYS_KEY, String(Math.max(0, Number(n) || 0))) }

/** Projetos que precisam de backup: nunca fizeram ou o ultimo passou do prazo. */
export function backupDue(projects) {
  const days = getBackupDays()
  if (!days) return []
  const snooze = Number(localStorage.getItem(SNOOZE_KEY) || 0)
  if (Date.now() < snooze) return []
  const limit = Date.now() - days * 86400000
  return projects
    .map((p) => ({ ...p, since: new Date(p.lastBackupAt || p.createdAt || 0).getTime() }))
    .filter((p) => p.since < limit)
    .map((p) => ({ ...p, days: Math.floor((Date.now() - p.since) / 86400000), never: !p.lastBackupAt }))
}
export function snoozeBackup(hours = 24) { localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 3600000)) }
