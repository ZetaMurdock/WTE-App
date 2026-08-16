export type VttTool = "select" | "pan" | "token" | "wall" | "light" | "measure" | "effect" | "zone" | "draw";

export const VTT_TOOLS: { id: VttTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click or tap an object · drag tokens (snaps)" },
  { id: "pan", label: "Pan", hint: "Drag to pan · wheel or pinch to zoom" },
  { id: "token", label: "Token", hint: "Click or tap the map to place a token" },
  { id: "wall", label: "Wall", hint: "Drag with mouse or finger to draw a wall (blocks sight)" },
  { id: "light", label: "Light", hint: "Click or tap to place a light source" },
  { id: "measure", label: "Measure", hint: "Drag with mouse or finger to measure distance" },
  { id: "draw", label: "Draw", hint: "Freehand draw with mouse or finger — everyone sees your ink" },
  { id: "effect", label: "Effect", hint: "Click or tap to place an AoE / zone effect" },
  { id: "zone", label: "Paint", hint: "Paint effect zones by dragging — pick the brush in Scene Studio · Zones" },
];
