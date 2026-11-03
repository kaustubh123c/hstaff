import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const el = document.getElementById('root');
const root = (globalThis.__hstaffRoot ??= createRoot(el));
root.render(<ErrorBoundary><App /></ErrorBoundary>);
