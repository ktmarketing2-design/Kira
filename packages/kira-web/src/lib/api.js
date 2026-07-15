import { supabase } from "./supabase.js";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4020";
export class ApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`API request failed with status ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
    }
}
async function authHeader() {
    const { data: { session }, } = await supabase.auth.getSession();
    return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};
}
export async function apiRequest(method, path, body) {
    const headers = await authHeader();
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
        throw new ApiError(res.status, json);
    }
    return json;
}
