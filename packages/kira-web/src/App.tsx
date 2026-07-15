import { Routes, Route } from "react-router-dom";
import LandingPage from "./landing/LandingPage.js";
import LoginPage from "./auth/LoginPage.js";
import LinkPage from "./auth/LinkPage.js";
import AuthGuard from "./shell/AuthGuard.js";
import Shell from "./shell/Shell.js";
import DashboardPage from "./dashboard/DashboardPage.js";
import RosterPage from "./roster/RosterPage.js";
import AlertsPage from "./alerts/AlertsPage.js";
import TokenPage from "./token/TokenPage.js";
import SettingsPage from "./settings/SettingsPage.js";
import UpgradePage from "./settings/UpgradePage.js";

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/link/:code" element={<LinkPage />} />

      <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/roster" element={<Protected><RosterPage /></Protected>} />
      <Route path="/alerts" element={<Protected><AlertsPage /></Protected>} />
      <Route path="/token" element={<Protected><TokenPage /></Protected>} />
      <Route path="/token/:address" element={<Protected><TokenPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/upgrade" element={<Protected><UpgradePage /></Protected>} />

      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
}
