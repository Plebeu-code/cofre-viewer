<script setup>
import { reactive } from 'vue'
import Icon from './Icon.vue'
import { LAYERS, barColor, prettyFolder } from '../constants.js'

defineProps({ columns: { type: Array, required: true } })
const emit = defineEmits(['open'])
const closed = reactive({})
</script>

<template>
  <div>
    <div v-for="col in columns" :key="col.id" class="list-group">
      <div class="list-group-head" style="cursor:pointer; user-select:none" @click="closed[col.id] = !closed[col.id]">
        <Icon :name="closed[col.id] ? 'chevronRight' : 'chevronDown'" :size="14" />
        <span class="sev-dot" :style="{ background: col.color }"></span>
        {{ col.label }}
        <span class="muted" style="font-weight:500">{{ col.cards.length }}</span>
      </div>
      <template v-if="!closed[col.id]">
        <div v-for="c in col.cards" :key="c.path" class="list-item" @click="emit('open', c.path)">
          <span class="sev-dot" :style="{ background: barColor(c) }"></span>
          <span class="t">{{ c.title }}</span>
          <span class="muted" style="font-size:12px; white-space:nowrap">{{ prettyFolder(c.feature) }}</span>
          <span class="layer" :class="c.layer">{{ LAYERS[c.layer] }}</span>
        </div>
        <div v-if="!col.cards.length" class="muted" style="padding:6px 12px 4px">Nenhuma tarefa</div>
      </template>
    </div>
  </div>
</template>
