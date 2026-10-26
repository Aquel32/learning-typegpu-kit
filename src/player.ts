import { d, std, type TgpuRoot } from "typegpu";
import { Car } from "./car";
import type { CarManager } from "./carManager";
import type { CollisionObject, CollisionSystem } from "./collision";
import { cameras } from "@typegpu/kit";
import * as web from "@typegpu/kit/web";

export class Player {
    public car: Car;

    private pressedKeys: Set<string> = new Set();
    public drifts: boolean;
    public view: cameras.OrbitCamera;

    public handleKeyDown(event: KeyboardEvent) {
        this.pressedKeys.add(event.key.toLocaleLowerCase());
    }

    public handleKeyUp(event: KeyboardEvent) {
        this.pressedKeys.delete(event.key.toLocaleLowerCase());
    }
    constructor(root: TgpuRoot,  collisionSystem: CollisionSystem, carManager: CarManager, surface: web.Surface, canvas: HTMLCanvasElement, initialPosition: d.v3f, initialDirection: d.v3f, initialVelocity: d.v3f, mass: number, dimensions: d.v3f) {
        this.car = new Car(root, collisionSystem, initialPosition, initialDirection, initialVelocity, mass, dimensions);

        document.addEventListener("keydown", (event) => this.handleKeyDown(event));
        document.addEventListener("keyup", (event) => this.handleKeyUp(event));

        this.drifts = false;

        carManager.registerCar(this.car);

        this.view = cameras.orbit(root, {
          size: surface,
          target: [0, 1, 0],
          distance: 3,
        });
        web.orbitControls(this.view, canvas);
    }

    public update(deltaTime: number) {
        "use gpu";
        this.applySteering(deltaTime);

        const carForward = this.car.getForward();
        this.view.goal.target = this.car.position.add(d.vec3f(0, 0.1, 0));
        this.view.goal.yaw = std.atan2(-carForward.x, -carForward.z);
        this.view.goal.fov = this.drifts ? Math.PI / 2 : Math.PI / 3;
        this.view.update(deltaTime);
    }
    
    private applySteering(deltaTime: number)
    {
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
        this.drifts = this.pressedKeys.has("shift");
        this.car.setDrifts(this.drifts);

        this.car.steer(steering, deltaTime);
        this.car.applyForce(
            d.vec3f(
                this.car.getForward().x * throttle * 12,
                0,
                this.car.getForward().z * throttle * 12,
            ),
            deltaTime,
        );
    }
}