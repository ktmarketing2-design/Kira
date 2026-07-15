import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./useAuth.js";
import { apiRequest, ApiError } from "../lib/api.js";
export default function LinkPage() {
    const { code } = useParams();
    const { session, loading } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState("waiting");
    const [error, setError] = useState(null);
    useEffect(() => {
        if (loading || !code)
            return;
        if (!session) {
            setStatus("waiting");
            return;
        }
        setStatus("linking");
        apiRequest("POST", "/auth/telegram-link", { code })
            .then(() => {
            setStatus("done");
            setTimeout(() => navigate("/dashboard"), 3000);
        })
            .catch((err) => {
            setStatus("error");
            setError(err instanceof ApiError ? String(err.body ?? err.message) : "Something went wrong.");
        });
    }, [loading, session, code, navigate]);
    return (_jsx("div", { className: "min-h-screen bg-kira-bg flex items-center justify-center px-4", children: _jsxs("div", { className: "w-full max-w-sm bg-kira-surface border border-kira-border rounded-md p-6 text-center", children: [_jsx("div", { className: "font-display text-xl tracking-widest text-kira-text mb-4", children: "KIRA" }), status === "waiting" && !loading && (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-kira-text", children: "Log in to connect your Telegram account." }), _jsx("a", { href: "/login", className: "inline-block mt-4 text-kira-accent text-sm hover:underline", children: "Go to login \u2192" })] })), (loading || status === "linking") && _jsx("p", { className: "text-sm text-kira-text-muted", children: "Connecting..." }), status === "done" && (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-kira-green", children: "Telegram connected." }), _jsx("p", { className: "text-xs text-kira-text-muted mt-2", children: "Alerts will now be delivered to your Telegram. Redirecting..." })] })), status === "error" && (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-kira-red", children: "Couldn't connect Telegram." }), _jsx("p", { className: "text-xs text-kira-text-muted mt-2", children: error })] }))] }) }));
}
