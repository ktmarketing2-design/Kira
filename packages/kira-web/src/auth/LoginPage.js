import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useAuth } from "./useAuth.js";
export default function LoginPage() {
    const { sendMagicLink, configError } = useAuth();
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("idle");
    const [error, setError] = useState(null);
    async function handleSubmit(e) {
        e.preventDefault();
        if (!email)
            return;
        setStatus("sending");
        setError(null);
        const err = await sendMagicLink(email);
        if (err) {
            setStatus("error");
            setError(err);
            return;
        }
        setStatus("sent");
    }
    return (_jsx("div", { className: "min-h-screen bg-kira-bg flex items-center justify-center px-4", children: _jsxs("div", { className: "w-full max-w-sm", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "font-display text-2xl tracking-widest text-kira-text", children: "KIRA" }), _jsx("div", { className: "text-kira-text-muted text-xs mt-1", children: "by Ceronix Labs" })] }), _jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-6", children: [configError && (_jsx("div", { className: "mb-4 text-xs text-kira-red border border-kira-red/40 rounded p-2", children: configError })), status === "sent" ? (_jsxs("div", { className: "text-center py-4", children: [_jsx("p", { className: "text-kira-text text-sm", children: "Check your inbox." }), _jsxs("p", { className: "text-kira-text-muted text-xs mt-2", children: ["We sent a magic link to ", _jsx("span", { className: "text-kira-text", children: email }), ". Click it to sign in."] })] })) : (_jsxs("form", { onSubmit: handleSubmit, className: "space-y-3", children: [_jsx("label", { className: "block text-xs text-kira-text-muted uppercase tracking-wide", children: "Email" }), _jsx("input", { type: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", className: "w-full bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-sm text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent" }), status === "error" && error && _jsx("p", { className: "text-xs text-kira-red", children: error }), _jsx("button", { type: "submit", disabled: status === "sending", className: "w-full bg-kira-accent text-kira-bg text-sm font-medium rounded px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity", children: status === "sending" ? "Sending..." : "Send magic link" })] }))] }), _jsxs("div", { className: "mt-4 bg-kira-surface border border-kira-border rounded-md p-4", children: [_jsx("p", { className: "text-xs text-kira-text-muted mb-2", children: "Or connect with Telegram" }), _jsx("a", { href: "https://t.me/KiraByCeronixBot", target: "_blank", rel: "noreferrer", className: "text-kira-accent text-sm font-data hover:underline", children: "@KiraByCeronixBot" }), _jsx("p", { className: "text-xs text-kira-text-dim mt-2", children: "Message /start to the bot, then use the link it sends you to connect this account." })] })] }) }));
}
