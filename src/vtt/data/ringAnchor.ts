// Where an on-map ring of buttons sits, as arithmetic with no clock in it.
//
// Lifted out of `VttRadialMenu`, which had this math inline inside a
// requestAnimationFrame callback. A rAF loop is not a thing a test can hold
// still, so the one piece of the radial menu that could actually be wrong — the
// world-to-screen transform — was the piece nothing checked. Everything here is
// pure: a world point, a camera and a viewport in, screen pixels out.
//
// ONE anchoring approach. The ability ring and the token ring call the same two
// functions, so a camera convention that changes changes in one place. Two
// re-implementations of `world * zoom + pan` drift the first time either grows
// a special case.

export interface RingCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface RingViewport {
  width: number;
  height: number;
}

/** Clear air between a body's edge and the button centres around it. */
export const RING_GAP = 30;

/** Diameter of one ring button, in screen px, and the number the spacing is
 *  derived from. Fixed rather than measured: the radius has to be known before
 *  the buttons are laid out, and a layout read per frame to discover a constant
 *  is a reflow per frame.
 *
 *  Set to the LARGEST the button ever gets — 46px, the finger-sized variant a
 *  coarse pointer is given in styles.css. Sizing the ring for the 38px desktop
 *  button would have let two touch buttons overlap on exactly the devices where
 *  a mis-press is hardest to undo. */
export const RING_BUTTON = 46;

export interface RingRadiusInput {
  camera: RingCamera;
  /** The body the ring must clear, in grid cells. */
  bodyCells?: number;
  /** World px per grid cell. */
  gridSize?: number;
  gap?: number;
  /** How many buttons the ring has to hold. Omit for a ring with a fixed
   *  layout — the token radial's four cardinal buttons never crowd. */
  count?: number;
}

/**
 * How far the buttons sit from the anchor.
 *
 * A floor derived from the button COUNT, because the alternative is buttons
 * that overlap: eight buttons need eight button-widths of circumference between
 * them, and a size-1 token at low zoom offers a radius of about 35. Deriving
 * the floor rather than picking one means a ring that grows a seventh button
 * cannot silently start stacking two of them on top of each other.
 */
export function ringRadius(input: RingRadiusInput): number {
  const body = ((Math.max(1, input.bodyCells ?? 1) * (input.gridSize ?? 70)) / 2) * input.camera.zoom + (input.gap ?? RING_GAP);
  if (!input.count || input.count <= 0) return body;
  const crowded = (input.count * (RING_BUTTON + 8)) / (2 * Math.PI);
  return Math.max(body, crowded);
}

export interface RingPlacementInput {
  /** Where on the map the ring is ABOUT. Null when the thing it followed is
   *  gone — a deleted token, an origin the scene never had. */
  world: { x: number; y: number } | null;
  camera: RingCamera;
  radius: number;
  /** The stage the ring is drawn in. Absent or unmeasured clamps nothing:
   *  clamping against a viewport of zero would pin every ring to the top-left
   *  corner for the first frame after a mount, before layout has run. */
  viewport?: RingViewport | null;
  /** Half a button, so a clamped ring keeps its buttons on the canvas rather
   *  than just its centre. */
  edge?: number;
}

export interface RingPlacement {
  x: number;
  y: number;
  radius: number;
  /** The anchor's own screen point was off the stage (or too near an edge to
   *  draw the ring) and the ring was pulled back in. Reported rather than done
   *  silently: a ring that has drifted off the body it belongs to needs to say
   *  so, or it reads as anchored to the wrong thing. */
  clamped: boolean;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * The ring's centre in stage pixels, or null when there is nothing to anchor to.
 *
 * Callers pass the LIVE display position, not the token's stored square: a
 * token mid-drag is interpolating toward its cell, and reading the stored value
 * makes the ring lag a whole cell behind the body it is glued to.
 */
export function ringPlacement(input: RingPlacementInput): RingPlacement | null {
  if (!input.world) return null;
  const { camera, radius } = input;
  const x = input.world.x * camera.zoom + camera.x;
  const y = input.world.y * camera.zoom + camera.y;
  const vp = input.viewport;
  if (!vp || vp.width <= 0 || vp.height <= 0) return { x, y, radius, clamped: false };
  // A viewport narrower than the ring itself has no legal centre; half the
  // stage is the least-wrong answer and beats NaN or a negative bound.
  const margin = radius + (input.edge ?? RING_BUTTON / 2);
  const padX = Math.min(margin, vp.width / 2);
  const padY = Math.min(margin, vp.height / 2);
  const cx = clamp(x, padX, vp.width - padX);
  const cy = clamp(y, padY, vp.height - padY);
  return { x: cx, y: cy, radius, clamped: cx !== x || cy !== y };
}

/**
 * Button centres around the ring, relative to its centre, starting at the top
 * and going clockwise.
 *
 * Clockwise from twelve o'clock so the FIRST action an ability offers — placing
 * what it declared — is the one nearest the pointer arriving from the abilities
 * dock, which sits above and to the left.
 */
export function ringOffsets(count: number, radius: number, startAngle = -Math.PI / 2): { dx: number; dy: number }[] {
  if (count <= 0) return [];
  const step = (Math.PI * 2) / count;
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + index * step;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  });
}
