<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { api } from './api.js'
import { COLUMNS, LAYERS, SEV, colorFor, initials, prettyFolder } from './constants.js'
import Icon from './components/Icon.vue'
import KanbanBoard from './components/KanbanBoard.vue'
import TaskTable from './components/TaskTable.vue'
import TaskList from './components/TaskList.vue'
import TaskDetail from './components/TaskDetail.vue'
import CreateTaskModal from './components/CreateTaskModal.vue'
import ChatPanel from './components/ChatPanel.vue'
import FileBrowser from './components/FileBrowser.vue'
import ProjectsView from './components/ProjectsView.vue'
import Dashboard from './components/Dashboard.vue'

// ---------- estado global ----------
const projects = ref([])
const currentId = ref(localStorage.getItem('cofre.project') || '')
const section = ref('tasks')          // home | tasks | docs | insights
const taskView = ref(localStorage.getItem('cofre.view') || 'kanban') // kanban | table | list
const board = ref(null)
const tree = ref([])
const loading = ref(false)
const error = ref('')
const toast = ref('')

const favorites = ref(new Set(JSON.parse(localStorage.getItem('cofre.favs') || '[]')))
const filters = reactive({ q: '', layer: 'all', severity: 'all', feature: '' })
const showFilter = ref(false)
const openGroups = reactive({ favs: true, projects: true, cats: true, docs: false })

const detailPath = ref('')
const createOpen = ref(false)
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
  } catch (e) { error.value = e.message }
}

async function loadProject() {
  if (!currentId.value) return
  loading.value = true
  error.value = ''
  try {
    const [b, t] = await Promise.all([api.kanban(currentId.value), api.tree(currentId.value)])
    board.value = b
    tree.value = t.tree
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

onMounted(async () => { await loadProjects(); await loadProject() })

watch(currentId, (id) => {
  localStorage.setItem('cofre.project', id || '')
  filters.feature = ''
  detailPath.value = ''
  docFile.value = ''
  docFolder.value = []
  board.value = null
  loadProject()
})
watch(taskView, (v) => localStorage.setItem('cofre.view', v))

function notify(msg) {
  toast.value = msg
  setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2600)
}

// ---------- tarefas ----------
const allCards = computed(() => (board.value ? board.value.columns.flatMap((c) => c.cards) : []))

const filteredCards = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return allCards.value.filter((c) => {
    if (filters.layer !== 'all' && c.layer !== filters.layer) return false
    if (filters.severity === 'none' && c.severity) return false
    if (!['all', 'none'].includes(filters.severity) && c.severity !== filters.severity) return false
    if (filters.feature && c.feature !== filters.feature) return false
    if (q && !`${c.title} ${c.feature} ${c.kind} ${c.excerpt}`.toLowerCase().includes(q)) return false
    return true
  })
})

const columnsView = computed(() =>
  COLUMNS.map((col) => ({ ...col, cards: filteredCards.value.filter((c) => c.status === col.id) }))
)

const categories = computed(() => {
  const map = new Map()
  for (const c of allCards.value) map.set(c.feature, (map.get(c.feature) || 0) + 1)
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
})

const summary = computed(() => {
  const s = { red: 0, yellow: 0, done: 0 }
  for (const c of allCards.value) {
    if (c.severity === 'red') s.red++
    if (c.severity === 'yellow') s.yellow++
    if (c.status === 'feito') s.done++
  }
  return s
})

const activeFilterCount = computed(() =>
  (filters.layer !== 'all') + (filters.severity !== 'all') + Boolean(filters.feature)
)

async function moveCard(path, status) {
  const card = allCards.value.find((c) => c.path === path)
  if (!card || card.status === status) return
  const prev = card.status
  // move otimista entre colunas
  const from = board.value.columns.find((c) => c.id === prev)
  const to = board.value.columns.find((c) => c.id === status)
  from.cards = from.cards.filter((c) => c.path !== path)
  card.status = status
  to.cards.push(card)
  try {
    await api.moveCard(currentId.value, path, status)
  } catch (e) {
    notify('Não foi possível mover: ' + e.message)
    loadProject()
  }
}

