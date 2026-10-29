<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, defineAsyncComponent } from 'vue'
import { api } from './api.js'
import { COLUMNS, LAYERS, SEV, DND_TASK, DND_CARD, colorFor, initials, prettyFolder, dueState } from './constants.js'
import Icon from './components/Icon.vue'
import KanbanBoard from './components/KanbanBoard.vue'
import TaskTable from './components/TaskTable.vue'
import TaskList from './components/TaskList.vue'
import ProjectsView from './components/ProjectsView.vue'
import { backupDue, snoozeBackup } from './browser/prefs.js'
import { onStoreChange } from './browser/store.js'
import { download, stamp, safeName } from './browser/download.js'

// telas e janelas que nao aparecem na abertura sao carregadas sob demanda
const lazy = (load) => defineAsyncComponent(load)
const TaskDetail = lazy(() => import('./components/TaskDetail.vue'))
const CreateTaskModal = lazy(() => import('./components/CreateTaskModal.vue'))
const ChatPanel = lazy(() => import('./components/ChatPanel.vue'))
const FileBrowser = lazy(() => import('./components/FileBrowser.vue'))
const Dashboard = lazy(() => import('./components/Dashboard.vue'))
const SprintsModal = lazy(() => import('./components/SprintsModal.vue'))
const RoadmapView = lazy(() => import('./components/RoadmapView.vue'))
const SettingsModal = lazy(() => import('./components/SettingsModal.vue'))

// ---------- estado global ----------
const projects = ref([])
const currentId = ref(localStorage.getItem('cofre.project') || '')
const section = ref('tasks')          // home | tasks | docs | insights
const taskView = ref(localStorage.getItem('cofre.view') || 'kanban') // kanban | table | list | roadmap
const lanes = ref(localStorage.getItem('cofre.lanes') || 'none')    // raias: none | feature | priority | assignee
const board = ref(null)
const tree = ref([])
const loading = ref(false)
const error = ref('')
const toast = ref('')

const favorites = ref(new Set(JSON.parse(localStorage.getItem('cofre.favs') || '[]')))
// quick: filtros rapidos do quadro (overdue | high | unassigned), como os do Jira
// sprint: '' = todas, id de uma sprint, ou '__none' = sem sprint
const filters = reactive({ q: '', layer: 'all', severity: 'all', feature: '', assignee: '', label: '', sprint: '', quick: new Set() })
const showFilter = ref(false)
const openGroups = reactive({ favs: true, projects: true })
// arvore da sidebar: projeto > (Funcionalidades | Documentos) > pasta > arquivo
const expandedProjects = ref(new Set(JSON.parse(localStorage.getItem('cofre.expanded') || '[]')))
const subOpen = reactive({})          // `${projeto}:feats|docs` -> aberto?
const openFeatures = ref(new Set())   // `${projeto}:${funcionalidade}` expandidas
const projectData = reactive({})      // id -> { board, tree } (o atual + os expandidos)
let pendingNav = null                 // acao a executar depois de trocar de projeto
const sideDrag = ref('')              // arquivo sendo arrastado a partir da sidebar
const sideDropOver = ref(false)       // card do quadro sobre a sidebar (para remover)

const detailPath = ref('')
const createOpen = ref(false)
const sprintsOpen = ref(false)
const settingsOpen = ref(false)
const settingsSection = ref('general')
const sideOpen = ref(false)           // sidebar como gaveta em telas pequenas
const prefsTick = ref(0)              // forca recalculo apos mudar configuracoes
const helpOpen = ref(false)
const table = ref(null)               // TaskTable (para limpar a selecao)
const createColumn = ref('backlog')
const chatOpen = ref(false)
const chatSeed = ref(null)            // { text, contextPath }
const docFolder = ref([])             // breadcrumb inicial do FileBrowser
const docFile = ref('')
const addProjectSignal = ref(0)

const current = computed(() => projects.value.find((p) => p.id === currentId.value) || null)
// Sem nenhum cofre importado, a navegacao fica travada na tela de importacao.
const hasProjects = computed(() => projects.value.length > 0)

// ---------- carregamento ----------
async function loadProjects() {
  try {
    projects.value = await api.projects()
    if (!current.value && projects.value.length) currentId.value = projects.value.find((p) => p.exists)?.id || ''
    if (!hasProjects.value) { section.value = 'home'; currentId.value = '' }
    else if (!currentId.value) section.value = 'home'
    // descarta dados de projetos removidos e carrega os que estao expandidos
    const ids = new Set(projects.value.map((p) => p.id))
    for (const id of Object.keys(projectData)) if (!ids.has(id)) delete projectData[id]
    for (const id of expandedProjects.value) if (ids.has(id) && id !== currentId.value) ensureProjectData(id)
  } catch (e) { error.value = e.message }
}

