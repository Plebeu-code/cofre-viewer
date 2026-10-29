import { describe, it, expect } from 'vitest'
import { buildBoard, compareCards } from '../src/browser/kanban.js'
import { A, B, C, T, VAULT } from './helpers.js'

describe('buildBoard', () => {
  it('nenhuma tarefa entra no quadro sozinha', () => {
    const { board } = buildBoard(VAULT, {}, {}, 'LP')
    expect(board.cards).toHaveLength(4)
    expect(board.cards.every((c) => c.status === null)).toBe(true)
    expect(board.columns.every((col) => col.cards.length === 0)).toBe(true)
  })

  it('gera chaves estáveis em ordem de caminho e só uma vez', () => {
    const first = buildBoard(VAULT, {}, {}, 'LP')
    const keys = Object.fromEntries(first.board.cards.map((c) => [c.path, c.key]))
    expect(keys[C]).toBe('LP-1') // Cadastro < Login
    expect(first.metaChanged).toBe(true)
    const again = buildBoard(VAULT, {}, first.taskMeta, 'XX')
    expect(again.metaChanged).toBe(false)
    expect(again.board.cards.find((c) => c.path === C).key).toBe('LP-1')
  })

  it('limpa status inválidos e de arquivos que sumiram', () => {
    const { statusMap, changed } = buildBoard(VAULT, { [A]: 'fazendo', [B]: 'xyz', 'sumiu.md': 'feito' }, {}, 'LP')
    expect(statusMap).toEqual({ [A]: 'fazendo' })
    expect(changed).toBe(true)
  })

  it('extrai severidade, critérios e IDs definidos/citados', () => {
    const a = buildBoard(VAULT, {}, {}, 'LP').board.cards.find((c) => c.path === A)
    expect(a.severity).toBe('yellow')
    expect([a.checkDone, a.checkTotal]).toEqual([1, 2])
    expect(a.defines).toEqual(['FRONT-1'])
    expect(a.ids).toContain('BACK-2')
    expect(a.layer).toBe('front')
  })

  it('calcula bloqueio a partir dos vínculos', () => {
    const meta = { tasks: { [B]: { links: [{ type: 'blocks', to: A }] } } }
    let cards = buildBoard(VAULT, { [A]: 'a-fazer', [B]: 'fazendo' }, meta, 'LP').board.cards
    const a = cards.find((c) => c.path === A)
    expect(a.blocked).toBe(true)
    expect(a.blockedBy).toEqual([B])
    cards = buildBoard(VAULT, { [A]: 'a-fazer', [B]: 'feito' }, meta, 'LP').board.cards
    expect(cards.find((c) => c.path === A).blocked).toBe(false)
  })

  it('ordena por posição manual e depois por pasta e nome', () => {
    const list = [
      { rank: null, feature: 'b', fileName: 'x' },
      { rank: 2000, feature: 'z', fileName: 'z' },
      { rank: null, feature: 'a', fileName: 'y' },
      { rank: 1000, feature: 'z', fileName: 'z' },
    ].sort(compareCards)
    expect(list.map((c) => c.rank ?? c.feature)).toEqual([1000, 2000, 'a', 'b'])
  })

  it('ignora README e templates', () => {
    const files = { ...VAULT, 'Backlog Técnico/README.md': '# r', 'Backlog Técnico/_template.md': '# t' }
    expect(buildBoard(files, {}, {}, 'LP').board.cards).toHaveLength(4)
    expect(buildBoard(VAULT, {}, {}, 'LP').board.cards.some((c) => c.path === T)).toBe(true)
  })
})
