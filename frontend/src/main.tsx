/**
 * main.tsx — app entry. The dark Electric-Blue studio uses SYSTEM fonts only
 * (system-ui sans + ui-monospace); there are no webfonts to load. Imports the
 * ported design system (theme.css — tokens + component classes) first, then the
 * app-specific layout/skin built on those same tokens. Then mounts store + app.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/theme.css';
import './styles/ds.css';
import './styles/app.css';

import { StoreProvider } from './state/store';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
