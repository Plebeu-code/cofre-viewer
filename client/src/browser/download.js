// Downloads gerados no navegador (backup, .zip do cofre, CSV).

import { COLUMN_LABEL, PRIORITIES, LAYERS } from '../constants.js'

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const stamp = () => new Date().toISOString().slice(0, 10)
export const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'cofre'

/** CSV com separador ";" e BOM, para abrir direto no Excel em pt-BR. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(';'))]
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

/** Colunas padrao para exportar tarefas (Tabela e Insights). */
export function taskColumns({ sprints = [], withProject = false } = {}) {
  const sprintName = (id) => sprints.find((s) => s.id === id)?.name || ''
  return [
    ...(withProject ? [{ label: 'Projeto', value: (c) => c.pname }] : []),
    { label: 'Chave', value: (c) => c.key },
    { label: 'Tarefa', value: (c) => c.title },
    { label: 'Tipo', value: (c) => c.kind },
    { label: 'Funcionalidade', value: (c) => c.feature },
    { label: 'Camada', value: (c) => LAYERS[c.layer] },
    { label: 'Status', value: (c) => (c.status ? COLUMN_LABEL[c.status] : 'Fora do quadro') },
    { label: 'Prioridade', value: (c) => PRIORITIES[c.priority]?.label || '' },
    { label: 'Responsável', value: (c) => c.assignee },
    { label: 'Prazo', value: (c) => c.due || '' },
    { label: 'Pontos', value: (c) => c.points ?? '' },
    { label: 'Sprint', value: (c) => sprintName(c.sprint) },
    { label: 'Etiquetas', value: (c) => c.labels },
    { label: 'Críticos', value: (c) => c.red },
    { label: 'Riscos', value: (c) => c.yellow },
    { label: 'Melhorias', value: (c) => c.green },
    { label: 'Critérios concluídos', value: (c) => (c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : '') },
    { label: 'Bloqueada', value: (c) => (c.blocked ? 'sim' : '') },
    { label: 'Concluída em', value: (c) => (c.doneAt ? c.doneAt.slice(0, 10) : '') },
    { label: 'Arquivo', value: (c) => c.path },
  ]
}
