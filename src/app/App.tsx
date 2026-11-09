import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { HomePage } from '../pages/HomePage';
import { LedgerPage } from '../pages/LedgerPage';
import { AssetsPage } from '../pages/AssetsPage';
import { AssetFormPage } from '../pages/AssetFormPage';
import { ArchivedAssetsPage } from '../pages/ArchivedAssetsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { LoginPage } from '../pages/LoginPage';
import { StartPage } from '../pages/StartPage';
import { TransactionFormPage } from '../pages/TransactionFormPage';
import { JoinPage } from '../pages/JoinPage';
import { MembersPage } from '../pages/MembersPage';
import { LedgerNamePage } from '../pages/LedgerNamePage';
import { MemberNamePage } from '../pages/MemberNamePage';
import { LedgerAddPage } from '../pages/LedgerAddPage';
import { CategorySettingsPage } from '../pages/settings/CategorySettingsPage';
import { PocketSettingsPage } from '../pages/settings/PocketSettingsPage';
import { ThemeSettingsPage } from '../pages/settings/ThemeSettingsPage';
import { RequireAuth, RequireLedger, RequireNoLedger } from './guards';
import { ThemeProvider } from './theme';

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="join/:code" element={<JoinPage />} />
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
            <Route path="assets/new" element={<AssetFormPage />} />
            <Route path="assets/archived" element={<ArchivedAssetsPage />} />
            <Route path="assets/:assetId" element={<AssetFormPage />} />
            <Route path="ledger/new" element={<TransactionFormPage />} />
            <Route path="ledger/:transactionId" element={<TransactionFormPage />} />
            <Route path="settings/name" element={<LedgerNamePage />} />
            <Route path="settings/my-name" element={<MemberNamePage />} />
            <Route path="settings/members" element={<MembersPage />} />
            <Route path="settings/categories" element={<CategorySettingsPage />} />
            <Route path="settings/pockets" element={<PocketSettingsPage />} />
            <Route path="settings/theme" element={<ThemeSettingsPage />} />
            <Route path="ledgers/new" element={<LedgerAddPage mode="create" />} />
            <Route path="ledgers/join" element={<LedgerAddPage mode="join" />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
