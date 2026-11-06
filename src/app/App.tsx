import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { HomePage } from '../pages/HomePage';
import { LedgerPage } from '../pages/LedgerPage';
import { AssetsPage } from '../pages/AssetsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { LoginPage } from '../pages/LoginPage';
import { StartPage } from '../pages/StartPage';
import { TransactionFormPage } from '../pages/TransactionFormPage';
import { RequireAuth, RequireLedger, RequireNoLedger } from './guards';

export function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireNoLedger />}>
          <Route path="start" element={<StartPage />} />
        </Route>
        <Route element={<RequireLedger />}>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="assets" element={<AssetsPage />} />
          </Route>
          <Route path="settings" element={<SettingsPage />} />
          <Route path="ledger/new" element={<TransactionFormPage />} />
          <Route path="ledger/:transactionId" element={<TransactionFormPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
