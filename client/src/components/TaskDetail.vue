<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import { api } from '../api.js'
import Icon from './Icon.vue'
import { COLUMNS, LAYERS, SEV, prettyFolder } from '../constants.js'

const props = defineProps({
  projectId: { type: String, required: true },
  path: { type: String, required: true },
  cards: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'move', 'saved', 'deleted', 'ask', 'open-doc'])

const md = new MarkdownIt({ html: false, linkify: true })

const content = ref('')
const original = ref('')
const editing = ref(false)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const review = ref(null)
const reviewing = ref(false)
const copied = ref(false)

const card = computed(() => props.cards.find((c) => c.path === props.path) || null)
const siblings = computed(() =>
  card.value ? props.cards.filter((c) => c.feature === card.value.feature && c.path !== props.path) : []
)
const dirty = computed(() => content.value !== original.value)

// remove o H1 do corpo (ja aparece no cabecalho do modal)
const rendered = computed(() => md.render(content.value.replace(/^#\s+.+\r?\n/, '')))
const heading = computed(() => (content.value.match(/^#\s+(.+)$/m) || [])[1] || card.value?.fileName || props.path)

// criterios de aceitacao: linhas "- [ ] texto"
const criteria = computed(() => {
  const out = []
  content.value.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^(\s*)- \[([ xX])\]\s*(.*)$/)
    if (m) out.push({ index: i, done: m[2] !== ' ', text: m[3] || '(sem texto)' })
  })
  return out
})
const doneCount = computed(() => criteria.value.filter((c) => c.done).length)

async function load() {
  loading.value = true
  error.value = ''
  editing.value = false
  review.value = null
  try {
    const data = await api.read(props.projectId, props.path)
    content.value = data.content
    original.value = data.content
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
watch(() => props.path, load)
onMounted(load)

async function persist(next, msg) {
  saving.value = true
  error.value = ''
  try {
    await api.save(props.projectId, props.path, next)
    content.value = next
    original.value = next
    emit('saved', msg)
  } catch (e) { error.value = e.message }
  finally { saving.value = false }
}

async function save() {
  await persist(content.value)
  if (!error.value) editing.value = false
}
function cancel() { content.value = original.value; editing.value = false }

async function copyTask() {
  try {
    await navigator.clipboard.writeText(content.value)
  } catch {
    // fallback para navegadores/contextos sem Clipboard API
    const ta = document.createElement('textarea')
    ta.value = content.value
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    document.body.removeChild(ta)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 1800)
}

function toggleCriterion(c) {
  const lines = original.value.split(/\r?\n/)
  lines[c.index] = lines[c.index].replace(/- \[([ xX])\]/, c.done ? '- [ ]' : '- [x]')
  persist(lines.join('\n'))
}

async function remove() {
  if (!confirm('Excluir esta tarefa? O arquivo será apagado do cofre.')) return
  try {
    await api.remove(props.projectId, props.path)
    emit('deleted')
  } catch (e) { error.value = e.message }
}

async function runReview() {
  if (!card.value) return
  reviewing.value = true
  try {
    review.value = await api.analyze(props.projectId, {
      title: card.value.title,
      description: content.value.slice(0, 4000),
      feature: card.value.feature,
      layer: card.value.layer,
    })
  } catch (e) { error.value = e.message }
  finally { reviewing.value = false }
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (editing.value && dirty.value && !confirm('Descartar alterações?')) return
    emit('close')
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && editing.value) { e.preventDefault(); save() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function close() {
  if (editing.value && dirty.value && !confirm('Descartar alterações?')) return
  emit('close')
}
</script>

<template>
  <div class="overlay" @click.self="close">
    <div class="modal wide">
      <div class="modal-head">
        <span class="layer" :class="card?.layer">{{ LAYERS[card?.layer] || 'Documento' }}</span>
        <span class="muted" style="font-size:12px">{{ prettyFolder(card?.feature || '') }}</span>
        <div style="margin-left:auto; display:flex; gap:4px">
          <button class="icon-btn" :class="{ 'copy-ok': copied }" :title="copied ? 'Copiado!' : 'Copiar tarefa inteira'" @click="copyTask">
            <Icon :name="copied ? 'check' : 'copy'" :size="15" />
          </button>
          <template v-if="!editing">
            <button class="btn-ghost" @click="emit('ask', card)" :disabled="!card"><Icon name="message" :size="14" /> Perguntar</button>
            <button class="btn-ghost" @click="editing = true"><Icon name="edit" :size="14" /> Editar</button>
            <button class="icon-btn btn-danger" title="Excluir" @click="remove"><Icon name="trash" :size="15" /></button>
          </template>
          <template v-else>
            <button class="btn-ghost" @click="cancel">Cancelar</button>
            <button class="btn-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Salvando…' : 'Salvar' }}</button>
          </template>
          <button class="icon-btn" title="Fechar (Esc)" @click="close"><Icon name="x" :size="16" /></button>
        </div>
      </div>

      <div v-if="loading" class="empty">Carregando…</div>
      <div v-else class="detail">
        <div class="detail-main">
          <p v-if="error" class="err">{{ error }}</p>
          <h2 style="margin:0 0 16px; font-size:19px; line-height:1.3">{{ heading }}</h2>
          <textarea v-if="editing" v-model="content" rows="28" spellcheck="false"
            style="font-family: ui-monospace, Consolas, monospace; font-size:12.5px; line-height:1.55"></textarea>
          <div v-else class="md" v-html="rendered"></div>
        </div>

        <aside class="detail-side">
          <div class="prop">
            <span class="k">Status</span>
            <select :value="card?.status" :disabled="!card" @change="emit('move', path, $event.target.value)">
              <option v-for="c in COLUMNS" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </div>

          <div v-if="criteria.length" class="prop">
            <span class="k">Critérios de aceitação · {{ doneCount }}/{{ criteria.length }}</span>
            <div class="progress"><i :style="{ width: (doneCount / criteria.length * 100) + '%' }"></i></div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px">
              <label v-for="c in criteria" :key="c.index"
                style="display:flex; gap:8px; align-items:flex-start; margin:0; text-transform:none; letter-spacing:0; font-size:12.5px; font-weight:400; color:var(--text-2); cursor:pointer">
                <input type="checkbox" :checked="c.done" :disabled="saving || editing" style="width:auto; margin-top:2px" @change="toggleCriterion(c)" />
                <span :style="{ textDecoration: c.done ? 'line-through' : 'none', opacity: c.done ? .6 : 1 }">{{ c.text }}</span>
              </label>
            </div>
          </div>

          <div v-if="card && (card.red || card.yellow || card.green)" class="prop">
            <span class="k">Apontamentos do diagnóstico</span>
            <div class="row" style="gap:14px">
              <span v-for="k in ['red', 'yellow', 'green']" v-show="card[k]" :key="k" class="status-pill">
                <span class="sev-dot" :style="{ background: SEV[k].color }"></span>{{ card[k] }} {{ SEV[k].label.toLowerCase() }}
              </span>
            </div>
          </div>

          <div v-if="card?.ids?.length" class="prop">
            <span class="k">Tarefas citadas</span>
            <div class="row" style="flex-wrap:wrap; gap:6px">
              <span v-for="id in card.ids" :key="id" class="chip" style="cursor:default">{{ id }}</span>
            </div>
          </div>

          <div v-if="siblings.length" class="prop">
            <span class="k">Outros arquivos da funcionalidade</span>
            <div v-for="s in siblings" :key="s.path" class="list-item" style="margin:0; padding:9px 10px" @click="emit('open-doc', s.path)">
              <span class="layer" :class="s.layer">{{ LAYERS[s.layer] }}</span>
              <span class="t" style="font-weight:500">{{ s.title }}</span>
            </div>
          </div>

          <div class="prop">
            <span class="k">Revisão pelo assistente</span>
            <button class="btn" style="justify-content:center" :disabled="reviewing || !card" @click="runReview">
              <Icon name="sparkle" :size="14" /> {{ reviewing ? 'Analisando…' : 'Revisar tarefa' }}
            </button>
            <template v-if="review">
              <div class="muted" style="font-size:12px; margin-top:4px">{{ review.resumo }}</div>
              <div v-for="(f, i) in review.findings.filter((x) => x.doc !== path).slice(0, 6)" :key="i" class="finding" :class="f.severity">
                {{ f.message }}
                <a v-if="f.doc" @click="emit('open-doc', f.doc)">{{ f.doc.split('/').slice(-2).join(' / ') }}</a>
              </div>
              <div v-for="(m, i) in review.melhorias" :key="'m' + i" class="finding info">{{ m }}</div>
            </template>
          </div>

          <div class="prop">
            <span class="k">Arquivo</span>
            <span class="muted" style="font-size:11.5px; word-break:break-all">{{ path }}</span>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
