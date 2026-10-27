<script setup>
// Linha do tempo: sprints no topo e, por funcionalidade, cada tarefa com a
// faixa da sua sprint e um marcador (losango) no prazo.
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import Icon from './Icon.vue'
import { COLUMN_LABEL, COLUMN_COLOR, PRIORITIES, prettyFolder, colorFor, dueState, formatDue } from '../constants.js'

const props = defineProps({
  cards: { type: Array, default: () => [] },
  sprints: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'sprints'])

const DAY = 86400000
const zoom = ref(Number(localStorage.getItem('cofre.roadmap.zoom')) || 18) // px por dia
const setZoom = (z) => { zoom.value = z; localStorage.setItem('cofre.roadmap.zoom', z) }

const toDate = (s) => new Date(s + 'T00:00')
const today = new Date(new Date().toDateString())
const sprintOf = computed(() => Object.fromEntries(props.sprints.map((s) => [s.id, s])))

// tarefas com alguma referencia de tempo (prazo ou sprint)
const timed = computed(() => props.cards.filter((c) => c.due || sprintOf.value[c.sprint]))
const untimed = computed(() => props.cards.length - timed.value.length)

const range = computed(() => {
  const pts = [today]
  for (const s of props.sprints) pts.push(toDate(s.start), toDate(s.end))
  for (const c of timed.value) if (c.due) pts.push(toDate(c.due))
  let min = new Date(Math.min(...pts) - 7 * DAY)
  let max = new Date(Math.max(...pts) + 14 * DAY)
  // comeca numa segunda-feira e cobre pelo menos 6 semanas
  min = new Date(min - ((min.getDay() + 6) % 7) * DAY)
  if (max - min < 42 * DAY) max = new Date(+min + 42 * DAY)
  return { min, days: Math.round((max - min) / DAY) + 1 }
})
const x = (d) => Math.round((toDate(d) - range.value.min) / DAY) * zoom.value
const todayX = computed(() => Math.round((today - range.value.min) / DAY) * zoom.value + zoom.value / 2)
const width = computed(() => range.value.days * zoom.value)

const weeks = computed(() => {
  const out = []
  for (let i = 0; i < range.value.days; i += 7) {
    const d = new Date(+range.value.min + i * DAY)
    out.push({ x: i * zoom.value, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, month: d.getDate() <= 7 ? d.toLocaleDateString('pt-BR', { month: 'short' }) : '' })
  }
  return out
})

const sprintBars = computed(() =>
  props.sprints.map((s) => ({ ...s, left: x(s.start), w: x(s.end) - x(s.start) + zoom.value }))
)

const closed = reactive({})
const groups = computed(() => {
  const map = new Map()
  for (const c of timed.value) {
    if (!map.has(c.feature)) map.set(c.feature, [])
    const s = sprintOf.value[c.sprint]
    map.get(c.feature).push({
      ...c,
      bar: s ? { left: x(s.start), w: x(s.end) - x(s.start) + zoom.value, name: s.name } : null,
      dueX: c.due ? x(c.due) + zoom.value / 2 : null,
    })
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([name, tasks]) => ({
    name, tasks: tasks.sort((a, b) => (a.due || '9').localeCompare(b.due || '9')),
  }))
})

const markerColor = (c) => (c.status === 'feito' ? 'var(--green)' : dueState(c) === 'overdue' ? 'var(--red)' : c.status ? COLUMN_COLOR[c.status] : 'var(--text-3)')

// tooltip
const tip = reactive({ show: false, x: 0, y: 0, c: null })
function showTip(e, c) { Object.assign(tip, { show: true, x: Math.min(e.clientX + 14, window.innerWidth - 250), y: e.clientY + 16, c }) }

// abre ja rolado ate "hoje"
const scroller = ref(null)
onMounted(async () => {
  await nextTick()
  if (scroller.value) scroller.value.scrollLeft = Math.max(0, todayX.value - 260)
})
</script>

