// Assistente heuristico no navegador (sem LLM). Porta server/assistant.js.
// Opera sobre o mapa { relPath -> conteudo } do cofre.

import { listMarkdownFiles } from './vault.js'

// o modo com IA (Claude) fica em ./llm.js e e ativado nas Configuracoes
export const HAS_LLM = false

function indexVault(files) {
  return listMarkdownFiles(files).map((rel) => {
    const content = files[rel] || ''
    return {
      path: rel,
      name: rel.split('/').pop().replace(/\.md$/, ''),
      feature: rel.split('/').slice(0, -1).pop() || '',
      content,
      lower: content.toLowerCase(),
    }
  })
}

const STOPWORDS = new Set(['de', 'da', 'do', 'a', 'o', 'e', 'em', 'para', 'por', 'com', 'que', 'os', 'as', 'um', 'uma', 'no', 'na', 'dos', 'das', 'ao', 'se', 'sua', 'seu'])

function keywords(text) {
  return [...new Set(
    (text || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )]
}

function rank(docs, text, limit = 5) {
  const kws = keywords(text)
  if (!kws.length) return []
  return docs
    .map((d) => {
      let score = 0
      for (const kw of kws) {
        const occ = d.lower.split(kw).length - 1
        if (occ) score += occ
        if (d.name.toLowerCase().includes(kw)) score += 5
        if (d.feature.toLowerCase().includes(kw)) score += 4
      }
      return { doc: d, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Documentos mais relevantes para um texto (usado como contexto pelo modo com IA). */
export function retrieve(files, text, limit = 8) {
  return rank(indexVault(files), text, limit).map(({ doc }) => doc)
}

function snippet(content, kws, len = 220) {
  const lines = content.split(/\r?\n/)
  const hit = lines.find((l) => kws.some((k) => l.toLowerCase().includes(k)))
  const base = (hit || lines.find((l) => l.trim()) || '').trim()
  return base.slice(0, len)
}

export function answer(files, question) {
  const docs = indexVault(files)
  const kws = keywords(question)
  const ranked = rank(docs, question, 5)

  if (!ranked.length) {
    return {
      mode: 'heuristic',
      answer: 'Não encontrei nada diretamente relacionado na documentação deste projeto. Tente termos mais específicos (ex.: nome da funcionalidade, "ability", "token", "LGPD").',
      sources: [],
    }
  }

  const sources = ranked.map(({ doc }) => ({ path: doc.path, feature: doc.feature, snippet: snippet(doc.content, kws) }))
  const topFeatures = [...new Set(ranked.map((r) => r.doc.feature))].slice(0, 4)
  const text =
    `Encontrei ${ranked.length} documento(s) relevante(s) sobre isso, principalmente em: ` +
    `${topFeatures.join(', ')}. Veja os trechos abaixo e abra os documentos citados para o detalhe completo.`

  return { mode: 'heuristic', answer: text, sources }
}

export function analyzeDraft(files, draft) {
  const { title = '', description = '', feature = '', layer = '' } = draft || {}
  const docs = indexVault(files)
  const text = `${title} ${description} ${feature}`
  const kws = keywords(text)
  const ranked = rank(docs, text, 6)

  const related = ranked.map(({ doc }) => ({ path: doc.path, feature: doc.feature, snippet: snippet(doc.content, kws) }))
  const findings = []

  for (const { doc } of ranked) {
    if (doc.content.includes('🔴')) {
      findings.push({ type: 'conflito', severity: 'red', doc: doc.path, message: `O documento "${doc.name}" já registra um conflito crítico (🔴) relacionado — verifique se a nova tarefa não colide ou se deveria referenciá-lo.` })
    }
    if (doc.content.includes('🟡')) {
      findings.push({ type: 'risco', severity: 'yellow', doc: doc.path, message: `"${doc.name}" tem risco(s) (🟡) na mesma área — avalie o impacto antes de implementar.` })
    }
  }

  const dup = ranked.find(({ doc }) => title && doc.name.toLowerCase().includes(title.toLowerCase().slice(0, 12)))
  if (dup) {
    findings.push({ type: 'duplicacao', severity: 'yellow', doc: dup.doc.path, message: `Pode haver sobreposição com "${dup.doc.name}". Confirme se não é uma tarefa duplicada.` })
  }

  const idsCitados = (description.match(/\b(FRONT|BACK|INT|CONF|RISK)-[A-Z]*-?\d+\b/g) || [])
  if (idsCitados.length) {
    findings.push({ type: 'dependencia', severity: 'info', message: `A tarefa cita ${idsCitados.join(', ')} — registre essas dependências explicitamente e verifique o status delas.` })
  }

  const melhorias = []
  if (description.trim().length < 60) melhorias.push('A descrição está curta — detalhe contexto, comportamento esperado e critérios de aceitação.')
  if (!/crit[ée]rio/i.test(description)) melhorias.push('Inclua critérios de aceitação verificáveis.')
  if (layer === 'front' && !/valida|campo|formul/i.test(description)) melhorias.push('Tarefa de front: descreva campos, validações e estados da tela.')
  if (layer === 'back' && !/endpoint|rota|ability|contrato/i.test(description)) melhorias.push('Tarefa de back: descreva endpoints, abilities e contrato de request/response.')
  if (!feature) melhorias.push('Associe a tarefa a uma funcionalidade/pasta do projeto.')

  const resumo = findings.length
    ? `Encontrei ${findings.length} ponto(s) de atenção e ${related.length} documento(s) relacionado(s) antes de criar esta tarefa.`
    : `Nenhum conflito óbvio encontrado. ${related.length} documento(s) relacionado(s) para referência.`

  return { mode: 'heuristic', resumo, findings, melhorias, related }
}
