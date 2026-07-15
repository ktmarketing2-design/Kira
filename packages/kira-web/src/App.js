import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function Protected({ children }) {
    return (_jsx(AuthGuard, { children: _jsx(Shell, { children: children }) }));
}
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/link/:code", element: _jsx(LinkPage, {}) }), _jsx(Route, { path: "/dashboard", element: _jsx(Protected, { children: _jsx(DashboardPage, {}) }) }), _jsx(Route, { path: "/roster", element: _jsx(Protected, { children: _jsx(RosterPage, {}) }) }), _jsx(Route, { path: "/alerts", element: _jsx(Protected, { children: _jsx(AlertsPage, {}) }) }), _jsx(Route, { path: "/token", element: _jsx(Protected, { children: _jsx(TokenPage, {}) }) }), _jsx(Route, { path: "/token/:address", element: _jsx(Protected, { children: _jsx(TokenPage, {}) }) }), _jsx(Route, { path: "/settings", element: _jsx(Protected, { children: _jsx(SettingsPage, {}) }) }), _jsx(Route, { path: "/upgrade", element: _jsx(Protected, { children: _jsx(UpgradePage, {}) }) }), _jsx(Route, { path: "*", element: _jsx(LandingPage, {}) })] }));
}
