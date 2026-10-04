import { Fragment, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { useLang } from './i18n';
import './styles.css';

/** Remounts the app when the language changes so every string is re-translated. */
function LangRoot({ children }: { children: ReactNode }) {
  return <Fragment key={useLang()}>{children}</Fragment>;
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <LangRoot>
          <App />
        </LangRoot>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
