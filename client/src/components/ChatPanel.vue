<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { api } from '../api.js'
import Icon from './Icon.vue'

const props = defineProps({
  projectId: { type: String, required: true },
  projectName: { type: String, default: '' },
  seed: { type: Object, default: null },
})
const emit = defineEmits(['close', 'open-doc', 'consumed'])

const SUGGESTIONS = [
  'Quais são os conflitos críticos deste projeto?',
  'Onde a autenticação e o token são tratados?',
  'Quais tarefas envolvem dados pessoais (LGPD)?',
]

const messages = ref([])
const input = ref('')
const loading = ref(false)
const bodyEl = ref(null)

async function scroll() {
  await nextTick()
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight
}

async function ask(text) {
  const q = (text ?? input.value).trim()
  if (!q || loading.value) return
  input.value = ''
  messages.value.push({ me: true, text: q })
  loading.value = true
  scroll()
  try {
    const r = await api.chat(props.projectId, q)
    messages.value.push({ me: false, text: r.answer, sources: r.sources || [] })
  } catch (e) {
    messages.value.push({ me: false, text: 'Não consegui consultar a documentação: ' + e.message, sources: [] })
  } finally {
    loading.value = false
    scroll()
  }
}

function onEnter(e) {
  if (e.shiftKey) return
  e.preventDefault()
  ask()
}

function consumeSeed() {
  if (props.seed?.text) {
    ask(props.seed.text)
    emit('consumed')
  }
}
watch(() => props.seed, consumeSeed)
onMounted(consumeSeed)
watch(() => props.projectId, () => { messages.value = [] })
</script>

<template>
  <div class="chat" @click.stop>
    <div class="chat-head">
      <button class="icon-btn" title="Limpar conversa" @click="messages = []"><Icon name="refresh" :size="15" /></button>
      <div class="name"><Icon name="sparkle" :size="15" style="color: var(--accent)" /> Assistente</div>
      <button class="icon-btn" title="Fechar" @click="emit('close')"><Icon name="x" :size="16" /></button>
    </div>

    <div ref="bodyEl" class="chat-body">
      <template v-if="!messages.length">
        <div class="bubble-ai">
          Olá! Eu consulto a documentação de <b>{{ projectName }}</b> e indico os documentos relevantes. Experimente:
        </div>
        <div class="chat-src">
          <div v-for="s in SUGGESTIONS" :key="s" class="s" @click="ask(s)"><div style="color: var(--text-2)">{{ s }}</div></div>
        </div>
      </template>

      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.me" class="bubble-me">{{ m.text }}</div>
        <div v-else class="bubble-ai">
          {{ m.text }}
          <div v-if="m.sources?.length" class="chat-src">
            <div v-for="(s, j) in m.sources" :key="j" class="s" @click="emit('open-doc', s.path)">
              <div class="p">{{ s.path.split('/').slice(-2).join(' / ') }}</div>
              <div v-if="s.snippet" class="x">{{ s.snippet }}</div>
            </div>
          </div>
        </div>
      </template>
      <div v-if="loading" class="bubble-ai muted">Consultando a documentação…</div>
    </div>

    <div class="chat-foot">
      <div class="chat-input">
        <textarea v-model="input" rows="2" placeholder="Pergunte ao assistente…" @keydown.enter="onEnter"></textarea>
        <div class="row">
          <span class="muted" style="font-size:11px">Enter envia · Shift+Enter quebra linha</span>
          <button class="send-btn" :disabled="loading || !input.trim()" title="Enviar" @click="ask()"><Icon name="send" :size="14" /></button>
        </div>
      </div>
    </div>
  </div>
</template>
