import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { runVectorMigration } from './services/vectorMigration';

// Expose to window for manual execution in browser console
(window as any).runVectorMigration = runVectorMigration;
import { useAppStore } from './store';
(window as any).useAppStore = useAppStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
