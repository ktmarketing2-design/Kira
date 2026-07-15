import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Sidebar, { BottomNav } from "./Sidebar.js";
import TopBar from "./TopBar.js";
import { AppDataProvider } from "./AppDataContext.js";
export default function Shell({ children }) {
    return (_jsx(AppDataProvider, { children: _jsxs("div", { className: "flex min-h-screen bg-kira-bg", children: [_jsx(Sidebar, {}), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx(TopBar, {}), _jsx("main", { className: "p-4 md:p-6 pb-20 md:pb-6", children: children })] }), _jsx(BottomNav, {})] }) }));
}
