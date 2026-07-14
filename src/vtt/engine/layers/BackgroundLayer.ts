// Scene backdrop: a fill for the playable area + optional map image (asset url).
import { Assets, Container, Graphics, Sprite } from "pixi.js";
import type { VttScene } from "../../types/scene";

export class BackgroundLayer {
  readonly view = new Container();
  private fill = new Graphics();
  private sprite: Sprite | null = null;
  private loadedSrc = "";

  constructor() {
    this.view.addChild(this.fill);
  }

  draw(scene: VttScene): void {
    const { grid, background } = scene.data;
    const w = grid.cols * grid.size;
    const h = grid.rows * grid.size;
    this.fill.clear();
    this.fill.rect(0, 0, w, h).fill(background.color || "#0c1220");
    this.fill.rect(0, 0, w, h).stroke({ width: 2, color: 0x1a2233 });

    const src = background.src || "";
    if (src !== this.loadedSrc) {
      this.loadedSrc = src;
      if (this.sprite) {
        this.sprite.destroy();
        this.sprite = null;
      }
      if (src) {
        void Assets.load(src)
          .then((tex) => {
            if (this.loadedSrc !== src) return;
            this.sprite = new Sprite(tex);
            this.view.addChild(this.sprite);
            this.place(scene);
          })
          .catch(() => {
            /* bad url — keep the fill */
          });
      }
    } else {
      this.place(scene);
    }
  }

  private place(scene: VttScene): void {
    if (!this.sprite) return;
    const b = scene.data.background;
    if ((b.fit ?? "grid") === "grid") {
      // Stretch the map image to cover the whole playable grid.
      const { grid } = scene.data;
      this.sprite.position.set(0, 0);
      this.sprite.width = grid.cols * grid.size;
      this.sprite.height = grid.rows * grid.size;
    } else {
      this.sprite.scale.set(b.scale || 1);
      this.sprite.position.set(b.x, b.y);
    }
  }
}
