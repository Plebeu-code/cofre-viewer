# Cofre Hub

> Visualizador e gerenciador **100% front-end** de cofres de documentação de auditoria — estilo Jira, com Kanban, busca, insights e um assistente offline.

🔗 **Demo:** https://cofre-viewer.vercel.app

O Cofre Hub permite **gerenciar múltiplos projetos** de documentação no padrão do cofre (Backlog Técnico, Transversais, Matrizes, Diagnóstico, Inventário). Você importa um cofre por **upload de `.zip`** e passa a visualizar, editar, organizar em Kanban e planejar tarefas com ajuda de um assistente que lê a documentação do projeto.

Não há backend: toda a lógica roda no navegador e **nenhum dado sai da sua máquina**. O build é estático e pode ser hospedado em qualquer lugar (Vercel, GitHub Pages, Netlify, S3…).

---

## ✨ Funcionalidades

| Área | O que faz |
|---|---|
| **Projetos** | Importa cofres por `.zip`, abre e remove projetos; seletor global na sidebar. Vários cofres convivem no mesmo navegador. |
| **Tarefas** | Três visões: **Kanban** (Backlog / A fazer / Fazendo / Feito, com drag-and-drop), **Tabela** e **Lista**. Filtros por texto, camada (Front/Back/Geral), severidade e feature; favoritos. |
| **Criar tarefa com assistente** | Antes de criar o arquivo, o assistente analisa o rascunho e aponta conflitos (🔴), riscos (🟡), possíveis duplicações, dependências citadas e sugestões de melhoria. |
| **Assistente (chat lateral)** | Responde perguntas sobre a documentação buscando nos `.md` e citando as fontes (clicáveis). |
| **Documentos** | Navegação por breadcrumb, render de Markdown, editar / criar / excluir arquivos. No detalhe da tarefa há um botão para **copiar a tarefa inteira**. |
| **Insights** | Contagens de CONF / RISK / MEL / FRONT / BACK / INT, status do inventário e severidade por documento. |
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

## 🤖 Assistente (heurístico e plugável)

O assistente roda **offline**, com um motor heurístico que indexa os `.md`, ranqueia por relevância e cruza o rascunho da tarefa com conflitos, riscos e dependências já existentes.

Para plugar um **LLM real**, o ponto de integração está isolado em [`client/src/browser/assistant.js`](client/src/browser/assistant.js) (`HAS_LLM`, `answer`, `analyzeDraft`). Como não há backend, a chamada ao provedor seria feita direto do navegador — atenção a CORS e à exposição da chave de API.

## 🔒 Persistência e privacidade

Os cofres importados e o status do Kanban ficam **apenas neste navegador** (IndexedDB + `localStorage`). Limpar os dados do site apaga os projetos. Nada é enviado a nenhum servidor.

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
