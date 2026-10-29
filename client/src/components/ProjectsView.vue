<script setup>
import { ref, watch } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'
import UpdateVaultModal from './UpdateVaultModal.vue'
import { download, stamp, safeName } from '../browser/download.js'
import { colorFor, initials } from '../constants.js'

const props = defineProps({
  projects: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  favorites: { type: Object, default: () => new Set() },
  addSignal: { type: Number, default: 0 },
})
const emit = defineEmits(['select', 'changed', 'toggle-fav', 'notify'])

const updating = ref(null) // projeto sendo atualizado com nova versao do .zip
function onUpdated(d) {
  updating.value = null
  emit('changed')
  emit('notify', `Cofre atualizado: ${d.added.length} novo(s), ${d.changed.length} alterado(s), ${d.removed.length} removido(s)`)
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

const adding = ref(false)
const name = ref('')
const zipFile = ref(null)
const zipName = ref('')
const error = ref('')
const saving = ref(false)
const dragging = ref(false)
const fileInput = ref(null)

watch(() => props.addSignal, (v) => { if (v) openAdd() })

function openAdd() {
  adding.value = true
  error.value = ''
  name.value = ''
  zipFile.value = null
  zipName.value = ''
}

// aceita o .zip do cofre ou um backup .json exportado pelo proprio Cofre Hub
const isBackup = (f) => /\.json$/i.test(f?.name || '')

function pickFile(file) {
  if (!file) return
  if (!/\.(zip|json)$/i.test(file.name)) { error.value = 'Envie o .zip do cofre ou um backup .json do Cofre Hub.'; return }
  error.value = ''
  zipFile.value = file
  zipName.value = file.name
  if (!name.value.trim()) name.value = file.name.replace(/(\.cofre)?\.(zip|json)$/i, '')
}

// ---------- exportacao ----------
const exporting = ref('')

async function exportZip(p) {
  exporting.value = p.id + ':zip'
  try { download(await api.exportZip(p.id), `${safeName(p.name)}.zip`) } catch (e) { alert(e.message) }
  finally { exporting.value = '' }
}
async function exportBackup(p) {
  exporting.value = p.id + ':json'
  try { download(await api.exportBackup(p.id), `${safeName(p.name)}-${stamp()}.cofre.json`) } catch (e) { alert(e.message) }
  finally { exporting.value = '' }
}

function onFileChange(e) { pickFile(e.target.files?.[0]) }
function onDrop(e) { dragging.value = false; pickFile(e.dataTransfer?.files?.[0]) }

async function add() {
  error.value = ''
  if (!name.value.trim()) { error.value = 'Informe o nome do projeto.'; return }
  if (!zipFile.value) { error.value = 'Selecione o .zip do cofre.'; return }
  saving.value = true
  try {
    const p = isBackup(zipFile.value)
      ? await api.importBackup(await zipFile.value.text(), name.value.trim())
      : await api.importZipProject(name.value.trim(), await zipFile.value.arrayBuffer())
    adding.value = false
    emit('changed')
    emit('select', p.id)
  } catch (e) { error.value = e.message }
  finally { saving.value = false }
}

async function remove(p) {
  if (!confirm(`Remover "${p.name}"? Os documentos importados deste cofre serão apagados do navegador.`)) return
  try { await api.removeProject(p.id); emit('changed') } catch (e) { alert(e.message) }
}
</script>

<template>
  <div>
    <div v-if="!projects.length" class="welcome">
      <div class="welcome-logo">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6.5" r="4"/><circle cx="6.5" cy="15.5" r="4"/><circle cx="17.5" cy="15.5" r="4"/></svg>
      </div>
      <h2>Bem-vindo ao Cofre Hub</h2>
      <p class="muted">Para começar, importe o <b>.zip</b> de um cofre. Enquanto nenhum cofre for importado, a navegação fica indisponível.</p>
      <button class="btn-primary" style="margin-top:4px" @click="openAdd"><Icon name="plus" :size="15" /> Importar cofre (.zip)</button>
    </div>

    <template v-else>
    <div class="row" style="margin-bottom:16px">
      <span class="muted">{{ projects.length }} projeto(s) · cada projeto é um cofre importado por .zip</span>
      <button class="btn-primary" style="margin-left:auto" @click="openAdd"><Icon name="plus" :size="14" /> Importar cofre</button>
    </div>

    <div class="files" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))">
      <div v-for="p in projects" :key="p.id" class="file-tile" style="align-items:flex-start; padding:18px"
        :style="{ borderColor: p.id === currentId ? 'var(--accent)' : '' }"
        @click="emit('select', p.id)">
        <div class="project-avatar" :style="{ background: colorFor(p.name) }">{{ initials(p.name) }}</div>
        <div style="min-width:0; flex:1">
          <div class="nm" style="font-size:14px">{{ p.name }}</div>
          <div class="sb">{{ p.updatedAt ? `Atualizado em ${fmtDate(p.updatedAt)}` : 'Cofre importado' }}</div>
          <div class="row" style="margin-top:10px; gap:12px">
            <span class="muted" style="font-size:12px"><b style="color:var(--text)">{{ p.taskCount }}</b> tarefas</span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:2px" @click.stop>
          <button class="icon-btn star" :class="{ on: favorites.has(p.id) }" title="Favoritar" @click="emit('toggle-fav', p.id)"><Icon name="star" :size="15" /></button>
          <button class="icon-btn" title="Atualizar cofre com uma nova versão do .zip (mantém quadro e histórico)" @click="updating = p">
            <Icon name="upload" :size="15" />
          </button>
          <button class="icon-btn" :disabled="!!exporting" title="Exportar cofre (.zip) com as edições feitas aqui" @click="exportZip(p)">
            <Icon :name="exporting === p.id + ':zip' ? 'refresh' : 'download'" :size="15" />
          </button>
          <button class="icon-btn" :disabled="!!exporting" title="Backup completo (.json): cofre, quadro, comentários e histórico" @click="exportBackup(p)">
            <Icon :name="exporting === p.id + ':json' ? 'refresh' : 'archive'" :size="15" />
          </button>
          <button class="icon-btn btn-danger" title="Remover" @click="remove(p)"><Icon name="trash" :size="15" /></button>
        </div>
      </div>
      <div class="add-list" style="width:auto; min-height:110px; cursor:pointer" @click="openAdd">
        <Icon name="plus" :size="15" /> Importar cofre (.zip)
      </div>
    </div>
    </template>

    <UpdateVaultModal v-if="updating" :project="updating" @close="updating = null" @updated="onUpdated" />

    <div v-if="adding" class="overlay" @click.self="adding = false">
      <div class="modal">
        <div class="modal-head">
          <h3>Importar cofre</h3>
          <button class="icon-btn" style="margin-left:auto" @click="adding = false"><Icon name="x" :size="16" /></button>
        </div>
        <div class="modal-body">
          <label>Nome do projeto</label>
          <input v-model="name" placeholder="Ex.: SOPE / HGE" autofocus />

          <label>Arquivo do cofre (.zip)</label>
          <div class="dropzone" :class="{ over: dragging, has: zipFile }"
            @click="fileInput.click()"
            @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
            <input ref="fileInput" type="file" accept=".zip,.json" style="display:none" @change="onFileChange" />
            <Icon :name="zipFile ? 'check' : 'file'" :size="20" />
            <div v-if="zipFile"><b>{{ zipName }}</b><div class="muted" style="font-size:12px">Clique para trocar</div></div>
            <div v-else>Arraste o .zip aqui ou <span style="color:var(--accent)">clique para selecionar</span></div>
          </div>

          <p class="muted" style="font-size:12px; margin:10px 0 0">
            Compacte a pasta do cofre (com <code>Backlog Técnico/</code>, <code>Transversais/</code> e os documentos globais) num <code>.zip</code>. Os dados ficam salvos apenas neste navegador.
          </p>
          <p class="muted" style="font-size:12px; margin:6px 0 0">
            Para <b>restaurar um backup</b>, envie o arquivo <code>.cofre.json</code> exportado pelo botão <Icon name="archive" :size="12" /> do projeto. Quadro, comentários e histórico voltam junto.
          </p>
          <p v-if="error" class="err" style="margin-top:10px">{{ error }}</p>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" @click="adding = false">Cancelar</button>
          <button class="btn-primary" :disabled="saving || !name.trim() || !zipFile" @click="add">
            {{ saving ? 'Importando…' : 'Importar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
