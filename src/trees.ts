import { camera, instances, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import type { MapGenerator } from "./map";
import { d, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { meshes } from "@typegpu/kit/geometry";
import { Fragment, Vertex } from "./static";
import type { CollisionSystem } from "./collision";

export class TreeGenerator{
    public shape;
    public mesh: meshPool.Mesh | null;
    private mapGenerator: MapGenerator;
    private things;
    private treePositions: d.v3f[];

    private treeRadius: number = 0.03;
    private treeHeight: number = 0.3;
    private treeRadialSegments: number = 6;
    private treeColor: d.v3f = d.vec3f(115, 70, 31).div(255);
    private treeMaterial;

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>, mapGenerator: MapGenerator, collisionSystem: CollisionSystem, mapWidth: number, mapHeight: number, trees: number = 100) {
        this.shape = meshes.cylinder({ radius: this.treeRadius, height: this.treeHeight, radialSegments: this.treeRadialSegments });
        this.mesh = null;
        this.mapGenerator = mapGenerator;
        this.things = instances.create(root, pool, {capacity: trees});
        this.treePositions = [];
        this.treeMaterial = materials.matte(this.treeColor);

        while(this.treePositions.length < trees) {
            const x = Math.random() * mapWidth - mapWidth / 2;
            const z = Math.random() * mapHeight - mapHeight / 2;
            const height = this.heightAt(x, z, mapWidth, mapHeight);
            if(Math.abs(height) > 0.05) {
                this.treePositions.push(d.vec3f(x, height + this.treeHeight / 2, z));
                collisionSystem.register(
                    d.vec3f(x, height + this.treeHeight / 2, z),
                    d.vec3f(this.treeRadius * 2, this.treeHeight, this.treeRadius * 2),
                );
            }
        }
    }

    private heightAt(x: number, z: number, mapWidth: number, mapHeight: number): number {
        const minX = -Math.floor(mapWidth / 2);
        const minZ = -Math.floor(mapHeight / 2);
        const maxX = Math.ceil(mapWidth / 2) - 1;
        const maxZ = Math.ceil(mapHeight / 2) - 1;
        const x0 = Math.max(minX, Math.min(maxX, Math.floor(x)));
        const z0 = Math.max(minZ, Math.min(maxZ, Math.floor(z)));
        const x1 = Math.min(maxX, x0 + 1);
        const z1 = Math.min(maxZ, z0 + 1);
        const tx = x1 === x0 ? 0 : x - x0;
        const tz = z1 === z0 ? 0 : z - z0;

        const sample = (sampleX: number, sampleZ: number) =>
            this.mapGenerator.heightMap.get(`${sampleX},${sampleZ}`) ?? 0;
        const h00 = sample(x0, z0);
        const h10 = sample(x1, z0);
        const h01 = sample(x0, z1);
        const h11 = sample(x1, z1);
        const h0 = h00 + (h10 - h00) * tx;
        const h1 = h01 + (h11 - h01) * tx;

        return h0 + (h1 - h0) * tz;
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.mesh = pool.add(this.shape, encoder);
        for (const position of this.treePositions) {
            this.things.add(this.mesh, {position: position, ...this.treeMaterial});
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

    public cast(shadow: lighting.Shadow, light: lighting.Lighting)
    {
        const casted = shadow.add(this.things.renderer(light));
        return casted;
    }
}