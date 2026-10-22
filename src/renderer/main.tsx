import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getBridge } from './bridge';
import { CrashNotice } from './components/CrashNotice';
import { RenderBoundary } from './components/RenderBoundary';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/markdown.css';
import './styles/highlight.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <RenderBoundary
      fallback={
        <CrashNotice
          onReload={() => {
            window.location.reload();
          }}
        />
      }
    >
      <App bridge={getBridge()} />
    </RenderBoundary>
  </StrictMode>,
);