<template>
  <div class="roadmap">
    <div class="rm-tools">
      <span class="muted">{{ timed.length }} tarefa(s) na linha do tempo<template v-if="untimed"> · {{ untimed }} sem prazo nem sprint</template></span>
      <div class="seg" style="margin-left:auto">
        <button v-for="(l, z) in { 10: 'Meses', 18: 'Semanas', 34: 'Dias' }" :key="z" :class="{ on: zoom === +z }" @click="setZoom(+z)">{{ l }}</button>
      </div>
      <button class="btn" @click="emit('sprints')"><Icon name="clock" :size="14" /> Sprints</button>
    </div>

    <div v-if="!timed.length && !sprints.length" class="empty">
      Defina <b>prazos</b> ou adicione tarefas a <b>sprints</b> para vê-las aqui.
    </div>

    <div v-else ref="scroller" class="rm-scroll">
      <div class="rm-grid" :style="{ width: 260 + width + 'px', '--wk': zoom * 7 + 'px' }">
        <!-- cabecalho: semanas -->
        <div class="rm-row rm-head">
          <div class="rm-label">Funcionalidade / tarefa</div>
          <div class="rm-track" :style="{ width: width + 'px' }">
            <div v-for="w in weeks" :key="w.x" class="rm-week" :style="{ left: w.x + 'px' }">
              <span v-if="w.month" class="rm-month">{{ w.month }}</span>{{ w.label }}
            </div>
          </div>
        </div>

        <!-- sprints -->
        <div class="rm-row rm-sprints">
          <div class="rm-label"><Icon name="clock" :size="13" /> Sprints</div>
          <div class="rm-track" :style="{ width: width + 'px' }">
            <div v-for="s in sprintBars" :key="s.id" class="rm-sprint" :class="s.state" :style="{ left: s.left + 'px', width: s.w + 'px' }"
              :title="`${s.name} · ${formatDue(s.start)} – ${formatDue(s.end)}`">{{ s.name }}</div>
          </div>
        </div>

        <template v-for="g in groups" :key="g.name">
          <button class="rm-row rm-group" @click="closed[g.name] = !closed[g.name]">
            <div class="rm-label">
              <Icon :name="closed[g.name] ? 'chevronRight' : 'chevronDown'" :size="12" />
              <Icon name="hash" :size="13" :style="{ color: colorFor(g.name) }" /> {{ prettyFolder(g.name) }}
              <span class="muted">{{ g.tasks.length }}</span>
            </div>
            <div class="rm-track" :style="{ width: width + 'px' }"></div>
          </button>
          <template v-if="!closed[g.name]">
            <div v-for="c in g.tasks" :key="c.path" class="rm-row rm-task" @click="emit('open', c.path)">
              <div class="rm-label">
                <span class="key">{{ c.key }}</span>
                <Icon v-if="c.priority" :name="PRIORITIES[c.priority].icon" :size="12" :style="{ color: PRIORITIES[c.priority].color }" />
                <span class="rm-title">{{ c.title }}</span>
              </div>
              <div class="rm-track" :style="{ width: width + 'px' }">
                <div v-if="c.bar" class="rm-bar" :style="{ left: c.bar.left + 'px', width: c.bar.w + 'px', '--c': markerColor(c) }"
                  @mousemove="showTip($event, c)" @mouseleave="tip.show = false"></div>
                <div v-if="c.dueX != null" class="rm-due" :style="{ left: c.dueX + 'px', background: markerColor(c) }"
                  @mousemove="showTip($event, c)" @mouseleave="tip.show = false"></div>
              </div>
            </div>
          </template>
        </template>

        <!-- linha de hoje -->
        <div class="rm-today" :style="{ left: 260 + todayX + 'px' }"><span>Hoje</span></div>
      </div>
    </div>

    <div v-if="tip.show && tip.c" class="ins-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div class="tt-t">{{ tip.c.key }} · {{ tip.c.title }}</div>
      <div class="tt-l"><span class="tt-k">Status</span><b>{{ tip.c.status ? COLUMN_LABEL[tip.c.status] : 'Fora do quadro' }}</b></div>
      <div v-if="tip.c.due" class="tt-l"><span class="tt-k">Prazo</span><b>{{ formatDue(tip.c.due) }}</b></div>
      <div v-if="tip.c.bar" class="tt-l"><span class="tt-k">Sprint</span><b>{{ tip.c.bar.name }}</b></div>
      <div v-if="tip.c.assignee" class="tt-l"><span class="tt-k">Responsável</span><b>{{ tip.c.assignee }}</b></div>
    </div>
  </div>
</template>
