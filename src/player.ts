import { d, type TgpuRoot } from "typegpu";
import { Car } from "./car";
import type { CarManager } from "./carManager";
import type { CollisionObject, CollisionSystem } from "./collision";

export class Player {
    public car: Car;

    private pressedKeys: Set<string> = new Set();
    public drifts: boolean;

    public handleKeyDown(event: KeyboardEvent) {
        this.pressedKeys.add(event.key.toLocaleLowerCase());
    }

    public handleKeyUp(event: KeyboardEvent) {
        this.pressedKeys.delete(event.key.toLocaleLowerCase());
    }
    constructor(root: TgpuRoot,  collisionSystem: CollisionSystem, carManager: CarManager, initialPosition: d.v3f, initialDirection: d.v3f, initialVelocity: d.v3f, mass: number, dimensions: d.v3f) {
        this.car = new Car(root, collisionSystem, initialPosition, initialDirection, initialVelocity, mass, dimensions);
        carManager.registerCar(this.car);

        document.addEventListener("keydown", (event) => this.handleKeyDown(event));
        document.addEventListener("keyup", (event) => this.handleKeyUp(event));

        this.drifts = false;
    }

    public update(deltaTime: number) {
        this.applySteering(deltaTime);
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