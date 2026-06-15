// utils/dicionarioParadas.js
export const nomesExtenso = {
  alm: ["Agência da Lagoa Mirim", "ALM", "Padaria Bom Preço"],
  amilcargigante: ["Amilcar Gigante"],
  anglo: ["Anglo"],
  capaoleao: ["Campus Capão do Leão", "Capão"],
  campusii: ["Campus II"],
  canguru: ["Canguru", "IFSul", "Secretaria Municipal de Saúde"],
  cap: ["Palma", "Centro Agropecuário da Palma"],
  cchs: ["CCHS", "ICH", "Instituto de Ciências Humanas"],
  ceiq: ["CEIQ", "Casa do Estudante Indígena e Quilombola"],
  ceu: ["CEU", "Casa do Estudante"],
  cotada: ["Cotada"],
  direito: ["Direito"],
  esef: ["ESEF", "Escola Superior de Educação Física"],
  famed: ["Faculdade de Medicina", "FaMed"],
  faurb: ["Faculdade de Arquitetura e Urbanismo", "FaUrb", "Centro de Artes"],
  hospitalescola: ["Hospital Escola", "IFSul"],
  laneira: ["Laneira"],
  lyceu: ["Lyceu", "Mercado Público", "Praça Cel. Pedro Osório"],
  madeireira: ["Engenharia Madeireira"],
  odonto: ["Odontologia", "Odonto", "Panvel"],
  rotula: ["Rótula"],
  rucentro: ["Restaurante Universitário Centro", "RU Centro"],
};

// Função de tradução direta (sem chamar serviços externos)
const traduzirDireto = (sigla) => {
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";
  const siglaLimpa = sigla.toLowerCase().trim();
  const opcoes = nomesExtenso[siglaLimpa];
  return opcoes ? opcoes[0] : sigla.toUpperCase();
};

// Cache simples para evitar leituras repetidas do localStorage
let apelidosCache = null;

const getApelidosCache = () => {
  if (apelidosCache === null) {
    try {
      apelidosCache = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
    } catch {
      apelidosCache = {};
    }
  }
  return apelidosCache;
};

// Função principal de tradução - SEM recursão
export const traduzirSigla = (sigla) => {
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";
  const siglaLimpa = sigla.toLowerCase().trim();

  // Verifica se há apelido no cache
  const apelidos = getApelidosCache();
  if (apelidos[siglaLimpa]) {
    return apelidos[siglaLimpa];
  }

  // Fallback para o dicionário padrão
  return traduzirDireto(siglaLimpa);
};

// Função para atualizar o cache de apelidos (chamada pelo serviço)
export const atualizarCacheApelidos = (novosApelidos) => {
  apelidosCache = { ...novosApelidos };
  localStorage.setItem("user_apelidos", JSON.stringify(apelidosCache));
};

// Funções de favoritos (mantidas para compatibilidade)
export const getFavoritos = () => {
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

export const salvarFavoritos = (lista) => {
  localStorage.setItem("user_favoritos", JSON.stringify(lista));
};
