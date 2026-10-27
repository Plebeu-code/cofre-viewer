<script setup>
import { ref, computed } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'
import { COLUMNS, prettyFolder } from '../constants.js'

const props = defineProps({
  projectId: { type: String, required: true },
  categories: { type: Array, default: () => [] },
  initialColumn: { type: String, default: 'backlog' },
  initialFeature: { type: String, default: '' },
})
const emit = defineEmits(['close', 'created', 'open-doc'])

const LAYER_FILE = { front: 'Formulário e Interface', back: 'API e Regras de Negócio', shared: 'Visão Geral e Integração' }

const title = ref('')
const feature = ref(props.initialFeature || props.categories[0]?.name || '')
const newFeature = ref('')
const layer = ref('back')
const column = ref(props.initialColumn)
const description = ref('')
const criteria = ref('')

const analysis = ref(null)
const analyzing = ref(false)
const creating = ref(false)
const error = ref('')

const featureName = computed(() => (feature.value === '__new' ? newFeature.value.trim() : feature.value))
const fileName = computed(() => `${LAYER_FILE[layer.value]} — ${title.value.trim() || 'Título'}`)
const canSubmit = computed(() => title.value.trim() && featureName.value)

async function analyze() {
  if (!canSubmit.value) { error.value = 'Informe o título e a funcionalidade.'; return }
  analyzing.value = true
  error.value = ''
  try {
    analysis.value = await api.analyze(props.projectId, {
      title: title.value, description: `${description.value}\n${criteria.value}`, feature: featureName.value, layer: layer.value,
    })
  } catch (e) { error.value = e.message }
  finally { analyzing.value = false }
}

function buildBody() {
  const crit = criteria.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return [
    `# ${fileName.value}`,
    '',
    `> **Funcionalidade:** ${prettyFolder(featureName.value)}`,
    `> **Descrição:** ${description.value.split(/\r?\n/)[0] || '(preencher)'}`,
    '',
    '## Contexto',
    description.value.trim() || '_(descrever o comportamento atual e o objetivo)_',
    '',
    '## Critérios de aceitação',
    ...(crit.length ? crit.map((c) => `- [ ] ${c.replace(/^[-*]\s*(\[.\]\s*)?/, '')}`) : ['- [ ] ']),
    '',
    '## Dependências',
    '- (listar tarefas e módulos relacionados)',
    '',
  ].join('\n')
}

async function create() {
  if (!canSubmit.value) { error.value = 'Informe o título e a funcionalidade.'; return }
  creating.value = true
  error.value = ''
  const path = `Backlog Técnico/${featureName.value}/${fileName.value}.md`
  try {
    const res = await api.create(props.projectId, path, buildBody())
    await api.moveCard(props.projectId, res.path, column.value)
    emit('created', res.path)
  } catch (e) {
    error.value = e.message
    creating.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" :class="{ wide: analysis }" :style="analysis ? 'width: 980px' : ''">
      <div class="modal-head">
        <h3>Nova tarefa</h3>
        <button class="icon-btn" style="margin-left:auto" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>

      <div :style="analysis ? 'display:grid; grid-template-columns: 1fr 380px' : ''">
        <div class="modal-body">
          <label>Título</label>
          <input v-model="title" placeholder="Ex.: Restringir o login temporário do QRCode" autofocus />

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div>
              <label>Funcionalidade</label>
              <select v-model="feature">
                <option v-for="c in categories" :key="c.name" :value="c.name">{{ prettyFolder(c.name) }}</option>
                <option value="__new">+ Nova funcionalidade…</option>
              </select>
              <input v-if="feature === '__new'" v-model="newFeature" placeholder="Nome-da-Pasta" style="margin-top:6px" />
            </div>
            <div>
              <label>Camada</label>
              <select v-model="layer">
                <option value="front">Front-end</option>
                <option value="back">Back-end</option>
                <option value="shared">Geral / Integração</option>
              </select>
            </div>
          </div>

          <label>Coluna</label>
          <div class="row" style="flex-wrap:wrap">
            <span v-for="c in COLUMNS" :key="c.id" class="chip" :style="column === c.id ? 'background: var(--accent-soft); color: var(--text)' : ''" @click="column = c.id">
              <span class="sev-dot" :style="{ background: c.color }"></span>{{ c.label }}
            </span>
          </div>

          <label>Contexto / descrição</label>
          <textarea v-model="description" rows="4" placeholder="O que acontece hoje, o que precisa mudar e por quê."></textarea>

          <label>Critérios de aceitação (um por linha)</label>
          <textarea v-model="criteria" rows="3" placeholder="Login com user_id arbitrário retorna 401"></textarea>

          <p class="muted" style="font-size:11.5px; margin:10px 0 0">
            Arquivo: <code>Backlog Técnico/{{ featureName || '…' }}/{{ fileName }}.md</code>
          </p>
          <p v-if="error" class="err" style="margin-top:10px">{{ error }}</p>
        </div>

        <aside v-if="analysis" style="border-left:1px solid var(--line-soft); padding:20px; max-height:70vh; overflow:auto">
          <div class="row" style="margin-bottom:6px"><Icon name="sparkle" :size="15" style="color:var(--accent)" /><b>Revisão do assistente</b></div>
          <div class="muted" style="font-size:12px">{{ analysis.resumo }}</div>

          <div v-if="analysis.melhorias.length" style="margin-top:14px">
            <div class="prop"><span class="k">Melhorias no rascunho</span></div>
            <div v-for="(m, i) in analysis.melhorias" :key="i" class="finding info">{{ m }}</div>
          </div>

          <div v-if="analysis.findings.length" style="margin-top:14px">
            <div class="prop"><span class="k">Pontos de atenção</span></div>
            <div v-for="(f, i) in analysis.findings.slice(0, 8)" :key="i" class="finding" :class="f.severity">
              {{ f.message }}
              <a v-if="f.doc" @click="emit('open-doc', f.doc)">{{ f.doc.split('/').slice(-2).join(' / ') }}</a>
            </div>
          </div>
        </aside>
      </div>

      <div class="modal-foot">
        <button class="btn" :disabled="analyzing" @click="analyze">
          <Icon name="sparkle" :size="14" /> {{ analyzing ? 'Revisando…' : analysis ? 'Revisar novamente' : 'Revisar antes de criar' }}
        </button>
        <div style="flex:1"></div>
        <button class="btn-ghost" @click="emit('close')">Cancelar</button>
        <button class="btn-primary" :disabled="creating || !canSubmit" @click="create">{{ creating ? 'Criando…' : 'Criar tarefa' }}</button>
      </div>
    </div>
  </div>
</template>
