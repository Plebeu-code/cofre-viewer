<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'
import FlowReports from './FlowReports.vue'
import { download, toCsv, taskColumns, stamp } from '../browser/download.js'
import { COLUMNS, COLUMN_LABEL, COLUMN_COLOR, LAYERS, SEV, prettyFolder, colorFor, initials, formatDue } from '../constants.js'

const props = defineProps({
  projects: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  cards: { type: Array, default: () => [] }, // tarefas do projeto atual (ao vivo)
})
const emit = defineEmits(['open']) // (path, projectId)

const error = ref('')
const loading = ref(false)

// ---------- escopo: todos os projetos ou uma selecao ----------
const SCOPE_KEY = 'cofre.insights.scope'
function readScope() {
  try {
    const s = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null')
    if (s) return { all: Boolean(s.all), ids: new Set(s.ids || []) }
  } catch { /* usa o padrao */ }
  return { all: false, ids: new Set() }
}
const scope = reactive(readScope())
function saveScope() {
  localStorage.setItem(SCOPE_KEY, JSON.stringify({ all: scope.all, ids: [...scope.ids] }))
}

const nameOf = (id) => props.projects.find((p) => p.id === id)?.name || id
// selecao vazia ou com projetos removidos cai no projeto atual
const selectedIds = computed(() => {
  if (scope.all) return props.projects.map((p) => p.id)
  const valid = [...scope.ids].filter((id) => props.projects.some((p) => p.id === id))
  return valid.length ? valid : props.currentId ? [props.currentId] : []
})
const multi = computed(() => selectedIds.value.length > 1)
const isSelected = (id) => !scope.all && selectedIds.value.includes(id)

function selectAll() {
  scope.all = true
  saveScope()
}
function toggleProject(id) {
  if (scope.all) { scope.all = false; scope.ids = new Set([id]) }
  else {
    const s = new Set(selectedIds.value)
    if (s.has(id)) { if (s.size > 1) s.delete(id) } // mantem ao menos um
    else s.add(id)
    scope.ids = s
  }
  saveScope()
}
function focusProject(id) {
  scope.all = false
  scope.ids = new Set([id])
  saveScope()
}

// ---------- carregamento por projeto ----------
const data = reactive({}) // id -> { cards, stats }

