import { d, std, type TgpuRoot } from "typegpu";
import { Car } from "./car";
import type { CarManager } from "./carManager";
import type { CollisionObject, CollisionSystem } from "./collision";
import { cameras } from "@typegpu/kit";
import * as web from "@typegpu/kit/web";
import { Speedometer } from "./speedometer";

const MAX_FORWARD_SPEED = 4;
const MAX_REVERSE_SPEED = 2;
const FORWARD_ENGINE_ACCELERATION = 1;
const FORWARD_ACCELERATION_GAIN = 2.5;
const REVERSE_ENGINE_ACCELERATION = 0.6;
const BRAKING_ACCELERATION = 3;

export class Player {
  public car: Car;

  private pressedKeys: Set<string> = new Set();
  public view: cameras.OrbitCamera;

  private speedometer: Speedometer;

  public handleKeyDown(event: KeyboardEvent) {
    this.pressedKeys.add(event.key.toLocaleLowerCase());
  }

  public handleKeyUp(event: KeyboardEvent) {
    this.pressedKeys.delete(event.key.toLocaleLowerCase());
  }
  constructor(
    root: TgpuRoot,
    collisionSystem: CollisionSystem,
    carManager: CarManager,
    surface: web.Surface,
    canvas: HTMLCanvasElement,
    initialPosition: d.v3f,
    initialDirection: d.v3f,
    initialVelocity: d.v3f,
    mass: number,
    dimensions: d.v3f,
  ) {
    this.car = new Car(
      root,
      collisionSystem,
      initialPosition,
      initialDirection,
      initialVelocity,
      mass,
      dimensions,
    );

    document.addEventListener("keydown", (event) => this.handleKeyDown(event));
    document.addEventListener("keyup", (event) => this.handleKeyUp(event));

    carManager.registerCar(this.car);

    this.view = cameras.orbit(root, {
      size: surface,
      target: [0, 1, 0],
      distance: 3,
    });
    web.orbitControls(this.view, canvas);

    this.speedometer = new Speedometer(this);
  }

  public update(deltaTime: number) {
    "use gpu";
    this.applySteering(deltaTime);

    const carForward = this.car.getForward();
    this.view.goal.target = this.car.position.add(d.vec3f(0, 0.1, 0));
    this.view.goal.yaw = std.atan2(-carForward.x, -carForward.z);
    this.view.goal.fov = this.car.drifts ? Math.PI / 2 : Math.PI / 3;
    this.view.update(deltaTime);

    this.speedometer.update();
  }

  private applySteering(deltaTime: number) {
    let throttle = 0;
    let steering = 0;

    if (this.pressedKeys.has("w")) {
      throttle += 1;
    }
    if (this.pressedKeys.has("a")) {
      steering += 1;
    }
    if (this.pressedKeys.has("s")) {
      throttle -= 1;
    }
    if (this.pressedKeys.has("d")) {
      steering -= 1;
    }
    this.car.setDrifts(this.pressedKeys.has("shift"));

    this.car.steer(steering, deltaTime);
    this.applyThrottle(throttle, deltaTime);
  }

  private applyThrottle(throttle: number, deltaTime: number) {
    if (throttle === 0) {
      return;
    }

    const forward = this.car.getForward();
    const forwardSpeed = this.car.velocity.x * forward.x + this.car.velocity.z * forward.z;
    const targetSpeed = throttle > 0 ? MAX_FORWARD_SPEED : -MAX_REVERSE_SPEED;
    const isBraking = throttle * forwardSpeed < 0;

    if (!isBraking && Math.abs(forwardSpeed) >= Math.abs(targetSpeed)) {
      return;
    }

    const speedRatio = Math.min(1, Math.abs(forwardSpeed / targetSpeed));
    let engineAcceleration =
      throttle > 0
        ? FORWARD_ENGINE_ACCELERATION + FORWARD_ACCELERATION_GAIN * speedRatio
        : REVERSE_ENGINE_ACCELERATION;
    let acceleration = isBraking
      ? Math.min(BRAKING_ACCELERATION, Math.abs(forwardSpeed) / deltaTime)
      : engineAcceleration;
    if(this.car.groundType === "grass")
    {
        engineAcceleration *= 0.5;
        acceleration *= 0.5;
    }

    this.car.applyForce(
      d.vec3f(
        forward.x * Math.sign(throttle) * acceleration * this.car.mass,
        0,
        forward.z * Math.sign(throttle) * acceleration * this.car.mass,
      ),
      deltaTime,
    );
  }
}
