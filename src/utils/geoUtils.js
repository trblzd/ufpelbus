// utils/geoUtils.js
// UTILITÁRIOS GEOGRÁFICOS - Cálculos de distância, normalização e validação

// ==================== CONSTANTES ====================

// Raio da Terra em metros (valor médio)
// Usado na fórmula de Haversine para cálculo de distâncias
const RAIO_TERRA_METROS = 6371e3; // 6.371 km

// ==================== CÁLCULO DE DISTÂNCIA ====================

/**
 * Calcula a distância entre dois pontos geográficos usando a fórmula de Haversine
 *
 * Fórmula de Haversine: Calcula a distância do grande círculo entre dois pontos
 * em uma esfera (Terra), considerando a curvatura da superfície.
 *
 * Por que Haversine?
 * - Precisão boa para distâncias curtas (metros/quilômetros)
 * - Mais precisa que Pitágoras (que assume Terra plana)
 * - Mais simples que Vincenty (que considera elipsoide)
 *
 * @param {number} lat1 - Latitude do primeiro ponto
 * @param {number} lon1 - Longitude do primeiro ponto
 * @param {number} lat2 - Latitude do segundo ponto
 * @param {number} lon2 - Longitude do segundo ponto
 * @returns {number} Distância em metros
 *
 * @example
 * calculateDistance(-31.76, -52.33, -31.77, -52.34) // ~1500 metros
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // ========== NORMALIZAÇÃO PARA PELOTAS ==========
  // Pelotas (RS) está no Hemisfério Sul (latitudes negativas) e Oeste (longitudes negativas)
  // Algumas fontes podem fornecer coordenadas positivas, então normalizamos aqui
  const nLat1 = lat1 > 0 ? lat1 * -1 : lat1;
  const nLon1 = lon1 > 0 ? lon1 * -1 : lon1;
  const nLat2 = lat2 > 0 ? lat2 * -1 : lat2;
  const nLon2 = lon2 > 0 ? lon2 * -1 : lon2;

  // ========== CONVERSÃO PARA RADIANOS ==========
  // Fórmula de Haversine trabalha com radianos
  const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
  const dLon = ((nLon2 - nLon1) * Math.PI) / 180;

  // ========== FÓRMULA DE HAVERSINE ==========
  // a = sin²(Δφ/2) + cos(φ1) * cos(φ2) * sin²(Δλ/2)
  // c = 2 * atan2(√a, √(1−a))
  // d = R * c
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((nLat1 * Math.PI) / 180) *
      Math.cos((nLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RAIO_TERRA_METROS * c; // Retorna metros
};

// ==================== NORMALIZAÇÃO DE COORDENADAS ====================

/**
 * Normaliza coordenadas para formato consistente [lat, lng]
 *
 * Por que normalizar?
 * - Diferentes fontes usam formatos diferentes:
 *   - Firebase pode ter { latitude, longitude }
 *   - Leaflet usa { lat, lng }
 *   - GPX pode ter [lat, lng]
 *   - API OSRM retorna { lat, lng }
 *
 * Esta função unifica todos para o formato [lat, lng] com valores negativos
 *
 * @param {Array|Object} coord - Coordenada em qualquer formato
 * @returns {Array|null} Array [lat, lng] normalizado ou null se inválido
 *
 * @example
 * normalizarCoordenadas({ latitude: -31.76, longitude: -52.33 }) // [-31.76, -52.33]
 * normalizarCoordenadas([-31.76, -52.33]) // [-31.76, -52.33]
 * normalizarCoordenadas({ lat: 31.76, lng: 52.33 }) // [-31.76, -52.33]
 */
export const normalizarCoordenadas = (coord) => {
  if (!coord) return null;

  // CASO 1: Array [lat, lng]
  if (Array.isArray(coord) && coord.length === 2) {
    let [lat, lng] = coord;
    // Garante valores negativos (Pelotas está no hemisfério sul/oeste)
    return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
  }

  // CASO 2: Objeto com propriedades (lat/lng, latitude/longitude, _lat/_long)
  if (typeof coord === "object") {
    let lat = coord.lat ?? coord.latitude ?? coord._lat;
    let lng = coord.lng ?? coord.longitude ?? coord._long;
    if (lat !== undefined && lng !== undefined) {
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
  }

  return null; // Formato não reconhecido
};

// ==================== VALIDAÇÃO DE EMBARQUE ====================

/**
 * Verifica se o usuário pode confirmar o embarque
 *
 * Validações:
 * 1. Distância máxima de 50 metros da parada
 * 2. Aguardar pelo menos 1 minuto entre confirmações (evita spam)
 *
 * @param {Object} posicaoUsuario - Posição atual { lat, lng }
 * @param {Array} paradaCoords - Coordenadas da parada [lat, lng]
 * @param {number} ultimaAtualizacao - Timestamp da última confirmação
 * @returns {Object} { ok: boolean, msg: string }
 *
 * @example
 * podeSubir(userPos, paradaPos, lastConfirmTime)
 * // { ok: true } ou { ok: false, msg: "Você está muito longe da parada!" }
 */
export const podeSubir = (posicaoUsuario, paradaCoords, ultimaAtualizacao) => {
  // VALIDAÇÃO 1: Distância da parada
  const distancia = calculateDistance(
    posicaoUsuario.lat,
    posicaoUsuario.lng,
    paradaCoords[0],
    paradaCoords[1],
  );

  if (distancia > 50) {
    return { ok: false, msg: "Você está muito longe da parada!" };
  }

  // VALIDAÇÃO 2: Cooldown entre confirmações
  const agora = Date.now();
  const umMinuto = 60 * 1000;
  if (agora - ultimaAtualizacao < umMinuto) {
    return {
      ok: false,
      msg: "Aguarde um momento antes de confirmar novamente.",
    };
  }

  return { ok: true };
};
