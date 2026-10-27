<script setup>
import { ref } from 'vue'
import Icon from './Icon.vue'
import { LAYERS, barColor, prettyFolder } from '../constants.js'

defineProps({ columns: { type: Array, required: true } })
const emit = defineEmits(['open', 'move', 'add'])

const dragPath = ref('')
const overCol = ref('')

function onDragStart(e, card) {
  dragPath.value = card.path
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', card.path)
}
function onDragEnd() { dragPath.value = ''; overCol.value = '' }
function onDrop(colId) {
  const path = dragPath.value
  overCol.value = ''
  dragPath.value = ''
  if (path) emit('move', path, colId)
}
</script>

<template>
  <div class="board">
    <section
      v-for="col in columns"
      :key="col.id"
      class="column"
      :class="{ over: overCol === col.id }"
      @dragover.prevent="overCol = col.id"
      @dragleave.self="overCol = ''"
      @drop.prevent="onDrop(col.id)"
    >
      <div class="column-head">
        <span class="dot" :style="{ background: col.color }"></span>
        {{ col.label }}
        <span class="n">{{ col.cards.length }}</span>
      </div>

      <div class="column-cards">
        <article
          v-for="card in col.cards"
          :key="card.path"
          class="card"
          :class="{ dragging: dragPath === card.path }"
          draggable="true"
          @dragstart="onDragStart($event, card)"
          @dragend="onDragEnd"
          @click="emit('open', card.path)"
        >
          <div class="bar" :style="{ background: barColor(card) }"></div>
          <div class="feature">{{ prettyFolder(card.feature) }}</div>
          <div class="ttl">{{ card.title }}</div>
          <div v-if="card.excerpt" class="desc">{{ card.excerpt }}</div>
          <div class="meta">
            <span v-if="card.checkTotal" class="m" title="Critérios de aceitação">
              <Icon name="checkSquare" :size="12" /> {{ card.checkDone }}/{{ card.checkTotal }}
            </span>
            <span v-if="card.red" class="m" title="Conflitos críticos" style="color: var(--red)">
              <Icon name="alert" :size="12" /> {{ card.red }}
            </span>
            <span v-if="card.yellow" class="m" title="Riscos" style="color: var(--yellow)">
              <Icon name="alert" :size="12" /> {{ card.yellow }}
            </span>
            <span class="right">
              <span class="layer" :class="card.layer">{{ LAYERS[card.layer] }}</span>
            </span>
          </div>
        </article>
      </div>

      <div class="column-foot">
        <button class="add-task" @click="emit('add', col.id)"><Icon name="plus" :size="14" /> Adicionar tarefa</button>
      </div>
    </section>
  </div>
</template>
