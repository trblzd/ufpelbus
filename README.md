# 🚌 busepel - Rastreamento de Ônibus Universitário em Tempo Real

[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?logo=vite)](https://vitejs.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-10.0-FFCA28?logo=firebase)](https://firebase.google.com/)
[![Material-UI](https://img.shields.io/badge/MUI-5.0-007FFF?logo=mui)](https://mui.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 📱 Sobre o Projeto

**busepel** é um aplicativo web progressivo (PWA) que permite aos estudantes da Universidade Federal de Pelotas (UFPel) rastrear os ônibus universitários em tempo real. O sistema utiliza tecnologia colaborativa onde os próprios passageiros se tornam rastreadores, enviando a localização do veículo através de seus smartphones.

### 🎯 Problema que Resolve

- **Incerteza na espera**: Estudantes não sabem quando o próximo ônibus vai chegar
- **Falta de informação**: Horários fixos não refletem atrasos ou adiantamentos
- **Superlotação**: Não há como saber se o ônibus está lotado antes de chegar
- **Rotas complexas**: Múltiplas linhas com trajetos similares causam confusão

### ✨ Solução

- **Rastreamento colaborativo**: Passageiros contribuem com a localização em tempo real
- **Previsão inteligente**: Baseada em dados históricos de viagem
- **Informação de lotação**: Votação coletiva sobre ocupação do veículo
- **Interface intuitiva**: Foco em simplicidade e usabilidade

## 🚀 Funcionalidades Principais

### Para Estudantes
- 🗺️ **Mapa interativo** com rotas coloridas e paradas
- 📍 **Embarque automático** - Detecta quando você está na parada
- 🚏 **Paradas favoritas** - Marque seus pontos de embarque preferidos
- ✏️ **Personalização de nomes** - Renomeie paradas como preferir
- 📊 **Lotação em tempo real** - Vazio, Médio ou Lotado
- ⏱️ **Previsão de chegada** - Calculada com base em dados históricos
- 🔄 **Recuperação de sessão** - Volte à viagem mesmo após fechar o app

### Para Administradores
- 🛠️ **Editor de rotas** - Interface gráfica para desenhar trajetos
- 🔗 **Compartilhamento de trechos** - Reutilize rotas entre diferentes linhas
- 🎨 **Sistema de gradiente** - Visualização colorida por trecho
- 📐 **Snap to road** - Alinhamento automático às ruas (OSRM)

### Tecnologias de Backend
- 👑 **Sistema de rastreador principal** - Um passageiro por vez envia GPS
- 🔄 **Reserva automática** - Próximo passageiro assume quando o atual desce
- 🧠 **Aprendizado coletivo** - Tempos de trecho melhoram com uso
- 💾 **Cache multi-camada** - Redução de 70% nas requisições ao Firebase
