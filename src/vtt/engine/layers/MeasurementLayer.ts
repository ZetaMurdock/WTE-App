// Live measurement ruler: line + distance readout (cells × 5 ft).
import { Container, Graphics, Text } from "pixi.js";

export class MeasurementLayer {
  readonly view = new Container();
  private line = new Graphics();
  private label = new Text({
    text: "",
    style: { fontFamily: "Consolas, monospace", fontSize: 14, fill: 0x7ecfca, stroke: { color: 0x04070d, width: 3 } },
  });

  constructor() {
    this.label.anchor.set(0.5, 1);
    this.view.addChild(this.line, this.label);
    this.view.visible = false;
  }

  show(x1: number, y1: number, x2: number, y2: number, cellSize: number): void {
    this.view.visible = true;
    this.line.clear();
    this.line.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2, color: 0x7ecfca, alpha: 0.9 });
    this.line.circle(x1, y1, 4).fill(0x7ecfca);
    this.line.circle(x2, y2, 4).fill(0x7ecfca);
    const cells = Math.hypot(x2 - x1, y2 - y1) / cellSize;
    this.label.text = `${Math.round(cells * 10) / 10} cells · ${Math.round(cells * 5)} ft`;
    this.label.position.set((x1 + x2) / 2, (y1 + y2) / 2 - 8);
  }
  clear(): void {
    this.view.visible = false;
  }
}
