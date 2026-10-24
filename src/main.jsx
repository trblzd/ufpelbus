// main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import 'material-symbols/outlined.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* atualização de rota síncrona: a View Transition captura o DOM novo no flushSync */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
