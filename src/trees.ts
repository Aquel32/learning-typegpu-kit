import { camera, instances, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import type { MapGenerator } from "./map";
import { d, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { meshes } from "@typegpu/kit/geometry";
import { Fragment, Vertex } from "./static";

export class TreeGenerator{
    public shape;
    public mesh: meshPool.Mesh | null;
    private mapGenerator: MapGenerator;
    private things;
    private treePositions: d.v3f[];

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>, mapGenerator: MapGenerator, mapWidth: number, mapHeight: number, trees: number = 100) {
        this.shape = meshes.cylinder({ radius: 0.1, height: 1, radialSegments: 6 });
        this.mesh = null;
        this.mapGenerator = mapGenerator;
        this.things = instances.create(root, pool, {capacity: trees});
        this.treePositions = [];

        while(this.treePositions.length < trees) {
            const x = Math.random() * mapWidth - mapWidth / 2;
            const z = Math.random() * mapHeight - mapHeight / 2;
            const height = this.mapGenerator.heightMap.get(`${Math.floor(x)},${Math.floor(z)}`) || 0;
            if(Math.abs(height) > 0.05) {
                this.treePositions.push(d.vec3f(x, height, z));
            }
        }
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.mesh = pool.add(this.shape, encoder);
        for (const position of this.treePositions) {
            this.things.add(this.mesh, {position: position});
        }
        this.things.flush();
        return this.mesh;
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
}