<script setup>
import { ref, computed, watch } from 'vue'
import { api } from '../api.js'
import { COLUMNS, SEV, prettyFolder } from '../constants.js'

const props = defineProps({
  projectId: { type: String, required: true },
  cards: { type: Array, default: () => [] },
})
const emit = defineEmits(['open'])

const stats = ref(null)
const error = ref('')

async function load() {
  error.value = ''
  try { stats.value = await api.stats(props.projectId) } catch (e) { error.value = e.message }
}
watch(() => props.projectId, load, { immediate: true })

const byColumn = computed(() => {
  const total = props.cards.length || 1
  return COLUMNS.map((c) => {
    const n = props.cards.filter((x) => x.status === c.id).length
    return { ...c, n, pct: (n / total) * 100 }
  })
})

const hotFeatures = computed(() => {
  const map = new Map()
  for (const c of props.cards) {
    const f = map.get(c.feature) || { name: c.feature, red: 0, yellow: 0, tasks: 0 }
    f.red += c.red || 0
    f.yellow += c.yellow || 0
    f.tasks++
    map.set(c.feature, f)
  }
  return [...map.values()].filter((f) => f.red || f.yellow).sort((a, b) => b.red - a.red || b.yellow - a.yellow).slice(0, 10)
})
const maxHot = computed(() => Math.max(1, ...hotFeatures.value.map((f) => f.red + f.yellow)))

const criteria = computed(() => {
  let t = 0, d = 0
  for (const c of props.cards) { t += c.checkTotal || 0; d += c.checkDone || 0 }
  return { t, d, pct: t ? Math.round((d / t) * 100) : 0 }
})
</script>

<template>
  <div>
    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="!stats" class="empty">Carregando indicadores…</div>
    <template v-else>
      <div class="metrics">
        <div class="metric"><div class="n" :style="{ color: SEV.red.color }">{{ stats.totals.CONF }}</div><div class="l">Conflitos críticos (CONF)</div></div>
        <div class="metric"><div class="n" :style="{ color: SEV.yellow.color }">{{ stats.totals.RISK }}</div><div class="l">Riscos (RISK)</div></div>
        <div class="metric"><div class="n" :style="{ color: SEV.green.color }">{{ stats.totals.MEL }}</div><div class="l">Melhorias (MEL)</div></div>
        <div class="metric"><div class="n">{{ cards.length }}</div><div class="l">Arquivos de tarefa</div></div>
        <div class="metric"><div class="n">{{ stats.totals.FRONT }}<span class="muted" style="font-size:16px"> / </span>{{ stats.totals.BACK }}</div><div class="l">Tarefas Front / Back</div></div>
        <div class="metric"><div class="n">{{ criteria.pct }}%</div><div class="l">Critérios concluídos ({{ criteria.d }}/{{ criteria.t }})</div></div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px">
        <div class="panel">
          <h3>Andamento</h3>
          <div style="display:flex; height:10px; border-radius:6px; overflow:hidden; background:#3a3b41; margin-bottom:14px">
            <div v-for="c in byColumn" :key="c.id" :style="{ width: c.pct + '%', background: c.color }"></div>
          </div>
          <div v-for="c in byColumn" :key="c.id" class="row" style="justify-content:space-between; padding:5px 0">
            <span class="row"><span class="sev-dot" :style="{ background: c.color }"></span>{{ c.label }}</span>
            <span class="muted">{{ c.n }}</span>
          </div>
        </div>

        <div class="panel">
          <h3>Funcionalidades com mais apontamentos</h3>
          <div v-for="f in hotFeatures" :key="f.name" style="padding:5px 0">
            <div class="row" style="justify-content:space-between; font-size:12.5px">
              <span>{{ prettyFolder(f.name) }}</span>
              <span class="muted">{{ f.red }} críticos · {{ f.yellow }} riscos</span>
            </div>
            <div style="display:flex; height:6px; margin-top:5px; border-radius:4px; overflow:hidden; background:#3a3b41">
              <div :style="{ width: (f.red / maxHot) * 100 + '%', background: SEV.red.color }"></div>
              <div :style="{ width: (f.yellow / maxHot) * 100 + '%', background: SEV.yellow.color }"></div>
            </div>
          </div>
          <div v-if="!hotFeatures.length" class="muted">Nenhum apontamento.</div>
        </div>
      </div>

      <div class="panel">
        <h3>Documentos por severidade</h3>
        <table class="table">
          <thead><tr><th>Documento</th><th style="width:90px">Críticos</th><th style="width:90px">Riscos</th><th style="width:100px">Melhorias</th></tr></thead>
          <tbody>
            <tr v-for="f in stats.severityByFile.slice(0, 40)" :key="f.path" class="row" @click="emit('open', f.path)">
              <td><div class="t">{{ f.path.split('/').pop().replace(/\.md$/, '') }}</div><div class="muted" style="font-size:11.5px">{{ f.path.split('/').slice(0, -1).join(' / ') }}</div></td>
              <td :style="{ color: f.red ? SEV.red.color : '' }">{{ f.red || '—' }}</td>
              <td :style="{ color: f.yellow ? SEV.yellow.color : '' }">{{ f.yellow || '—' }}</td>
              <td :style="{ color: f.green ? SEV.green.color : '' }">{{ f.green || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
