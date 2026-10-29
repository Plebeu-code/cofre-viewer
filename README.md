# Cofre Hub

> Visualizador e gerenciador **100% front-end** de cofres de documentação de auditoria — estilo Jira, com Kanban, busca, insights e um assistente offline.

🔗 **Demo:** https://cofre-viewer.vercel.app

O Cofre Hub permite **gerenciar múltiplos projetos** de documentação no padrão do cofre (Backlog Técnico, Transversais, Matrizes, Diagnóstico, Inventário). Você importa um cofre por **upload de `.zip`** e passa a visualizar, editar, organizar em Kanban e planejar tarefas com ajuda de um assistente que lê a documentação do projeto.

Não há backend: toda a lógica roda no navegador e **nenhum dado sai da sua máquina**. O build é estático e pode ser hospedado em qualquer lugar (Vercel, GitHub Pages, Netlify, S3…).

---

## ✨ Funcionalidades

| Área | O que faz |
|---|---|
| **Projetos** | Importa cofres por `.zip`, abre e remove projetos. Na sidebar, cada projeto é uma pasta com suas **Funcionalidades** e **Documentos**. |
| **Backup** | Exporta o cofre (`.zip`, com as edições feitas no app) e um **backup completo** (`.cofre.json`: quadro, campos, comentários e histórico), restaurável pela importação. |
| **Kanban único por projeto** | Tarefas entram no quadro arrastando da sidebar (listra amarela = fora do quadro, verde = no quadro). Ordenação manual, **limite de WIP** por coluna e **raias** por funcionalidade, prioridade ou responsável. |
| **Campos estilo Jira** | Chave da tarefa (ex.: `LP-12`), prioridade, responsável, prazo (com aviso de atraso), etiquetas, estimativa em pontos, sprint, **vínculos** (bloqueia / é bloqueada por / relacionada), **comentários** e **histórico de atividade**. Ficam fora dos `.md`, sem alterar o cofre. |
| **Visões** | **Kanban**, **Tabela** (com **edição em massa**), **Lista** e **Roadmap** (linha do tempo com sprints e prazos). Filtros rápidos: atrasadas, alta prioridade, sem responsável, por responsável, etiqueta e sprint. |
| **Sprints** | Criar, iniciar e encerrar sprints; ao encerrar, o que não terminou vai para a próxima. **Burndown** no Insights. |
| **Relatórios** | Fluxo cumulativo, tempo de ciclo e velocidade por sprint; exportação de tarefas e documentos em **CSV**. |
| **Desfazer** | Mover, tirar do quadro, editar em massa e excluir oferecem **Desfazer** (ou `Ctrl+Z`). |
| **Teclado e acessibilidade** | Setas navegam entre cards, `Shift`+setas movem o card, `Enter` abre. Atalhos: `c` criar, `/` buscar, `1`–`4` visões, `g t/d/i/p` navegar, `s` sprints, `,` configurações, `?` ajuda. |
| **Aparência** | Tema escuro, claro ou do sistema; layout adaptado para celular. |
| **Criar tarefa com assistente** | Antes de criar o arquivo, o assistente analisa o rascunho e aponta conflitos (🔴), riscos (🟡), possíveis duplicações, dependências citadas e sugestões de melhoria. |
| **Assistente (chat lateral)** | Responde perguntas sobre a documentação buscando nos `.md` e citando as fontes (clicáveis). |
| **Documentos** | Navegação por breadcrumb, render de Markdown, editar / criar / excluir arquivos. No detalhe da tarefa há um botão para **copiar a tarefa inteira**. |
| **Insights** | Filtro por **todos os projetos ou projetos específicos**: progresso, cobertura do quadro, pontos de atenção, funcionalidades, camadas, comparativo entre projetos, inventário, documentos por severidade e burndown da sprint. |
| **Busca** | Full-text dentro do projeto. |

## 🧱 Stack

