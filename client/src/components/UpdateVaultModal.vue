<script setup>
// Atualiza um projeto com uma nova versao do .zip do cofre, mostrando antes
// o que mudou. Quadro, campos, comentarios e historico sao preservados.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'

const props = defineProps({ project: { type: Object, required: true } })
const emit = defineEmits(['close', 'updated'])

const file = ref(null)
const diff = ref(null)
const error = ref('')
const busy = ref(false)
const dragging = ref(false)
const input = ref(null)
const tab = ref('tasks')

async function pick(f) {
  if (!f) return
  if (!/\.zip$/i.test(f.name)) { error.value = 'Envie o .zip com a nova versão do cofre.'; return }
  error.value = ''
  file.value = f
  busy.value = true
  try { diff.value = await api.previewVaultUpdate(props.project.id, await f.arrayBuffer()) }
  catch (e) { error.value = e.message; diff.value = null }
  finally { busy.value = false }
}

async function apply() {
  busy.value = true
  try {
    const d = await api.applyVaultUpdate(props.project.id, await file.value.arrayBuffer())
    emit('updated', d)
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}

const noChanges = computed(() => diff.value && !diff.value.added.length && !diff.value.removed.length && !diff.value.changed.length)
const groups = computed(() => {
  const d = diff.value
  if (!d) return []
  const t = tab.value === 'tasks'
  return [
    { key: 'added', label: 'Novos', icon: 'plus', cls: 'add', list: t ? d.tasksAdded : d.added },
    { key: 'changed', label: 'Alterados', icon: 'edit', cls: 'chg', list: t ? d.tasksChanged : d.changed },
    { key: 'removed', label: 'Removidos', icon: 'trash', cls: 'rem', list: t ? d.tasksRemoved : d.removed },
  ]
})
const short = (p) => p.split('/').slice(-2).join(' / ').replace(/\.md$/, '')

function onKey(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" style="width:620px">
      <div class="modal-head">
        <Icon name="upload" :size="16" /><h3>Atualizar cofre · {{ project.name }}</h3>
        <button class="icon-btn" style="margin-left:auto" title="Fechar (Esc)" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>
      <div class="modal-body">
        <p class="muted" style="margin:0 0 12px; font-size:12.5px">
          Envie a nova versão do <code>.zip</code>. Os documentos são substituídos; <b>quadro, campos, comentários e histórico continuam</b>.
        </p>
        <div class="dropzone" :class="{ over: dragging, has: file }" @click="input.click()"
          @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dragging = false; pick($event.dataTransfer.files[0])">
          <input ref="input" type="file" accept=".zip" style="display:none" @change="pick($event.target.files[0])" />
          <Icon :name="file ? 'check' : 'upload'" :size="20" />
          <div v-if="file"><b>{{ file.name }}</b><div class="muted" style="font-size:12px">Clique para trocar</div></div>
          <div v-else>Arraste o .zip aqui ou <span style="color:var(--accent)">clique para selecionar</span></div>
        </div>
        <p v-if="error" class="err" style="margin-top:10px">{{ error }}</p>
        <div v-if="busy && !diff" class="muted" style="margin-top:12px">Comparando versões…</div>

        <template v-if="diff">
          <div v-if="noChanges" class="all-good" style="margin-top:14px"><Icon name="check" :size="16" /> Esta versão é idêntica à atual. Nada a atualizar.</div>
          <template v-else>
            <div class="diff-sum">
              <span class="add"><b>{{ diff.added.length }}</b> novo(s)</span>
              <span class="chg"><b>{{ diff.changed.length }}</b> alterado(s)</span>
              <span class="rem"><b>{{ diff.removed.length }}</b> removido(s)</span>
              <span class="muted">{{ diff.unchanged }} sem mudança</span>
            </div>
            <div v-if="diff.tasksRemoved.length" class="blocked-note" style="margin-top:10px">
              <Icon name="alert" :size="13" /> {{ diff.tasksRemoved.length }} tarefa(s) saem do cofre: os campos, comentários e histórico delas serão descartados. Faça um backup antes, se precisar.
            </div>
            <div class="seg" style="margin-top:12px">
              <button :class="{ on: tab === 'tasks' }" @click="tab = 'tasks'">Tarefas</button>
              <button :class="{ on: tab === 'all' }" @click="tab = 'all'">Todos os arquivos</button>
            </div>
            <div class="diff-list">
              <template v-for="g in groups" :key="g.key">
                <div v-for="p in g.list" :key="g.key + p" class="diff-row" :class="g.cls" :title="p">
                  <Icon :name="g.icon" :size="12" /> <span>{{ short(p) }}</span>
                </div>
              </template>
              <div v-if="!groups.some((g) => g.list.length)" class="muted" style="padding:8px">Nenhuma mudança nesta visão.</div>
            </div>
          </template>
        </template>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" @click="emit('close')">Cancelar</button>
        <button class="btn-primary" :disabled="busy || !diff || noChanges" @click="apply">{{ busy && diff ? 'Atualizando…' : 'Aplicar atualização' }}</button>
      </div>
    </div>
  </div>
</template>
