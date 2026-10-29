import type { Player } from "./player";

const METERS_PER_WORLD_UNIT = 10;
const KILOMETERS_PER_METER = 0.001;
const SECONDS_PER_HOUR = 3600;

export class Speedometer {
  private player: Player;

  private textElement: HTMLElement;

  constructor(player: Player) {
    this.player = player;

    this.textElement = document.querySelector("#speed-text") as HTMLElement;
  }

  public update() {
    const { velocity } = this.player.car;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const speedKmh =
      horizontalSpeed * METERS_PER_WORLD_UNIT * KILOMETERS_PER_METER * SECONDS_PER_HOUR;

    if (this.textElement) {
      this.textElement.textContent = `${Math.max(0, Math.round(speedKmh))}`;
    }
  }
}
