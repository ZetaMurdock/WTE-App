export type VttTool = "select" | "pan" | "token" | "wall" | "light" | "measure" | "effect" | "zone";

export const VTT_TOOLS: { id: VttTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click a token, wall, light, or effect · drag tokens (snaps)" },
  { id: "pan", label: "Pan", hint: "Drag to pan · wheel zooms (any tool)" },
  { id: "token", label: "Token", hint: "Click the map to place a token" },
  { id: "wall", label: "Wall", hint: "Drag to draw a wall (blocks sight)" },
  { id: "light", label: "Light", hint: "Click to place a light source" },
  { id: "measure", label: "Measure", hint: "Drag to measure distance" },
  { id: "effect", label: "Effect", hint: "Click to place an AoE / zone effect" },
  { id: "zone", label: "Paint", hint: "Paint effect zones (water / smoke / embers) — pick the brush in Scene Studio · Zones" },
];
