export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // Normalização para Pelotas (Garante que sejam negativas)
  const nLat1 = lat1 > 0 ? lat1 * -1 : lat1;
  const nLon1 = lon1 > 0 ? lon1 * -1 : lon1;
  const nLat2 = lat2 > 0 ? lat2 * -1 : lat2;
  const nLon2 = lon2 > 0 ? lon2 * -1 : lon2;

  const R = 6371e3; // Raio da Terra em metros
  const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
  const dLon = ((nLon2 - nLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((nLat1 * Math.PI) / 180) *
      Math.cos((nLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Retorna metros
};

const podeSubir = (posicaoUsuario, paradaCoords, ultimaAtualizacao) => {
  // 1. Validar Distância (50 metros)
  const distancia = calculateDistance(
    posicaoUsuario.lat,
    posicaoUsuario.lng,
    paradaCoords[0],
    paradaCoords[1],
  );

  if (distancia > 50)
    return { ok: false, msg: "Você está muito longe da parada!" };

  // 2. Validar Tempo (1 minuto)
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
