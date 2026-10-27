<script setup>
// Card de tarefa do Kanban (usado no quadro simples e no quadro com raias).
import Icon from './Icon.vue'
import { LAYERS, PRIORITIES, barColor, prettyFolder, dueState, formatDue, colorFor, initials } from '../constants.js'

defineProps({ card: { type: Object, required: true } })
</script>

<template>
  <article class="card" :class="{ blocked: card.blocked }" draggable="true">
    <div class="card-top">
      <div class="bar" :style="{ background: barColor(card) }"></div>
      <span class="feature">{{ prettyFolder(card.feature) }}</span>
      <span v-if="card.blocked" class="blocked-tag" :title="`Bloqueada por ${card.blockedBy.length} tarefa(s) não concluída(s)`">
        <Icon name="alert" :size="11" /> Bloqueada
      </span>
    </div>
    <div class="ttl">{{ card.title }}</div>
    <div v-if="card.excerpt" class="desc">{{ card.excerpt }}</div>
    <div v-if="card.labels.length" class="card-labels">
      <span v-for="l in card.labels.slice(0, 3)" :key="l" class="label-chip">{{ l }}</span>
      <span v-if="card.labels.length > 3" class="label-chip more">+{{ card.labels.length - 3 }}</span>
    </div>
    <div class="meta">
      <span class="key">{{ card.key }}</span>
      <span v-if="card.priority" class="m prio" :title="`Prioridade: ${PRIORITIES[card.priority].label}`" :style="{ color: PRIORITIES[card.priority].color }">
        <Icon :name="PRIORITIES[card.priority].icon" :size="13" />
      </span>
      <span v-if="card.due" class="due" :class="dueState(card)" :title="`Prazo: ${formatDue(card.due)}`">
        <Icon name="calendar" :size="11" /> {{ formatDue(card.due) }}
      </span>
      <span v-if="card.checkTotal" class="m" title="Critérios de aceitação">
        <Icon name="checkSquare" :size="12" /> {{ card.checkDone }}/{{ card.checkTotal }}
      </span>
      <span v-if="card.red" class="m" title="Conflitos críticos" style="color: var(--red)">
        <Icon name="alert" :size="12" /> {{ card.red }}
      </span>
      <span v-if="card.blocks.length + card.blockedBy.length + card.related.length" class="m" title="Vínculos">
        <Icon name="link" :size="12" /> {{ card.blocks.length + card.blockedBy.length + card.related.length }}
      </span>
      <span v-if="card.commentCount" class="m" title="Comentários">
        <Icon name="message" :size="12" /> {{ card.commentCount }}
      </span>
      <span class="right">
        <span v-if="card.points != null" class="points" title="Estimativa (pontos)">{{ card.points }}</span>
        <span class="layer" :class="card.layer">{{ LAYERS[card.layer] }}</span>
        <span v-if="card.assignee" class="avatar" :title="`Responsável: ${card.assignee}`" :style="{ background: colorFor(card.assignee) }">{{ initials(card.assignee) }}</span>
      </span>
    </div>
  </article>
</template>
