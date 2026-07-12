// Token sprites: circle + name label (+ HP pip later). Diffed against the scene.
import { Container, Graphics, Text } from "pixi.js";
import type { VttScene, VttToken } from "../../types/scene";

interface Node {
  root: Container;
  disc: Graphics;
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
        n = { root, disc, label, token: t };
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
      n.label.text = t.name || "";
      n.label.position.set(0, r + 4);
    }
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
