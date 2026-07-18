import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";

interface ResearchNote {
  id: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ResearchNotesPanel({ tokenAddress }: { tokenAddress: string }) {
  const [open, setOpen] = useState(true);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    apiRequest<{ notes: ResearchNote[] }>("GET", `/token/${tokenAddress}/notes`)
      .then((res) => setNotes(res.notes))
      .finally(() => setLoading(false));
  }

  useEffect(load, [tokenAddress]);

  async function handleSave() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ note: ResearchNote }>("POST", `/token/${tokenAddress}/notes`, { content });
      setNotes((prev) => [res.note, ...prev]);
      setDraft("");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: ResearchNote) {
    const res = await apiRequest<{ note: ResearchNote }>("PATCH", `/token/${tokenAddress}/notes/${note.id}`, {
      pinned: !note.pinned,
    });
    setNotes((prev) =>
      [...prev.filter((n) => n.id !== note.id), res.note].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    );
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
        <span>📝 Research Notes{notes.length > 0 && ` (${notes.length})`}</span>
        <span className="text-tt-fg-dim text-xs">{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-tt-border pt-3">
          {loading ? (
            <p className="text-xs text-tt-fg-dim">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-tt-fg-faint mb-3">No notes yet.</p>
          ) : (
            <div className="space-y-3 mb-3">
              {notes.map((note) => (
                <div key={note.id} className="text-xs">
                  <p className="text-tt-fg whitespace-pre-wrap">
                    {note.pinned && "📌 "}
                    {note.content}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-tt-fg-faint">
                    <span>
                      {fmtDate(note.created_at)}
                      {note.pinned && " · pinned"}
                    </span>
                    <button onClick={() => void togglePin(note)} className="hover:text-tt-brand">
                      {note.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button onClick={() => void handleDelete(note.id)} className="hover:text-tt-red">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a note..."
              rows={2}
              className="bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 text-xs text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand resize-none"
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving || !draft.trim()}
              className="self-end bg-tt-brand text-tt-bg rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
