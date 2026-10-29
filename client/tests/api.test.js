import { describe, it, expect, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { api, diffVault } from '../src/api.js'
import { A, B, C, VAULT, zipOf } from './helpers.js'

let pid
const card = async (path) => (await api.kanban(pid)).cards.find((c) => c.path === path)
const column = async (status) => (await api.kanban(pid)).cards.filter((c) => c.status === status).map((c) => c.path)

beforeEach(async () => {
  pid = (await api.importZipProject('Login Portal', await zipOf(VAULT, 'cofre-new/'))).id
})

describe('importação', () => {
  it('desembrulha a pasta-raiz e conta as tarefas', async () => {
    const [p] = await api.projects()
    expect(p.name).toBe('Login Portal')
    expect(p.taskCount).toBe(4)
    expect((await api.read(pid, A)).content).toContain('Tela de login')
  })

  it('recusa .zip que não é um cofre', async () => {
    await expect(api.importZipProject('X', await zipOf({ 'src/app.md': '# app' }))).rejects.toThrow(/cofre válido/)
  })
})

describe('quadro', () => {
  it('posiciona na coluna e reordena', async () => {
    await api.moveCard(pid, A, 'backlog')
    await api.moveCard(pid, B, 'backlog')
    await api.moveCard(pid, C, 'backlog', A) // C antes de A
    expect(await column('backlog')).toEqual([C, A, B])
    await api.moveCard(pid, B, 'backlog', C) // B para o topo
    expect(await column('backlog')).toEqual([B, C, A])
  })

  it('tira do quadro e registra no histórico', async () => {
    await api.moveCard(pid, A, 'fazendo')
    await api.removeFromBoard(pid, A)
    expect((await card(A)).status).toBe(null)
    const { history } = await api.taskMeta(pid, A)
    expect(history.map((h) => [h.from, h.to])).toEqual([[null, 'fazendo'], ['fazendo', null]])
  })

  it('respeita o limite de WIP salvo', async () => {
    await api.setWip(pid, 'fazendo', 2)
    expect((await api.kanban(pid)).wip).toEqual({ fazendo: 2 })
    await api.setWip(pid, 'fazendo', '')
    expect((await api.kanban(pid)).wip).toEqual({})
  })
})

describe('campos, comentários e vínculos', () => {
  it('normaliza campos e registra cada mudança', async () => {
    await api.updateTask(pid, A, { priority: 'alta', assignee: ' Ana ', labels: ['ux', 'ux', ' '], points: '3', due: '2026-01-31' })
    const a = await card(A)
    expect([a.priority, a.assignee, a.labels, a.points, a.due]).toEqual(['alta', 'Ana', ['ux'], 3, '2026-01-31'])
    await api.updateTask(pid, A, { points: '', due: 'invalida' })
    expect([(await card(A)).points, (await card(A)).due]).toEqual([null, null])
    const fields = (await api.taskMeta(pid, A)).history.map((h) => h.field)
    expect(fields).toEqual(['priority', 'due', 'assignee', 'labels', 'points', 'due', 'points'])
  })

  it('adiciona e remove comentários', async () => {
    const c = await api.addComment(pid, A, '  revisar  ')
    expect(c.text).toBe('revisar')
    await expect(api.addComment(pid, A, '   ')).rejects.toThrow(/vazio/)
    await api.deleteComment(pid, A, c.id)
    expect((await api.taskMeta(pid, A)).comments).toEqual([])
  })

  it('vincula, impede duplicado/circular e remove dos dois lados', async () => {
    await api.addLink(pid, B, 'blocks', A)
    await expect(api.addLink(pid, A, 'blocked_by', B)).rejects.toThrow(/vinculadas/)
    await expect(api.addLink(pid, A, 'blocks', A)).rejects.toThrow(/ela mesma/)
    expect((await card(A)).blockedBy).toEqual([B])
    await api.removeLink(pid, A, B)
    expect((await card(A)).blockedBy).toEqual([])
  })

  it('edita em massa', async () => {
    await api.bulkUpdate(pid, [A, B], { priority: 'urgente', addLabel: 'mvp', status: 'a-fazer' })
    const [a, b] = [await card(A), await card(B)]
    expect([a.priority, b.priority, a.labels, b.status]).toEqual(['urgente', 'urgente', ['mvp'], 'a-fazer'])
  })
})

describe('sprints', () => {
  it('uma ativa por vez e leva as pendentes adiante ao encerrar', async () => {
    const s1 = await api.createSprint(pid, { start: '2026-10-01', end: '2026-10-14' })
    const s2 = await api.createSprint(pid, { name: 'S2', start: '2026-10-15', end: '2026-10-28' })
    expect(s1.name).toBe('Sprint 1')
    await expect(api.createSprint(pid, { start: '2026-10-10', end: '2026-10-01' })).rejects.toThrow(/fim/)
    await api.bulkUpdate(pid, [A, B], { sprint: s1.id })
    await api.moveCard(pid, A, 'feito')
    await api.startSprint(pid, s1.id)
    await expect(api.startSprint(pid, s2.id)).rejects.toThrow(/ativa/)
    const closed = await api.closeSprint(pid, s1.id, s2.id)
    expect(closed.result).toEqual({ done: 1, carried: 1 })
    expect([(await card(A)).sprint, (await card(B)).sprint]).toEqual([s1.id, s2.id])
  })
})

describe('backup, atualização do cofre e desfazer', () => {
  it('backup completo volta igual e registra a data', async () => {
    await api.moveCard(pid, A, 'fazendo')
    await api.addComment(pid, A, 'oi')
    const blob = await api.exportBackup(pid)
    expect((await api.projects())[0].lastBackupAt).toBeTruthy()
    const r = await api.importBackup(await blob.text(), 'Cópia')
    const a = (await api.kanban(r.id)).cards.find((c) => c.path === A)
    expect([a.status, a.commentCount, a.key]).toEqual(['fazendo', 1, (await card(A)).key])
    await expect(api.importBackup('{"x":1}')).rejects.toThrow(/backup do Cofre Hub/)
  })

  it('exporta o cofre em .zip', async () => {
    const zip = await JSZip.loadAsync(await (await api.exportZip(pid)).arrayBuffer())
    expect(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()).toEqual(Object.keys(VAULT).sort())
  })

  it('atualiza o cofre mantendo o trabalho e marcando o que mudou', async () => {
    await api.moveCard(pid, A, 'fazendo')
    await api.addComment(pid, A, 'mantém')
    const next = { ...VAULT, [A]: VAULT[A] + '\nnovo', 'Backlog Técnico/Login/Novo — Logout.md': '# Logout' }
    delete next[C]
    const preview = await api.previewVaultUpdate(pid, await zipOf(next))
    expect([preview.tasksAdded.length, preview.tasksChanged, preview.tasksRemoved]).toEqual([1, [A], [C]])
    await api.applyVaultUpdate(pid, await zipOf(next))
    const a = await card(A)
    expect([a.status, a.commentCount]).toEqual(['fazendo', 1])
    expect((await api.taskMeta(pid, A)).history.at(-1)).toMatchObject({ type: 'file', change: 'changed' })
    expect(await card(C)).toBeUndefined()
    expect((await api.kanban(pid)).cards).toHaveLength(4)
  })

  it('desfaz restaurando o retrato', async () => {
    const snap = await api.snapshot(pid, true)
    await api.moveCard(pid, A, 'feito')
    await api.remove(pid, B)
    await api.restore(pid, snap)
    expect((await card(A)).status).toBe(null)
    expect(await card(B)).toBeTruthy()
  })
})

describe('diffVault', () => {
  it('separa novos, alterados, removidos e tarefas', () => {
    const d = diffVault({ a: '1', b: '2', [A]: 'x' }, { a: '1', b: '3', c: '4', [A]: 'y' })
    expect([d.added, d.changed, d.removed, d.tasksChanged, d.unchanged]).toEqual([['c'], [A, 'b'].sort(), [], [A], 1])
  })
})
