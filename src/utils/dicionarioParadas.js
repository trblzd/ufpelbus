// utils/dicionarioParadas.js
// DICIONÁRIO DE PARADAS - Gerencia nomes oficiais e apelidos personalizados

// ==================== DICIONÁRIO OFICIAL ====================

/**
 * Mapeamento de siglas para nomes extensos (oficiais)
 *
 * Estrutura: { sigla: [nome_principal, nome_alternativo1, nome_alternativo2, ...] }
 *
 * Por que múltiplas opções?
 * - Permite ao usuário escolher o nome mais familiar
 * - Ex: "anglo" pode ser "Anglo" ou "Colégio Anglo"
 * - Ex: "cchs" pode ser "CCHS", "ICH" ou "Instituto de Ciências Humanas"
 */
export const nomesExtenso = {
  // Campus e instituições principais
  alm: ["Agência da Lagoa Mirim", "ALM", "Padaria Bom Preço"],
  amilcargigante: ["Amilcar Gigante"],
  anglo: ["Anglo"],
  capaoleao: ["Campus Capão do Leão", "Capão"],
  campusii: ["Campus II"],
  canguru: ["Canguru", "IFSul", "Secretaria Municipal de Saúde"],
  cap: ["Palma", "Centro Agropecuário da Palma"],

  // Institutos e faculdades
  cchs: ["CCHS", "ICH", "Instituto de Ciências Humanas"],
  ceiq: ["CEIQ", "Casa do Estudante Indígena e Quilombola"],
  ceu: ["CEU", "Casa do Estudante"],
  cotada: ["Cotada"],
  direito: ["Direito"],
  esef: ["ESEF", "Escola Superior de Educação Física"],
  famed: ["Faculdade de Medicina", "FaMed"],
  faurb: ["Faculdade de Arquitetura e Urbanismo", "FaUrb", "Centro de Artes"],

  // Outros pontos de interesse
  hospitalescola: ["Hospital Escola", "IFSul"],
  laneira: ["Laneira"],
  lyceu: ["Lyceu", "Mercado Público", "Praça Cel. Pedro Osório"],
  madeireira: ["Engenharia Madeireira"],
  odonto: ["Odontologia", "Odonto", "Panvel"],
  rotula: ["Rótula"],
  rucentro: ["Restaurante Universitário Centro", "RU Centro"],
};

// ==================== CACHE DE APELIDOS ====================

/**
 * Cache de apelidos personalizados pelo usuário
 * Carregado do localStorage uma única vez
 *
 * Formato: { "anglo": "Meu Colégio", "cchs": "Humanas", ... }
 */
let apelidosCache = null;

/**
 * Carrega apelidos do localStorage (com lazy loading)
 * Apenas a primeira chamada acessa o disco
 *
 * @returns {Object} Mapa de apelidos
 */
const getApelidosCache = () => {
  if (apelidosCache === null) {
    try {
      apelidosCache = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
    } catch {
      apelidosCache = {}; // Fallback seguro em caso de erro
    }
  }
  return apelidosCache;
};

// ==================== TRADUÇÃO DIRETA (SEM APELIDOS) ====================

/**
 * Traduz sigla para nome oficial (ignora apelidos personalizados)
 * Usada como fallback quando não há apelido
 *
 * @param {string} sigla - Sigla da parada (ex: "anglo")
 * @returns {string} Nome oficial (ex: "Anglo")
 */
const traduzirDireto = (sigla) => {
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";

  const siglaLimpa = sigla.toLowerCase().trim();
  const opcoes = nomesExtenso[siglaLimpa];

  // Retorna o primeiro nome da lista ou a sigla em maiúsculo
  return opcoes ? opcoes[0] : sigla.toUpperCase();
};

// ==================== FUNÇÃO PRINCIPAL DE TRADUÇÃO ====================

/**
 * Traduz uma sigla de parada para nome amigável
 * Prioridade: Apelido personalizado > Nome oficial > Sigla em maiúsculo
 *
 * Por que não usar recursão?
 * - Evita loops infinitos (apelido poderia chamar traduzirSigla)
 * - Performance melhor (caminho linear)
 *
 * @param {string} sigla - Sigla da parada (ex: "anglo", "cchs")
 * @returns {string} Nome amigável (ex: "Anglo", "Instituto de Ciências Humanas")
 *
 * @example
 * traduzirSigla("anglo") // "Anglo"
 * traduzirSigla("cchs") // "CCHS" (ou apelido se existir)
 */
export const traduzirSigla = (sigla) => {
  // Validação de entrada
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";

  const siglaLimpa = sigla.toLowerCase().trim();

  // 1º PRIORIDADE: Apelido personalizado do usuário
  const apelidos = getApelidosCache();
  if (apelidos[siglaLimpa]) {
    return apelidos[siglaLimpa];
  }

  // 2º PRIORIDADE: Nome oficial do dicionário
  return traduzirDireto(siglaLimpa);
};

// ==================== GERENCIAMENTO DE CACHE ====================

/**
 * Atualiza o cache de apelidos (chamado pelo apelidosService)
 * Mantém sincronia entre o dicionário e o serviço
 *
 * @param {Object} novosApelidos - Novo mapa de apelidos
 */
export const atualizarCacheApelidos = (novosApelidos) => {
  apelidosCache = { ...novosApelidos };
  localStorage.setItem("user_apelidos", JSON.stringify(apelidosCache));
};

// ==================== FUNÇÕES LEGACY (FAVORITOS) ====================

/**
 * Obtém lista de favoritos do localStorage
 * NOTA: Mantida para compatibilidade, mas favoritos são gerenciados pelo favoritosService
 *
 * @deprecated Use getFavoritos do favoritosService
 * @returns {Array} Lista de IDs de paradas favoritas
 */
export const getFavoritos = () => {
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

/**
 * Salva lista de favoritos no localStorage
 * NOTA: Mantida para compatibilidade, mas favoritos são gerenciados pelo favoritosService
 *
 * @deprecated Use adicionarFavorito/removerFavorito do favoritosService
 * @param {Array} lista - Lista de IDs de paradas favoritas
 */
export const salvarFavoritos = (lista) => {
  localStorage.setItem("user_favoritos", JSON.stringify(lista));
};
