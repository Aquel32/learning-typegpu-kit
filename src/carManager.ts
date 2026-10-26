import { gltf, instances, type lighting, type meshPool, type passes } from "@typegpu/kit";
import type { Car } from "./car";
import { d, type TgpuRoot } from "typegpu";

export class CarManager {
    private modelName = "sedan-sports-packed.glb";
    private pool : meshPool.MeshPool<{}>;
    private things;
    public cars: Car[];

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>) {
        this.pool = pool;
        this.cars = [];
        this.things = instances.create(root, pool, {capacity: 20 * 5});
    }

    public async registerCar(car: Car) {
        this.cars.push(car);
        
        const response = await fetch(`/models/vehicles/${this.modelName}`);
        const data = gltf.read(await response.arrayBuffer());
        const model = this.pool.add(data);
        await model.ready;

        car.model = model;

        car.instanceId = this.things.add(model, {
            position: car.position,
            rotation: d.vec4f(0, Math.sin(car.yaw / 2), 0, Math.cos(car.yaw / 2)),
            scale: 0.1,
        });
    }

    public update(deltaTime: number) {
        for (const car of this.cars) {
            const data = car.update(deltaTime);
            if(car.instanceId == null) {
                continue;
            }

            this.things.write(car.instanceId as Parameters<typeof this.things.write>[0], {
                position: data.position,
                rotation: d.vec4f(0, Math.sin(car.yaw / 2), 0, Math.cos(car.yaw / 2)),
            });
        }
        this.things.flush();
    }

    public draw(scene: passes.Description<{
    readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
    }>,
        light: lighting.Lighting) {
        const drawn = scene.add(this.things.renderer(light));
        return drawn;
    }

    public cast(shadow: lighting.Shadow, light: lighting.Lighting)
    {
        const casted = shadow.add(this.things.renderer(light));
        return casted;
    }
}