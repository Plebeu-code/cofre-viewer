<script setup>
// Relatorios de fluxo a partir do historico de status: fluxo cumulativo,
// tempo de ciclo (Fazendo -> Feito) e velocidade por sprint.
import { ref, reactive, computed } from 'vue'
import { COLUMNS, formatDue } from '../constants.js'

const props = defineProps({
  cards: { type: Array, default: () => [] },
  sprints: { type: Array, default: () => [] }, // so quando ha um projeto
})
const emit = defineEmits(['open'])

const tab = ref('cfd')
const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hasHistory = computed(() => props.cards.some((c) => c.statusLog?.length))

// ---------- fluxo cumulativo ----------
const range = ref(30)
// status de uma tarefa no fim de um dia = ultima mudanca ate ali
function statusAt(c, endOfDay) {
  let s = null
  for (const h of c.statusLog || []) { if (h.at <= endOfDay) s = h.to; else break }
  return s
}
const cfd = computed(() => {
  const days = []
  const today = new Date(new Date().toDateString())
  for (let i = range.value - 1; i >= 0; i--) days.push(iso(new Date(+today - i * DAY)))
  const rows = days.map((day) => {
    const end = new Date(day + 'T23:59:59.999').toISOString() // fim do dia no fuso local
    const n = Object.fromEntries(COLUMNS.map((c) => [c.id, 0]))
    for (const c of props.cards) { const s = statusAt(c, end); if (s) n[s]++ }
    return { day, n }
  })
  const max = Math.max(1, ...rows.map((r) => COLUMNS.reduce((t, c) => t + r.n[c.id], 0)))
  return { rows, max }
})
const W = 640, H = 220, P = { l: 34, r: 12, t: 12, b: 26 }
const cx = (i) => P.l + (i / Math.max(1, cfd.value.rows.length - 1)) * (W - P.l - P.r)
const cy = (v) => P.t + (1 - v / cfd.value.max) * (H - P.t - P.b)
// camadas empilhadas: "feito" na base, "backlog" no topo
const STACK = [...COLUMNS].reverse()
const areas = computed(() => {
  const rows = cfd.value.rows
  return STACK.map((col, k) => {
    const below = (r) => STACK.slice(0, k).reduce((t, c) => t + r.n[c.id], 0)
    const top = rows.map((r, i) => `${cx(i).toFixed(1)},${cy(below(r) + r.n[col.id]).toFixed(1)}`)
    const bottom = rows.map((r, i) => `${cx(i).toFixed(1)},${cy(below(r)).toFixed(1)}`).reverse()
    return { ...col, d: `M${top.join(' L')} L${bottom.join(' L')} Z` }
  })
})
const xLabels = computed(() => {
  const rows = cfd.value.rows
  const step = Math.ceil(rows.length / 6)
  return rows.map((r, i) => ({ i, label: formatDue(r.day) })).filter((x) => x.i % step === 0 || x.i === rows.length - 1)
})
const hover = ref(-1)
const tip = reactive({ show: false, x: 0, y: 0, title: '', lines: [] })
function onMove(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const xv = ((e.clientX - r.left) / r.width) * W
  const n = cfd.value.rows.length
  hover.value = Math.min(n - 1, Math.max(0, Math.round(((xv - P.l) / (W - P.l - P.r)) * (n - 1))))
  const row = cfd.value.rows[hover.value]
  Object.assign(tip, {
    show: true, x: Math.min(e.clientX + 14, window.innerWidth - 230), y: e.clientY + 16, title: formatDue(row.day),
    lines: COLUMNS.map((c) => ({ color: c.color, label: c.label, value: row.n[c.id] })),
  })
}
function onLeave() { hover.value = -1; tip.show = false }

// ---------- tempo de ciclo ----------
const cycle = computed(() => {
  const items = []
  for (const c of props.cards) {
    if (!c.doneAt) continue
    const start = (c.statusLog || []).find((h) => h.to === 'fazendo' && h.at <= c.doneAt)
    if (!start) continue
    items.push({ c, days: Math.max(0, (new Date(c.doneAt) - new Date(start.at)) / DAY) })
  }
  items.sort((a, b) => b.days - a.days)
  const vals = items.map((x) => x.days).sort((a, b) => a - b)
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0)
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  return { items, n: vals.length, median: q(0.5), p85: q(0.85), avg, max: Math.max(1, ...vals) }
})
const fmtDays = (d) => (d < 1 ? `${Math.round(d * 24)} h` : `${(Math.round(d * 10) / 10).toString().replace('.', ',')} d`)

// ---------- velocidade ----------
const velocity = computed(() => {
  const closed = props.sprints.filter((s) => s.state === 'closed').sort((a, b) => a.start.localeCompare(b.start)).slice(-8)
  const rows = closed.map((s) => {
    const done = props.cards.filter((c) => c.sprint === s.id && c.status === 'feito')
    return { s, tasks: done.length, pts: done.reduce((n, c) => n + (c.points || 0), 0) }
  })
  const usePts = rows.some((r) => r.pts)
  const vals = rows.map((r) => (usePts ? r.pts : r.tasks))
  return { rows, usePts, max: Math.max(1, ...vals), avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 }
})
</script>