async function loadScope() {
  error.value = ''
  const ids = selectedIds.value
  const todo = ids.filter((id) => !data[id] || id === props.currentId)
  if (!todo.length) return
  loading.value = true
  try {
    await Promise.all(todo.map(async (id) => {
      const [board, stats] = await Promise.all([api.kanban(id), api.stats(id)])
      data[id] = { cards: board.cards, sprints: board.sprints || [], stats }
    }))
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
watch(selectedIds, loadScope, { immediate: true })
// recalcula o projeto atual quando o conteudo das tarefas muda (edicao/exclusao)
watch(() => props.cards.length, loadScope)

const ready = computed(() => selectedIds.value.length && selectedIds.value.every((id) => data[id]))

// "fora do quadro" entra como um segmento neutro (hachurado) no fluxo
const OFF = { id: 'off', label: 'Fora do quadro', color: 'var(--line)' }
const FLOW = [OFF, ...COLUMNS]

const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0)
const statusKey = (c) => c.status || 'off'
const emptyFlow = () => Object.fromEntries(FLOW.map((s) => [s.id, 0]))

// tarefas de todos os projetos no escopo, marcadas com o projeto de origem
const cards = computed(() =>
  selectedIds.value.flatMap((id) => {
    const list = id === props.currentId ? props.cards : data[id]?.cards || []
    const pname = nameOf(id)
    return list.map((c) => ({ ...c, pid: id, pname }))
  })
)

// soma os consolidados; IDs (CONF, RISK...) sao unicos por projeto
const stats = computed(() => {
  const totals = {}
  const severityByFile = []
  const inventories = []
  for (const id of selectedIds.value) {
    const s = data[id]?.stats
    if (!s) continue
    for (const [k, v] of Object.entries(s.totals)) if (typeof v === 'number') totals[k] = (totals[k] || 0) + v
    for (const f of s.severityByFile) severityByFile.push({ ...f, pid: id, pname: nameOf(id) })
    if (s.inventory.length) inventories.push({ pid: id, pname: nameOf(id), rows: s.inventory })
  }
  severityByFile.sort((a, b) => b.red - a.red || b.yellow - a.yellow || b.green - a.green)
  return { totals, severityByFile, inventories }
})

// ---------- visao geral ----------
const overview = computed(() => {
  const total = cards.value.length
  const flow = emptyFlow()
  let critT = 0, critD = 0
  for (const c of cards.value) {
    flow[statusKey(c)]++
    critT += c.checkTotal || 0
    critD += c.checkDone || 0
  }
  const onBoard = total - flow.off
  return {
    total, onBoard, flow,
    done: flow.feito,
    donePct: pct(flow.feito, total),
    coveragePct: pct(onBoard, total),
    critT, critD, critPct: pct(critD, critT),
  }
})

// ---------- comparativo entre projetos ----------
const byProject = computed(() =>
  selectedIds.value.map((id) => {
    const cs = cards.value.filter((c) => c.pid === id)
    const flow = emptyFlow()
    let red = 0, yellow = 0
    for (const c of cs) { flow[statusKey(c)]++; red += c.red || 0; yellow += c.yellow || 0 }
    return {
      id, name: nameOf(id), total: cs.length, flow, red, yellow,
      donePct: pct(flow.feito, cs.length), coveragePct: pct(cs.length - flow.off, cs.length),
    }
  }).sort((a, b) => b.red - a.red || a.donePct - b.donePct)
)

// ---------- pontos de atencao (acionaveis) ----------
const attention = computed(() => {
  const out = []
  for (const c of cards.value) {
    if (c.red && !c.status) out.push({ c, rank: 0, sev: 'red', why: 'Conflito crítico fora do quadro' })
    else if (c.red && (c.status === 'a-fazer' || c.status === 'fazendo')) out.push({ c, rank: 1, sev: 'red', why: `${COLUMN_LABEL[c.status]} com conflito crítico` })
    else if (c.status === 'feito' && c.checkTotal && c.checkDone < c.checkTotal) out.push({ c, rank: 2, sev: 'yellow', why: `Concluída com ${c.checkTotal - c.checkDone} critério(s) pendente(s)` })
    else if (c.yellow && c.status === 'fazendo') out.push({ c, rank: 3, sev: 'yellow', why: 'Em andamento com risco' })
  }
  return out.sort((a, b) => a.rank - b.rank || (b.c.red - a.c.red) || (b.c.yellow - a.c.yellow))
})
const showAllAttention = ref(false)
const attentionShown = computed(() => (showAllAttention.value ? attention.value : attention.value.slice(0, 5)))

// ---------- funcionalidades ----------
const featureSort = ref('risk') // risk | progress | name
const openFeature = ref('')

const features = computed(() => {
  const map = new Map()
  for (const c of cards.value) {
    const key = `${c.pid}::${c.feature}`
    let f = map.get(key)
    if (!f) {
      f = { key, name: c.feature, pid: c.pid, pname: c.pname, tasks: [], flow: emptyFlow(), red: 0, yellow: 0, green: 0 }
      map.set(key, f)
    }
    f.tasks.push(c)
    f.flow[statusKey(c)]++
    f.red += c.red || 0
    f.yellow += c.yellow || 0
    f.green += c.green || 0
  }
  const list = [...map.values()].map((f) => ({ ...f, donePct: pct(f.flow.feito, f.tasks.length) }))
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.pname.localeCompare(b.pname, 'pt-BR')
  const by = {
    risk: (a, b) => b.red - a.red || b.yellow - a.yellow || byName(a, b),
    progress: (a, b) => a.donePct - b.donePct || byName(a, b),
    name: byName,
  }
  return list.sort(by[featureSort.value])
})
const maxFindings = computed(() => Math.max(1, ...features.value.map((f) => f.red + f.yellow + f.green)))

// ---------- camadas ----------
const layers = computed(() => {
  const rows = ['front', 'back', 'shared'].map((k) => {
    const cs = cards.value.filter((c) => c.layer === k)
    return {
      key: k, label: LAYERS[k], n: cs.length,
      done: cs.filter((c) => c.status === 'feito').length,
      red: cs.reduce((s, c) => s + (c.red || 0), 0),
      yellow: cs.reduce((s, c) => s + (c.yellow || 0), 0),
    }
  })
  const max = Math.max(1, ...rows.map((r) => r.n))
  return rows.map((r) => ({ ...r, w: (r.n / max) * 100, donePct: pct(r.done, r.n) }))
})

// ---------- documentos por severidade ----------
const docFilter = reactive({ sev: 'all', q: '' })
const docLimit = ref(8)
const docs = computed(() => {
  const q = docFilter.q.trim().toLowerCase()
  return stats.value.severityByFile.filter((f) => {
    if (docFilter.sev !== 'all' && !f[docFilter.sev]) return false
    return !q || `${f.pname} ${f.path}`.toLowerCase().includes(q)
  })
})
const maxDoc = computed(() => Math.max(1, ...docs.value.map((f) => f.red + f.yellow + f.green)))
watch(() => [docFilter.sev, docFilter.q, selectedIds.value.join()], () => { docLimit.value = 8 })

const docName = (p) => p.split('/').pop().replace(/\.md$/, '')
const docDir = (p) => p.split('/').slice(0, -1).join(' / ')

// ---------- inventario ----------
const inventory = computed(() => {
  const groups = stats.value.inventories
  const all = groups.flatMap((g) => g.rows)
  const done = all.filter((r) => r.done).length
  return { groups, total: all.length, done, pct: pct(done, all.length) }
})

// ---------- burndown da sprint (so com um projeto) ----------
const projectSprints = computed(() => {
  if (multi.value) return []
  const list = data[selectedIds.value[0]]?.sprints || []
  return list.filter((s) => s.state !== 'planned').sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : b.end.localeCompare(a.end)))
})
const burnSprintId = ref('')
const burnSprint = computed(() => projectSprints.value.find((s) => s.id === burnSprintId.value) || projectSprints.value[0] || null)

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const burn = computed(() => {
  const s = burnSprint.value
  if (!s) return null
  const tasks = cards.value.filter((c) => c.sprint === s.id)
  const usePoints = tasks.some((c) => c.points)
  const weight = (c) => (usePoints ? c.points || 0 : 1)
  const total = tasks.reduce((n, c) => n + weight(c), 0)
  const days = []
  const today = isoDay(new Date())
  for (let d = new Date(s.start + 'T00:00'); isoDay(d) <= s.end; d.setDate(d.getDate() + 1)) days.push(isoDay(d))
  const last = Math.max(1, days.length - 1)
  const points = days.map((day, i) => ({
    day,
    ideal: total - (total * i) / last,
    // restante = o que nao estava concluido ate o fim daquele dia (dias futuros ficam vazios)
    actual: day > today ? null : tasks.reduce((n, c) => n + (c.doneAt && isoDay(new Date(c.doneAt)) <= day ? 0 : weight(c)), 0),
  }))
  const done = tasks.filter((c) => c.status === 'feito')
  const remaining = total - done.reduce((n, c) => n + weight(c), 0)
  const daysLeft = days.filter((d) => d > today).length
  return { s, tasks, usePoints, total, points, done: done.length, remaining, daysLeft, unit: usePoints ? 'pts' : 'tarefas' }
})

