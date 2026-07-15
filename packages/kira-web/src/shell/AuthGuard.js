import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
export default function AuthGuard({ children }) {
    const { session, loading } = useAuth();
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-kira-bg flex items-center justify-center", children: _jsx("div", { className: "text-kira-text-muted text-sm", children: "Loading..." }) }));
    }
    if (!session) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(_Fragment, { children: children });
}
