import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api.js";

interface ResearchNote {
  id: string;
  content: string;
  pinned: boolean;
  is_ai_message: boolean;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ResearchNotesPanel({ tokenAddress }: { tokenAddress: string }) {
  const [open, setOpen] = useState(true);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  function load() {
    setLoading(true);
    apiRequest<{ notes: ResearchNote[] }>("GET", `/token/${tokenAddress}/notes`)
      .then((res) => setNotes(res.notes))
      .finally(() => setLoading(false));
  }

  useEffect(load, [tokenAddress]);

  useEffect(() => {
    if (open) threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [notes, open]);

  // Plain note: saved as-is, no AI call. Distinguished from an "Ask Kira" question only by which
  // button the user clicks -- both are ordinary rows (is_ai_message: false) in the same thread.
  async function handleSaveNote() {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setAskError(null);
    try {
      const res = await apiRequest<{ note: ResearchNote }>("POST", `/token/${tokenAddress}/notes`, { content });
      setNotes((prev) => [...prev, res.note]);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  // "Ask Kira": persists the question first (so it's in the thread even if /ask fails), then
  // calls the existing /ask endpoint and persists the answer as an is_ai_message row linked back
  // to the question via parent_id.
  async function handleAskKira() {
    const question = draft.trim();
    if (!question) return;
    setSending(true);
    setAskError(null);
    try {
      const questionRes = await apiRequest<{ note: ResearchNote }>("POST", `/token/${tokenAddress}/notes`, {
        content: question,
      });
      setNotes((prev) => [...prev, questionRes.note]);
      setDraft("");

      try {
        const askRes = await apiRequest<{ answer: string }>("POST", "/ask", { tokenAddress, question });
        const answerRes = await apiRequest<{ note: ResearchNote }>("POST", `/token/${tokenAddress}/notes`, {
          content: askRes.answer,
          isAiMessage: true,
          parentId: questionRes.note.id,
        });
        setNotes((prev) => [...prev, answerRes.note]);
      } catch {
        setAskError("Kira couldn't answer that just now — your question was saved, try again later.");
      }
    } finally {
      setSending(false);
    }
  }

  async function togglePin(note: ResearchNote) {
    const res = await apiRequest<{ note: ResearchNote }>("PATCH", `/token/${tokenAddress}/notes/${note.id}`, {
      pinned: !note.pinned,
    });
    setNotes((prev) => prev.map((n) => (n.id === note.id ? res.note : n)));
  }

  async function handleDelete(id: string) {
    await apiRequest("DELETE", `/token/${tokenAddress}/notes/${id}`);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-tt-fg"
      >
        <span>Research Thread{notes.length > 0 && ` (${notes.length})`}</span>
        <span className="text-tt-fg-dim text-xs">{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-tt-border pt-3">
          {loading ? (
            <p className="text-xs text-tt-fg-dim">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-tt-fg-faint mb-3">
              No messages yet. Add a note, or ask Kira a question about this token.
            </p>
          ) : (
            <div className="space-y-3 mb-3 max-h-96 overflow-y-auto">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className={`text-xs rounded-md px-3 py-2 border ${
                    note.is_ai_message
                      ? "bg-tt-bg-panel border-tt-brand/40"
                      : "bg-tt-bg-panel border-tt-border"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-tt-fg-faint">
                    <span className={note.is_ai_message ? "text-tt-brand font-medium" : "text-tt-fg-dim font-medium"}>
                      {note.is_ai_message ? "Kira" : "You"}
                    </span>
                    <span>· {fmtTime(note.created_at)}</span>
                    {note.pinned && <span>· pinned</span>}
                  </div>
                  <p className="text-tt-fg whitespace-pre-wrap">{note.content}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-tt-fg-faint">
                    <button onClick={() => void togglePin(note)} className="hover:text-tt-brand">
                      {note.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button onClick={() => void handleDelete(note.id)} className="hover:text-tt-red">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              <div ref={threadEndRef} />
            </div>
          )}

          {askError && <p className="text-xs text-tt-red mb-2">{askError}</p>}

          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a note, or ask Kira about this token..."
              rows={2}
              className="bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 text-xs text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand resize-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => void handleSaveNote()}
                disabled={sending || !draft.trim()}
                className="bg-tt-bg-panel border border-tt-border text-tt-fg rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:border-tt-brand"
              >
                Save Note
              </button>
              <button
                onClick={() => void handleAskKira()}
                disabled={sending || !draft.trim()}
                className="bg-tt-brand text-tt-bg rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {sending ? "Asking..." : "Ask Kira"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
