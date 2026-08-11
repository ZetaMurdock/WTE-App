import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BootGate } from "./components/BootGate";
import { isStandaloneAtlas } from "./vtt/atlas/atlasBridge";
import { AtlasStandalone } from "./vtt/atlas/AtlasStandalone";
import "./styles.css";

// A second OS window carrying only the Atlas boots this same bundle with a
// routing hash. It still goes through BootGate — a read-only probe; the main
// window did any backup work long before a pop-out could exist.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Nothing may open the database before the pre-upgrade backup is confirmed. */}
    <BootGate>{isStandaloneAtlas() ? <AtlasStandalone /> : <App />}</BootGate>
  </React.StrictMode>
);
