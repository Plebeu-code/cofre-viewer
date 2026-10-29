<script setup>
import { ref, reactive, computed, nextTick, watch } from 'vue'
import Icon from './Icon.vue'
import TaskCard from './TaskCard.vue'
import { PRIORITIES, prettyFolder, colorFor, initials, DND_TASK, DND_CARD } from '../constants.js'

const props = defineProps({
  columns: { type: Array, required: true },       // colunas ja filtradas
  counts: { type: Object, default: () => ({}) },  // total real por coluna (para o WIP)
  wip: { type: Object, default: () => ({}) },     // { coluna: limite }
  lanes: { type: String, default: 'none' },       // none | feature | priority | assignee
  assignees: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'move', 'add', 'set-wip'])

// ---------- raias ----------
const LANE_FIELD = { priority: 'priority', assignee: 'assignee' } // raias que, ao soltar, mudam o campo
const collapsed = reactive({})

const laneList = computed(() => {
  const all = props.columns.flatMap((c) => c.cards)
  let defs
  if (props.lanes === 'feature') {
    defs = [...new Set(all.map((c) => c.feature))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((f) => ({ key: f, label: prettyFolder(f), match: (c) => c.feature === f, color: colorFor(f), icon: 'hash' }))
  } else if (props.lanes === 'priority') {
    // todas as prioridades aparecem, mesmo vazias, para poder soltar nelas
    defs = [...Object.entries(PRIORITIES).map(([id, p]) => ({ key: id, value: id, label: p.label, match: (c) => c.priority === id, color: p.color, icon: p.icon })),
      { key: '-', value: null, label: 'Sem prioridade', match: (c) => !c.priority, icon: 'equal' }]
  } else if (props.lanes === 'assignee') {
    const names = [...new Set([...props.assignees, ...all.map((c) => c.assignee).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    defs = [...names.map((n) => ({ key: n, value: n, label: n, match: (c) => c.assignee === n, avatar: n })),
      { key: '-', value: '', label: 'Sem responsável', match: (c) => !c.assignee, icon: 'user' }]
  } else return []
  return defs.map((d) => {
    const cols = props.columns.map((col) => ({ ...col, cards: col.cards.filter(d.match) }))
    return { ...d, cols, total: cols.reduce((s, c) => s + c.cards.length, 0) }
  })
})

// ---------- drag and drop (com posicao) ----------
const dragPath = ref('')
const over = ref('')       // `${raia}|${coluna}` sob o cursor
const dropBefore = ref('') // card antes do qual o arrastado sera inserido ('' = fim)

function onDragStart(e, card) {
  dragPath.value = card.path
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', card.path)
  e.dataTransfer.setData(DND_TASK, card.path)
  e.dataTransfer.setData(DND_CARD, card.path) // permite soltar de volta na sidebar
}
function onDragEnd() { dragPath.value = ''; over.value = ''; dropBefore.value = '' }
function onDragOver(e, zone) {
  if (!e.dataTransfer.types.includes(DND_TASK)) return
  e.preventDefault()
  if (over.value !== zone) dropBefore.value = ''
  over.value = zone
}
// metade de cima do card = inserir antes dele; metade de baixo = antes do proximo
function onCardOver(e, cards, index) {
  if (!e.dataTransfer.types.includes(DND_TASK)) return
  const r = e.currentTarget.getBoundingClientRect()
  dropBefore.value = e.clientY > r.top + r.height / 2 ? cards[index + 1]?.path || '' : cards[index].path
}
// aceita cards do proprio quadro e arquivos arrastados da sidebar
function onDrop(e, colId, lane = null) {
  const path = dragPath.value || e.dataTransfer.getData(DND_TASK)
  const before = dropBefore.value
  onDragEnd()
  if (!path || path === before) return
  // soltar em outra raia de prioridade/responsavel muda esse campo
  let patch = null
  const field = LANE_FIELD[props.lanes]
  if (lane && field) {
    const card = props.columns.flatMap((c) => c.cards).find((c) => c.path === path)
    const cur = card ? card[field] || (field === 'assignee' ? '' : null) : undefined
    if (cur !== lane.value) patch = { [field]: lane.value }
  }
  emit('move', path, colId, before || null, patch)
}
const isOver = (zone) => over.value === zone
const dropEnd = (zone, cards) => isOver(zone) && !dropBefore.value && dragPath.value !== cards.at(-1)?.path

// ---------- teclado ----------
// setas: navegar entre cards; Shift+esquerda/direita: mudar de coluna;
// Shift+cima/baixo: reordenar; Enter/Espaco: abrir
const pendingFocus = ref('')
function focusCard(path) {
  const el = path && document.querySelector('.card[data-path="' + CSS.escape(path) + '"]')
  el?.focus()
  return Boolean(el)
}
watch(() => props.columns, async () => {
  if (!pendingFocus.value) return
  await nextTick()
  if (focusCard(pendingFocus.value)) pendingFocus.value = ''
}, { deep: true })

function onCardKey(e, cols, ci, i, lane = null) {
  const col = cols[ci]
  const card = col.cards[i]
  const k = e.key
  if (k === 'Enter' || k === ' ') { e.preventDefault(); emit('open', card.path); return }
  if (!k.startsWith('Arrow')) return
  e.preventDefault()
  if (e.shiftKey) {
    pendingFocus.value = card.path
    if (k === 'ArrowLeft' && ci > 0) emit('move', card.path, cols[ci - 1].id, null, null)
    else if (k === 'ArrowRight' && ci < cols.length - 1) emit('move', card.path, cols[ci + 1].id, null, null)
    else if (k === 'ArrowUp' && i > 0) emit('move', card.path, col.id, col.cards[i - 1].path, null)
    else if (k === 'ArrowDown' && i < col.cards.length - 1) emit('move', card.path, col.id, col.cards[i + 2]?.path || null, null)
    else pendingFocus.value = ''
    return
  }
  const target =
    k === 'ArrowUp' ? col.cards[i - 1]
    : k === 'ArrowDown' ? col.cards[i + 1]
    : k === 'ArrowLeft' ? (cols[ci - 1]?.cards[Math.min(i, cols[ci - 1].cards.length - 1)])
    : (cols[ci + 1]?.cards[Math.min(i, cols[ci + 1].cards.length - 1)])
  if (target) focusCard(target.path)
}

// ---------- limite de WIP ----------
const editingWip = ref('')
const wipInput = ref(null)
async function editWip(colId) {
  editingWip.value = colId
  await nextTick()
  wipInput.value?.[0]?.focus()
  wipInput.value?.[0]?.select()
}
function saveWip(colId, e) {
  if (editingWip.value !== colId) return
  editingWip.value = ''
  emit('set-wip', colId, e.target.value)
}
const overWip = (colId) => props.wip[colId] && (props.counts[colId] || 0) > props.wip[colId]
</script>

<template>
  <!-- ===== Quadro simples ===== -->
  <div v-if="lanes === 'none'" class="board">
    <section
      v-for="(col, ci) in columns"
      :key="col.id"
      class="column"
      :class="{ over: isOver('|' + col.id), 'wip-over': overWip(col.id) }"
      @dragover="onDragOver($event, '|' + col.id)"
      @dragleave.self="over = ''"
      @drop.prevent="onDrop($event, col.id)"
    >
      <div class="column-head">
        <span class="dot" :style="{ background: col.color }"></span>
        {{ col.label }}
        <input v-if="editingWip === col.id" ref="wipInput" class="wip-input" type="number" min="0" :value="wip[col.id] || ''"
          placeholder="—" title="Limite de WIP (vazio = sem limite)"
          @keydown.enter="$event.target.blur()" @keydown.esc="editingWip = ''" @blur="saveWip(col.id, $event)" />
        <button v-else class="n wip" :title="wip[col.id] ? `Limite de WIP: ${wip[col.id]} (clique para alterar)` : 'Definir limite de WIP'" @click="editWip(col.id)">
          {{ counts[col.id] ?? col.cards.length }}<template v-if="wip[col.id]"> / {{ wip[col.id] }}</template>
        </button>
      </div>
      <div v-if="overWip(col.id)" class="wip-warn"><Icon name="alert" :size="12" /> Acima do limite de {{ wip[col.id] }}</div>

      <div class="column-cards" :class="{ 'drop-end': dropEnd('|' + col.id, col.cards) }">
        <TaskCard
          v-for="(card, i) in col.cards" :key="card.path" :card="card"
          :class="{ dragging: dragPath === card.path, 'drop-before': isOver('|' + col.id) && dropBefore === card.path && dragPath !== card.path }"
          @dragstart="onDragStart($event, card)" @dragend="onDragEnd"
          @dragover="onCardOver($event, col.cards, i)" @click="emit('open', card.path)"
          @keydown="onCardKey($event, columns, ci, i)"
        />
        <div v-if="!col.cards.length" class="column-empty">
          <Icon name="plus" :size="14" /> Arraste tarefas da sidebar
        </div>
      </div>

      <div class="column-foot">
        <button class="add-task" @click="emit('add', col.id)"><Icon name="plus" :size="14" /> Adicionar tarefa</button>
      </div>
    </section>
  </div>

  <!-- ===== Quadro com raias ===== -->
  <div v-else class="laned">
    <div class="lane-cols">
      <div v-for="col in columns" :key="col.id" class="lane-col-head" :class="{ 'wip-over': overWip(col.id) }">
        <span class="dot" :style="{ background: col.color }"></span>{{ col.label }}
        <input v-if="editingWip === col.id" ref="wipInput" class="wip-input" type="number" min="0" :value="wip[col.id] || ''"
          placeholder="—" @keydown.enter="$event.target.blur()" @keydown.esc="editingWip = ''" @blur="saveWip(col.id, $event)" />
        <button v-else class="n wip" :title="wip[col.id] ? `Limite de WIP: ${wip[col.id]}` : 'Definir limite de WIP'" @click="editWip(col.id)">
          {{ counts[col.id] ?? 0 }}<template v-if="wip[col.id]"> / {{ wip[col.id] }}</template>
        </button>
      </div>
    </div>

    <section v-for="lane in laneList" :key="lane.key" class="lane" :class="{ closed: collapsed[lane.key] }">
      <button class="lane-head" :aria-expanded="!collapsed[lane.key]" @click="collapsed[lane.key] = !collapsed[lane.key]">
        <Icon name="chevronRight" :size="12" class="lane-chev" />
        <span v-if="lane.avatar" class="avatar xs" :style="{ background: colorFor(lane.avatar) }">{{ initials(lane.avatar) }}</span>
        <Icon v-else :name="lane.icon" :size="13" :style="{ color: lane.color || 'var(--text-3)' }" />
        {{ lane.label }} <span class="muted">{{ lane.total }}</span>
      </button>
      <div class="clp" :class="{ open: !collapsed[lane.key] }">
        <div class="clp-in">
          <div class="lane-row">
            <div v-for="(col, ci) in lane.cols" :key="col.id" class="lane-cell" :class="{ over: isOver(lane.key + '|' + col.id) }"
              @dragover="onDragOver($event, lane.key + '|' + col.id)" @dragleave.self="over = ''"
              @drop.prevent="onDrop($event, col.id, lane)">
              <div class="column-cards" :class="{ 'drop-end': dropEnd(lane.key + '|' + col.id, col.cards) }">
                <TaskCard
                  v-for="(card, i) in col.cards" :key="card.path" :card="card"
                  :class="{ dragging: dragPath === card.path, 'drop-before': isOver(lane.key + '|' + col.id) && dropBefore === card.path && dragPath !== card.path }"
                  @dragstart="onDragStart($event, card)" @dragend="onDragEnd"
                  @dragover="onCardOver($event, col.cards, i)" @click="emit('open', card.path)"
                  @keydown="onCardKey($event, lane.cols, ci, i, lane)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <div v-if="!laneList.length" class="empty">Nenhuma tarefa no quadro.</div>
  </div>
</template>
