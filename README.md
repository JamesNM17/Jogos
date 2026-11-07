# 🏆 Interclasse — Jogos 2026

Plataforma digital desenvolvida para organizar e acompanhar os Jogos da Escola Estadual Brigadeiro Gavião Peixoto.

O sistema permite gerenciar inscrições, modalidades esportivas, equipes, participantes, sorteios de confrontos e placares em tempo real, oferecendo uma experiência simples e intuitiva para alunos e organização.

---

## 📌 Sobre o projeto

O **Interclasse — Jogos 2026** foi desenvolvido para centralizar a organização dos jogos escolares em uma única plataforma.

Os estudantes podem consultar as regras, realizar inscrições e acompanhar os resultados das partidas. A equipe organizadora possui um painel administrativo para controlar todas as etapas da competição.

A plataforma possui uma interface responsiva, identidade visual própria e suporte aos temas claro e escuro.

---

## ✨ Funcionalidades

### 🏠 Página inicial
- Apresentação oficial dos Jogos 2026.
- Identidade visual da escola.
- Navegação entre as páginas do sistema.
- Acesso rápido às inscrições, regras e placares.

### 📝 Sistema de inscrições
- Inscrição de equipes e competidores.
- Seleção de modalidades disponíveis.
- Cadastro de nome da equipe e turma.
- Cadastro dos participantes.
- Quantidade de participantes definida automaticamente de acordo com a modalidade.
- Validação dos campos obrigatórios.
- Bloqueio de novas inscrições quando o período é encerrado.
- Envio e armazenamento das inscrições no Supabase.

### 📖 Regras e orientações
- Página dedicada às regras gerais dos Jogos.
- Orientações sobre inscrições e participação.
- Informações sobre respeito, disciplina e espírito esportivo.

### 📊 Placar ao vivo
- Exibição das partidas em andamento.
- Atualização automática dos resultados.
- Visualização dos próximos confrontos.
- Histórico dos últimos resultados.
- Identificação das equipes e respectivas turmas.
- Modo telão para exibição em telas maiores.
- Visualização individual de partidas em tela cheia.

### 🔐 Painel administrativo
- Autenticação de administradores.
- Dashboard com estatísticas gerais.
- Gerenciamento de modalidades.
- Criação, edição, ativação e desativação de modalidades.
- Visualização e pesquisa de equipes inscritas.
- Edição dos dados das equipes e participantes.
- Gerenciamento de participantes.
- Possibilidade de bloquear equipes ou participantes.
- Controle de abertura e encerramento das inscrições.
- Geração automática de confrontos.
- Gerenciamento das partidas e placares.
- Controle de início e encerramento das partidas.
- Atualização da pontuação durante os jogos.
- Geração de fases eliminatórias.
- Exportação de relatórios oficiais em PDF.
- Opção administrativa para reiniciar os dados do campeonato.

### 🏅 Sistema de campeonatos
O sistema disponibiliza dois formatos de competição:

**1. Mata-mata direto**
- Os confrontos são organizados em uma chave eliminatória.
- Quem vence avança para a próxima fase.
- Quem perde é eliminado.
- A competição segue até a definição do campeão.

**2. Fase de grupos + mata-mata**
- As equipes são distribuídas em grupos.
- Os participantes disputam partidas dentro dos grupos.
- Os dois melhores de cada grupo avançam.
- A competição continua em formato eliminatório.
- A classificação considera pontos, saldo de gols, gols marcados e nome da equipe como critério final de desempate.

Esse formato exige pelo menos seis equipes inscritas na modalidade.

---

## 🛠️ Tecnologias utilizadas

O projeto utiliza tecnologias web para oferecer uma aplicação leve, acessível e sem necessidade de instalação de aplicativos.

| Tecnologia | Utilização |
|---|---|
| HTML5 | Estrutura das páginas |
| CSS3 | Estilização e responsividade |
| JavaScript | Funcionalidades e interações |
| JavaScript ES Modules | Organização dos módulos |
| Supabase | Banco de dados e autenticação |
| Supabase Auth | Login administrativo |
| Supabase RPC | Operações e regras do campeonato |
| LocalStorage | Persistência da preferência de tema |

A biblioteca `@supabase/supabase-js` é carregada dinamicamente por CDN.

---

## 📂 Estrutura do projeto

```text
Jogos/
│
├── assets/
│   ├── brasao-escola.png
│   └── jogos-banner.webp
│
├── css/
│   ├── style.css
│   └── scoreboard.css
│
├── js/
│   ├── admin-tools.js
│   ├── admin.js
│   ├── app.js
│   ├── config.js
│   ├── placar.js
│   ├── supabase.js
│   └── theme.js
│
├── index.html
├── inscricao.html
├── regras.html
├── placar.html
├── admin.html
│
└── README.md
```

### Organização dos arquivos JavaScript

- `admin-tools.js`: ferramentas administrativas e geração de relatórios.
- `admin.js`: autenticação, painel administrativo e gerenciamento do campeonato.
- `app.js`: funcionamento da página de inscrições.
- `config.js`: configurações gerais e conexão com o Supabase.
- `placar.js`: atualização e exibição dos placares.
- `supabase.js`: inicialização e gerenciamento do cliente Supabase.
- `theme.js`: controle dos temas claro e escuro.

---

## 🌐 Páginas disponíveis

| Arquivo | Descrição |
|---|---|
| `index.html` | Página inicial dos Jogos |
| `inscricao.html` | Inscrição de equipes e participantes |
| `regras.html` | Regras e orientações |
| `placar.html` | Placar e resultados ao vivo |
| `admin.html` | Painel administrativo |

---

## 🎨 Interface e experiência do usuário

O projeto foi desenvolvido com foco em uma identidade visual esportiva, moderna e intuitiva.

Entre os recursos visuais estão:

- Layout responsivo para computadores, tablets e celulares.
- Identidade visual personalizada da escola.
- Tema claro e tema escuro.
- Componentes visuais para partidas e resultados.
- Navegação adaptada para dispositivos móveis.
- Modo de exibição em tela cheia.
- Feedback visual para operações e mensagens do sistema.

---

## 🔒 Segurança

A segurança dos dados é fundamental para o funcionamento do sistema.

O projeto utiliza autenticação do Supabase para acesso administrativo e validação de permissões por meio da tabela `admin_users`.

Recomendações:

- Nunca disponibilizar chaves secretas no frontend.
- Manter as políticas RLS habilitadas e corretamente configuradas.
- Restringir operações administrativas a usuários autorizados.
- Validar permissões também no backend e nas funções RPC.
- Evitar disponibilizar informações administrativas em consultas públicas.

A chave Publishable utilizada no frontend não substitui as políticas de segurança do banco de dados.

---

## 🏫 Instituição

**Escola Estadual Brigadeiro Gavião Peixoto**

**Projeto:** Jogos Escolares — Interclasse 2026

**Objetivo:** facilitar a organização, a participação e o acompanhamento das competições escolares, incentivando a união, o respeito e o espírito esportivo.

---

## ❤️ Mensagem final

Mais do que competir, é representar.

Mais do que vencer, é jogar junto.

**Garra, respeito e união.**

🏆 **Jogos 2026 — Nossa escola. Nosso jogo.**
