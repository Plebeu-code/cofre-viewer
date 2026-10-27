<script setup>
import { ref, computed } from 'vue'
import { COLUMNS, LAYERS, SEV, prettyFolder } from '../constants.js'

const props = defineProps({ cards: { type: Array, required: true } })
const emit = defineEmits(['open', 'move'])

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
  <table class="table">
    <thead>
      <tr>
        <th style="cursor:pointer" @click="sortBy('title')">Tarefa{{ arrow('title') }}</th>
        <th style="cursor:pointer" @click="sortBy('feature')">Funcionalidade{{ arrow('feature') }}</th>
        <th style="cursor:pointer" @click="sortBy('layer')">Camada{{ arrow('layer') }}</th>
        <th style="cursor:pointer" @click="sortBy('severity')">Apontamentos{{ arrow('severity') }}</th>
        <th>Critérios</th>
        <th style="cursor:pointer; width:160px" @click="sortBy('status')">Status{{ arrow('status') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="c in rows" :key="c.path" class="row" @click="emit('open', c.path)">
        <td><div class="t">{{ c.title }}</div><div class="muted" style="font-size:11.5px">{{ c.kind }}</div></td>
        <td>{{ prettyFolder(c.feature) }}</td>
        <td><span class="layer" :class="c.layer">{{ LAYERS[c.layer] }}</span></td>
        <td>
          <span v-if="c.red" class="status-pill" style="margin-right:10px"><span class="sev-dot" :style="{ background: SEV.red.color }"></span>{{ c.red }}</span>
          <span v-if="c.yellow" class="status-pill" style="margin-right:10px"><span class="sev-dot" :style="{ background: SEV.yellow.color }"></span>{{ c.yellow }}</span>
          <span v-if="c.green" class="status-pill"><span class="sev-dot" :style="{ background: SEV.green.color }"></span>{{ c.green }}</span>
          <span v-if="!c.red && !c.yellow && !c.green" class="muted">—</span>
        </td>
        <td>{{ c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : '—' }}</td>
        <td @click.stop>
          <select :value="c.status" style="padding:5px 8px" @change="emit('move', c.path, $event.target.value)">
            <option v-for="col in COLUMNS" :key="col.id" :value="col.id">{{ col.label }}</option>
          </select>
        </td>
      </tr>
    </tbody>
  </table>
</template>