async function loadProject() {
  if (!currentId.value) return
  const id = currentId.value
  loading.value = true
  error.value = ''
  try {
    const [b, t] = await Promise.all([api.kanban(id), api.tree(id)])
    if (id !== currentId.value) return // trocou de projeto no meio do carregamento
    board.value = b
    tree.value = t.tree
    projectData[id] = { board: b, tree: t.tree } // mesmo objeto: a sidebar reflete os moves
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

// dados de um projeto que nao e o atual, so para listar na sidebar
async function ensureProjectData(id) {
  if (projectData[id]) return
  try {
    const [b, t] = await Promise.all([api.kanban(id), api.tree(id)])
    if (!projectData[id]) projectData[id] = { board: b, tree: t.tree }
  } catch (e) { notify('Não foi possível carregar o projeto: ' + e.message) }
}

onMounted(async () => {
  await loadProjects()
  if (currentId.value) setExpanded(currentId.value, true)
  await loadProject()
})

watch(currentId, (id) => {
  localStorage.setItem('cofre.project', id || '')
  filters.feature = ''
  filters.assignee = ''
  filters.label = ''
  filters.sprint = ''
  detailPath.value = ''
  docFile.value = ''
  docFolder.value = []
  board.value = null
  if (id) setExpanded(id, true)
  const nav = pendingNav
  pendingNav = null
  loadProject().then(() => nav?.())
})
watch(taskView, (v) => localStorage.setItem('cofre.view', v))
watch(lanes, (v) => localStorage.setItem('cofre.lanes', v))

// toast: mensagem simples ou com acao "Desfazer"
const toastUndo = ref(null)
let toastTimer = 0
function notify(msg, undo = null) {
  toast.value = msg
  toastUndo.value = undo
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = ''; toastUndo.value = null }, undo ? 7000 : 2600)
}

// ---------- desfazer ----------
// tira um retrato do projeto antes da acao; "Desfazer" (ou Ctrl+Z) restaura
async function withUndo(msg, action, { files = false } = {}) {
  const pid = currentId.value
  const snap = await api.snapshot(pid, files)
  await action()
  notify(msg, async () => {
    toast.value = ''
    toastUndo.value = null
    await api.restore(pid, snap)
    if (pid === currentId.value) await loadProject()
    notify('Ação desfeita')
  })
}
function runUndo() { toastUndo.value?.() }

// ---------- tarefas ----------
// allCards = todas as tarefas do cofre; boardCards = so as que estao no quadro
const allCards = computed(() => (board.value ? board.value.cards : []))
const boardCards = computed(() => allCards.value.filter((c) => c.status))

const filteredCards = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return boardCards.value.filter((c) => {
    if (filters.layer !== 'all' && c.layer !== filters.layer) return false
    if (filters.severity === 'none' && c.severity) return false
    if (!['all', 'none'].includes(filters.severity) && c.severity !== filters.severity) return false
    if (filters.feature && c.feature !== filters.feature) return false
    if (filters.assignee && c.assignee !== filters.assignee) return false
    if (filters.label && !c.labels.includes(filters.label)) return false
    if (filters.sprint === '__none' && c.sprint) return false
    if (filters.sprint && filters.sprint !== '__none' && c.sprint !== filters.sprint) return false
    if (filters.quick.has('overdue') && dueState(c) !== 'overdue') return false
    if (filters.quick.has('high') && !['urgente', 'alta'].includes(c.priority)) return false
    if (filters.quick.has('unassigned') && c.assignee) return false
    if (q && !`${c.key} ${c.title} ${c.feature} ${c.kind} ${c.excerpt} ${c.assignee} ${c.labels.join(' ')}`.toLowerCase().includes(q)) return false
    return true
  })
})

