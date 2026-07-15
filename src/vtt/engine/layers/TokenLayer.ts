// Token sprites: colour disc + optional circular art image + name label.
// Diffed against the scene; art is (re)loaded only when a token's img changes.
import { Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import type { VttScene, VttToken } from "../../types/scene";
import { cellKey } from "../systems/VisionSystem";

const STATUS_PALETTE = [0xa1584a, 0xa08a4f, 0x689a96, 0x837aae, 0x6f9a68, 0xa7aebd];
/** Stable colour per status tag, so a given status always reads the same. */
function statusColor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return STATUS_PALETTE[h % STATUS_PALETTE.length];
}

interface Node {
  root: Container;
  /** Rotating part (disc + art); the label stays upright. */
  body: Container;
  disc: Graphics;
  art: Sprite | null;
  artMask: Graphics | null;
  imgSrc: string; // currently loaded art uri
  label: Text;
  token: VttToken;
}

export class TokenLayer {
  readonly view = new Container();
  private nodes = new Map<string, Node>();
  /** On-canvas transform handles for the selected token (rotate + scale). */
  private handles = new Graphics();

  constructor() {
    this.view.addChild(this.handles);
  }

  /** World positions of the selected token's handles. */
  private handlePoints(t: VttToken, cell: number): { rot: { x: number; y: number }; scale: { x: number; y: number } } {
    const r = ((t.size || 1) * cell) / 2 - 4;
    const a = (((t.rotation || 0) - 90) * Math.PI) / 180; // knob starts straight up
    const rd = r + 22;
    const d = (r + 14) * 0.7071;
    return {
      rot: { x: t.x + Math.cos(a) * rd, y: t.y + Math.sin(a) * rd },
      scale: { x: t.x + d, y: t.y + d },
    };
  }

  /** Which transform handle (if any) is under the world point for the selected token. */
  pickHandle(scene: VttScene, selectedId: string, wx: number, wy: number, zoom: number): "rotate" | "scale" | null {
    const t = scene.data.tokens.find((x) => x.id === selectedId);
    if (!t) return null;
    const p = this.handlePoints(t, scene.data.grid.size);
    const tol = 14 / Math.max(zoom, 0.001);
    if ((wx - p.rot.x) ** 2 + (wy - p.rot.y) ** 2 <= tol * tol) return "rotate";
    if ((wx - p.scale.x) ** 2 + (wy - p.scale.y) ** 2 <= tol * tol) return "scale";
    return null;
  }

