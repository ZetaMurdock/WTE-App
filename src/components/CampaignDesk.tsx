import { useMemo, useState } from "react";
import {
  listDeskNotes,
  newDeskNote,
  saveDeskNote,
  deleteDeskNote,
  listCalEvents,
  newCalEvent,
  saveCalEvent,
  deleteCalEvent,
  type DeskNote,
  type DeskNoteKind,
  type CalEvent,
  type CalKind,
} from "../lib/campaignDesk";

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
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [noteTab, setNoteTab] = useState<DeskNoteKind>("inquisitor");

  const tabs = NOTE_TABS.filter((t) => t.kind !== "curator" || curator);
  const activeTab = tabs.some((t) => t.kind === noteTab) ? noteTab : "inquisitor";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notes = useMemo(() => listDeskNotes(campaignId, activeTab), [campaignId, activeTab, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => listCalEvents(campaignId), [campaignId, tick]);

  return (
    <div className="desk-grid">
      {/* ── Notes ── */}
      <div className="desk-col">
        <div className="desk-head">
          <span className="panel-title" style={{ margin: 0 }}>
            Notes
          </span>
          <button className="chip" onClick={() => { newDeskNote(campaignId, activeTab); bump(); }}>
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
            </button>
          ))}
        </div>
        <p className="identity-hint" style={{ margin: "0 0 8px" }}>{NOTE_TABS.find((t) => t.kind === activeTab)?.blurb}</p>
        {notes.length === 0 ? (
          <p className="list-empty">No {activeTab} notes yet.</p>
        ) : (
          notes.map((n) => <NoteCard key={n.id} campaignId={campaignId} note={n} onChanged={bump} />)
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

function NoteCard({ campaignId, note, onChanged }: { campaignId: string; note: DeskNote; onChanged: () => void }) {
  const [n, setN] = useState(note);
  function patch(p: Partial<DeskNote>) {
    const next = { ...n, ...p };
    setN(next);
    saveDeskNote(campaignId, next);
  }
  return (
    <div className="desk-note">
      <div className="desk-note-head">
        <input className="desk-note-title" value={n.title} placeholder="Title…" onChange={(e) => patch({ title: e.target.value })} />
        <button className="cdx-flag" title="Delete note" onClick={() => { deleteDeskNote(campaignId, n.id); onChanged(); }}>
          ×
        </button>
      </div>
      <textarea className="desk-note-body" value={n.body} placeholder="Write…" onChange={(e) => patch({ body: e.target.value })} />
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
