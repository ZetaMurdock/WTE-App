export type VttTool = "select" | "pan" | "token" | "measure";

export const VTT_TOOLS: { id: VttTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click a token · drag to move (snaps to grid)" },
  { id: "pan", label: "Pan", hint: "Drag to pan · wheel zooms (any tool)" },
  { id: "token", label: "Token", hint: "Click the map to place a token" },
  { id: "measure", label: "Measure", hint: "Drag to measure distance" },
];