// geometria do grafico (viewBox fixo, escala com a largura)
const BW = 640, BH = 220, PAD = { l: 36, r: 14, t: 14, b: 26 }
const bx = (i) => PAD.l + (i / Math.max(1, (burn.value?.points.length || 1) - 1)) * (BW - PAD.l - PAD.r)
const by = (v) => PAD.t + (1 - v / Math.max(1, burn.value?.total || 1)) * (BH - PAD.t - PAD.b)
const burnPath = (key) => {
  const pts = (burn.value?.points || []).map((p, i) => [i, p[key]]).filter(([, v]) => v != null)
  return pts.map(([i, v], n) => `${n ? 'L' : 'M'}${bx(i).toFixed(1)},${by(v).toFixed(1)}`).join(' ')
}
const burnTicks = computed(() => {
  const t = burn.value?.total || 0
  return [0, 0.5, 1].map((f) => Math.round(t * f)).filter((v, i, a) => a.indexOf(v) === i)
})
const burnLabels = computed(() => {
  const pts = burn.value?.points || []
  const step = Math.max(1, Math.ceil(pts.length / 7))
  return pts.map((p, i) => ({ i, label: formatDue(p.day) })).filter((p) => p.i % step === 0 || p.i === pts.length - 1)
})
const burnHover = ref(-1)
function onBurnMove(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const xv = ((e.clientX - r.left) / r.width) * BW
  const n = burn.value.points.length
  const i = Math.round(((xv - PAD.l) / (BW - PAD.l - PAD.r)) * (n - 1))
  burnHover.value = Math.min(n - 1, Math.max(0, i))
  const p = burn.value.points[burnHover.value]
  showTip(e, formatDue(p.day), [
    { color: 'var(--accent)', label: 'Restante', value: p.actual == null ? '—' : `${p.actual} ${burn.value.unit}` },
    { color: 'var(--text-3)', label: 'Ideal', value: `${Math.round(p.ideal * 10) / 10} ${burn.value.unit}` },
  ])
}
function onBurnLeave() { burnHover.value = -1; hideTip() }

// ---------- exportacao ----------
function exportTasks() {
  const sprints = selectedIds.value.flatMap((id) => data[id]?.sprints || [])
  download(toCsv(cards.value, taskColumns({ sprints, withProject: multi.value })), `insights-tarefas-${stamp()}.csv`)
}
function exportDocs() {
  download(toCsv(docs.value, [
    ...(multi.value ? [{ label: 'Projeto', value: (f) => f.pname }] : []),
    { label: 'Documento', value: (f) => docName(f.path) }, { label: 'Pasta', value: (f) => docDir(f.path) },
    { label: 'Críticos', value: (f) => f.red }, { label: 'Riscos', value: (f) => f.yellow }, { label: 'Melhorias', value: (f) => f.green },
  ]), `insights-documentos-${stamp()}.csv`)
}
const flowSprints = computed(() => (multi.value ? [] : data[selectedIds.value[0]]?.sprints || []))

