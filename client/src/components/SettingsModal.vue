<script setup>
// Configuracoes deste navegador: aparencia, assistente com IA (Claude),
// lembrete de backup e sincronizacao opcional (Supabase).
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { getTheme, setTheme, getBackupDays, setBackupDays } from '../browser/prefs.js'

const props = defineProps({
  projects: { type: Array, default: () => [] },
  section: { type: String, default: 'general' },
})
const emit = defineEmits(['close', 'changed', 'notify'])

const tab = ref(props.section)

// ---------- aparencia ----------
const theme = ref(getTheme())
function pickTheme(t) { theme.value = t; setTheme(t) }

// ---------- assistente (Claude) ----------
// a config e lida direto do localStorage para nao carregar o SDK ao abrir a tela
const LLM_KEY = 'cofre.llm'
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (mais rápido)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (mais barato)' },
]
const llm = reactive((() => {
  try { return { apiKey: '', model: 'claude-opus-5-5', ...JSON.parse(localStorage.getItem(LLM_KEY) || '{}') } } catch { return { apiKey: '', model: 'claude-opus-5-5' } }
})())
const showKey = ref(false)
function saveLlm() {
  localStorage.setItem(LLM_KEY, JSON.stringify({ apiKey: llm.apiKey.trim(), model: llm.model }))
  emit('changed')
  emit('notify', llm.apiKey.trim() ? 'Assistente com Claude ativado' : 'Assistente em modo offline')
}
function clearLlm() { llm.apiKey = ''; saveLlm() }

// ---------- backup ----------
const backupDays = ref(getBackupDays())
function saveBackup() { setBackupDays(backupDays.value); emit('changed') }

// ---------- sincronizacao ----------
const sync = reactive({ url: '', anonKey: '', auto: false })
const user = ref(null)
const email = ref('')
const remote = ref([])
const syncBusy = ref('')
const syncError = ref('')
const linkSent = ref(false)
let mod = null
let offAuth = () => {}
const configured = ref(false) // conexao salva (o modulo nao e reativo)

async function loadSync() {
  mod = await import('../browser/sync.js')
  Object.assign(sync, mod.getSyncConfig())
  configured.value = mod.syncConfigured()
  if (!configured.value) return
  user.value = await mod.getUser()
  offAuth = mod.onAuthChange((u) => { user.value = u; if (u) refreshRemote() })
  if (user.value) refreshRemote()
}
async function saveSync() {
  mod.setSyncConfig(sync)
  user.value = null
  await loadSync()
  emit('changed')
  emit('notify', 'Configuração de sincronização salva')
}
async function run(key, fn) {
  syncBusy.value = key
  syncError.value = ''
  try { return await fn() } catch (e) { syncError.value = e.message; throw e } finally { syncBusy.value = '' }
}
async function sendLink() {
  await run('login', () => mod.signIn(email.value.trim())).catch(() => {})
  if (!syncError.value) linkSent.value = true
}
async function logout() { await mod.signOut(); user.value = null; remote.value = [] }
async function refreshRemote() { remote.value = await run('list', () => mod.listRemote()).catch(() => []) }

const rows = computed(() => {
  const remoteBy = new Map(remote.value.map((r) => [r.id, r]))
  const local = props.projects.map((p) => ({ p, r: remoteBy.get(p.id) }))
  const onlyRemote = remote.value.filter((r) => !props.projects.some((p) => p.id === r.id))
  return { local, onlyRemote }
})
function status({ p, r }) {
  if (!r) return { label: 'Só neste navegador', cls: 'off' }
  if (p.syncConflict || (p.syncVersion && r.version > p.syncVersion)) return { label: 'Versão mais nova na nuvem', cls: 'warn' }
  if (!p.syncVersion) return { label: 'Existe na nuvem (não vinculado)', cls: 'warn' }
  return { label: 'Sincronizado', cls: 'ok' }
}
async function push(p, force = false) {
  try {
    await run('push:' + p.id, () => mod.pushProject(p.id, { force }))
    emit('changed')
    emit('notify', `"${p.name}" enviado para a nuvem`)
    refreshRemote()
  } catch (e) {
    if (e.code === 'conflict' && confirm(`${e.message}\n\nSobrescrever a versão da nuvem com a sua? (Cancelar mantém a da nuvem; use "Baixar" para trazê-la.)`)) push(p, true)
  }
}
async function pull(r) {
  if (props.projects.some((p) => p.id === r.id) && !confirm(`Substituir a cópia local de "${r.name}" pela versão da nuvem?`)) return
  await run('pull:' + r.id, () => mod.pullProject(r.id, r.owner)).catch(() => {})
  if (!syncError.value) { emit('changed'); emit('notify', `"${r.name}" baixado da nuvem`) }
}
const shareInput = reactive({})
async function share(p, r) {
  const list = (shareInput[p.id] ?? (r?.shared_with || []).join(', ')).split(/[,;\s]+/)
  const saved = await run('share:' + p.id, () => mod.shareProject(p.id, list)).catch(() => null)
  if (saved) { emit('notify', saved.length ? `Compartilhado com ${saved.length} pessoa(s)` : 'Compartilhamento removido'); refreshRemote() }
}
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

