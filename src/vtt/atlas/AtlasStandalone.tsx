import { useEffect, useMemo } from "react";
import { AtlasWindow } from "./AtlasWindow";
import { closeThisWindow, parseAtlasHash } from "./atlasBridge";
import { AppToasts } from "../../components/ui/AppToasts";
import { NetProvider } from "../../net/NetContext";
import { installSaveGuards } from "../../lib/saveQueue";

// The popped-out Atlas: an OS window that is nothing but the instrument.
//
// main.tsx routes here when the URL hash says #/atlas (the pop-out button in
// the inline Atlas builds that URL). Everything interesting — DB access for
// the curator, the bridge back to the main window for netplay — lives in
// AtlasWindow's standalone mode; this page just gives it the whole window.
export function AtlasStandalone() {
  const params = useMemo(() => parseAtlasHash(window.location.hash), []);
  // App.tsx normally installs these; this window boots without App, and a
  // curator closing it mid-debounce must not lose the last edit.
  useEffect(() => {
    installSaveGuards();
  }, []);
  if (!params) {
    return <p className="atlas-note">This window was opened without a campaign. Close it and pop the Atlas out again from the table.</p>;
  }
  return (
    // NetProvider sits idle here — the popped window never joins a session
    // (the bridge proxies through the main window) — but AtlasWindow reads the
    // context unconditionally, and an idle provider is what "not connected"
    // looks like everywhere else in the app.
    <NetProvider>
      <div className="atlas-standalone-page">
        <AtlasWindow
          campaignId={params.campaignId}
          curator={params.curator}
          standalone
          bridgePlayer={params.netPlayer}
          onClose={closeThisWindow}
        />
        <AppToasts />
      </div>
    </NetProvider>
  );
}
