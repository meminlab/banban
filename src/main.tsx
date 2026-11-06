import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './app/auth';
import { captureEntryUrl } from './app/entryUrl';
import './styles/global.css';

// 라우터가 /login 등으로 주소를 바꾸기 전에 처음 연 주소를 기억한다 (카카오톡 → 다른 브라우저로 열기용)
captureEntryUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