function onKey(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => { window.addEventListener('keydown', onKey); loadSync() })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); offAuth() })

const TABS = [
  { id: 'general', label: 'Geral', icon: 'settings' },
  { id: 'ai', label: 'Assistente IA', icon: 'sparkle' },
  { id: 'sync', label: 'Sincronização', icon: 'refresh' },
]
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal settings" style="width:760px">
      <div class="modal-head">
        <Icon name="settings" :size="16" /><h3>Configurações</h3>
        <button class="icon-btn" style="margin-left:auto" title="Fechar (Esc)" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav">
          <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id"><Icon :name="t.icon" :size="14" /> {{ t.label }}</button>
        </nav>

        <div class="settings-main">
          <!-- ===== Geral ===== -->
          <template v-if="tab === 'general'">
            <h4>Aparência</h4>
            <div class="theme-pick">
              <button v-for="(l, t) in { dark: 'Escuro', light: 'Claro', system: 'Sistema' }" :key="t" :class="{ on: theme === t }" @click="pickTheme(t)">
                <span class="theme-sw" :class="t"></span>{{ l }}
              </button>
            </div>

            <h4>Lembrete de backup</h4>
            <p class="muted hint">Os dados ficam só neste navegador. O app avisa quando um projeto passa deste prazo sem backup completo.</p>
            <div class="row" style="gap:8px">
              <select v-model.number="backupDays" style="width:auto" @change="saveBackup">
                <option :value="3">A cada 3 dias</option>
                <option :value="7">A cada 7 dias</option>
                <option :value="14">A cada 14 dias</option>
                <option :value="30">A cada 30 dias</option>
                <option :value="0">Nunca lembrar</option>
              </select>
            </div>
          </template>

          <!-- ===== Assistente IA ===== -->
          <template v-else-if="tab === 'ai'">
            <h4>Assistente com Claude</h4>
            <p class="muted hint">
              Com uma chave da API da Anthropic, o assistente lê os documentos do cofre e responde de verdade, e a revisão de tarefas passa a ser feita pelo Claude.
              Sem chave, ele funciona offline, apenas buscando trechos.
            </p>
            <div class="fld">
              <span class="k">Chave da API</span>
              <div class="row" style="gap:6px">
                <input v-model="llm.apiKey" :type="showKey ? 'text' : 'password'" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
                <button class="icon-btn" :title="showKey ? 'Ocultar' : 'Mostrar'" @click="showKey = !showKey"><Icon name="search" :size="14" /></button>
              </div>
            </div>
            <div class="fld" style="margin-top:10px">
              <span class="k">Modelo</span>
              <select v-model="llm.model"><option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option></select>
            </div>
            <div class="note-warn">
              <Icon name="alert" :size="13" />
              <span>A chave fica salva <b>somente neste navegador</b> e é enviada direto para a API da Anthropic. Os documentos usados como contexto também são enviados. Use uma chave própria, com limite de gastos, e não use em computador compartilhado.</span>
            </div>
            <div class="row" style="gap:8px; justify-content:flex-end; margin-top:12px">
              <button v-if="llm.apiKey" class="btn-ghost" @click="clearLlm">Remover chave</button>
              <button class="btn-primary" @click="saveLlm">Salvar</button>
            </div>
          </template>

          <!-- ===== Sincronização ===== -->
          <template v-else>
            <h4>Sincronização (opcional)</h4>
            <p class="muted hint">
              Compartilhe projetos entre pessoas e computadores usando um projeto <b>Supabase</b> seu. Rode
              <code>supabase/schema.sql</code> (no repositório) no SQL Editor do Supabase e informe abaixo a URL e a chave pública (<i>anon</i>).
            </p>
            <div class="fld-row">
              <div class="fld"><span class="k">URL do projeto</span><input v-model="sync.url" placeholder="https://xxxx.supabase.co" spellcheck="false" /></div>
              <div class="fld"><span class="k">Chave anon (pública)</span><input v-model="sync.anonKey" type="password" placeholder="eyJ..." autocomplete="off" /></div>
            </div>
            <label class="check"><input v-model="sync.auto" type="checkbox" /> Enviar automaticamente as mudanças dos projetos já sincronizados</label>
            <div class="row" style="justify-content:flex-end; margin-top:8px"><button class="btn" @click="saveSync">Salvar conexão</button></div>

            <p v-if="syncError" class="err" style="margin-top:10px">{{ syncError }}</p>

            <template v-if="configured">
              <div class="sync-box">
                <template v-if="!user">
                  <div class="k">Entrar</div>
                  <div class="row" style="gap:8px">
                    <input v-model="email" type="email" placeholder="seu@email.com" @keydown.enter="sendLink" />
                    <button class="btn-primary" :disabled="!email.includes('@') || syncBusy === 'login'" @click="sendLink">Enviar link</button>
                  </div>
                  <p v-if="linkSent" class="muted hint" style="margin-top:6px">Link enviado. Abra o e-mail neste navegador para entrar.</p>
                </template>
                <template v-else>
                  <div class="row" style="justify-content:space-between">
                    <span>Conectado como <b>{{ user.email }}</b></span>
                    <span class="row" style="gap:6px">
                      <button class="btn" :disabled="syncBusy === 'list'" @click="refreshRemote"><Icon name="refresh" :size="13" /> Atualizar</button>
                      <button class="btn-ghost" @click="logout">Sair</button>
                    </span>
                  </div>

                  <div class="sync-list">
                    <div v-for="row in rows.local" :key="row.p.id" class="sync-row">
                      <div class="sync-main">
                        <b>{{ row.p.name }}</b>
                        <span class="sync-st" :class="status(row).cls">{{ status(row).label }}</span>
                        <span v-if="row.r" class="muted sync-meta">v{{ row.r.version }} · {{ fmt(row.r.updated_at) }}{{ row.r.updated_by ? ' · ' + row.r.updated_by : '' }}</span>
                      </div>
                      <div class="row" style="gap:6px">
                        <button class="btn" :disabled="!!syncBusy" @click="push(row.p)"><Icon name="upload" :size="13" /> Enviar</button>
                        <button v-if="row.r" class="btn" :disabled="!!syncBusy" @click="pull(row.r)"><Icon name="download" :size="13" /> Baixar</button>
                      </div>
                      <div v-if="row.r && row.r.owner === user.id" class="sync-share">
                        <input :value="shareInput[row.p.id] ?? row.r.shared_with.join(', ')" placeholder="Compartilhar com: email1, email2"
                          @input="shareInput[row.p.id] = $event.target.value" @keydown.enter="share(row.p, row.r)" />
                        <button class="btn" :disabled="!!syncBusy" @click="share(row.p, row.r)">Compartilhar</button>
                      </div>
                    </div>
                    <div v-for="r in rows.onlyRemote" :key="r.owner + r.id" class="sync-row">
                      <div class="sync-main">
                        <b>{{ r.name }}</b>
                        <span class="sync-st">{{ r.owner === user.id ? 'Só na nuvem' : 'Compartilhado com você' }}</span>
                        <span class="muted sync-meta">v{{ r.version }} · {{ fmt(r.updated_at) }}</span>
                      </div>
                      <button class="btn-primary" :disabled="!!syncBusy" @click="pull(r)"><Icon name="download" :size="13" /> Baixar</button>
                    </div>
                    <div v-if="!rows.local.length && !rows.onlyRemote.length" class="muted">Nenhum projeto.</div>
                  </div>
                </template>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
