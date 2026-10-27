<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'
import { formatDue } from '../constants.js'

const props = defineProps({
  projectId: { type: String, required: true },
  sprints: { type: Array, default: () => [] },
  cards: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'changed'])

const error = ref('')
const busy = ref(false)

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return iso(d) }

// nova sprint comeca no dia seguinte ao fim da ultima (ou hoje), com 2 semanas
function defaults() {
  const last = [...props.sprints].sort((a, b) => b.end.localeCompare(a.end))[0]
  const start = last ? addDays(last.end, 1) : iso(new Date())
  return { name: '', start, end: addDays(start, 13), goal: '' }
}
const form = reactive(defaults())
const showForm = ref(!props.sprints.length)

const STATE = { active: 'Ativa', planned: 'Planejada', closed: 'Encerrada' }
const ORDER = { active: 0, planned: 1, closed: 2 }
const list = computed(() =>
  [...props.sprints].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.start.localeCompare(b.start)).map((s) => {
    const cs = props.cards.filter((c) => c.sprint === s.id)
    const done = cs.filter((c) => c.status === 'feito').length
    return { ...s, total: cs.length, done, pts: cs.reduce((n, c) => n + (c.points || 0), 0) }
  })
)
const hasActive = computed(() => props.sprints.some((s) => s.state === 'active'))
const planned = computed(() => props.sprints.filter((s) => s.state === 'planned'))

async function run(fn) {
  busy.value = true
  error.value = ''
  try { await fn(); emit('changed') } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
const create = () => run(async () => {
  await api.createSprint(props.projectId, form)
  Object.assign(form, defaults())
  showForm.value = false
})
const start = (s) => run(() => api.startSprint(props.projectId, s.id))

// encerrar: escolher para onde vai o que nao foi concluido
const closing = ref(null)
const moveTo = ref('')
function askClose(s) { closing.value = s; moveTo.value = planned.value.find((p) => p.id !== s.id)?.id || '' }
const confirmClose = () => run(async () => {
  await api.closeSprint(props.projectId, closing.value.id, moveTo.value || null)
  closing.value = null
})
const remove = (s) => {
  if (!confirm(`Excluir "${s.name}"? As tarefas continuam no projeto, só saem da sprint.`)) return
  run(() => api.deleteSprint(props.projectId, s.id))
}

function onKey(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" style="width: 640px">
      <div class="modal-head">
        <Icon name="clock" :size="16" />
        <h3>Sprints</h3>
        <button class="btn-primary" style="margin-left:auto" @click="showForm = !showForm"><Icon name="plus" :size="14" /> Nova sprint</button>
        <button class="icon-btn" title="Fechar (Esc)" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>
      <div class="modal-body">
        <p v-if="error" class="err">{{ error }}</p>

        <div class="clp" :class="{ open: showForm }">
          <div class="clp-in">
            <div class="sprint-form">
              <div class="fld-row">
                <div class="fld"><span class="k">Nome</span><input v-model="form.name" :placeholder="`Sprint ${sprints.length + 1}`" /></div>
                <div class="fld"><span class="k">Início</span><input v-model="form.start" type="date" /></div>
                <div class="fld"><span class="k">Fim</span><input v-model="form.end" type="date" /></div>
              </div>
              <div class="fld"><span class="k">Objetivo</span><input v-model="form.goal" placeholder="O que esta sprint precisa entregar?" /></div>
              <div style="display:flex; justify-content:flex-end; gap:8px">
                <button class="btn-ghost" @click="showForm = false">Cancelar</button>
                <button class="btn-primary" :disabled="busy" @click="create">Criar sprint</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!list.length && !showForm" class="empty" style="padding:30px">Nenhuma sprint ainda.</div>
        <div v-for="s in list" :key="s.id" class="sprint" :class="s.state">
          <div class="sprint-top">
            <span class="sprint-state">{{ STATE[s.state] }}</span>
            <b>{{ s.name }}</b>
            <span class="muted">{{ formatDue(s.start) }} – {{ formatDue(s.end) }}</span>
            <span class="sprint-actions">
              <button v-if="s.state === 'planned'" class="btn" :disabled="busy || hasActive" :title="hasActive ? 'Encerre a sprint ativa antes' : ''" @click="start(s)">Iniciar</button>
              <button v-if="s.state === 'active'" class="btn" :disabled="busy" @click="askClose(s)">Encerrar</button>
              <button v-if="s.state !== 'active'" class="icon-btn btn-danger" title="Excluir sprint" @click="remove(s)"><Icon name="trash" :size="14" /></button>
            </span>
          </div>
          <div v-if="s.goal" class="sprint-goal">{{ s.goal }}</div>
          <div class="sprint-prog">
            <div class="meter"><i :style="{ width: (s.total ? s.done / s.total * 100 : 0) + '%', background: 'var(--green)' }"></i></div>
            <span class="muted">{{ s.done }}/{{ s.total }} tarefas<template v-if="s.pts"> · {{ s.pts }} pts</template>
              <template v-if="s.result"> · {{ s.result.carried }} levada(s) adiante</template></span>
          </div>

          <div v-if="closing?.id === s.id" class="sprint-close">
            <div>{{ s.total - s.done }} tarefa(s) não concluída(s). Para onde vão?</div>
            <select v-model="moveTo">
              <option value="">Sair de sprint (voltam para o backlog geral)</option>
              <option v-for="p in planned.filter((p) => p.id !== s.id)" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <div style="display:flex; justify-content:flex-end; gap:8px">
              <button class="btn-ghost" @click="closing = null">Cancelar</button>
              <button class="btn-primary" :disabled="busy" @click="confirmClose">Encerrar sprint</button>
            </div>
          </div>
        </div>

        <p class="muted" style="font-size:12px; margin:14px 0 0">
          Adicione tarefas a uma sprint pelo campo <b>Sprint</b> no detalhe da tarefa, ou selecionando várias na <b>Tabela</b>.
        </p>
      </div>
    </div>
  </div>
</template>
