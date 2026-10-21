import type { lighting, meshPool, passes } from "@typegpu/kit";
import type { TgpuCommandEncoder } from "typegpu";
import type { Car } from "./car";

export class CarManager {
    private pool : meshPool.MeshPool<{}>;
    private encoder : TgpuCommandEncoder;

    private cars: Car[];

    constructor(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.pool = pool;
        this.encoder = encoder;
        this.cars = [];
    }

    public registerCar(car: Car) {
        this.cars.push(car);
        car.addToPool(this.pool, this.encoder);
    }

    public update(deltaTime: number) {
        for (const car of this.cars) {
            car.update(deltaTime);
        }
    }

    public draw(scene: passes.Description<{
    readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
    }>) {
        let drawned = [];
        for (const car of this.cars) {
            const draw = car.draw(scene, this.pool);
            drawned.push(draw);
        }
        return drawned;
    }

    public cast(shadow: lighting.Shadow)
    {
        let casted = [];
        for (const car of this.cars) {
            const cast = car.cast(shadow, this.pool);
            casted.push(cast);
        }
        return casted;
    }
}