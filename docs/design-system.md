# Design system do Busepel

## 1. Origem

Adaptação do [`DESIGN.md` do Uber](https://github.com/Meliwat/awesome-ios-design-md/tree/main/design-md/travel/uber) em **modo escuro**. Diferenças em relação ao original:

- Tema escuro único (canvas `#0C0C0C`); CTA branco com texto preto.
- Inter Variable com `font-variant-numeric: tabular-nums` no lugar da Uber Move.
- O logo (`public/buslogo.svg`) é branco. Azul aparece apenas em links (`#8FA6FF`) e no ponto "você está aqui" do mapa (`#3D6DFF`).

Fonte única dos tokens: `src/theme/tokens.js` (JS/sx) e `:root` de `src/index.css` (CSS). Mantenha os dois em sincronia.

## 2. Cores

| CSS | JS (`cores.`) | Hex | Uso |
|---|---|---|---|
| `--cor-canvas` | `canvas` | `#0C0C0C` | Fundo de telas |
| `--cor-superficie-1` | `superficie1` | `#1A1A1A` | Cards, sheets, inputs |
| `--cor-superficie-2` | `superficie2` | `#2F2F2F` | Chips, botões secundários, bordas de card |
| `--cor-superficie-3` | `superficie3` | `#3A3A3A` | Hover, divisores fortes, alça do sheet |
| `--cor-texto` | `texto` | `#FFFFFF` | Texto principal, CTA |
| `--cor-texto-2` | `texto2` | `#AFAFAF` | Metadados |
| `--cor-texto-3` | `texto3` | `#757575` | Desabilitado, conector da rota |
| `--cor-preto` | `preto` | `#000000` | Texto sobre superfície clara |
| `--cor-texto-sobre-claro` | `textoSobreClaro` | `#545454` | Rótulo sobre badge branco |
| `--cor-cta-hover` | `ctaHover` | `#E5E5E5` | Hover do CTA |
| `--cor-sucesso` | `sucesso` | `#22C77A` | Confirmado / vazio |
| `--cor-perigo` | `perigo` | `#FF4C3F` | Lotado / destrutivo |
| `--cor-alerta` | `alerta` | `#FFCB00` | Médio |
| `--cor-info` | `info` | `#3D6DFF` | Posição do usuário no mapa |
| `--cor-link` | `link` | `#8FA6FF` | Links |
| `--cor-link-hover` | `linkHover` | `#B8C6FF` | Hover de links |
| `--cor-mapa` | `mapa` | `#1E1E1E` | Fundo do mapa |

## 3. Raios e sombras

| Token | Valor | Uso |
|---|---|---|
| `--raio-sm` | 4px | |
| `--raio-md` | 8px | Botões, inputs, cards |
| `--raio-lg` | 12px | Cards de horário, menu do Select |
| `--raio-sheet` | 16px | Bottom sheets (só cantos superiores) |
| `--raio-pill` | 999px | Chips |
| `--sombra-controle` | `0 2px 8px rgba(0,0,0,.25)` | Controles flutuantes do mapa |
| `--sombra-sheet` | `0 -4px 24px rgba(0,0,0,.25)` | Bottom sheets |

## 4. Tipografia

| Uso | Estilo |
|---|---|
| Título de tela | 28 / 700 / -0.4px |
| Título de sheet | 20 / 700 |
| Linha de lista | 17 / 600 |
| Corpo | 15 |
| Metadado | 14, `#AFAFAF` |
| Rótulo | 11 / 700, caixa alta, 0.6px |
| Botão | 17 / 500 (grande), 15 / 500 |

## 5. Componentes

- **CTA:** `<Button variant="contained" size="large" fullWidth>` — branco, 56px, `scale(0.98)` ao pressionar.
- **Secundário:** `variant="outlined"` (borda branca) ou `variant="text"` com classe própria (botões de horário).
- **Chip:** tema MUI (pílula `#2F2F2F`); status com `.status-dot` no `icon`.
- **Card de opção:** `.bus-item-card` — 8px, borda `#2F2F2F`, título 17/600, horário 20/600.
- **Bloco de rota:** `.input-block-container` com `.rota-linha`, `.rota-marcador--origem` (círculo), `.rota-marcador--destino` (quadrado), `.rota-conector` e `.rota-divisor`.
- **Tab bar:** `.tab-bar` / `.tab-bar-item` — largura total, ícone 24px + rótulo sempre visível, ativo com `aria-current="page"`.
- **Bottom sheet:** `sheetSx` (modais da Home) e `.map-bottom-wrapper` (mapa), com alça de 36×4.
- **Controles flutuantes do mapa:** `.map-top-close-btn` e `.map-top-badge` — brancos, texto preto, `--sombra-controle`.
- **`.status-dot`:** bolinha de 8px; a cor vem de `style` inline com `cores.sucesso|alerta|perigo`.

## 6. Regras

- Cor só funcional: verde = confirmado/vazio, âmbar = médio, vermelho = lotado/destrutivo.
- Sem gradientes.
- Sem itálico.
- Hex novos só em `tokens.js` e `:root`. Exceções: `#3388ff` (traçado escolhido pelo admin, é dado) e `rgba()` de sombra/overlay.
- Tiles do editor de rotas continuam claros: são conteúdo de mapa, não chrome.
