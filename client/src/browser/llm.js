// Assistente com Claude (opcional). Sem backend, a chamada sai direto do
// navegador com a chave que o usuario informa nas Configuracoes; a chave fica
// so neste navegador (localStorage). Sem chave, o app usa o modo heuristico.

import Anthropic from '@anthropic-ai/sdk'
import { retrieve } from './assistant.js'

const KEY = 'cofre.llm'
export const DEFAULT_MODEL = 'claude-opus-5-5'
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (mais rápido)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (mais barato)' },
]
// fallback no servidor quando o modelo recusa (so os modelos que aceitam o modo "default")
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

export function getLlmConfig() {
  try { return { apiKey: '', model: DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { apiKey: '', model: DEFAULT_MODEL } }
}
export function setLlmConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify({ apiKey: (cfg.apiKey || '').trim(), model: cfg.model || DEFAULT_MODEL }))
}
export const hasLlm = () => Boolean(getLlmConfig().apiKey)

function client() {
  const { apiKey } = getLlmConfig()
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

function baseParams(model) {
  return FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}
}

/** Traduz erros do SDK para mensagens uteis ao usuario. */
export function llmErrorMessage(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Chave de API inválida. Confira em Configurações.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'A chave não tem permissão para este modelo.'
  if (e instanceof Anthropic.RateLimitError) return 'Limite de uso atingido. Tente novamente em instantes.'
  if (e instanceof Anthropic.BadRequestError) return 'Requisição recusada pela API: ' + e.message
  if (e instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API da Anthropic.'
  if (e instanceof Anthropic.APIError) return `Erro da API (${e.status}): ${e.message}`
  return e?.message || String(e)
}

// documentos do cofre entram como contexto, numerados para citacao [n]
function documentsBlock(docs) {
  return docs.map((d, i) => `<document index="${i + 1}" path="${d.path}">\n${d.content}\n</document>`).join('\n\n')
}

const CHAT_SYSTEM = `Você é o assistente do Cofre Hub, uma ferramenta para equipes que trabalham com cofres de documentação de auditoria (backlog técnico, conflitos 🔴, riscos 🟡, melhorias 🟢, matrizes e inventário).
Responda em português do Brasil, de forma direta, usando apenas os documentos fornecidos. Quando afirmar algo que vem de um documento, cite-o com o número entre colchetes, por exemplo [2]. Se os documentos não trazem a resposta, diga isso claramente em vez de supor.`

/**
 * Responde uma pergunta sobre o cofre com streaming.
 * history: [{ me: boolean, text }] das mensagens anteriores do chat.
 */
export async function llmAnswer(files, question, history = [], onText = () => {}) {
  const { model } = getLlmConfig()
  const docs = retrieve(files, [question, ...history.filter((m) => m.me).slice(-2).map((m) => m.text)].join(' '), 8)
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.me ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: `${docs.length ? documentsBlock(docs) : '(nenhum documento relevante encontrado)'}\n\nPergunta: ${question}` },
  ]
  // a conversa precisa comecar pelo usuario
  while (messages.length && messages[0].role !== 'user') messages.shift()

  const stream = client().beta.messages.stream({
    model, max_tokens: 64000, system: CHAT_SYSTEM, messages,
    output_config: { effort: 'medium' },
    ...baseParams(model),
  })
  stream.on('text', (_, snapshot) => onText(snapshot))
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'refusal') return { mode: 'llm', answer: 'O modelo recusou responder a esta pergunta.', sources: [] }

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const sources = docs
    .map((d, i) => ({ path: d.path, feature: d.feature, snippet: '', n: i + 1 }))
    .filter((s) => cited.has(s.n))
  return { mode: 'llm', answer: text, sources }
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'findings', 'melhorias'],
  properties: {
    resumo: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'message', 'doc'],
        properties: {
          severity: { type: 'string', enum: ['red', 'yellow', 'info'] },
          message: { type: 'string' },
          doc: { type: 'string', description: 'caminho (path) do documento relacionado, ou string vazia' },
        },
      },
    },
    melhorias: { type: 'array', items: { type: 'string' } },
  },
}

/** Revisa o rascunho de uma tarefa contra a documentacao (conflitos, riscos, duplicacao). */
export async function llmReview(files, draft) {
  const { model } = getLlmConfig()
  const { title = '', description = '', feature = '', layer = '' } = draft || {}
  const docs = retrieve(files, `${title} ${description} ${feature}`, 8)
  const response = await client().beta.messages.create({
    model, max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
    system: `Você revisa tarefas de um backlog técnico de auditoria antes de serem criadas. Compare o rascunho com os documentos do cofre e aponte, em português do Brasil:
- conflitos com decisões ou conflitos críticos já registrados (severity "red");
- riscos e possíveis duplicações com tarefas existentes (severity "yellow");
- dependências citadas que precisam ser registradas (severity "info").
Em "doc", use exatamente o path do documento relacionado. Em "melhorias", sugira como deixar a tarefa mais clara e verificável (critérios de aceitação, validações, contrato de API). Seja específico; não invente fatos que os documentos não sustentam.`,
    messages: [{
      role: 'user',
      content: `${documentsBlock(docs)}\n\n<rascunho>\nTítulo: ${title}\nFuncionalidade: ${feature}\nCamada: ${layer}\n\n${description}\n</rascunho>`,
    }],
    ...baseParams(model),
  })
  if (response.stop_reason === 'refusal') throw new Error('O modelo recusou revisar esta tarefa.')
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const out = JSON.parse(text)
  const valid = new Set(docs.map((d) => d.path))
  out.findings = out.findings.map((f) => ({ ...f, doc: valid.has(f.doc) ? f.doc : '' }))
  return { mode: 'llm', ...out, related: docs.map((d) => ({ path: d.path, feature: d.feature, snippet: '' })) }
}
