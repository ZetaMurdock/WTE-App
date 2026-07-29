// Scene backdrop: a fill for the playable area + optional map image (asset url).
import { Container, Graphics, Sprite } from "pixi.js";
import type { VttScene } from "../../types/scene";
import { describeSource, loadSceneTexture } from "../loadTexture";

export class BackgroundLayer {
  readonly view = new Container();
  private fill = new Graphics();
  private sprite: Sprite | null = null;
  private loadedSrc = "";
  /** Called when a map image cannot be shown. A background that silently fails to
   *  load is indistinguishable from a scene that never had one. */
  onImageError: ((detail: string) => void) | null = null;

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
        void loadSceneTexture(src)
          .then((tex) => {
            if (this.loadedSrc !== src) return;
            this.sprite = new Sprite(tex);
            this.view.addChild(this.sprite);
            this.place(scene);
          })
          .catch((e) => {
            if (this.loadedSrc !== src) return;
            // The fill stays, so the scene is still usable — but say so. This used
            // to be an empty catch, which is why a map that failed to load looked
            // exactly like a scene with no map.
            const why = e instanceof Error ? e.message : String(e);
            this.onImageError?.(`This scene's map image could not be loaded (${describeSource(src)}): ${why}`);
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
