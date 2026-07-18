import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts } from "../../lib/appToast";

// App-wide notices — mounted once, above everything. Currently used for save
// failures, which must never be silent.
export function AppToasts() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (!toasts.length) return null;
  return (
    <div className="app-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"app-toast " + t.kind}>
          <span>{t.text}</span>
          <button className="cdx-tab-x" onClick={() => dismissToast(t.id)} title="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
