import { describe, it, expect } from 'vitest'
import { toCsv, taskColumns, safeName } from '../src/browser/download.js'

describe('CSV', () => {
  it('usa ";" e BOM, e escapa aspas, quebras e o separador', async () => {
    const blob = toCsv([{ a: 'x;y', b: 'diz "oi"', c: ['p', 'q'] }], [
      { label: 'A', value: (r) => r.a }, { label: 'B', value: (r) => r.b }, { label: 'C', value: (r) => r.c },
    ])
    // Blob.text() descarta o BOM ao decodificar; o Excel le os bytes
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await blob.text()).toBe('A;B;C\r\n"x;y";"diz ""oi""";p, q')
  })

  it('colunas de tarefa traduzem status e prioridade', () => {
    const cols = taskColumns({ sprints: [{ id: 's1', name: 'Sprint 1' }] })
    const row = Object.fromEntries(cols.map((c) => [c.label, c.value({ status: null, priority: 'alta', sprint: 's1', labels: [], layer: 'front' })]))
    expect([row.Status, row.Prioridade, row.Sprint, row.Camada]).toEqual(['Fora do quadro', 'Alta', 'Sprint 1', 'Front'])
  })

  it('gera nome de arquivo seguro', () => {
    expect(safeName('SOPE / HGE: v2?')).toBe('SOPE - HGE- v2-')
    expect(safeName('')).toBe('cofre')
  })
})
