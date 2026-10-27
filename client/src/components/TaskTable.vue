<script setup>
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import { COLUMNS, LAYERS, SEV, PRIORITIES, PRIORITY_ORDER, prettyFolder, dueState, formatDue, colorFor, initials } from '../constants.js'

const props = defineProps({
  cards: { type: Array, required: true },
  assignees: { type: Array, default: () => [] },
  sprints: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'move', 'bulk'])

// ---------- selecao e edicao em massa ----------
const selected = ref(new Set())
const visiblePaths = computed(() => props.cards.map((c) => c.path))
// descarta da selecao o que saiu da lista (filtro/remocao)
const selection = computed(() => visiblePaths.value.filter((p) => selected.value.has(p)))
const allChecked = computed(() => selection.value.length > 0 && selection.value.length === visiblePaths.value.length)
function toggle(path) {
  const s = new Set(selected.value)
  s.has(path) ? s.delete(path) : s.add(path)
  selected.value = s
}
function toggleAll() { selected.value = allChecked.value ? new Set() : new Set(visiblePaths.value) }
function clearSel() { selected.value = new Set() }
defineExpose({ clearSel, selection })

const bulkLabel = ref('')
function bulk(patch) {
  if (!selection.value.length) return
  emit('bulk', selection.value, patch)
}
function bulkSelect(e, field) {
  const v = e.target.value
  e.target.value = '__'
  if (v === '__') return
  bulk({ [field]: v === '__none' ? null : v })
}
function bulkAddLabel() {
  const v = bulkLabel.value.trim()
  bulkLabel.value = ''
  if (v) bulk({ addLabel: v })
}

const sortKey = ref('feature')
const sortDir = ref(1)
const ORDER = Object.fromEntries(COLUMNS.map((c, i) => [c.id, i]))
const SEV_ORDER = { red: 0, yellow: 1, green: 2 }

const rows = computed(() => {
  const k = sortKey.value
  return [...props.cards].sort((a, b) => {
    let va, vb
    if (k === 'status') { va = ORDER[a.status]; vb = ORDER[b.status] }
    else if (k === 'severity') { va = SEV_ORDER[a.severity] ?? 9; vb = SEV_ORDER[b.severity] ?? 9 }
    else if (k === 'priority') { va = PRIORITY_ORDER[a.priority] ?? 9; vb = PRIORITY_ORDER[b.priority] ?? 9 }
    else if (k === 'due') { va = a.due || '9999'; vb = b.due || '9999' }
    else if (k === 'key') { va = Number(a.key?.split('-').pop()) || 0; vb = Number(b.key?.split('-').pop()) || 0 }
    else { va = (a[k] || '').toString().toLowerCase(); vb = (b[k] || '').toString().toLowerCase() }
    return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir.value
  })
})

function sortBy(k) {
  if (sortKey.value === k) sortDir.value *= -1
  else { sortKey.value = k; sortDir.value = 1 }
}
const arrow = (k) => (sortKey.value === k ? (sortDir.value === 1 ? ' ↑' : ' ↓') : '')
</script>