  sync(scene: VttScene, selectedId: string | null, visible: Set<string> | null = null): void {
    const { tokens, layers } = scene.data;
    this.view.visible = layers.tokens;
    const live = new Set(tokens.map((t) => t.id));
    for (const [id, n] of this.nodes) {
      if (!live.has(id)) {
        n.root.destroy({ children: true });
        this.nodes.delete(id);
      }
    }
    const cell = scene.data.grid.size;
    for (const t of tokens) {
      let n = this.nodes.get(t.id);
      if (!n) {
        const root = new Container();
        const body = new Container();
        const disc = new Graphics();
        body.addChild(disc);
        const label = new Text({
          text: "",
          style: { fontFamily: "Georgia, serif", fontSize: 13, fill: 0xd5dbe6, stroke: { color: 0x04070d, width: 3 } },
        });
        label.anchor.set(0.5, 0);
        root.addChild(body, label);
        this.view.addChild(root);
        n = { root, body, disc, art: null, artMask: null, imgSrc: "", label, token: t };
        this.nodes.set(t.id, n);
      }
      n.token = t;
      const r = ((t.size || 1) * cell) / 2 - 4;
      n.root.position.set(t.x, t.y);
      // Player view: a token in an unseen cell is hidden by the fog of war.
      const inFog = visible !== null && !visible.has(cellKey(Math.floor(t.x / cell), Math.floor(t.y / cell)));
      n.root.visible = t.visible !== false && !inFog;
      n.body.rotation = (((t.rotation || 0) % 360) * Math.PI) / 180;
      n.disc.clear();
      n.disc.circle(0, 0, r).fill(t.color || "#689a96");
      n.disc.circle(0, 0, r).stroke({ width: 2, color: 0x04070d });
      if (t.id === selectedId) n.disc.circle(0, 0, r + 4).stroke({ width: 2, color: 0x7ecfca, alpha: 0.9 });

      // Token art: (re)load only when the uri changes; mask to a circle.
      const img = t.img || "";
      if (img !== n.imgSrc) {
        n.imgSrc = img;
        if (n.art) (n.art.destroy(), (n.art = null));
        if (n.artMask) (n.artMask.destroy(), (n.artMask = null));
        if (img) {
          const node = n;
          void Assets.load(img)
            .then((tex) => {
              if (node.imgSrc !== img || !this.nodes.has(t.id)) return; // stale / removed
              const art = new Sprite(tex);
              art.anchor.set(0.5);
              const mask = new Graphics();
              node.body.addChild(mask, art);
              art.mask = mask;
              node.art = art;
              node.artMask = mask;
              this.sizeArt(node, node.token, cell);
            })
            .catch(() => {
              /* bad uri — keep the colour disc */
            });
        }
      }
      if (n.art) this.sizeArt(n, t, cell);

      // Status pips (SimulationSystem) — small dots along the top edge.
      const st = t.statuses ?? [];
      if (st.length) {
        const pipR = Math.max(3, r * 0.15);
        const gap = pipR * 2.4;
        const startX = -((st.length - 1) * gap) / 2;
        const y = -r - pipR - 2;
        for (let i = 0; i < st.length; i++) {
          const cx = startX + i * gap;
          n.disc.circle(cx, y, pipR).fill(statusColor(st[i]));
          n.disc.circle(cx, y, pipR).stroke({ width: 1, color: 0x04070d });
        }
      }

      n.label.text = t.name || "";
      n.label.position.set(0, r + 4);
    }

    // transform handles on the selected token (rotate knob up, scale knob corner)
    this.handles.clear();
    this.view.addChild(this.handles); // keep on top
    const selTok = selectedId ? tokens.find((t) => t.id === selectedId) : null;
    if (selTok && selTok.visible !== false) {
      const p = this.handlePoints(selTok, cell);
      const r = ((selTok.size || 1) * cell) / 2 - 4;
      const a = (((selTok.rotation || 0) - 90) * Math.PI) / 180;
      this.handles.moveTo(selTok.x + Math.cos(a) * r, selTok.y + Math.sin(a) * r);
      this.handles.lineTo(p.rot.x, p.rot.y);
      this.handles.stroke({ width: 1.5, color: 0x7ecfca, alpha: 0.9 });
      this.handles.circle(p.rot.x, p.rot.y, 7).fill({ color: 0x0a1122 });
      this.handles.circle(p.rot.x, p.rot.y, 7).stroke({ width: 2, color: 0x7ecfca });
      this.handles.rect(p.scale.x - 6, p.scale.y - 6, 12, 12).fill({ color: 0x0a1122 });
      this.handles.rect(p.scale.x - 6, p.scale.y - 6, 12, 12).stroke({ width: 2, color: 0x7ecfca });
    }
  }

  private sizeArt(n: Node, t: VttToken, cell: number): void {
    if (!n.art || !n.artMask) return;
    const r = ((t.size || 1) * cell) / 2 - 5;
    n.art.width = r * 2;
    n.art.height = r * 2;
    n.artMask.clear();
    n.artMask.circle(0, 0, r).fill(0xffffff);
  }

  /** Topmost token whose disc contains the world point. */
  pick(scene: VttScene, wx: number, wy: number): VttToken | null {
    const cell = scene.data.grid.size;
    const list = scene.data.tokens;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const r = ((t.size || 1) * cell) / 2;
      if ((wx - t.x) ** 2 + (wy - t.y) ** 2 <= r * r) return t;
    }
    return null;
  }
}
