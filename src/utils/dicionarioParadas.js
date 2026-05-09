export const nomesExtenso = {
  alm: ["Agência da Lagoa Mirim", "ALM"],
  "amilcar-gigante": ["Amilcar Gigante"],
  anglo: ["Anglo"],
  "campus-capo-do-leao": ["Campus Capão do Leão", "Capão"],
  "campus-ii": ["Campus II"],
  canguru: ["Canguru"],
  cap: ["Palma"],
  cchs: [
    "CCHS",
    "ICH",
    "Instituto de Ciências Humanas",
    "Centro de Artes",
    "CA",
  ],
  ceiq: ["CEIQ", "Casa do Estudante Indígena e Quilombola"],
  ceu: ["CEU", "Casa do Estudante"],
  cotada: ["Cotada"],
  direito: ["Direito"],
  esef: ["ESEF", "Escola Superior de Educação Física"],
  famed: ["Faculdade de Medicina", "FaMed"],
  faurb: ["Faculdade de Arquitetura e Urbanismo", "FaUrb"],
  "hospital-escola": ["Hospital Escola"],
  laneira: ["Laneira"],
  lyceu: ["Lyceu"],
  madeireira: ["Engenharia Madeireira"],
  odonto: ["Odontologia", "Odonto"],
  rotula: ["Rótula"],
  "ru-centro": ["Restaurante Universitário Centro", "RU Centro"],
};

export const traduzirSigla = (sigla) => {
  if (!sigla || sigla === "undefined") return "Parada Desconhecida";
  const siglaLimpa = sigla.toLowerCase().trim();
  const apelidos = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
  if (apelidos[siglaLimpa]) return apelidos[siglaLimpa];
  const opcoes = nomesExtenso[siglaLimpa];
  return opcoes ? opcoes[0] : sigla.toUpperCase();
};

export const salvarApelido = (sigla, novoNome) => {
  const siglaLimpa = sigla.toLowerCase().trim();
  const apelidos = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
  apelidos[siglaLimpa] = novoNome;
  localStorage.setItem("user_apelidos", JSON.stringify(apelidos));
};