// valores existentes no projeto, para filtros e sugestoes de preenchimento
const assignees = computed(() => [...new Set(allCards.value.map((c) => c.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')))
const labels = computed(() => [...new Set(allCards.value.flatMap((c) => c.labels))].sort((a, b) => a.localeCompare(b, 'pt-BR')))
const sprints = computed(() => board.value?.sprints || [])
const activeSprint = computed(() => sprints.value.find((s) => s.state === 'active') || null)
// total real por coluna (sem filtros), usado no limite de WIP
const columnCounts = computed(() => Object.fromEntries(COLUMNS.map((c) => [c.id, boardCards.value.filter((x) => x.status === c.id).length])))
const roadmapCards = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return allCards.value.filter((c) => !q || `${c.key} ${c.title} ${c.feature}`.toLowerCase().includes(q))
})
const overdueCount = computed(() => boardCards.value.filter((c) => dueState(c) === 'overdue').length)

function toggleQuick(k) {
  const s = new Set(filters.quick)
  s.has(k) ? s.delete(k) : s.add(k)
  filters.quick = s
}

const columnsView = computed(() =>
  COLUMNS.map((col) => ({ ...col, cards: filteredCards.value.filter((c) => c.status === col.id) }))
)

// agrupa as tarefas de um projeto por funcionalidade (pasta)
function groupFeatures(cards) {
  const map = new Map()
  for (const c of cards) {
    if (!map.has(c.feature)) map.set(c.feature, [])
    map.get(c.feature).push(c)
  }
  return [...map.entries()]
    .map(([name, files]) => ({
      name,
      count: files.length,
      onBoard: files.filter((f) => f.status).length,
      files: files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
const categories = computed(() => groupFeatures(allCards.value))

const summary = computed(() => {
  const s = { red: 0, yellow: 0, done: 0 }
  for (const c of boardCards.value) {
    if (c.severity === 'red') s.red++
    if (c.severity === 'yellow') s.yellow++
    if (c.status === 'feito') s.done++
  }
  return s
})

const activeFilterCount = computed(() =>
  (filters.layer !== 'all') + (filters.severity !== 'all') + Boolean(filters.feature) + Boolean(filters.assignee) + Boolean(filters.label)
)

// recarrega o board sem o estado de "carregando" (apos moves/edicoes)
async function refreshBoard() {
  const id = currentId.value
  if (!id) return
  try {
    const b = await api.kanban(id)
    if (id !== currentId.value) return
    board.value = b
    if (projectData[id]) projectData[id].board = b
  } catch (e) { notify(e.message) }
}

// status vazio/null tira a tarefa do quadro (ela volta a ficar so na sidebar).
// beforePath: card antes do qual inserir (ordenacao manual); null = fim da coluna
async function moveCard(path, status, beforePath = null, patch = null) {
  status = status || null
  const card = allCards.value.find((c) => c.path === path)
  if (!card || (card.status === status && !status)) return
  // soltar em outra raia (prioridade/responsavel) tambem muda esse campo
  if (patch) {
    try { await api.updateTask(currentId.value, path, patch) } catch (e) { notify(e.message) }
  }
  const wasOnBoard = Boolean(card.status)
  const from = card.status
  card.status = status // otimista: colunas e sidebar derivam do status
  try {
    const msg = !status ? 'Tarefa removida do quadro'
      : !wasOnBoard ? 'Tarefa adicionada ao quadro'
      : from !== status ? `Movida para ${COLUMNS.find((c) => c.id === status).label}` : 'Ordem alterada'
    await withUndo(msg, () => (status ? api.moveCard(currentId.value, path, status, beforePath) : api.removeFromBoard(currentId.value, path)))
    await refreshBoard() // traz a nova ordem e o historico atualizado
  } catch (e) {
    notify('Não foi possível mover: ' + e.message)
    loadProject()
  }
}

async function setWip(column, limit) {
  try { await api.setWip(currentId.value, column, limit); await refreshBoard() } catch (e) { notify(e.message) }
}

async function onBulk(paths, patch) {
  try {
    await withUndo(`${paths.length} tarefa(s) atualizada(s)`, () => api.bulkUpdate(currentId.value, paths, patch))
    await refreshBoard()
    // tirar do quadro remove as tarefas da tabela; a selecao se ajusta sozinha
  } catch (e) { notify(e.message) }
}

// ---------- atalhos de teclado ----------
const SHORTCUTS = [
  ['c', 'Criar tarefa'], ['/', 'Buscar'], ['1', 'Kanban'], ['2', 'Tabela'], ['3', 'Lista'], ['4', 'Roadmap'],
  ['g t', 'Ir para Tarefas'], ['g d', 'Ir para Docs'], ['g i', 'Ir para Insights'], ['g p', 'Ir para Projetos'],
  ['s', 'Gerenciar sprints'], ['Ctrl Z', 'Desfazer a última ação'], ['a', 'Abrir/fechar assistente'], [',', 'Configurações'], ['?', 'Mostrar atalhos'], ['Esc', 'Fechar janela / limpar seleção'],
]
let gPending = 0
function onGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && toastUndo.value
    && !['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) { e.preventDefault(); runUndo(); return }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const el = e.target
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
  // com janela aberta, cada janela cuida das proprias teclas
  if (detailPath.value || createOpen.value || sprintsOpen.value || settingsOpen.value) return
  if (helpOpen.value) { if (e.key === 'Escape' || e.key === '?') helpOpen.value = false; return }
  if (e.key === 'Escape') { table.value?.clearSel(); showFilter.value = false; return }
  if (!hasProjects.value) return
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0
    const to = { t: 'tasks', d: 'docs', i: 'insights', p: 'home' }[e.key]
    if (to) { e.preventDefault(); go(to) }
    return
  }
  const k = e.key
  if (k === 'g') { gPending = Date.now(); return }
  if (k === '?') { e.preventDefault(); helpOpen.value = true; return }
  if (k === ',') { e.preventDefault(); openSettings(); return }
  if (k === '/') { e.preventDefault(); document.querySelector('.side-search input')?.focus(); return }
  if (!current.value) return
  if (k === 'c') { e.preventDefault(); go('tasks'); newTask() }
  else if (k === 's') { e.preventDefault(); sprintsOpen.value = true }
  else if (k === 'a') { e.preventDefault(); chatOpen.value = !chatOpen.value }
  else if (['1', '2', '3', '4'].includes(k)) {
    e.preventDefault()
    go('tasks')
    taskView.value = ['kanban', 'table', 'list', 'roadmap'][+k - 1]
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey))

function openTask(path) { detailPath.value = path }
function newTask(column = 'backlog') { createColumn.value = column; createOpen.value = true }

async function onTaskCreated(path) {
  createOpen.value = false
  await loadProject()
  notify('Tarefa criada')
  detailPath.value = path
}
// exclusao com desfazer (o retrato inclui os arquivos do cofre)
async function deleteTask(path) {
  detailPath.value = ''
  try {
    await withUndo('Tarefa excluída', () => api.remove(currentId.value, path), { files: true })
    await loadProject()
  } catch (e) { notify(e.message) }
}

function clearFilters() {
  filters.layer = 'all'; filters.severity = 'all'; filters.feature = ''
  filters.assignee = ''; filters.label = ''; filters.sprint = ''; filters.quick = new Set()
}

// ---------- navegação ----------
function go(s) {
  showFilter.value = false
  // sem cofre importado, so a tela de importacao (home) fica acessivel
  if (!hasProjects.value) { section.value = 'home'; return }
  section.value = s
}

function selectProject(id) {
  if (id !== currentId.value) currentId.value = id
  section.value = 'tasks'
  sideOpen.value = false
}

function openSettings(sec = 'general') { settingsSection.value = sec; settingsOpen.value = true }

// projetos mudaram por fora (atualizacao do cofre, sincronizacao, importacao)
async function onProjectsChanged() {
  for (const id of Object.keys(projectData)) delete projectData[id]
  await loadProjects()
  await loadProject()
  prefsTick.value++
}

// ---------- lembrete de backup ----------
const backupReminder = computed(() => { prefsTick.value; return backupDue(projects.value) })
async function backupNow(p) {
  try {
    download(await api.exportBackup(p.id), `${safeName(p.name)}-${stamp()}.cofre.json`)
    await loadProjects()
    notify(`Backup de "${p.name}" baixado`)
  } catch (e) { notify(e.message) }
}
function snooze() { snoozeBackup(24); prefsTick.value++ }

// ---------- sincronizacao automatica (opcional) ----------
let offStore = () => {}
async function startSync() {
  offStore()
  let cfg = {}
  try { cfg = JSON.parse(localStorage.getItem('cofre.sync') || '{}') } catch { /* sem config */ }
  if (!cfg.url || !cfg.anonKey) return
  const sync = await import('./browser/sync.js')
  await sync.getUser() // conclui o login vindo do link magico, se houver
  offStore = onStoreChange((id) => sync.scheduleAutoPush(id, (err) => {
    if (err?.code === 'conflict') notify('Há uma versão mais nova na nuvem. Abra Configurações > Sincronização.')
    else if (err) notify('Falha ao sincronizar: ' + err.message)
    else loadProjects()
  }))
}
onMounted(startSync)
onBeforeUnmount(() => offStore())

function toggleFav(id) {
  const s = new Set(favorites.value)
  s.has(id) ? s.delete(id) : s.add(id)
  favorites.value = s
  localStorage.setItem('cofre.favs', JSON.stringify([...s]))
}

// ---------- arvore da sidebar ----------
function setExpanded(id, open) {
  const s = new Set(expandedProjects.value)
  open ? s.add(id) : s.delete(id)
  expandedProjects.value = s
  localStorage.setItem('cofre.expanded', JSON.stringify([...s]))
  if (open && id !== currentId.value) ensureProjectData(id)
}
function toggleProject(id) { setExpanded(id, !expandedProjects.value.has(id)) }

// por padrao Funcionalidades abre e Documentos fica recolhido
const isSubOpen = (pid, kind) => subOpen[`${pid}:${kind}`] ?? kind === 'feats'
function toggleSub(pid, kind) { subOpen[`${pid}:${kind}`] = !isSubOpen(pid, kind) }

function toggleFeature(pid, name) {
  const key = `${pid}:${name}`
  const s = new Set(openFeatures.value)
  s.has(key) ? s.delete(key) : s.add(key)
  openFeatures.value = s
}

// troca de projeto (se preciso) e so entao executa a navegacao
function goToProject(id, nav) {
  if (id === currentId.value) { nav?.(); return }
  pendingNav = nav
  currentId.value = id
}
function openTaskIn(pid, path) { goToProject(pid, () => openTask(path)) }
function openDocIn(pid, path) { goToProject(pid, () => openDoc(path)) }

// arrastar um arquivo da sidebar: o quadro precisa estar visivel para receber.
// So o projeto aberto pode ser arrastado (o Kanban e do projeto atual).
function onSideDragStart(e, card) {
  sideDrag.value = card.path
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', card.path)
  e.dataTransfer.setData(DND_TASK, card.path)
  if (section.value !== 'tasks' || taskView.value !== 'kanban') {
    section.value = 'tasks'
    taskView.value = 'kanban'
  }
}
function onSideDragEnd() { sideDrag.value = ''; sideDropOver.value = false }

// soltar um card do quadro sobre a sidebar o tira do quadro
function onSideDragOver(e) {
  if (!e.dataTransfer.types.includes(DND_CARD)) return
  e.preventDefault()
  sideDropOver.value = true
}
function onSideDrop(e) {
  sideDropOver.value = false
  const path = e.dataTransfer.getData(DND_CARD)
  if (path) moveCard(path, null)
}

// pastas de documentos que NAO sao tarefas (consolidados)
const docFoldersOf = (t) => (t || []).filter((n) => n.type === 'dir' && !/^backlog|^transversais/i.test(n.name))

function openDocFolderIn(pid, node) {
  goToProject(pid, () => {
    docFolder.value = [node.name]
    docFile.value = ''
    section.value = 'docs'
  })
}

function openDoc(path) {
  // tarefas abrem no detalhe; demais documentos na aba Documentos
  if (allCards.value.some((c) => c.path === path)) { detailPath.value = path; return }
  const parts = path.split('/')
  docFolder.value = parts.slice(0, -1)
  docFile.value = path
  section.value = 'docs'
}

function askAboutTask(card) {
  chatSeed.value = { text: `Quais conflitos, riscos e dependências envolvem a tarefa "${card.title}" (${prettyFolder(card.feature)})?`, contextPath: card.path }
  chatOpen.value = true
}

const favProjects = computed(() => projects.value.filter((p) => favorites.value.has(p.id)))

// Arvore da sidebar. Com busca ativa, um projeto aparece se o nome casar ou se
// alguma funcionalidade/arquivo dele casar (e ai abre o caminho ate o achado).
const sideProjects = computed(() => {
  const q = filters.q.trim().toLowerCase()
  const out = []
  for (const p of projects.value) {
    const data = projectData[p.id]
    const projHit = !q || p.name.toLowerCase().includes(q)
    let feats = data ? groupFeatures(data.board.cards) : []
    let docs = data ? docFoldersOf(data.tree) : []
    let searchOpen = false
    if (q && !projHit) {
      feats = feats
        .map((c) => {
          const nameHit = prettyFolder(c.name).toLowerCase().includes(q)
          const files = nameHit ? c.files : c.files.filter((f) => f.fileName.toLowerCase().includes(q))
          return { ...c, files, searchOpen: !nameHit && files.length > 0 }
        })
        .filter((c) => c.files.length)
      docs = docs.filter((d) => d.name.toLowerCase().includes(q))
      if (!feats.length && !docs.length) continue
      searchOpen = true
    }
    out.push({
      ...p,
      data,
      open: expandedProjects.value.has(p.id) || searchOpen,
      featsOpen: isSubOpen(p.id, 'feats') || (searchOpen && feats.length > 0),
      docsOpen: isSubOpen(p.id, 'docs') || (searchOpen && docs.length > 0),
      feats: feats.map((c) => ({ ...c, open: openFeatures.value.has(`${p.id}:${c.name}`) || c.searchOpen })),
      docs,
    })
  }
  return out
})

const SECTION_TITLE = { home: 'Projetos', insights: 'Insights', docs: 'Documentos', tasks: '' }
</script>

<template>
  <div class="shell" @click="showFilter = false">
    <!-- ===== Rail de ícones ===== -->
    <nav class="rail">
      <div class="logo" title="Cofre Hub">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6.5" r="4"/><circle cx="6.5" cy="15.5" r="4"/><circle cx="17.5" cy="15.5" r="4"/></svg>
      </div>
      <div class="rail-item" :class="{ active: section === 'home' }" @click="go('home')"><Icon name="home" :size="18" />Início</div>
      <div class="rail-item" :class="{ active: section === 'tasks', disabled: !hasProjects }" @click="go('tasks')"><Icon name="board" :size="18" />Tarefas</div>
      <div class="rail-item" :class="{ active: section === 'docs', disabled: !hasProjects }" @click="go('docs')"><Icon name="file" :size="18" />Docs</div>
      <div class="rail-item" :class="{ active: section === 'insights', disabled: !hasProjects }" @click="go('insights')"><Icon name="chart" :size="18" />Insights</div>
      <div class="grow"></div>
      <div class="rail-item" :class="{ active: chatOpen, disabled: !current }" @click="current && (chatOpen = !chatOpen)"><Icon name="sparkle" :size="18" />Assist.</div>
      <div class="rail-item" :class="{ active: settingsOpen }" title="Configurações" @click="openSettings()"><Icon name="settings" :size="18" />Config.</div>
    </nav>
    <div v-if="sideOpen" class="side-backdrop" @click="sideOpen = false"></div>

    <!-- ===== Sidebar ===== -->
    <aside class="side" :class="{ open: sideOpen }">
      <div class="side-search">
        <div class="field">
          <Icon name="search" :size="14" />
          <input v-model="filters.q" placeholder="Buscar..." />
        </div>
      </div>

      <div class="side-scroll">
        <!-- Favoritos -->
        <div v-if="favProjects.length" class="side-group">
          <div class="side-group-head" @click="openGroups.favs = !openGroups.favs">
            <Icon :name="openGroups.favs ? 'chevronDown' : 'chevronRight'" :size="12" /> Favoritos
          </div>
          <template v-if="openGroups.favs">
            <div v-for="p in favProjects" :key="'f' + p.id" class="side-item" :class="{ active: p.id === currentId && section !== 'home' }" @click="selectProject(p.id)">
              <Icon name="star" :size="14" style="color: var(--yellow)" />
              <span>{{ p.name }}</span>
            </div>
          </template>
        </div>

        <!-- Projetos: cada projeto e uma "pasta" com Funcionalidades e Documentos.
             Listra amarela = fora do quadro; verde = no quadro. So o projeto aberto
             pode ter arquivos arrastados para o Kanban. -->
        <div class="side-group">
          <div class="side-group-head" @click="openGroups.projects = !openGroups.projects">
            <Icon :name="openGroups.projects ? 'chevronDown' : 'chevronRight'" :size="12" /> Projetos
            <button class="icon-btn" style="margin-left:auto; width:22px; height:22px" title="Adicionar projeto"
              @click.stop="go('home'); addProjectSignal++"><Icon name="plus" :size="13" /></button>
          </div>
          <template v-if="openGroups.projects">
            <div v-for="p in sideProjects" :key="p.id" class="proj"
              :class="{ open: p.open, current: p.id === currentId, 'drop-out': sideDropOver && p.id === currentId }"
              @dragover="p.id === currentId && onSideDragOver($event)" @dragleave.self="sideDropOver = false"
              @drop.prevent="p.id === currentId && onSideDrop($event)">
              <div class="side-item proj-head" :class="{ active: p.id === currentId && section !== 'home' }"
                :title="p.name" @click="selectProject(p.id)">
                <button class="tw" :aria-expanded="p.open" :title="p.open ? 'Recolher' : 'Expandir'" @click.stop="toggleProject(p.id)">
                  <Icon name="chevronRight" :size="12" />
                </button>
                <span class="sq" :style="{ background: colorFor(p.name) }">{{ initials(p.name)[0] }}</span>
                <span class="proj-name">{{ p.name }}</span>
                <span class="count">{{ p.taskCount }}</span>
              </div>

              <div class="clp" :class="{ open: p.open }">
                <div class="clp-in proj-tree">
                  <div v-if="!p.data" class="tree-note">Carregando…</div>
                  <template v-else>
                    <div v-if="sideDropOver && p.id === currentId" class="side-drop-hint"><Icon name="x" :size="13" /> Solte para remover do quadro</div>

                    <!-- Funcionalidades -->
                    <div class="sub-head" :class="{ open: p.featsOpen }" @click="toggleSub(p.id, 'feats')">
                      <Icon name="chevronRight" :size="11" class="tw-ic" /> <Icon name="board" :size="13" /> Funcionalidades
                      <span class="count">{{ p.feats.length }}</span>
                    </div>
                    <div class="clp" :class="{ open: p.featsOpen }">
                      <div class="clp-in sub-tree">
                        <div v-for="c in p.feats" :key="c.name" class="feat" :class="{ open: c.open }">
                          <div class="side-item feat-head" :aria-expanded="c.open" @click="toggleFeature(p.id, c.name)">
                            <Icon name="chevronRight" :size="12" class="feat-chev" />
                            <Icon name="hash" :size="14" class="hash" :style="{ color: colorFor(c.name) }" />
                            <span class="feat-name">{{ prettyFolder(c.name) }}</span>
                            <span class="count" :title="`${c.onBoard} de ${c.count} no quadro`">{{ c.onBoard }}/{{ c.count }}</span>
                          </div>
                          <div class="feat-body">
                            <div class="feat-inner">
                              <div v-for="(f, i) in c.files" :key="f.path" class="feat-file"
                                :class="{ on: f.status, dragging: sideDrag === f.path, locked: p.id !== currentId }" :style="{ '--i': i }"
                                :title="p.id !== currentId ? 'Clique para abrir (troca para este projeto)' : f.status ? 'No quadro · clique para abrir' : 'Fora do quadro · arraste para o Kanban'"
                                :draggable="p.id === currentId" @dragstart="onSideDragStart($event, f)" @dragend="onSideDragEnd"
                                @click="openTaskIn(p.id, f.path)">
                                <span class="stripe"></span>
                                <span class="fname">{{ f.fileName }}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div v-if="!p.feats.length" class="tree-note">Nenhuma funcionalidade</div>
                      </div>
                    </div>

                    <!-- Documentos do cofre -->
                    <template v-if="p.docs.length">
                      <div class="sub-head" :class="{ open: p.docsOpen }" @click="toggleSub(p.id, 'docs')">
                        <Icon name="chevronRight" :size="11" class="tw-ic" /> <Icon name="file" :size="13" /> Documentos
                        <span class="count">{{ p.docs.length }}</span>
                      </div>
                      <div class="clp" :class="{ open: p.docsOpen }">
                        <div class="clp-in sub-tree">
                          <div v-for="d in p.docs" :key="d.path" class="side-item doc-item"
                            :class="{ active: p.id === currentId && section === 'docs' && docFolder[0] === d.name }"
                            @click="openDocFolderIn(p.id, d)">
                            <Icon name="folder" :size="14" class="hash" />
                            <span class="feat-name">{{ d.name }}</span>
                            <span class="count">{{ d.children.length }}</span>
                          </div>
                        </div>
                      </div>
                    </template>
                  </template>
                </div>
              </div>
            </div>
            <div v-if="!sideProjects.length" class="side-item muted" style="cursor:default">{{ filters.q ? 'Nada encontrado' : 'Nenhum projeto' }}</div>
          </template>
        </div>
      </div>

      <div class="side-foot">
        <div class="t">Assistente do projeto</div>
        <div class="s">Pergunte sobre a documentação e revise tarefas antes de criá-las.</div>
        <button class="btn-primary" style="width:100%; justify-content:center" :disabled="!current" @click="current && (chatOpen = true)">
          <Icon name="sparkle" :size="14" /> Abrir assistente
        </button>
      </div>
    </aside>

    <!-- ===== Área principal ===== -->
    <main class="main">
      <header class="header">
        <div class="header-top">
          <button class="icon-btn menu-btn" title="Menu" aria-label="Abrir menu" @click="sideOpen = !sideOpen"><Icon name="list" :size="18" /></button>
          <!-- Insights pode cobrir varios projetos: o escopo fica na propria tela -->
          <template v-if="section === 'insights' && current">
            <div class="project-avatar" style="background: var(--accent)"><Icon name="chart" :size="18" /></div>
            <h1>Insights</h1>
          </template>
          <template v-else-if="section !== 'home' && current">
            <div class="project-avatar" :style="{ background: colorFor(current.name) }">{{ initials(current.name) }}</div>
            <h1>{{ section === 'tasks' ? current.name : SECTION_TITLE[section] }}</h1>
            <button class="icon-btn star" :class="{ on: favorites.has(current.id) }" title="Favoritar" @click="toggleFav(current.id)">
              <Icon name="star" :size="16" />
            </button>
          </template>
          <h1 v-else>Projetos</h1>

          <div class="header-actions">
            <template v-if="current && section === 'tasks'">
              <span v-if="summary.red" class="chip" style="cursor:default" title="Tarefas com conflito crítico">
                <span class="sev-dot" :style="{ background: SEV.red.color }"></span>{{ summary.red }}
              </span>
              <span v-if="summary.yellow" class="chip" style="cursor:default" title="Tarefas com risco">
                <span class="sev-dot" :style="{ background: SEV.yellow.color }"></span>{{ summary.yellow }}
              </span>
              <span class="chip" style="cursor:default" title="Concluídas">
                <Icon name="check" :size="12" /> {{ summary.done }}/{{ boardCards.length }}
              </span>
              <button class="icon-btn" title="Recarregar" @click="loadProject"><Icon name="refresh" :size="16" /></button>
              <button class="btn-primary" @click="newTask()"><Icon name="plus" :size="14" /> Nova tarefa</button>
            </template>
          </div>
        </div>
        <div v-if="current && section !== 'home' && section !== 'insights'" class="header-sub">{{ boardCards.length }} de {{ current.taskCount }} tarefa(s) no quadro · cofre importado</div>

        <!-- Abas (somente tarefas) -->
        <div v-if="section === 'tasks' && current" class="tabs">
          <button class="tab" :class="{ active: taskView === 'kanban' }" @click="taskView = 'kanban'"><Icon name="board" :size="15" /> Kanban</button>
          <button class="tab" :class="{ active: taskView === 'table' }" @click="taskView = 'table'"><Icon name="table" :size="15" /> Tabela</button>
          <button class="tab" :class="{ active: taskView === 'list' }" @click="taskView = 'list'"><Icon name="list" :size="15" /> Lista</button>
          <button class="tab" :class="{ active: taskView === 'roadmap' }" @click="taskView = 'roadmap'"><Icon name="calendar" :size="15" /> Roadmap</button>

          <!-- sprint exibida + raias -->
          <select v-if="taskView !== 'roadmap'" v-model="filters.sprint" class="tab-select" title="Sprint exibida">
            <option value="">Todas as sprints</option>
            <option v-if="activeSprint" :value="activeSprint.id">▶ {{ activeSprint.name }} (ativa)</option>
            <option v-for="s in sprints.filter((s) => s.state === 'planned')" :key="s.id" :value="s.id">{{ s.name }}</option>
            <option value="__none">Sem sprint</option>
          </select>
          <select v-if="taskView === 'kanban'" v-model="lanes" class="tab-select" title="Raias">
            <option value="none">Sem raias</option>
            <option value="feature">Raias: funcionalidade</option>
            <option value="priority">Raias: prioridade</option>
            <option value="assignee">Raias: responsável</option>
          </select>
          <button class="tab" title="Gerenciar sprints" @click="sprintsOpen = true"><Icon name="clock" :size="15" /> Sprints</button>
          <div class="spacer"></div>

          <!-- filtros rapidos -->
          <button class="qf" :class="{ on: filters.quick.has('overdue') }" :aria-pressed="filters.quick.has('overdue')" @click="toggleQuick('overdue')">
            <Icon name="clock" :size="13" /> Atrasadas<span v-if="overdueCount" class="qf-n">{{ overdueCount }}</span>
          </button>
          <button class="qf" :class="{ on: filters.quick.has('high') }" :aria-pressed="filters.quick.has('high')" @click="toggleQuick('high')">
            <Icon name="arrowUp" :size="13" /> Alta prioridade
          </button>
          <button class="qf" :class="{ on: filters.quick.has('unassigned') }" :aria-pressed="filters.quick.has('unassigned')" @click="toggleQuick('unassigned')">
            <Icon name="user" :size="13" /> Sem responsável
          </button>

          <span v-if="filters.assignee" class="chip" @click="filters.assignee = ''">
            <Icon name="user" :size="11" /> {{ filters.assignee }} <Icon name="x" :size="11" class="x" />
          </span>
          <span v-if="filters.label" class="chip" @click="filters.label = ''">
            <Icon name="tag" :size="11" /> {{ filters.label }} <Icon name="x" :size="11" class="x" />
          </span>
          <span v-if="filters.feature" class="chip" @click="filters.feature = ''">
            # {{ prettyFolder(filters.feature) }} <Icon name="x" :size="11" class="x" />
          </span>

          <div style="position:relative" @click.stop>
            <button class="tab" @click="showFilter = !showFilter">
              <Icon name="filter" :size="15" /> Filtro<span v-if="activeFilterCount"> · {{ activeFilterCount }}</span>
            </button>
            <div v-if="showFilter" class="popover" style="right:0; top:40px">
              <div class="h">Camada</div>
              <div v-for="(label, key) in { all: 'Todas', ...LAYERS }" :key="key" v-show="key !== 'outro'"
                class="opt" :class="{ on: filters.layer === key }" @click="filters.layer = key">
                <Icon :name="filters.layer === key ? 'check' : 'layers'" :size="14" /> {{ label }}
              </div>
              <div class="sep"></div>
              <div class="h">Severidade</div>
              <div v-for="(label, key) in { all: 'Todas', red: 'Crítico', yellow: 'Risco', green: 'Melhoria', none: 'Sem apontamento' }" :key="key"
                class="opt" :class="{ on: filters.severity === key }" @click="filters.severity = key">
                <Icon v-if="filters.severity === key" name="check" :size="14" />
                <span v-else class="sev-dot" :style="{ background: SEV[key]?.color || 'var(--line-strong)', margin: '0 3.5px' }"></span>
                {{ label }}
              </div>
              <template v-if="assignees.length">
                <div class="sep"></div>
                <div class="h">Responsável</div>
                <div v-for="a in assignees" :key="a" class="opt" :class="{ on: filters.assignee === a }"
                  @click="filters.assignee = filters.assignee === a ? '' : a">
                  <Icon v-if="filters.assignee === a" name="check" :size="14" />
                  <span v-else class="avatar xs" :style="{ background: colorFor(a) }">{{ initials(a) }}</span>
                  {{ a }}
                </div>
              </template>
              <template v-if="labels.length">
                <div class="sep"></div>
                <div class="h">Etiqueta</div>
                <div v-for="l in labels" :key="l" class="opt" :class="{ on: filters.label === l }"
                  @click="filters.label = filters.label === l ? '' : l">
                  <Icon :name="filters.label === l ? 'check' : 'tag'" :size="14" /> {{ l }}
                </div>
              </template>
              <div class="sep"></div>
              <div class="opt" @click="clearFilters(); showFilter = false"><Icon name="x" :size="14" /> Limpar filtros</div>
            </div>
          </div>
        </div>
      </header>

      <div class="body">
        <p v-if="error" class="err">{{ error }}</p>

        <div v-if="backupReminder.length" class="backup-banner" role="status">
          <Icon name="archive" :size="16" />
          <span v-if="backupReminder.length === 1">
            <b>{{ backupReminder[0].name }}</b> {{ backupReminder[0].never ? 'nunca teve backup' : `está há ${backupReminder[0].days} dias sem backup` }}.
            Os dados ficam só neste navegador.
          </span>
          <span v-else><b>{{ backupReminder.length }} projetos</b> estão sem backup recente. Os dados ficam só neste navegador.</span>
          <span class="bb-actions">
            <button v-for="p in backupReminder.slice(0, 3)" :key="p.id" class="btn" @click="backupNow(p)">
              <Icon name="download" :size="13" /> {{ backupReminder.length === 1 ? 'Fazer backup agora' : p.name }}
            </button>
            <button class="btn-ghost" @click="snooze">Lembrar amanhã</button>
          </span>
        </div>

        <ProjectsView v-if="section === 'home'" :projects="projects" :current-id="currentId" :favorites="favorites"
          :add-signal="addProjectSignal" @select="selectProject" @changed="onProjectsChanged" @toggle-fav="toggleFav" @notify="notify" />

        <div v-else-if="!current" class="empty">Nenhum projeto selecionado. Adicione um cofre em <b>Início</b>.</div>

        <template v-else-if="section === 'tasks'">
          <div v-if="loading && !board" class="empty">Carregando tarefas…</div>
          <template v-else-if="board">
            <KanbanBoard v-if="taskView === 'kanban'" :columns="columnsView" :counts="columnCounts" :wip="board.wip || {}"
              :lanes="lanes" :assignees="assignees" @open="openTask" @move="moveCard" @add="newTask" @set-wip="setWip" />
            <TaskTable v-else-if="taskView === 'table'" ref="table" :cards="filteredCards" :assignees="assignees" :sprints="sprints"
              @open="openTask" @move="moveCard" @bulk="onBulk" />
            <RoadmapView v-else-if="taskView === 'roadmap'" :cards="roadmapCards" :sprints="sprints"
              @open="openTask" @sprints="sprintsOpen = true" />
            <TaskList v-else :columns="columnsView" @open="openTask" />
            <div v-if="!filteredCards.length && boardCards.length" class="empty">
              Nenhuma tarefa com esses filtros. <a href="#" style="color:var(--accent)" @click.prevent="clearFilters(); filters.q = ''">Limpar</a>
            </div>
          </template>
        </template>

        <FileBrowser v-else-if="section === 'docs'" :project-id="currentId" :tree="tree"
          :start-folder="docFolder" :start-file="docFile" @open-task="openTask" @changed="loadProject" />

        <Dashboard v-else-if="section === 'insights'" :projects="projects" :current-id="currentId" :cards="allCards"
          @open="(path, pid) => openDocIn(pid || currentId, path)" />
      </div>

      <!-- Chat flutuante -->
      <ChatPanel v-if="chatOpen && current" :project-id="currentId" :project-name="current.name" :seed="chatSeed"
        @close="chatOpen = false" @open-doc="openDoc" @consumed="chatSeed = null" @settings="openSettings('ai')" />
      <button v-if="current" class="fab" :class="{ ai: !chatOpen }" :title="chatOpen ? 'Fechar assistente' : 'Assistente'" @click="chatOpen = !chatOpen">
        <Icon :name="chatOpen ? 'x' : 'sparkle'" :size="18" />
      </button>
    </main>

    <!-- Modais -->
    <TaskDetail v-if="detailPath && current" :project-id="currentId" :path="detailPath" :cards="allCards"
      :assignees="assignees" :labels="labels" :sprints="sprints"
      @close="detailPath = ''" @move="moveCard" @saved="loadProject" @updated="refreshBoard" @delete="deleteTask"
      @ask="askAboutTask" @open-doc="openDoc" />

    <CreateTaskModal v-if="createOpen && current" :project-id="currentId" :categories="categories"
      :initial-column="createColumn" :initial-feature="filters.feature"
      @close="createOpen = false" @created="onTaskCreated" @open-doc="openDoc" />

    <SettingsModal v-if="settingsOpen" :projects="projects" :section="settingsSection"
      @close="settingsOpen = false" @changed="onProjectsChanged(); startSync()" @notify="notify" />

    <SprintsModal v-if="sprintsOpen && current" :project-id="currentId" :sprints="sprints" :cards="allCards"
      @close="sprintsOpen = false" @changed="refreshBoard" />

    <!-- atalhos de teclado -->
    <div v-if="helpOpen" class="overlay" @click.self="helpOpen = false">
      <div class="modal" style="width:440px">
        <div class="modal-head">
          <Icon name="help" :size="16" /><h3>Atalhos de teclado</h3>
          <button class="icon-btn" style="margin-left:auto" title="Fechar (Esc)" @click="helpOpen = false"><Icon name="x" :size="16" /></button>
        </div>
        <div class="modal-body shortcuts">
          <div v-for="[k, d] in SHORTCUTS" :key="k" class="sc"><span>{{ d }}</span><kbd v-for="x in k.split(' ')" :key="x">{{ x }}</kbd></div>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast" role="status">
      {{ toast }}
      <button v-if="toastUndo" class="toast-undo" @click="runUndo">Desfazer</button>
    </div>
  </div>
</template>
