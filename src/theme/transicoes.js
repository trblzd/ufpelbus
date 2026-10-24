// Padrões de transição do M3 com a View Transitions API.
// O tipo vai em html[data-transicao]; as animações ficam em src/index.css.
// Sem suporte à API, a mudança acontece na hora, sem animação.
import { flushSync } from 'react-dom';

let transicaoAtual = null;
let nomeados = [];

function limparNomes() {
  nomeados.forEach((el) => { el.style.viewTransitionName = ''; });
  nomeados = [];
}

function nomear(el, nome) {
  el.style.viewTransitionName = nome;
  nomeados.push(el);
}

function iniciar(tipo, atualizarDom, { regiao, origem } = {}) {
  const html = document.documentElement;
  const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  limparNomes();
  html.dataset.transicao = tipo;
  if (reduzido) html.dataset.reduzido = ''; else delete html.dataset.reduzido;
  if (regiao) { html.dataset.escopo = 'regiao'; nomear(regiao, 'regiao'); } else delete html.dataset.escopo;
  if (origem && !reduzido) nomear(origem, 'container');
  const transicao = document.startViewTransition(atualizarDom);
  transicaoAtual = transicao;
  transicao.ready.catch(() => {}); // transição pulada por outra mais nova não é erro
  transicao.finished.catch(() => {}).then(() => {
    if (transicaoAtual !== transicao) return; // outra transição já assumiu os atributos
    transicaoAtual = null;
    limparNomes();
    delete html.dataset.transicao;
    delete html.dataset.escopo;
    delete html.dataset.reduzido;
  });
}

// tipo: 'topo' | 'avancar' | 'voltar' | 'lateral-proximo' | 'lateral-anterior' | 'container'
// regiao: só esse elemento anima, o resto troca na hora; origem: elemento que vira a tela nova (container)
export function transicionar(tipo, atualizar, opcoes) {
  if (!document.startViewTransition) { atualizar(); return; }
  iniciar(tipo, () => flushSync(atualizar), opcoes);
}

export function voltarComTransicao() {
  if (!document.startViewTransition) { window.history.back(); return; }
  iniciar('voltar', () => new Promise((resolve) => {
    let limite;
    const concluir = () => { window.removeEventListener('popstate', aoVoltar); clearTimeout(limite); resolve(); };
    const aoVoltar = () => { flushSync(() => {}); concluir(); }; // o listener do router já rodou; isso comita o DOM novo
    window.addEventListener('popstate', aoVoltar);
    limite = setTimeout(concluir, 500); // sem página anterior no histórico, não congela a tela
    window.history.back();
  }));
}
