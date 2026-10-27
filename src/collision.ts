import { d, type TgpuRoot } from "typegpu";
import type { MapGenerator } from "./map";
import { CHUNK_SIZE, roadWidth } from "./static";
import type { GroundType, RoadGenerator } from "./road";

export type CollisionAABB = {
    min: d.v3f;
    max: d.v3f;
};

export type CollisionInfo = {
    groundHeight: number | null;
    groundType: GroundType;
    objects: CollisionObject[];
    isEmpty: boolean;
};

export class CollisionObject {
    public position: d.v3f;
    public dimensions: d.v3f;
    public AABB: CollisionAABB;
    public chunk: d.v2f;
    public collisionSystem: CollisionSystem;

    constructor(collisionSystem: CollisionSystem, position: d.v3f, dimensions: d.v3f, chunk: d.v2f) {
        this.collisionSystem = collisionSystem;
        this.position = position;
        this.dimensions = dimensions;
        this.AABB = this.rebuildAABB();
        this.chunk = chunk;
    }

    public update(position: d.v3f, dimensions: d.v3f) {
        this.position = position;
        this.dimensions = dimensions;
        this.rebuildAABB();
        this.collisionSystem.update(this, position, dimensions);
    }

    public rebuildAABB() {
        return this.AABB = {
            min: d.vec3f(this.position.x - this.dimensions.x / 2, this.position.y - this.dimensions.y / 2, this.position.z - this.dimensions.z / 2),
            max: d.vec3f(this.position.x + this.dimensions.x / 2, this.position.y + this.dimensions.y / 2, this.position.z + this.dimensions.z / 2),
        };
    }

    public checkCollision() {
        return this.collisionSystem.checkObjectCollision(this);
    }

    public groundHeight() {
        return this.collisionSystem.mapGenerator.getHeightAtWorldPosition(this.position);
    }
}

export class CollisionSystem {
    private registry: CollisionObject[];
    private chunks: Map<string, CollisionObject[]>;
    public mapGenerator: MapGenerator;
    public roadGenerator: RoadGenerator;

    constructor(root: TgpuRoot, mapGenerator: MapGenerator, roadGenerator: RoadGenerator) {
        this.registry = [];
        this.chunks = new Map();

        this.mapGenerator = mapGenerator;
        this.roadGenerator = roadGenerator;
    }

    public register(position: d.v3f, dimensions: d.v3f) {
        const chunk = this.getChunkIndex(position);
        const collisionObject = new CollisionObject(this,position, dimensions, chunk);
        this.registry.push(collisionObject);
        this.objectsInChunk(chunk).push(collisionObject);
        return collisionObject;
    }

    public unregister(collisionObject: CollisionObject) {
        const index = this.registry.indexOf(collisionObject);
        if (index !== -1) {
            this.registry.splice(index, 1);
            const objects = this.objectsInChunk(collisionObject.chunk);
            objects.splice(objects.indexOf(collisionObject), 1);
            return true;
        }

        return false;
    }

    public update(collisionObject: CollisionObject, position: d.v3f, dimensions: d.v3f) {
        const oldChunk = collisionObject.chunk;
        const newChunk = this.getChunkIndex(position);

        if (this.getChunkKey(oldChunk) !== this.getChunkKey(newChunk)) {
            const oldObjects = this.objectsInChunk(oldChunk);
            const oldChunkIndex = oldObjects.indexOf(collisionObject);
            if (oldChunkIndex !== -1) {
                oldObjects.splice(oldChunkIndex, 1);
            }
            this.objectsInChunk(newChunk).push(collisionObject);
            collisionObject.chunk = newChunk;
        }
    }

    public checkObjectCollision(collisionObject: CollisionObject): CollisionInfo {
        const chunk = collisionObject.chunk;
        let groundHeight: number | null = this.mapGenerator.getHeightAtWorldPosition(collisionObject.position);
        let objects: CollisionObject[] = [];
        let groundType: GroundType = "air";

        for (let x = chunk.x - 1; x <= chunk.x + 1; x++) {
            for (let y = chunk.y - 1; y <= chunk.y + 1; y++) {
                const objectsInChunk = this.objectsInChunk(d.vec2f(x, y));
                for (const other of objectsInChunk) {
                    if(other === collisionObject) continue;

                    if(this.aabbIntersect(collisionObject.AABB, other.AABB)) {
                        objects.push(other);
                    }
                }
            }
        }

        if(collisionObject.AABB.min.y <= groundHeight) {
            groundType = "grass"; // todo: change this to data from mapGenerator
        }

        if (groundType !== "air") { // in future there might be diffrent ground types
            groundType = this.getGroundTypeAtPosition(collisionObject.position);
        }

        return { groundHeight, groundType, objects, isEmpty: objects.length === 0 };
    }

    public getGroundTypeAtPosition(position: d.v3f): GroundType {
        let groundType: GroundType = "grass";

        const distanceSquared = this.roadGenerator.getDistanceToClosestEdge(position);
        if (distanceSquared <= (roadWidth / 2) ** 2) {
            groundType = "road";
        }

        return groundType;
    }

    private aabbIntersect(a: CollisionAABB, b: CollisionAABB): boolean {
        return (a.min.x <= b.max.x && a.max.x >= b.min.x) &&
               (a.min.y <= b.max.y && a.max.y >= b.min.y) &&
               (a.min.z <= b.max.z && a.max.z >= b.min.z);
    }

    private getChunkIndex(position: d.v3f): d.v2f {
        const x = Math.floor(position.x / CHUNK_SIZE);
        const z = Math.floor(position.z / CHUNK_SIZE);
        return d.vec2f(x, z);
    }

    private getChunkKey(chunk: d.v2f): string {
        return `${chunk.x},${chunk.y}`;
    }

    private objectsInChunk(chunk: d.v2f): CollisionObject[] {
        const key = this.getChunkKey(chunk);
        let objects = this.chunks.get(key);
        if (!objects) {
            objects = [];
            this.chunks.set(key, objects);
        }
        return objects;
    }
}