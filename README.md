# Busepel

Aplicativo de rastreamento colaborativo do transporte de apoio da Universidade Federal de Pelotas. Estudantes acompanham em tempo real a posição do ônibus, recebem estimativas de chegada e votam na lotação.

## O que resolve

Saber onde o ônibus está e quanto falta para ele chegar. O primeiro passageiro que embarca vira o "rastreador" e compartilha o GPS do celular; os demais veem a posição em tempo real no mapa.

## Stack

- **Frontend:** React 18 + Vite
- **UI:** Material UI + CSS customizado
- **Mapas:** Leaflet + React-Leaflet (tiles CartoDB Dark)
- **Backend:** Firebase (Firestore + Auth + Cloud Functions)
- **Roteamento:** React Router v6
- **Snapping de rotas:** OSRM
- **PWA:** instalável no celular

## Funcionalidades

**Passageiros**

- Login via e-mail/senha
- Embarque colaborativo (primeiro a embarcar vira rastreador)
- Localização do ônibus em tempo real no mapa
- Estimativa de chegada baseada em tempos históricos
- Votação de lotação (vazio / médio / lotado)
- Paradas favoritas e apelidos personalizados (sincronizados na nuvem)
- Carteirinha do Cobalto (somente local)

**Administradores**

- Editor visual de rotas com desenho sobre mapa
- Alinhamento automático às ruas via OSRM
- Compartilhamento de trechos entre itinerários
- Status de completude das rotas por linha

**Automatizações**

- Detecção automática de paradas por GPS
- Expulsão ao chegar no destino
- Aprendizado de tempos por trecho e faixa horária
- Detecção de desvio de rota
- Sucessão automática de rastreador