<template>
  <section class="panel ins-panel flow">
    <header class="ph">
      <div>
        <h3>Fluxo</h3>
        <div class="ph-s">Calculado a partir do histórico de status das tarefas</div>
      </div>
      <div class="seg">
        <button :class="{ on: tab === 'cfd' }" @click="tab = 'cfd'">Fluxo cumulativo</button>
        <button :class="{ on: tab === 'cycle' }" @click="tab = 'cycle'">Tempo de ciclo</button>
        <button v-if="sprints.length" :class="{ on: tab === 'vel' }" @click="tab = 'vel'">Velocidade</button>
      </div>
    </header>

    <div v-if="!hasHistory" class="muted" style="padding:10px 0">
      Ainda não há histórico de movimentação. Os relatórios aparecem conforme as tarefas forem movidas no quadro.
    </div>

    <!-- fluxo cumulativo -->
    <template v-else-if="tab === 'cfd'">
      <div class="flow-tools">
        <div class="legend" style="margin:0">
          <span v-for="c in COLUMNS" :key="c.id" class="lg-item"><span class="sw" :style="{ background: c.color }"></span>{{ c.label }}</span>
        </div>
        <div class="seg">
          <button v-for="d in [14, 30, 90]" :key="d" :class="{ on: range === d }" @click="range = d">{{ d }} dias</button>
        </div>
      </div>
      <svg class="burn" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Fluxo cumulativo de tarefas por coluna" @mousemove="onMove" @mouseleave="onLeave">
        <line v-for="f in [0, 0.5, 1]" :key="f" class="gridl" :x1="P.l" :x2="W - P.r" :y1="cy(cfd.max * f)" :y2="cy(cfd.max * f)" />
        <text v-for="f in [0, 0.5, 1]" :key="'t' + f" class="ax" :x="P.l - 8" :y="cy(cfd.max * f) + 4" text-anchor="end">{{ Math.round(cfd.max * f) }}</text>
        <path v-for="a in areas" :key="a.id" :d="a.d" :fill="a.color" class="area" />
        <text v-for="l in xLabels" :key="'d' + l.i" class="ax" :x="cx(l.i)" :y="H - 6" text-anchor="middle">{{ l.label }}</text>
        <line v-if="hover >= 0" class="cross" :x1="cx(hover)" :x2="cx(hover)" :y1="P.t" :y2="H - P.b" />
      </svg>
    </template>

    <!-- tempo de ciclo -->
    <template v-else-if="tab === 'cycle'">
      <div v-if="!cycle.n" class="muted" style="padding:10px 0">Nenhuma tarefa passou por "Fazendo" e chegou a "Feito" ainda.</div>
      <template v-else>
        <div class="cycle-kpis">
          <div><b>{{ fmtDays(cycle.median) }}</b><span>mediana</span></div>
          <div><b>{{ fmtDays(cycle.p85) }}</b><span>85% terminam em até</span></div>
          <div><b>{{ fmtDays(cycle.avg) }}</b><span>média</span></div>
          <div><b>{{ cycle.n }}</b><span>tarefas medidas</span></div>
        </div>
        <div class="ph-s" style="margin:14px 0 6px">Mais demoradas</div>
        <button v-for="x in cycle.items.slice(0, 6)" :key="x.c.pid + x.c.path" class="cyc" @click="emit('open', x.c.path, x.c.pid)">
          <span class="key">{{ x.c.key }}</span>
          <span class="t">{{ x.c.title }}</span>
          <span class="cyc-bar"><i :style="{ width: (x.days / cycle.max) * 100 + '%' }"></i></span>
          <span class="cyc-n">{{ fmtDays(x.days) }}</span>
        </button>
      </template>
    </template>

    <!-- velocidade -->
    <template v-else>
      <div v-if="!velocity.rows.length" class="muted" style="padding:10px 0">Encerre uma sprint para ver a velocidade.</div>
      <template v-else>
        <div class="ph-s" style="margin-bottom:8px">
          Média: <b>{{ Math.round(velocity.avg * 10) / 10 }}</b> {{ velocity.usePts ? 'pontos' : 'tarefas' }} concluídos por sprint
        </div>
        <div class="vel">
          <div v-for="r in velocity.rows" :key="r.s.id" class="vel-col" :title="`${r.s.name}: ${r.tasks} tarefa(s), ${r.pts} pts`">
            <span class="vel-n">{{ velocity.usePts ? r.pts : r.tasks }}</span>
            <span class="vel-bar" :style="{ height: ((velocity.usePts ? r.pts : r.tasks) / velocity.max) * 100 + '%' }"></span>
            <span class="vel-l">{{ r.s.name }}</span>
          </div>
        </div>
      </template>
    </template>

    <div v-if="tip.show" class="ins-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div class="tt-t">{{ tip.title }}</div>
      <div v-for="(l, i) in tip.lines" :key="i" class="tt-l"><span class="sw" :style="{ background: l.color }"></span><span class="tt-k">{{ l.label }}</span><b>{{ l.value }}</b></div>
    </div>
  </section>
</template>