function openTask(path) { detailPath.value = path }
function newTask(column = 'backlog') { createColumn.value = column; createOpen.value = true }

async function onTaskCreated(path) {
  createOpen.value = false
  await loadProject()
  notify('Tarefa criada')
  detailPath.value = path
}
async function onTaskDeleted() {
  detailPath.value = ''
  await loadProject()
  notify('Tarefa excluída')
}

function clearFilters() {
  filters.layer = 'all'; filters.severity = 'all'; filters.feature = ''
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
}

function toggleFav(id) {
  const s = new Set(favorites.value)
  s.has(id) ? s.delete(id) : s.add(id)
  favorites.value = s
  localStorage.setItem('cofre.favs', JSON.stringify([...s]))
}

function pickCategory(name) {
  filters.feature = filters.feature === name ? '' : name
  section.value = 'tasks'
}

// pastas de documentos que NAO sao tarefas (consolidados)
const docFolders = computed(() =>
  tree.value.filter((n) => n.type === 'dir' && !/^backlog|^transversais/i.test(n.name))
)

function openDocFolder(node) {
  docFolder.value = [node.name]
  docFile.value = ''
  section.value = 'docs'
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

const filteredProjects = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return projects.value.filter((p) => !q || p.name.toLowerCase().includes(q))
})
const favProjects = computed(() => projects.value.filter((p) => favorites.value.has(p.id)))
const filteredCategories = computed(() => {
  const q = filters.q.trim().toLowerCase()
  return categories.value.filter((c) => !q || c.name.toLowerCase().includes(q))
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
    </nav>

    <!-- ===== Sidebar ===== -->
    <aside class="side">
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

        <!-- Projetos -->
        <div class="side-group">
          <div class="side-group-head" @click="openGroups.projects = !openGroups.projects">
            <Icon :name="openGroups.projects ? 'chevronDown' : 'chevronRight'" :size="12" /> Todos os projetos
            <button class="icon-btn" style="margin-left:auto; width:22px; height:22px" title="Adicionar projeto"
              @click.stop="go('home'); addProjectSignal++"><Icon name="plus" :size="13" /></button>
          </div>
          <template v-if="openGroups.projects">
            <div v-for="p in filteredProjects" :key="p.id" class="side-item"
              :class="{ active: p.id === currentId && section !== 'home' }" @click="selectProject(p.id)">
              <span class="sq" :style="{ background: colorFor(p.name) }">{{ initials(p.name)[0] }}</span>
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ p.name }}</span>
              <span class="count">{{ p.taskCount }}</span>
            </div>
            <div v-if="!filteredProjects.length" class="side-item muted" style="cursor:default">Nenhum projeto</div>
          </template>
        </div>

        <!-- Categorias (funcionalidades do projeto) -->
        <div v-if="current" class="side-group">
          <div class="side-group-head" @click="openGroups.cats = !openGroups.cats">
            <Icon :name="openGroups.cats ? 'chevronDown' : 'chevronRight'" :size="12" /> Funcionalidades
          </div>
          <template v-if="openGroups.cats">
            <div v-for="c in filteredCategories" :key="c.name" class="side-item"
              :class="{ active: filters.feature === c.name && section === 'tasks' }" @click="pickCategory(c.name)">
              <Icon name="hash" :size="14" class="hash" :style="{ color: colorFor(c.name) }" />
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ prettyFolder(c.name) }}</span>
              <span class="count">{{ c.count }}</span>
            </div>
          </template>
        </div>

        <!-- Documentos do cofre -->
        <div v-if="docFolders.length" class="side-group">
          <div class="side-group-head" @click="openGroups.docs = !openGroups.docs">
            <Icon :name="openGroups.docs ? 'chevronDown' : 'chevronRight'" :size="12" /> Documentos do cofre
          </div>
          <template v-if="openGroups.docs">
            <div v-for="d in docFolders" :key="d.path" class="side-item" @click="openDocFolder(d)">
              <Icon name="folder" :size="14" class="hash" />
              <span>{{ d.name }}</span>
              <span class="count">{{ d.children.length }}</span>
            </div>
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
          <template v-if="section !== 'home' && current">
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
                <Icon name="check" :size="12" /> {{ summary.done }}/{{ allCards.length }}
              </span>
              <button class="icon-btn" title="Recarregar" @click="loadProject"><Icon name="refresh" :size="16" /></button>
              <button class="btn-primary" @click="newTask()"><Icon name="plus" :size="14" /> Nova tarefa</button>
            </template>
          </div>
        </div>
        <div v-if="current && section !== 'home'" class="header-sub">{{ current.taskCount }} tarefa(s) · cofre importado</div>

        <!-- Abas (somente tarefas) -->
        <div v-if="section === 'tasks' && current" class="tabs">
          <button class="tab" :class="{ active: taskView === 'kanban' }" @click="taskView = 'kanban'"><Icon name="board" :size="15" /> Kanban</button>
          <button class="tab" :class="{ active: taskView === 'table' }" @click="taskView = 'table'"><Icon name="table" :size="15" /> Tabela</button>
          <button class="tab" :class="{ active: taskView === 'list' }" @click="taskView = 'list'"><Icon name="list" :size="15" /> Lista</button>
          <div class="spacer"></div>

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
                <span v-else class="sev-dot" :style="{ background: SEV[key]?.color || '#55565d', margin: '0 3.5px' }"></span>
                {{ label }}
              </div>
              <div class="sep"></div>
              <div class="opt" @click="clearFilters(); showFilter = false"><Icon name="x" :size="14" /> Limpar filtros</div>
            </div>
          </div>
        </div>
      </header>

      <div class="body">
        <p v-if="error" class="err">{{ error }}</p>

        <ProjectsView v-if="section === 'home'" :projects="projects" :current-id="currentId" :favorites="favorites"
          :add-signal="addProjectSignal" @select="selectProject" @changed="loadProjects" @toggle-fav="toggleFav" />

        <div v-else-if="!current" class="empty">Nenhum projeto selecionado. Adicione um cofre em <b>Início</b>.</div>

        <template v-else-if="section === 'tasks'">
          <div v-if="loading && !board" class="empty">Carregando tarefas…</div>
          <template v-else-if="board">
            <KanbanBoard v-if="taskView === 'kanban'" :columns="columnsView" @open="openTask" @move="moveCard" @add="newTask" />
            <TaskTable v-else-if="taskView === 'table'" :cards="filteredCards" @open="openTask" @move="moveCard" />
            <TaskList v-else :columns="columnsView" @open="openTask" />
            <div v-if="!filteredCards.length && allCards.length" class="empty">
              Nenhuma tarefa com esses filtros. <a href="#" style="color:var(--accent)" @click.prevent="clearFilters(); filters.q = ''">Limpar</a>
            </div>
          </template>
        </template>

        <FileBrowser v-else-if="section === 'docs'" :project-id="currentId" :tree="tree"
          :start-folder="docFolder" :start-file="docFile" @open-task="openTask" @changed="loadProject" />

        <Dashboard v-else-if="section === 'insights'" :project-id="currentId" :cards="allCards" @open="openDoc" />
      </div>

      <!-- Chat flutuante -->
      <ChatPanel v-if="chatOpen && current" :project-id="currentId" :project-name="current.name" :seed="chatSeed"
        @close="chatOpen = false" @open-doc="openDoc" @consumed="chatSeed = null" />
      <button v-if="current" class="fab" :class="{ ai: !chatOpen }" :title="chatOpen ? 'Fechar assistente' : 'Assistente'" @click="chatOpen = !chatOpen">
        <Icon :name="chatOpen ? 'x' : 'sparkle'" :size="18" />
      </button>
    </main>

    <!-- Modais -->
    <TaskDetail v-if="detailPath && current" :project-id="currentId" :path="detailPath" :cards="allCards"
      @close="detailPath = ''" @move="moveCard" @saved="loadProject" @deleted="onTaskDeleted"
      @ask="askAboutTask" @open-doc="openDoc" />

    <CreateTaskModal v-if="createOpen && current" :project-id="currentId" :categories="categories"
      :initial-column="createColumn" :initial-feature="filters.feature"
      @close="createOpen = false" @created="onTaskCreated" @open-doc="openDoc" />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
