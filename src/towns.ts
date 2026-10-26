import { camera, instances, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import type { MapGenerator } from "./map";
import { d, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { meshes } from "@typegpu/kit/geometry";
import { Fragment, MAP_HEIGHT, MAP_WIDTH, Vertex } from "./static";

type Building = {
    position: d.v3f;
    dimensions: d.v3f;
    color: d.v3f;
    mesh: meshPool.Mesh | null;
    shape: meshes.IndexedGeometry<d.WgslStruct<{
        position: d.Vec3f;
        normal: d.Vec3f;
        uv: d.Vec2f;
    }>>
};

export class TownsGenerator{
    private mapGenerator: MapGenerator;
    private things;
    private buildings: Building[];

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>, mapGenerator: MapGenerator, towns: number = 3, buildingsPerTown: number = 5, loneBuildings: number = 5) {
        this.mapGenerator = mapGenerator;
        this.things = instances.create(root, pool, {capacity: towns * buildingsPerTown + loneBuildings});
        this.buildings = [];

        let townsPlaced = 0;
        while(townsPlaced < towns) {
            let townCenterX = Math.random() * MAP_WIDTH - MAP_WIDTH / 2;
            let townCenterZ = Math.random() * MAP_HEIGHT - MAP_HEIGHT / 2;
            let townCenterHeight = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(townCenterX, 0, townCenterZ));
            if(Math.abs(townCenterHeight) < 0.05) {
                for(let i = 0; i < buildingsPerTown; i++) {
                    let offsetX = (Math.random() - 0.5) * 10;
                    let offsetZ = (Math.random() - 0.5) * 10;
                    let buildingX = townCenterX + offsetX;
                    let buildingZ = townCenterZ + offsetZ;
                    let buildingHeight = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(buildingX, 0, buildingZ));
                    if(Math.abs(buildingHeight) < 0.05) {
                        this.buildings.push(this.createBuilding(buildingX, buildingZ, buildingHeight));
                    }
                }
                townsPlaced++;
            }
        }

        let loneBuildingsPlaced = 0;
        while(loneBuildingsPlaced < loneBuildings) {
            let buildingX = Math.random() * MAP_WIDTH - MAP_WIDTH / 2;
            let buildingZ = Math.random() * MAP_HEIGHT - MAP_HEIGHT / 2;
            let buildingHeight = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(buildingX, 0, buildingZ));
            if(Math.abs(buildingHeight) < 0.05) {
                this.buildings.push(this.createBuilding(buildingX, buildingZ, buildingHeight));
                loneBuildingsPlaced++;
            }
        }
    }

    private createBuilding(x: number, z: number, height: number): Building {
        let buildingHeight = this.randomInt(0.3, 0.6);
        let buildingWidth = this.randomInt(0.5, 1);
        let buildingDepth = this.randomInt(0.5, 1);
        let color = d.vec3f(Math.random(), Math.random(), Math.random());
        let shape = meshes.box({ width: buildingWidth, height: buildingHeight, depth: buildingDepth });
        return {
            position: d.vec3f(x, height + buildingHeight / 2, z),
            dimensions: d.vec3f(buildingWidth, buildingHeight, buildingDepth),
            color: color,
            mesh: null,
            shape: shape
        };
    }

    private randomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        for (const building of this.buildings) {
            building.mesh = pool.add(building.shape, encoder);
            this.things.add(building.mesh, {position: building.position, ...materials.matte(building.color)});
        }
        this.things.flush();
        return this.buildings.map(b => b.mesh);
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