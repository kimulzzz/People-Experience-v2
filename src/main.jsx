import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initTheme } from './utils/theme.js';
import './index.css';

// Applies the viewer's saved accent-theme preset (if any) before first paint, so there's no
// flash of the default red theme for someone who picked a different one last time.
initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
