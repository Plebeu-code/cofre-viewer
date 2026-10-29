import JSZip from 'jszip'

export const A = 'Backlog Técnico/Login/Formulário e Interface — Tela de login.md'
export const B = 'Backlog Técnico/Login/API e Regras de Negócio — Autenticação.md'
export const C = 'Backlog Técnico/Cadastro/API e Regras de Negócio — Validar CPF.md'
export const T = 'Transversais/Matriz de riscos.md'

export const VAULT = {
  [A]: '# FRONT-1 Tela de login\n\n**Descrição:** Formulário de login.\n\n🟡 risco de bloqueio\n\nDepende de BACK-2.\n\n- [ ] campos\n- [x] validação',
  [B]: '# BACK-2 Autenticação\n\n**Descrição:** Endpoint de token.\n\n🔴 conflito com sessão',
  [C]: '# BACK-3 CPF\n\nValidar CPF.',
  [T]: '# Matriz\n\n| a | b |',
}

/** .zip de um cofre (opcionalmente dentro de uma pasta-raiz, como no Windows). */
export async function zipOf(files, root = '') {
  const zip = new JSZip()
  for (const [p, c] of Object.entries(files)) zip.file(root + p, c)
  return zip.generateAsync({ type: 'uint8array' })
}
