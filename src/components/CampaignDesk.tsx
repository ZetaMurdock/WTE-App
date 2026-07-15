import { useEffect, useMemo, useState } from "react";
import {
  listDeskNotes,
  newDeskNote,
  saveDeskNote,
  deleteDeskNote,
  setUnitNotesLocal,
  listCalEvents,
  newCalEvent,
  saveCalEvent,
  deleteCalEvent,
  type DeskNote,
  type DeskNoteKind,
  type CalEvent,
  type CalKind,
} from "../lib/campaignDesk";
import { useNet } from "../net/NetContext";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "d-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

interface Props {
  campaignId: string;
  /** Curator mode unlocks the GM-only Curator notes and calendar editing. */
  curator: boolean;
}

const NOTE_TABS: { kind: DeskNoteKind; label: string; blurb: string }[] = [
  { kind: "inquisitor", label: "Inquisitor", blurb: "Your own notes." },
  { kind: "unit", label: "Unit", blurb: "Shared party notes." },
  { kind: "curator", label: "Curator", blurb: "GM-only — hidden from players." },
];
const CAL_KINDS: CalKind[] = ["session", "event", "deadline"];

// The campaign desk: three note ledgers (Inquisitor / Unit / Curator) and a
// campaign calendar of sessions, in-world events, and deadlines.
export function CampaignDesk({ campaignId, curator }: Props) {
  const net = useNet();
  const connected = net.status === "connected";
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [noteTab, setNoteTab] = useState<DeskNoteKind>("inquisitor");

  const tabs = NOTE_TABS.filter((t) => t.kind !== "curator" || curator);
  const activeTab = tabs.some((t) => t.kind === noteTab) ? noteTab : "inquisitor";
  // Unit notes go live over netplay when connected; other ledgers stay local.
  const unitShared = connected;

  // Host seeds the shared party notes from its local ones once, on connect.
  useEffect(() => {
    if (connected && net.role === "host" && net.unitNotes.length === 0) {
      const local = listDeskNotes(campaignId, "unit");
      if (local.length) net.syncUnitNotes(local);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, net.role]);
  // Host persists the shared party notes to its campaign so they survive the session.
  useEffect(() => {
    if (connected && net.role === "host") setUnitNotesLocal(campaignId, net.unitNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, net.unitNotes]);

  const notes = useMemo(
    () => (activeTab === "unit" && unitShared ? net.unitNotes : listDeskNotes(campaignId, activeTab)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaignId, activeTab, tick, unitShared, net.unitNotes]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => listCalEvents(campaignId), [campaignId, tick]);

  // Save/delete route through netplay for shared Unit notes, else the local store.
  function saveNote(n: DeskNote) {
    if (n.kind === "unit" && unitShared) net.upsertUnitNote({ ...n, updatedAt: Date.now() });
    else saveDeskNote(campaignId, n);
  }
  function removeNote(n: DeskNote) {
    if (n.kind === "unit" && unitShared) net.deleteUnitNote(n.id);
    else deleteDeskNote(campaignId, n.id);
    bump();
  }
  function addNote() {
    if (activeTab === "unit" && unitShared) net.upsertUnitNote({ id: uid(), kind: "unit", title: "", body: "", updatedAt: Date.now() });
    else {
      newDeskNote(campaignId, activeTab);
      bump();
    }
  }

  return (
    <div className="desk-grid">
      {/* ── Notes ── */}
      <div className="desk-col">
        <div className="desk-head">
          <span className="panel-title" style={{ margin: 0 }}>
            Notes
          </span>
          <button className="chip" onClick={addNote}>
            + New note
          </button>
        </div>
        <div className="desk-tabs">
          {tabs.map((t) => (
            <button
              key={t.kind}
              className={"desk-tab" + (activeTab === t.kind ? " active" : "") + (t.kind === "curator" ? " gm" : "")}
              onClick={() => setNoteTab(t.kind)}
              title={t.blurb}
            >
              {t.label}
              {t.kind === "unit" && unitShared && <span className="desk-live" title="Live-synced with the party"> ●</span>}
            </button>
          ))}
        </div>
        <p className="identity-hint" style={{ margin: "0 0 8px" }}>
          {NOTE_TABS.find((t) => t.kind === activeTab)?.blurb}
          {activeTab === "unit" && unitShared ? " Shared live with the room." : ""}
        </p>
        {notes.length === 0 ? (
          <p className="list-empty">No {activeTab} notes yet.</p>
        ) : (
          notes.map((n) => <NoteCard key={n.id} note={n} onSave={saveNote} onDelete={removeNote} />)
        )}
      </div>

      {/* ── Calendar ── */}
      <div className="desk-col">
        <div className="desk-head">
          <span className="panel-title" style={{ margin: 0 }}>
            Calendar
          </span>
          {curator && (
            <button className="chip" onClick={() => { newCalEvent(campaignId); bump(); }}>
              + New entry
            </button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="list-empty">{curator ? "No entries — add sessions, events, deadlines." : "The Curator hasn't scheduled anything yet."}</p>
        ) : (
          events.map((e) => <EventCard key={e.id} campaignId={campaignId} ev={e} editable={curator} onChanged={bump} />)
        )}
      </div>
    </div>
  );
}

function NoteCard({ note, onSave, onDelete }: { note: DeskNote; onSave: (n: DeskNote) => void; onDelete: (n: DeskNote) => void }) {
  // Local edit state, but re-seed if the note changes underneath us (a live
  // netplay update to this same note) while it isn't focused.
  const [n, setN] = useState(note);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setN(note);
  }, [note, focused]);
  function patch(p: Partial<DeskNote>) {
    const next = { ...n, ...p };
    setN(next);
    onSave(next);
  }
  return (
    <div className="desk-note">
      <div className="desk-note-head">
        <input
          className="desk-note-title"
          value={n.title}
          placeholder="Title…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => patch({ title: e.target.value })}
        />
        <button className="cdx-flag" title="Delete note" onClick={() => onDelete(n)}>
          ×
        </button>
      </div>
      <textarea
        className="desk-note-body"
        value={n.body}
        placeholder="Write…"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => patch({ body: e.target.value })}
      />
    </div>
  );
}

