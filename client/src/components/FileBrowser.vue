<script setup>
import { ref, computed, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import { api } from '../api.js'
import Icon from './Icon.vue'

const props = defineProps({
  projectId: { type: String, required: true },
  tree: { type: Array, default: () => [] },
  startFolder: { type: Array, default: () => [] },
  startFile: { type: String, default: '' },
})
const emit = defineEmits(['open-task', 'changed'])

const md = new MarkdownIt({ html: false, linkify: true })

const stack = ref([...props.startFolder])   // nomes das pastas abertas
const file = ref(props.startFile)           // caminho do documento aberto
const content = ref('')
const original = ref('')
const editing = ref(false)
const busy = ref(false)
const error = ref('')

watch(() => props.startFolder, (v) => { stack.value = [...v] })
watch(() => props.startFile, (v) => { file.value = v })

const isTask = (path) => /^(backlog|transversais)/i.test(path)

const currentNodes = computed(() => {
  let nodes = props.tree
  for (const name of stack.value) {
    const dir = nodes.find((n) => n.type === 'dir' && n.name === name)
    if (!dir) return []
    nodes = dir.children
  }
  return nodes
})
const dirs = computed(() => currentNodes.value.filter((n) => n.type === 'dir'))
const files = computed(() => currentNodes.value.filter((n) => n.type === 'file'))

const countFiles = (node) => node.type === 'file' ? 1 : node.children.reduce((s, c) => s + countFiles(c), 0)

function enter(node) {
  if (node.type === 'dir') { stack.value = [...stack.value, node.name]; file.value = ''; return }
  if (isTask(node.path)) { emit('open-task', node.path); return }
  file.value = node.path
}
function goTo(i) { stack.value = stack.value.slice(0, i); file.value = '' }

// ---- documento aberto ----
const rendered = computed(() => md.render(content.value || ''))
const dirty = computed(() => content.value !== original.value)

async function loadFile() {
  editing.value = false
  error.value = ''
  if (!file.value) return
  busy.value = true
  try {
    const d = await api.read(props.projectId, file.value)
    content.value = d.content
    original.value = d.content
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
watch(file, loadFile, { immediate: true })

async function save() {
  busy.value = true
  try {
    await api.save(props.projectId, file.value, content.value)
    original.value = content.value
    editing.value = false
    emit('changed')
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}

async function removeFile() {
  if (!confirm(`Excluir "${file.value}"?`)) return
  try {
    await api.remove(props.projectId, file.value)
    file.value = ''
    emit('changed')
  } catch (e) { error.value = e.message }
}

async function newDoc() {
  const name = prompt('Nome do novo documento:')
  if (!name) return
  const path = [...stack.value, name.endsWith('.md') ? name : name + '.md'].join('/')
  try {
    await api.create(props.projectId, path, `# ${name.replace(/\.md$/, '')}\n\n`)
    emit('changed')
    file.value = path
    editing.value = true
  } catch (e) { alert(e.message) }
}

const fileTitle = computed(() => file.value.split('/').pop()?.replace(/\.md$/, '') || '')
</script>

<template>
  <div>
    <div class="crumbs">
      <button :class="{ cur: !stack.length && !file }" @click="goTo(0)"><Icon name="home" :size="14" /> Cofre</button>
      <template v-for="(name, i) in stack" :key="i">
        <Icon name="chevronRight" :size="13" />
        <button :class="{ cur: i === stack.length - 1 && !file }" @click="goTo(i + 1)">{{ name }}</button>
      </template>
      <template v-if="file">
        <Icon name="chevronRight" :size="13" />
        <button class="cur" style="cursor:default">{{ fileTitle }}</button>
      </template>
      <div style="margin-left:auto">
        <button v-if="!file" class="btn" @click="newDoc"><Icon name="plus" :size="14" /> Novo documento</button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- Documento aberto -->
    <div v-if="file" class="panel" style="padding:22px 26px">
      <div class="row" style="margin-bottom:14px">
        <button class="btn-ghost" @click="file = ''"><Icon name="back" :size="14" /> Voltar</button>
        <div style="margin-left:auto; display:flex; gap:6px">
          <template v-if="!editing">
            <button class="btn-ghost" @click="editing = true"><Icon name="edit" :size="14" /> Editar</button>
            <button class="icon-btn btn-danger" title="Excluir" @click="removeFile"><Icon name="trash" :size="15" /></button>
          </template>
          <template v-else>
            <button class="btn-ghost" @click="content = original; editing = false">Cancelar</button>
            <button class="btn-primary" :disabled="busy || !dirty" @click="save">Salvar</button>
          </template>
        </div>
      </div>
      <div v-if="busy && !content" class="muted">Carregando…</div>
      <textarea v-else-if="editing" v-model="content" rows="30" spellcheck="false"
        style="font-family: ui-monospace, Consolas, monospace; font-size:12.5px; line-height:1.55"></textarea>
      <div v-else class="md" v-html="rendered"></div>
    </div>

    <!-- Pasta -->
    <template v-else>
      <div v-if="dirs.length" class="files" style="margin-bottom:18px">
        <div v-for="d in dirs" :key="d.path" class="file-tile" @click="enter(d)">
          <div class="ic dir"><Icon name="folder" :size="17" /></div>
          <div style="min-width:0">
            <div class="nm">{{ d.name }}</div>
            <div class="sb">{{ countFiles(d) }} documento(s)</div>
          </div>
        </div>
      </div>
      <div v-if="files.length" class="files">
        <div v-for="f in files" :key="f.path" class="file-tile" @click="enter(f)">
          <div class="ic"><Icon :name="isTask(f.path) ? 'board' : 'file'" :size="17" /></div>
          <div style="min-width:0">
            <div class="nm">{{ f.name.replace(/\.md$/, '') }}</div>
            <div class="sb">{{ isTask(f.path) ? 'Tarefa · abre no detalhe' : 'Documento' }}</div>
          </div>
        </div>
      </div>
      <div v-if="!dirs.length && !files.length" class="empty">Pasta vazia.</div>
    </template>
  </div>
</template>
