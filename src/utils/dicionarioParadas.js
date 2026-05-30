export const nomesExtenso = {
  alm: ["Agência da Lagoa Mirim", "ALM", "Padaria Bom Preço"],
  "amilcar-gigante": ["Amilcar Gigante"],
  anglo: ["Anglo"],
  "campus-capo-do-leao": ["Campus Capão do Leão", "Capão"],
  "campus-ii": ["Campus II"],
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
  "hospital-escola": ["Hospital Escola", "IFSul"],
  laneira: ["Laneira"],
  lyceu: ["Lyceu", "Mercado Público", "Praça Cel. Pedro Osório"],
  madeireira: ["Engenharia Madeireira"],
  odonto: ["Odontologia", "Odonto", "Panvel"],
  rotula: ["Rótula"],
  "ru-centro": ["Restaurante Universitário Centro", "RU Centro"],
};

let _cacheApelidos = null;
const getApelidos = () => {
  if (!_cacheApelidos)
    _cacheApelidos = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
  return _cacheApelidos;
};

export const traduzirSigla = (sigla) => {
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";
  const siglaLimpa = sigla.toLowerCase().trim();
  const apelidos = getApelidos();
  if (apelidos[siglaLimpa]) return apelidos[siglaLimpa];
  const opcoes = nomesExtenso[siglaLimpa];
  return opcoes ? opcoes[0] : sigla.toUpperCase();
};

export const getFavoritos = () => {
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

export const salvarFavoritos = (lista) => {
  localStorage.setItem("user_favoritos", JSON.stringify(lista));
};
