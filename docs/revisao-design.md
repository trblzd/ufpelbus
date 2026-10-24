# Revisão de design (UI) do Busepel

## 1. Escopo e método
- Telas: Auth, Embarque, lista de ônibus, mapa da viagem, Perfil, Horários, modais da Home, telas admin (leitura de código).
- Viewports: 390×844 e 320×640 (mobile, touch, DPR 2), Chromium headless, emuladores Firebase com GPS simulado; cenário de GPS negado em servidor separado.
- Severidade: **Alta** bloqueia uso, esconde informação essencial ou falha WCAG AA em texto principal. **Média** prejudica legibilidade, teclado/leitor de tela ou consistência visível. **Baixa** é dívida sem efeito visível imediato.
- Contraste: razão de luminância relativa WCAG 2.x. Cores adotadas: texto secundário `#A1A1AA` (≥ 4,9:1), azul em texto `#8FA6FF` (5,9:1 sobre `#2E2E2E`), ícones decorativos `#7C7C7C` (3,4:1).

## 2. Achados

| ID | Severidade | Tela | Arquivo:linha | Problema | Status |
|---|---|---|---|---|---|
| A1 | Alta | Home | `HomePage.jsx:1081,1206,1501` | GPS negado prendia a Home em "Obtendo sua localização..."; `error` do `useLocation` era ignorado. Agora a Home abre com aviso e seleção manual. | Corrigido |
| A2 | Alta | Mapa | `MainPage.jsx:763` | Posição do usuário não era desenhada. | Corrigido |
| A3 | Alta | Documento | `index.html:1-50` | O HTML servido não tinha manifest, theme-color, ícones, e usava `lang="en"`; `public/index.html` era arquivo morto (removido). | Corrigido |
| A4 | Alta | Documento | `index.html:5` | Zoom bloqueado (`user-scalable=no`), falha WCAG 1.4.4. | Corrigido |
| A5 | Alta | Home/Auth/Mapa | `HomePage.jsx:40,818-819,1013,1029`; `HomePage.css:84-220,176`; `AuthPage.css:58,128,138`; `MainPage.css:47` | Contraste: `#7C7C7C`/`#777` ≈ 3,2:1; `#0845FF` como texto 2,1–3,2:1; cores inline de `.bus-item-info-line` anuladas por `!important`. Também `.auth-label` e `.auth-forgot-btn`. | Corrigido |
| M1 | Média | Embarque | `HomePage.css:637-650` | Nome da parada colidia com a seta; reticência anulada. | Corrigido |
| M2 | Média | Global | `main.jsx:7`; `index.css:13`; `App.jsx:45`; `HomePage.jsx:43`; `HomePage.css:10`; `AuthPage.css:8` | Inter citada mas nunca carregada; três pilhas diferentes. Agora `@fontsource-variable/inter`. | Corrigido |
| M3 | Média | Global | `index.css:32-38` | Sem indicador de foco de teclado. | Corrigido |
| M4 | Média | Home | `HomePage.jsx:48,426,466,602,819,1647` | `Box`/`div` clicáveis sem role/teclado (modais Renomear, Favoritos, Upload; área da carteirinha). | Corrigido |
| M5 | Média | Mapa/Home/Admin | `MainPage.jsx:791`; `HomePage.jsx:387`; `AdminRoutesPage.jsx:138,200`; `RouteEditorPage.jsx:872,1141` | Botões só-ícone sem nome acessível. | Corrigido |
| M6 | Média | Auth | `AuthPage.jsx:72-85,106,119,131-132`; `AuthPage.css` | Labels não associados, erro sem `role="alert"`, `alert()` nativo, divisor "ou" sem alternativa, copy inconsistente. | Corrigido |
| M7 | Média | Nav | `HomePage.jsx:1834,1854,1874,1867` | Aba "Rotas" abria "Horários"; sem `aria-current`. | Corrigido |
| M8 | Média | Embarque | `HomePage.jsx:1601,1612,1681` | "Continuar...", "VOLTAR PARA BUSCA", "cobalto". | Corrigido |
| M9 | Média | Mapa | `MainPage.jsx:745`; `MainPage.css:41-52,186-190` | Fechar 36px, spinner `#00418F` sobre `#1A1A1A` (1,8:1), legenda 10–11px. | Corrigido |
| M10 | Média | Embarque | `HomePage.jsx:1537,1566` | Selects de parada sem nome acessível. | Corrigido |
| B1 | Baixa | Global | `index.css`, `HomePage.css`, `MainPage.css` | Sem design tokens: ~35 hex, três azuis de marca (`#00418F`, `#0845FF`, `#1E58FF`), quatro fundos escuros. | Registrado |
| B2 | Baixa | Global | `App.jsx:40-50`; `HomePage.jsx:35-45` | Dois temas MUI divergentes (claro global, escuro local). | Registrado |
| B3 | Baixa | Global | `HomePage.css` (212), `MainPage.css` (17) | 229 `!important` (212 + 17). | Registrado |
| B4 | Baixa | Home | `HomePage.css:81,415,425` e demais | CSS morto (sem uso em `src`, confirmado por grep): `modal-item*`, `modal-title`, `modal-header`, `modal-close-*`, `modal-paradas-*`, `gps-refresh-btn`, `bus-item-subtitle`, `screen-title-with-icon`, `paradas-icon-btn`, `icon-button-no-save`, `upload-placeholder`. | Registrado |
| B5 | Baixa | Global | `index.css:2-4` | `@tailwind` inerte (Tailwind não instalado). | Registrado |
| B6 | Baixa | Várias | `MainPage.css/.jsx`, `AuthPage.css`, `HomePage.css/.jsx`, `AdminRoutesPage.jsx`, `RouteEditorPage.jsx`, `PersonalizationPage.jsx` | `100vh`/`100vw` sem `dvh`. | Registrado |
| B7 | Baixa | Mapa | `index.html:48`; `MainPage.jsx:27,33` | CSS do Leaflet carregado duas vezes; ícone de embarque vem de `raw.githubusercontent.com`. | Registrado |
| B8 | Baixa | Mapa | `MainPage.jsx` | Gradiente vermelho→verde problemático para daltônicos; mitigado por legenda e formas. | Registrado |
| B9 | Baixa | Mapa | `MainPage.jsx:755` | Sem zoom nem recentralizar (`zoomControl={false}`). | Registrado |
| B10 | Baixa | Global | CSS | Sem `prefers-reduced-motion`; `AuthPage.css` sem `safe-area-inset`. | Registrado |
| B11 | Baixa | Home | `HomePage.jsx` | "Olá, aluno!" genérico; placeholders "subir"/"descer" pouco descritivos. | Registrado |
| B12 | Baixa | Personalização | — | Rota `/personalizar` órfã, tema claro, `ListItem onClick` sem teclado. | Registrado |
| B13 | Baixa | Admin | `App.jsx:276` | Telas admin em tema claro; `/admin/*` sem guarda de admin (risco de segurança, fora do escopo de design). | Registrado |
| B14 | Baixa | PWA | `public/sw.js` | Nunca registrado na página servida; ativar é decisão separada (cache/deploy). | Registrado |
| B15 | Baixa | Mapa | `MainPage.jsx` | Card de votação de lotação cobre o centro do mapa após o embarque. | Registrado |
| B16 | Baixa | Home | `HomePage.jsx:1413-1489` | Erro na busca de ônibus é silencioso. | Registrado |