<template>
  <!-- barra de edicao em massa -->
  <Transition name="bulk">
    <div v-if="selection.length" class="bulk-bar" role="toolbar" aria-label="Edição em massa">
      <b>{{ selection.length }} selecionada(s)</b>
      <select value="__" title="Mover" @change="bulkSelect($event, 'status')">
        <option value="__" disabled>Status…</option>
        <option v-for="col in COLUMNS" :key="col.id" :value="col.id">{{ col.label }}</option>
        <option value="__none">Remover do quadro</option>
      </select>
      <select value="__" @change="bulkSelect($event, 'priority')">
        <option value="__" disabled>Prioridade…</option>
        <option v-for="(p, id) in PRIORITIES" :key="id" :value="id">{{ p.label }}</option>
        <option value="__none">Sem prioridade</option>
      </select>
      <select value="__" @change="bulkSelect($event, 'assignee')">
        <option value="__" disabled>Responsável…</option>
        <option v-for="a in assignees" :key="a" :value="a">{{ a }}</option>
        <option value="__none">Sem responsável</option>
      </select>
      <select v-if="sprints.length" value="__" @change="bulkSelect($event, 'sprint')">
        <option value="__" disabled>Sprint…</option>
        <option v-for="s in sprints.filter((s) => s.state !== 'closed')" :key="s.id" :value="s.id">{{ s.name }}</option>
        <option value="__none">Sem sprint</option>
      </select>
      <input type="date" title="Prazo" @change="bulk({ due: $event.target.value || null }); $event.target.value = ''" />
      <input v-model="bulkLabel" class="bulk-label" placeholder="+ etiqueta" @keydown.enter="bulkAddLabel" />
      <button class="icon-btn" style="margin-left:auto" title="Limpar seleção (Esc)" @click="clearSel"><Icon name="x" :size="15" /></button>
    </div>
  </Transition>

  <table class="table">
    <thead>
      <tr>
        <th class="chk"><input type="checkbox" :checked="allChecked" :indeterminate="selection.length > 0 && !allChecked"
          title="Selecionar todas" aria-label="Selecionar todas" @change="toggleAll" /></th>
        <th style="cursor:pointer; width:80px" @click="sortBy('key')">Chave{{ arrow('key') }}</th>
        <th style="cursor:pointer" @click="sortBy('title')">Tarefa{{ arrow('title') }}</th>
        <th style="cursor:pointer" @click="sortBy('feature')">Funcionalidade{{ arrow('feature') }}</th>
        <th style="cursor:pointer" @click="sortBy('priority')">Prioridade{{ arrow('priority') }}</th>
        <th style="cursor:pointer" @click="sortBy('assignee')">Responsável{{ arrow('assignee') }}</th>
        <th style="cursor:pointer" @click="sortBy('due')">Prazo{{ arrow('due') }}</th>
        <th style="cursor:pointer" @click="sortBy('layer')">Camada{{ arrow('layer') }}</th>
        <th style="cursor:pointer" @click="sortBy('severity')">Apontamentos{{ arrow('severity') }}</th>
        <th>Critérios</th>
        <th style="cursor:pointer; width:160px" @click="sortBy('status')">Status{{ arrow('status') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="c in rows" :key="c.path" class="row" :class="{ sel: selected.has(c.path) }" @click="emit('open', c.path)">
        <td class="chk" @click.stop><input type="checkbox" :checked="selected.has(c.path)" :aria-label="`Selecionar ${c.key}`" @change="toggle(c.path)" /></td>
        <td><span class="key">{{ c.key }}</span></td>
        <td><div class="t">{{ c.title }}</div><div class="muted" style="font-size:11.5px">{{ c.kind }}</div></td>
        <td>{{ prettyFolder(c.feature) }}</td>
        <td>
          <span v-if="c.priority" class="status-pill"><Icon :name="PRIORITIES[c.priority].icon" :size="13" :style="{ color: PRIORITIES[c.priority].color }" />{{ PRIORITIES[c.priority].label }}</span>
          <span v-else class="muted">—</span>
        </td>
        <td>
          <span v-if="c.assignee" class="status-pill"><span class="avatar xs" :style="{ background: colorFor(c.assignee) }">{{ initials(c.assignee) }}</span>{{ c.assignee }}</span>
          <span v-else class="muted">—</span>
        </td>
        <td>
          <span v-if="c.due" class="due" :class="dueState(c)"><Icon name="calendar" :size="11" /> {{ formatDue(c.due) }}</span>
          <span v-else class="muted">—</span>
        </td>
        <td><span class="layer" :class="c.layer">{{ LAYERS[c.layer] }}</span></td>
        <td>
          <span v-if="c.red" class="status-pill" style="margin-right:10px"><span class="sev-dot" :style="{ background: SEV.red.color }"></span>{{ c.red }}</span>
          <span v-if="c.yellow" class="status-pill" style="margin-right:10px"><span class="sev-dot" :style="{ background: SEV.yellow.color }"></span>{{ c.yellow }}</span>
          <span v-if="c.green" class="status-pill"><span class="sev-dot" :style="{ background: SEV.green.color }"></span>{{ c.green }}</span>
          <span v-if="!c.red && !c.yellow && !c.green" class="muted">—</span>
        </td>
        <td>{{ c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : '—' }}</td>
        <td @click.stop>
          <select :value="c.status || ''" style="padding:5px 8px" @change="emit('move', c.path, $event.target.value)">
            <option v-for="col in COLUMNS" :key="col.id" :value="col.id">{{ col.label }}</option>
            <option value="">Remover do quadro</option>
          </select>
        </td>
      </tr>
    </tbody>
  </table>
</template>
