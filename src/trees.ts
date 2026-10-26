import { camera, gltf, instances, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import type { MapGenerator } from "./map";
import { d, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { meshes } from "@typegpu/kit/geometry";
import { Fragment, MAP_HEIGHT, MAP_WIDTH, Vertex } from "./static";
import type { CollisionSystem } from "./collision";

export class TreeGenerator{
    private mapGenerator: MapGenerator;
    private things;
    private treePositions: d.v3f[];

    private treeRadius: number = 0.03;
    private treeHeight: number = 0.3;

    private models: meshPool.Model[];
    private modelNames = [
        "tree_oak.glb",
        "tree_fat.glb",
        "tree_detailed.glb",
        "tree_pineDefaultA.glb"
    ];

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>, mapGenerator: MapGenerator, collisionSystem: CollisionSystem, trees: number = 100) {
        this.mapGenerator = mapGenerator;
        this.things = instances.create(root, pool, {capacity: trees * 2 * this.modelNames.length});
        this.treePositions = [];
        this.models = [];

        for(let i = 0; i < trees; i++) {
            const x = Math.random() * MAP_WIDTH - MAP_WIDTH / 2;
            const z = Math.random() * MAP_HEIGHT - MAP_HEIGHT / 2;
            const groundHeight = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(x, 0, z));
            if(Math.abs(groundHeight) > 0.05) {
                this.treePositions.push(d.vec3f(x, groundHeight + this.treeHeight / 2, z));
                collisionSystem.register(
                    d.vec3f(x, groundHeight + this.treeHeight / 2, z),
                    d.vec3f(this.treeRadius, this.treeHeight, this.treeRadius),
                );
            }
        }
        console.log(`Generated ${this.treePositions.length} trees out of ${trees} requested.`);
    }

    public async addToPool(pool: meshPool.MeshPool<{}>) {
        for (const modelName of this.modelNames) {
            const response = await fetch(`/models/trees/${modelName}`);
            const data = gltf.read(await response.arrayBuffer());
            const model = pool.add(data);
            await model.ready;
            this.models.push(model);
        }

        for (const position of this.treePositions) {
            const randomModelIndex = Math.floor(Math.random() * this.models.length);
            const model = this.models[randomModelIndex];
            this.things.add(model, {position: position});
        }
        this.things.flush();
        return this.things;
    }

    public draw(scene: passes.Description<{
        readonly hdr: typeof passes.color;
        readonly depth: typeof passes.depth;
        }>,
        light: lighting.Lighting)
    {
        const drawn = scene.add(this.things.renderer(light));
        return drawn;
    }

    public cast(shadow: lighting.Shadow, light: lighting.Lighting)
    {
        const casted = shadow.add(this.things.renderer(light));
        return casted;
    }
}