## 3. Recomendações (B*)
- B1–B3: custom properties em `index.css` e um tema MUI único; migrar por tela removendo `!important` à medida que os tokens entram.
- B4–B5: apagar o CSS morto e as diretivas `@tailwind`.
- B6: trocar por `100dvh`/`100svh`.
- B7: manter só um carregamento do CSS do Leaflet e servir o ícone de `public/`.
- B8–B9: adicionar padrão/forma à rota e botões de zoom/recentralizar.
- B10: `@media (prefers-reduced-motion)` e `env(safe-area-inset-*)` na Auth.
- B11–B12, B15–B16: ajustes de copy, remover ou ligar `/personalizar`, mover o card de lotação, avisar falha de busca.
- B13: guarda de admin em `App.jsx` (tarefa de segurança separada).
- B14: decidir registro do SW junto com a política de cache.

## Observações da implementação
- Com o recuo de 32px, o nome da parada trunca com reticência já em 320px. Em 320px a Inter, mais larga, fez o texto da lista de ônibus encostar no horário; ajuste: `margin-left: 12px` e `flex-shrink: 0` em `.bus-item-time` no `@media (max-width: 380px)` (`HomePage.css:775`).
- Antes/depois verificado em 390×844 e 320×640 (Auth, Embarque, lista, mapa, Perfil, Horários), sem overflow horizontal. Baseline: cópia temporária do working tree com os arquivos desta revisão restaurados do HEAD (mapa antes: fechar 36px, legenda 10–11px, sem ponto do usuário).
- O botão "Voltar para a busca" recebeu `textTransform: none` (o MUI colocava em caixa alta).
- O aviso de GPS negado é derivado (sem `setState` em efeito) para não aumentar os erros de lint.