- **[Vite 6](https://vitejs.dev/) + [Vue 3](https://vuejs.org/)** — UI no estilo Atlassian/Jira
- **[JSZip](https://stuk.github.io/jszip/)** — leitura do `.zip` do cofre no navegador
- **[idb-keyval](https://github.com/jakearchibald/idb-keyval)** (IndexedDB) — persistência local dos projetos e do Kanban
- **[markdown-it](https://github.com/markdown-it/markdown-it)** — renderização dos documentos

## 🚀 Como rodar

Requisitos: **Node.js 18+**.

```bash
git clone https://github.com/<seu-usuario>/cofre-viewer.git
cd cofre-viewer
npm run install:all     # instala as dependências do client
npm run dev             # http://localhost:5173
```

### Build de produção

```bash
npm run build           # instala deps e gera client/dist
npm run preview         # (opcional) pré-visualiza o build
```

Basta servir o conteúdo de `client/dist/` em qualquer host estático. O `base` do Vite é relativo (`./`), então funciona também em subpastas.

### Deploy na Vercel

O projeto já está pronto para a Vercel:

- **Root Directory:** `client`
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

## 📦 Primeiro uso

Ao abrir pela primeira vez **não há nenhum projeto** e a navegação fica bloqueada — só a tela de importação está disponível.

1. Compacte a pasta do cofre num `.zip` (contendo `Backlog Técnico/`, `Transversais/` e os documentos globais).
2. Em **Início**, clique em **Importar cofre (.zip)**, dê um nome e selecione (ou arraste) o arquivo.
3. O cofre é lido, validado e salvo no navegador; a navegação é liberada.

Detalhes da importação:

- Apenas arquivos `.md` são considerados.
- Pastas como `.obsidian`, `.git`, `node_modules` e `__MACOSX` são ignoradas.
- Um `.zip` com uma pasta-raiz única no topo (ex.: `cofre-new/...`) é "desembrulhado" automaticamente.
- A validação de estrutura é tolerante a acentos (aceita zips gravados com encodings diferentes).

## 🤖 Assistente (offline ou com Claude)

Sem configuração, o assistente roda **offline**: indexa os `.md`, ranqueia por relevância e cruza o rascunho da tarefa com conflitos, riscos e dependências já existentes.

Em **Configurações › Assistente IA** você pode informar uma chave da API da Anthropic. A partir daí o chat responde com o **Claude** (Opus 5.5 por padrão), citando os documentos usados, e a revisão de tarefas passa a ser feita pelo modelo. Como não há backend, a chamada sai **direto do navegador**: a chave fica salva só nele e os documentos usados como contexto são enviados à Anthropic. Use uma chave própria, com limite de gastos. O código está em [`client/src/browser/llm.js`](client/src/browser/llm.js).

## 🔄 Atualizar o cofre

Quando o cofre real ganhar uma versão nova, use **Atualizar cofre** (⬆ no card do projeto) com o novo `.zip`. Uma prévia mostra o que foi adicionado, alterado e removido; ao aplicar, **quadro, campos, comentários e histórico são preservados** e as tarefas alteradas ganham uma entrada no histórico.

## ☁️ Sincronização (opcional)

Por padrão nada sai do navegador. Para compartilhar projetos entre pessoas e máquinas:

1. Crie um projeto no [Supabase](https://supabase.com) e rode [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor (tabela + políticas de acesso).
2. Em **Configurações › Sincronização**, informe a URL e a chave pública (*anon*) e entre com seu e-mail (link mágico).
3. Envie, baixe e compartilhe projetos por e-mail. Conflitos são detectados por versão; o envio automático é opcional.

## 🔒 Persistência e privacidade

Os cofres importados, o quadro e os campos das tarefas ficam **apenas neste navegador** (IndexedDB + `localStorage`). Limpar os dados do site apaga os projetos — **faça backups** pelo botão 🗄 de cada projeto (o app lembra quando passa do prazo). Só saem do navegador os dados que você mandar explicitamente: documentos enviados ao Claude, se configurado, e projetos sincronizados com o seu Supabase.

O app pode ser **instalado** (PWA) e abre offline.

## 🗂️ Estrutura

```
cofre-viewer/
├── package.json             # scripts de conveniência (delegam para client/)
└── client/
    ├── index.html
    ├── vite.config.js       # base relativo './'
    └── src/
        ├── main.js
        ├── App.vue          # shell: rail + sidebar + header + abas
        ├── api.js           # "backend no navegador" (mesma interface de uma API)
        ├── constants.js     # colunas, camadas, severidades e helpers visuais
        ├── styles.css
        ├── browser/
        │   ├── store.js      # persistência IndexedDB (projetos, arquivos, kanban)
        │   ├── importZip.js  # leitura/validação do .zip
        │   ├── vault.js      # árvore e caminhos do cofre
        │   ├── kanban.js     # montagem do board e cards
        │   ├── stats.js      # agregações (IDs, severidade, inventário)
        │   └── assistant.js  # assistente heurístico
        └── components/
            ├── ProjectsView.vue   ├── KanbanBoard.vue
            ├── TaskTable.vue      ├── TaskList.vue
            ├── TaskDetail.vue     ├── CreateTaskModal.vue
            ├── ChatPanel.vue      ├── FileBrowser.vue
            ├── Dashboard.vue      └── Icon.vue
```

## 📜 Scripts

| Comando | Descrição |
|---|---|
| `npm run install:all` | Instala as dependências de `client/` |
| `npm run dev` | Servidor de desenvolvimento (porta 5173) |
| `npm run build` | Instala dependências e gera o build estático em `client/dist` |
| `npm run preview` | Pré-visualiza o build de produção |
| `npm test` | Roda os testes automatizados (Vitest) |