function EventCard({ campaignId, ev, editable, onChanged }: { campaignId: string; ev: CalEvent; editable: boolean; onChanged: () => void }) {
  const [e, setE] = useState(ev);
  function patch(p: Partial<CalEvent>) {
    const next = { ...e, ...p };
    setE(next);
    saveCalEvent(campaignId, next);
  }
  if (!editable) {
    return (
      <div className={"desk-event k-" + e.kind}>
        <div className="desk-event-when">
          <span className={"desk-event-kind k-" + e.kind}>{e.kind}</span>
          {e.date && <span>{e.date}</span>}
          {e.inWorld && <span className="desk-event-world">{e.inWorld}</span>}
        </div>
        <div className="desk-event-title">{e.title || "Untitled"}</div>
        {e.body && <div className="desk-event-body">{e.body}</div>}
      </div>
    );
  }
  return (
    <div className={"desk-event editable k-" + e.kind}>
      <div className="desk-event-row">
        <select className="bg-select" value={e.kind} onChange={(ev2) => patch({ kind: ev2.target.value as CalKind })}>
          {CAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input className="bg-select" type="date" value={e.date} onChange={(ev2) => patch({ date: ev2.target.value })} />
        <button className="cdx-flag" title="Delete entry" onClick={() => { deleteCalEvent(campaignId, e.id); onChanged(); }}>
          ×
        </button>
      </div>
      <input className="desk-note-title" value={e.title} placeholder="Title…" onChange={(ev2) => patch({ title: ev2.target.value })} />
      <input className="bg-select full" value={e.inWorld} placeholder="In-world date (e.g. Year 3261 · Cycle 4)" onChange={(ev2) => patch({ inWorld: ev2.target.value })} />
      <textarea className="desk-note-body" value={e.body} placeholder="Details…" onChange={(ev2) => patch({ body: ev2.target.value })} />
    </div>
  );
}
