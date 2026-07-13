// Token sprites: colour disc + optional circular art image + name label.
// Diffed against the scene; art is (re)loaded only when a token's img changes.
import { Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import type { VttScene, VttToken } from "../../types/scene";

const STATUS_PALETTE = [0xa1584a, 0xa08a4f, 0x689a96, 0x837aae, 0x6f9a68, 0xa7aebd];
/** Stable colour per status tag, so a given status always reads the same. */
function statusColor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return STATUS_PALETTE[h % STATUS_PALETTE.length];
}

interface Node {
  root: Container;
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

  sync(scene: VttScene, selectedId: string | null): void {
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
        const disc = new Graphics();
        const label = new Text({
          text: "",
          style: { fontFamily: "Georgia, serif", fontSize: 13, fill: 0xd5dbe6, stroke: { color: 0x04070d, width: 3 } },
        });
        label.anchor.set(0.5, 0);
        root.addChild(disc, label);
        this.view.addChild(root);
        n = { root, disc, art: null, artMask: null, imgSrc: "", label, token: t };
        this.nodes.set(t.id, n);
      }
      n.token = t;
      const r = ((t.size || 1) * cell) / 2 - 4;
      n.root.position.set(t.x, t.y);
      n.root.visible = t.visible !== false;
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
              node.root.addChildAt(mask, 1);
              node.root.addChildAt(art, 2);
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