// ---------- tooltip ----------
const tip = reactive({ show: false, x: 0, y: 0, title: '', lines: [] })
function showTip(e, title, lines) {
  tip.title = title
  tip.lines = lines
  tip.x = Math.min(e.clientX + 14, window.innerWidth - 230)
  tip.y = e.clientY + 16
  tip.show = true
}
function hideTip() { tip.show = false }

const flowLines = (flow, total) =>
  FLOW.filter((s) => flow[s.id]).map((s) => ({ color: s.color, off: s.id === 'off', label: s.label, value: `${flow[s.id]} · ${pct(flow[s.id], total)}%` }))
</script>

<template>
  <div class="ins">
    <!-- ===== Escopo ===== -->
    <div class="scope" role="group" aria-label="Projetos analisados">
      <span class="scope-k"><Icon name="filter" :size="13" /> Projetos</span>
      <button class="scope-chip" :class="{ on: scope.all }" :aria-pressed="scope.all" @click="selectAll">
        <Icon name="layers" :size="13" /> Todos <b>{{ projects.length }}</b>
      </button>
      <span class="scope-sep"></span>
      <button v-for="p in projects" :key="p.id" class="scope-chip" :class="{ on: isSelected(p.id), all: scope.all }"
        :aria-pressed="isSelected(p.id)" :title="scope.all ? 'Analisar só este projeto' : 'Incluir/remover da análise'"
        @click="toggleProject(p.id)">
        <span class="sq" :style="{ background: colorFor(p.name) }">{{ initials(p.name)[0] }}</span>
        {{ p.name }}
        <span v-if="p.id === currentId" class="cur">atual</span>
        <Icon v-if="isSelected(p.id) && multi" name="check" :size="12" />
      </button>
      <button class="btn scope-csv" :disabled="!ready" title="Exportar as tarefas dos projetos selecionados" @click="exportTasks">
        <Icon name="download" :size="13" /> CSV
      </button>
      <span class="scope-sum muted">
        {{ multi ? `${selectedIds.length} projetos · ${overview.total} tarefas` : `${overview.total} tarefas` }}
        <span v-if="loading" class="spin" aria-label="Carregando"></span>
      </span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="!ready" class="empty">Carregando indicadores…</div>
    <div v-else-if="!cards.length" class="empty">Os projetos selecionados ainda não têm arquivos de tarefa para analisar.</div>

    <template v-else>
      <!-- ===== Visão geral ===== -->
      <section class="ins-hero">
        <div class="hero-main">
          <div class="hero-k">Progresso geral{{ multi ? ` · ${selectedIds.length} projetos` : '' }}</div>
          <div class="hero-n">{{ overview.donePct }}<span>%</span></div>
          <div class="hero-s">{{ overview.done }} de {{ overview.total }} tarefas concluídas</div>

          <div class="stack lg" role="img" :aria-label="`Fluxo: ${FLOW.map((s) => `${s.label} ${overview.flow[s.id]}`).join(', ')}`">
            <template v-for="s in FLOW" :key="s.id">
              <i v-if="overview.flow[s.id]" :class="{ off: s.id === 'off' }"
                :style="{ flexGrow: overview.flow[s.id], background: s.id === 'off' ? null : s.color }"
                @mousemove="showTip($event, s.label, [{ value: `${overview.flow[s.id]} tarefa(s) · ${pct(overview.flow[s.id], overview.total)}%` }])"
                @mouseleave="hideTip"></i>
            </template>
          </div>
          <div class="legend">
            <span v-for="s in FLOW" :key="s.id" class="lg-item">
              <span class="sw" :class="{ off: s.id === 'off' }" :style="{ background: s.id === 'off' ? null : s.color }"></span>
              {{ s.label }} <b>{{ overview.flow[s.id] }}</b>
            </span>
          </div>
        </div>

        <div class="hero-side">
          <div class="kpi">
            <div class="kpi-top"><Icon name="board" :size="14" /> Cobertura do quadro</div>
            <div class="kpi-n">{{ overview.coveragePct }}%</div>
            <div class="meter"><i :style="{ width: overview.coveragePct + '%', background: 'var(--accent)' }"></i></div>
            <div class="kpi-s">{{ overview.onBoard }} de {{ overview.total }} tarefas no Kanban</div>
          </div>
          <div class="kpi">
            <div class="kpi-top"><Icon name="checkSquare" :size="14" /> Critérios de aceitação</div>
            <div class="kpi-n">{{ overview.critPct }}%</div>
            <div class="meter"><i :style="{ width: overview.critPct + '%', background: 'var(--green)' }"></i></div>
            <div class="kpi-s">{{ overview.critD }} de {{ overview.critT }} critérios marcados</div>
          </div>
        </div>
      </section>

      <!-- ===== Indicadores do cofre ===== -->
      <section class="ins-tiles">
        <div class="tile">
          <div class="tile-k"><span class="sev-dot" :style="{ background: SEV.red.color }"></span>Conflitos críticos</div>
          <div class="tile-n">{{ stats.totals.CONF || 0 }}</div>
          <div class="tile-s">IDs CONF · {{ stats.totals.red || 0 }} marcação(ões) 🔴</div>
        </div>
        <div class="tile">
          <div class="tile-k"><span class="sev-dot" :style="{ background: SEV.yellow.color }"></span>Riscos</div>
          <div class="tile-n">{{ stats.totals.RISK || 0 }}</div>
          <div class="tile-s">IDs RISK · {{ stats.totals.yellow || 0 }} marcação(ões) 🟡</div>
        </div>
        <div class="tile">
          <div class="tile-k"><span class="sev-dot" :style="{ background: SEV.green.color }"></span>Melhorias</div>
          <div class="tile-n">{{ stats.totals.MEL || 0 }}</div>
          <div class="tile-s">IDs MEL · {{ stats.totals.green || 0 }} marcação(ões) 🟢</div>
        </div>
        <div class="tile">
          <div class="tile-k"><Icon name="layers" :size="13" /> Itens técnicos</div>
          <div class="tile-n split">
            <span title="FRONT">{{ stats.totals.FRONT || 0 }}<small>front</small></span>
            <span title="BACK">{{ stats.totals.BACK || 0 }}<small>back</small></span>
            <span title="INT">{{ stats.totals.INT || 0 }}<small>int</small></span>
          </div>
          <div class="tile-s">IDs únicos citados na documentação</div>
        </div>
      </section>

      <!-- ===== Burndown da sprint ===== -->
      <section v-if="burn" class="panel ins-panel" style="margin-bottom:14px">
        <header class="ph">
          <div>
            <h3>Burndown · {{ burn.s.name }}</h3>
            <div class="ph-s">
              {{ formatDue(burn.s.start) }} – {{ formatDue(burn.s.end) }} ·
              {{ burn.done }} de {{ burn.tasks.length }} tarefas concluídas ·
              {{ burn.remaining }} {{ burn.unit }} restantes<template v-if="burn.s.state === 'active'"> · {{ burn.daysLeft }} dia(s) restantes</template>
            </div>
          </div>
          <select v-if="projectSprints.length > 1" v-model="burnSprintId" class="tab-select">
            <option value="">{{ projectSprints[0].name }}{{ projectSprints[0].state === 'active' ? ' (ativa)' : '' }}</option>
            <option v-for="sp in projectSprints.slice(1)" :key="sp.id" :value="sp.id">{{ sp.name }}</option>
          </select>
        </header>
        <div v-if="!burn.tasks.length" class="muted" style="padding:10px 0">Nenhuma tarefa nesta sprint ainda.</div>
        <template v-else>
          <div class="legend" style="margin:0 0 6px">
            <span class="lg-item"><span class="sw" style="background:var(--accent)"></span>Restante</span>
            <span class="lg-item"><span class="sw" style="background:var(--text-3)"></span>Ideal</span>
          </div>
          <svg class="burn" :viewBox="`0 0 ${BW} ${BH}`" role="img"
            :aria-label="`Burndown: ${burn.remaining} de ${burn.total} ${burn.unit} restantes`"
            @mousemove="onBurnMove" @mouseleave="onBurnLeave">
            <g class="grid">
              <line v-for="t in burnTicks" :key="t" :x1="PAD.l" :x2="BW - PAD.r" :y1="by(t)" :y2="by(t)" />
            </g>
            <text v-for="t in burnTicks" :key="'t' + t" class="ax" :x="PAD.l - 8" :y="by(t) + 4" text-anchor="end">{{ t }}</text>
            <text v-for="l in burnLabels" :key="'d' + l.i" class="ax" :x="bx(l.i)" :y="BH - 6" text-anchor="middle">{{ l.label }}</text>
            <path :d="burnPath('ideal')" class="ideal" />
            <path :d="burnPath('actual')" class="actual" />
            <template v-if="burnHover >= 0">
              <line class="cross" :x1="bx(burnHover)" :x2="bx(burnHover)" :y1="PAD.t" :y2="BH - PAD.b" />
              <circle v-if="burn.points[burnHover].actual != null" class="dot-a" :cx="bx(burnHover)" :cy="by(burn.points[burnHover].actual)" r="4.5" />
            </template>
          </svg>
        </template>
      </section>

      <FlowReports :cards="cards" :sprints="flowSprints" style="margin-bottom:14px" @open="(path, pid) => emit('open', path, pid)" />

      <!-- ===== Comparativo (só com mais de um projeto) ===== -->
      <section v-if="multi" class="panel ins-panel" style="margin-bottom:14px">
        <header class="ph">
          <div>
            <h3>Por projeto</h3>
            <div class="ph-s">Andamento, cobertura e apontamentos · clique para analisar só um projeto</div>
          </div>
        </header>
        <div class="pj-head"><span>Projeto</span><span>Andamento</span><span>Concluído</span><span>No quadro</span><span>Apontamentos</span></div>
        <button v-for="p in byProject" :key="p.id" class="pj" @click="focusProject(p.id)">
          <span class="pj-name">
            <span class="sq" :style="{ background: colorFor(p.name) }">{{ initials(p.name)[0] }}</span>
            <span class="nm">{{ p.name }}</span>
            <span class="muted cnt">{{ p.total }}</span>
          </span>
          <span class="stack" @mousemove="showTip($event, p.name, flowLines(p.flow, p.total))" @mouseleave="hideTip">
            <template v-for="s in FLOW" :key="s.id">
              <i v-if="p.flow[s.id]" :class="{ off: s.id === 'off' }" :style="{ flexGrow: p.flow[s.id], background: s.id === 'off' ? null : s.color }"></i>
            </template>
          </span>
          <span class="pj-n">{{ p.donePct }}%</span>
          <span class="pj-n">{{ p.coveragePct }}%</span>
          <span class="pj-sev">
            <span class="sv" :class="{ z: !p.red }" :style="{ color: p.red ? SEV.red.color : null }"><span class="sev-dot" :style="{ background: SEV.red.color }"></span>{{ p.red }}</span>
            <span class="sv" :class="{ z: !p.yellow }" :style="{ color: p.yellow ? SEV.yellow.color : null }"><span class="sev-dot" :style="{ background: SEV.yellow.color }"></span>{{ p.yellow }}</span>
          </span>
        </button>
      </section>

      <div class="ins-grid">
        <!-- ===== Funcionalidades ===== -->
        <section class="panel ins-panel span-main">
          <header class="ph">
            <div>
              <h3>Funcionalidades</h3>
              <div class="ph-s">Andamento e apontamentos por pasta · clique para ver as tarefas</div>
            </div>
            <div class="seg" role="tablist" aria-label="Ordenar funcionalidades">
              <button v-for="(l, k) in { risk: 'Risco', progress: 'Menor progresso', name: 'Nome' }" :key="k"
                :class="{ on: featureSort === k }" @click="featureSort = k">{{ l }}</button>
            </div>
          </header>

          <div class="ft-head">
            <span>Funcionalidade</span><span>Andamento</span><span>Apontamentos</span>
          </div>
          <div v-for="f in features" :key="f.key" class="ft" :class="{ open: openFeature === f.key }">
            <div class="ft-row" role="button" tabindex="0" :aria-expanded="openFeature === f.key"
              @click="openFeature = openFeature === f.key ? '' : f.key"
              @keydown.enter="openFeature = openFeature === f.key ? '' : f.key">
              <div class="ft-name">
                <Icon name="chevronRight" :size="12" class="ft-chev" />
                <Icon name="hash" :size="13" :style="{ color: colorFor(f.name) }" />
                <span class="nm">{{ prettyFolder(f.name) }}</span>
                <span v-if="multi" class="proj-tag" :title="f.pname">
                  <span class="dot" :style="{ background: colorFor(f.pname) }"></span>{{ f.pname }}
                </span>
                <span class="muted cnt">{{ f.tasks.length }}</span>
              </div>
              <div class="ft-prog" @mousemove="showTip($event, prettyFolder(f.name), flowLines(f.flow, f.tasks.length))" @mouseleave="hideTip">
                <div class="stack">
                  <template v-for="s in FLOW" :key="s.id">
                    <i v-if="f.flow[s.id]" :class="{ off: s.id === 'off' }" :style="{ flexGrow: f.flow[s.id], background: s.id === 'off' ? null : s.color }"></i>
                  </template>
                </div>
                <span class="pv">{{ f.donePct }}%</span>
              </div>
              <div class="ft-sev" @mousemove="showTip($event, 'Apontamentos', [
                  { color: SEV.red.color, label: 'Críticos', value: f.red },
                  { color: SEV.yellow.color, label: 'Riscos', value: f.yellow },
                  { color: SEV.green.color, label: 'Melhorias', value: f.green }])" @mouseleave="hideTip">
                <div v-if="f.red + f.yellow + f.green" class="stack thin" :style="{ width: ((f.red + f.yellow + f.green) / maxFindings) * 100 + '%' }">
                  <i v-if="f.red" :style="{ flexGrow: f.red, background: SEV.red.color }"></i>
                  <i v-if="f.yellow" :style="{ flexGrow: f.yellow, background: SEV.yellow.color }"></i>
                  <i v-if="f.green" :style="{ flexGrow: f.green, background: SEV.green.color }"></i>
                </div>
                <span v-else class="muted">—</span>
                <span v-if="f.red" class="sv" :style="{ color: SEV.red.color }">{{ f.red }}</span>
                <span v-if="f.yellow" class="sv" :style="{ color: SEV.yellow.color }">{{ f.yellow }}</span>
              </div>
            </div>

            <div class="ft-body">
              <div class="ft-inner">
                <div v-for="t in f.tasks" :key="t.path" class="ft-task" @click="emit('open', t.path, t.pid)">
                  <span class="pill" :class="{ off: !t.status }">
                    <span class="sw" :class="{ off: !t.status }" :style="{ background: t.status ? COLUMN_COLOR[t.status] : null }"></span>
                    {{ t.status ? COLUMN_LABEL[t.status] : 'Fora do quadro' }}
                  </span>
                  <span class="tt">{{ t.title }}</span>
                  <span v-if="t.kind" class="muted kd">{{ t.kind }}</span>
                  <span class="tr">
                    <span v-if="t.red" class="sv" :style="{ color: SEV.red.color }"><Icon name="alert" :size="11" /> {{ t.red }}</span>
                    <span v-if="t.yellow" class="sv" :style="{ color: SEV.yellow.color }"><Icon name="alert" :size="11" /> {{ t.yellow }}</span>
                    <span v-if="t.checkTotal" class="muted"><Icon name="checkSquare" :size="11" /> {{ t.checkDone }}/{{ t.checkTotal }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="span-side">
          <!-- ===== Pontos de atenção ===== -->
          <section class="panel ins-panel">
            <header class="ph">
              <div>
                <h3>Pontos de atenção</h3>
                <div class="ph-s">O que merece ação agora</div>
              </div>
              <span v-if="attention.length" class="badge">{{ attention.length }}</span>
            </header>
            <div v-if="!attention.length" class="all-good">
              <Icon name="check" :size="16" /> Nada pendente. Nenhum conflito crítico solto e nenhuma entrega com critérios abertos.
            </div>
            <button v-for="a in attentionShown" :key="a.c.pid + a.c.path" class="att" @click="emit('open', a.c.path, a.c.pid)">
              <span class="att-bar" :style="{ background: SEV[a.sev].color }"></span>
              <span class="att-body">
                <span class="att-t">{{ a.c.title }}</span>
                <span class="att-s">
                  <Icon name="alert" :size="11" :style="{ color: SEV[a.sev].color }" /> {{ a.why }} ·
                  {{ multi ? `${a.c.pname} / ` : '' }}{{ prettyFolder(a.c.feature) }}
                </span>
              </span>
              <Icon name="chevronRight" :size="14" class="muted" />
            </button>
            <button v-if="attention.length > 5" class="more" @click="showAllAttention = !showAllAttention">
              {{ showAllAttention ? 'Mostrar menos' : `Ver todos (${attention.length})` }}
            </button>
          </section>

          <!-- ===== Camadas ===== -->
          <section class="panel ins-panel">
            <header class="ph"><div><h3>Por camada</h3><div class="ph-s">Tarefas e concluídas</div></div></header>
            <div v-for="l in layers" :key="l.key" class="ly"
              @mousemove="showTip($event, l.label, [
                { label: 'Tarefas', value: l.n }, { label: 'Concluídas', value: `${l.done} · ${l.donePct}%` },
                { color: SEV.red.color, label: 'Críticos', value: l.red }, { color: SEV.yellow.color, label: 'Riscos', value: l.yellow }])"
              @mouseleave="hideTip">
              <div class="ly-top">
                <span class="layer" :class="l.key">{{ l.label }}</span>
                <span class="muted">{{ l.done }}/{{ l.n }} · {{ l.donePct }}%</span>
              </div>
              <div class="ly-track" :style="{ width: Math.max(l.w, 2) + '%' }">
                <i :style="{ width: l.donePct + '%' }"></i>
              </div>
            </div>
          </section>

          <!-- ===== Inventário ===== -->
          <section v-if="inventory.total" class="panel ins-panel">
            <header class="ph">
              <div><h3>Inventário</h3><div class="ph-s">{{ inventory.done }} de {{ inventory.total }} funcionalidades concluídas</div></div>
              <span class="badge ok">{{ inventory.pct }}%</span>
            </header>
            <div v-for="g in inventory.groups" :key="g.pid" class="inv-group">
              <div v-if="multi" class="inv-title">
                <span class="dot" :style="{ background: colorFor(g.pname) }"></span>{{ g.pname }}
                <span class="muted">{{ g.rows.filter((r) => r.done).length }}/{{ g.rows.length }}</span>
              </div>
              <div class="inv">
                <span v-for="r in g.rows" :key="r.num" class="inv-cell" :class="{ done: r.done }"
                  :style="{ '--c': r.done ? 'var(--green)' : (r.severity ? SEV[r.severity].color : 'var(--line)') }"
                  @mousemove="showTip($event, `${r.num}. ${r.nome}`, [{ label: 'Status', value: r.done ? 'Concluída' : 'Pendente' }, ...(r.severity ? [{ color: SEV[r.severity].color, label: 'Severidade', value: SEV[r.severity].label }] : [])])"
                  @mouseleave="hideTip">{{ r.num }}</span>
              </div>
            </div>
          </section>
        </div>

        <!-- ===== Documentos ===== -->
        <section class="panel ins-panel span-full">
          <header class="ph">
            <div>
              <h3>Documentos com apontamentos</h3>
              <div class="ph-s">{{ docs.length }} documento(s) · ordenados por severidade</div>
            </div>
            <div class="ph-tools">
              <div class="seg">
                <button v-for="(l, k) in { all: 'Todos', red: 'Críticos', yellow: 'Riscos', green: 'Melhorias' }" :key="k"
                  :class="{ on: docFilter.sev === k }" @click="docFilter.sev = k">
                  <span v-if="k !== 'all'" class="sev-dot" :style="{ background: SEV[k].color }"></span>{{ l }}
                </button>
              </div>
              <div class="mini-search"><Icon name="search" :size="13" /><input v-model="docFilter.q" placeholder="Filtrar documentos" /></div>
              <button class="btn" title="Exportar a lista filtrada" @click="exportDocs"><Icon name="download" :size="13" /> CSV</button>
            </div>
          </header>

          <div v-if="!docs.length" class="muted" style="padding:14px 2px">Nenhum documento com esse filtro.</div>
          <button v-for="f in docs.slice(0, docLimit)" :key="f.pid + f.path" class="doc" @click="emit('open', f.path, f.pid)">
            <span class="doc-ic"><Icon name="file" :size="14" /></span>
            <span class="doc-nm">
              <span class="t">{{ docName(f.path) }}</span>
              <span class="muted d">
                <template v-if="multi"><span class="dot" :style="{ background: colorFor(f.pname) }"></span>{{ f.pname }} · </template>{{ docDir(f.path) }}
              </span>
            </span>
            <span class="doc-bar"
              @mousemove="showTip($event, docName(f.path), [
                { color: SEV.red.color, label: 'Críticos', value: f.red },
                { color: SEV.yellow.color, label: 'Riscos', value: f.yellow },
                { color: SEV.green.color, label: 'Melhorias', value: f.green }])"
              @mouseleave="hideTip">
              <span class="stack thin" :style="{ width: ((f.red + f.yellow + f.green) / maxDoc) * 100 + '%' }">
                <i v-if="f.red" :style="{ flexGrow: f.red, background: SEV.red.color }"></i>
                <i v-if="f.yellow" :style="{ flexGrow: f.yellow, background: SEV.yellow.color }"></i>
                <i v-if="f.green" :style="{ flexGrow: f.green, background: SEV.green.color }"></i>
              </span>
            </span>
            <span class="doc-n">
              <span :class="{ z: !f.red }">{{ f.red }}</span>
              <span :class="{ z: !f.yellow }">{{ f.yellow }}</span>
              <span :class="{ z: !f.green }">{{ f.green }}</span>
            </span>
          </button>
          <button v-if="docs.length > docLimit" class="more" @click="docLimit += 12">
            Mostrar mais ({{ docs.length - docLimit }} restantes)
          </button>
        </section>
      </div>
    </template>

    <!-- tooltip compartilhado -->
    <div v-if="tip.show" class="ins-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div class="tt-t">{{ tip.title }}</div>
      <div v-for="(l, i) in tip.lines" :key="i" class="tt-l">
        <span v-if="l.color || l.off" class="sw" :class="{ off: l.off }" :style="{ background: l.off ? null : l.color }"></span>
        <span v-if="l.label" class="tt-k">{{ l.label }}</span>
        <b>{{ l.value }}</b>
      </div>
    </div>
  </div>
</template>
