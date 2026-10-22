import { camera, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { Fragment, gravityMultiplier, Vertex } from "./static";
import { CollisionObject, type CollisionSystem } from "./collision";
import { MapGenerator } from "./map";

export class Car {
    public position: d.v3f;
    public rotation: d.m4x4f;
    public velocity: d.v3f;
    public mass: number;
    public dimensions: d.v3f;

    public shape;
    public mesh: meshPool.Mesh | null;

    private positionUniform;
    private rotationUniform;
    private drifts: boolean;
    public yaw: number;

    private steeringAngleMultiplier: number;
    private steeringAngle: number;
    private gripPower: number;

    private collisionObject: CollisionObject;

    constructor(root: TgpuRoot, collisionSystem: CollisionSystem, position: d.v3f, forward: d.v3f, velocity: d.v3f, mass: number, dimensions: d.v3f) {
        "use gpu";
        this.position = d.vec3f(position.x, position.y + dimensions.y / 2, position.z);
        this.yaw = Math.atan2(forward.x, forward.z);
        this.rotation = rotationMatrix(this.yaw);
        this.velocity = velocity;
        this.mass = mass;
        this.dimensions = dimensions;

        this.shape = meshes.box({ width: dimensions.x, height: dimensions.y, depth: dimensions.z });
        this.mesh = null;

        this.positionUniform = root.createUniform(d.vec3f, this.position);
        this.rotationUniform = root.createUniform(d.mat4x4f, this.rotation);
        this.drifts = false;
        this.steeringAngle = 0;
        this.steeringAngleMultiplier = 0;
        this.gripPower = 0;

        this.collisionObject = collisionSystem.register(this.position, this.dimensions);
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.mesh = pool.add(this.shape, encoder);
        return this.mesh;
    }

    public update(deltaTime: number) {
        this.applyForce(d.vec3f(0, -gravityMultiplier * this.mass, 0), deltaTime);

        const collisionInfo = this.collisionObject.checkCollision();
        if(collisionInfo.ground !== null) {
            const groundHeight = collisionInfo.ground;
            if(this.position.y <= groundHeight + this.dimensions.y / 2) {
                this.position = d.vec3f(this.position.x, groundHeight + this.dimensions.y / 2, this.position.z);
                this.velocity = d.vec3f(this.velocity.x, 0, this.velocity.z);
            }
        }

        if(collisionInfo.objects !== null) {
            for(const obj of collisionInfo.objects) {
                const objAABB = obj.AABB;
                const carAABB = this.collisionObject.AABB;

                const overlapX = Math.max(0, Math.min(carAABB.max.x, objAABB.max.x) - Math.max(carAABB.min.x, objAABB.min.x));
                const overlapY = Math.max(0, Math.min(carAABB.max.y, objAABB.max.y) - Math.max(carAABB.min.y, objAABB.min.y));
                const overlapZ = Math.max(0, Math.min(carAABB.max.z, objAABB.max.z) - Math.max(carAABB.min.z, objAABB.min.z));

                if(overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                    if(overlapY <= overlapX && overlapY <= overlapZ) {
                        if(this.position.y > obj.position.y) {
                            this.position = d.vec3f(this.position.x, objAABB.max.y + this.dimensions.y / 2, this.position.z);
                            this.velocity = d.vec3f(this.velocity.x, 0, this.velocity.z);
                        } else {
                            this.position = d.vec3f(this.position.x, objAABB.min.y - this.dimensions.y / 2, this.position.z);
                            this.velocity = d.vec3f(this.velocity.x, 0, this.velocity.z);
                        }
                    } else if(overlapX <= overlapY && overlapX <= overlapZ) {
                        if(this.position.x > obj.position.x) {
                            this.position = d.vec3f(objAABB.max.x + this.dimensions.x / 2, this.position.y, this.position.z);
                        } else {
                            this.position = d.vec3f(objAABB.min.x - this.dimensions.x / 2, this.position.y, this.position.z);
                        }
                        this.velocity = d.vec3f(0, this.velocity.y, this.velocity.z);
                    } else {
                        if(this.position.z > obj.position.z) {
                            this.position = d.vec3f(this.position.x, this.position.y, objAABB.max.z + this.dimensions.z / 2);
                        } else {
                            this.position = d.vec3f(this.position.x, this.position.y, objAABB.min.z - this.dimensions.z / 2);
                        }
                        this.velocity = d.vec3f(this.velocity.x, this.velocity.y, 0);
                    }
                }
            }
        }
        const forward = this.getForward();
        const forwardSpeed = this.velocity.x * forward.x + this.velocity.z * forward.z;
        const forwardVelocity = d.vec3f(
            forward.x * forwardSpeed,
            this.velocity.y,
            forward.z * forwardSpeed,
        );
        const sidewaysVelocity = d.vec3f(
            this.velocity.x - forwardVelocity.x,
            0,
            this.velocity.z - forwardVelocity.z,
        );
        const speed = Math.sqrt(
            this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2,
        );
        this.gripPower = Math.min(
            0.98,
            Math.max(0.65, this.gripPower + (this.drifts ? 1 : -1) * deltaTime),
        );
        const sidewaysGrip = Math.pow(this.gripPower, deltaTime * 60);
        const rollingFriction = Math.pow(0.98, deltaTime * 60);

        this.velocity = d.vec3f(
            (forwardVelocity.x + sidewaysVelocity.x * sidewaysGrip) * rollingFriction,
            forwardVelocity.y,
            (forwardVelocity.z + sidewaysVelocity.z * sidewaysGrip) * rollingFriction,
        );

        this.position = d.vec3f(
            this.position.x + this.velocity.x * deltaTime,
            this.position.y + this.velocity.y * deltaTime,
            this.position.z + this.velocity.z * deltaTime,
        );

        this.collisionObject.update(this.position, this.dimensions);
        this.steeringAngleMultiplier = Math.min(
            0.5,
            Math.max(0, this.steeringAngleMultiplier + (this.drifts ? 1 : -1) * deltaTime),
        );
        this.steeringAngle = speed <= 0.1  ? 0: (1.5 / (speed + (1/2)) + this.steeringAngleMultiplier);

        this.positionUniform.write(this.position);
    }

    public applyForce(force: d.v3f, deltaTime: number) {
        const acceleration = d.vec3f(
            force.x / this.mass * deltaTime,
            force.y / this.mass * deltaTime,
            force.z / this.mass * deltaTime,
        );
        this.velocity = d.vec3f(
            this.velocity.x + acceleration.x,
            this.velocity.y + acceleration.y,
            this.velocity.z + acceleration.z,
        );
    }

    public steer(amount: number, deltaTime: number) {
        this.yaw += amount * this.steeringAngle * deltaTime;
        this.rotation = rotationMatrix(this.yaw);
        this.rotationUniform.write(this.rotation);

        if (this.drifts && amount !== 0) {
            const driftAngle = amount * 1.2 * deltaTime;
            const cos = Math.cos(driftAngle);
            const sin = Math.sin(driftAngle);
            this.velocity = d.vec3f(
                this.velocity.x * cos - this.velocity.z * sin,
                this.velocity.y,
                this.velocity.x * sin + this.velocity.z * cos,
            );
        }
    }

    public getForward() {
        return d.vec3f(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    public setDrifts(drifts: boolean) {
        this.drifts = drifts;
    }

    public draw(scene: passes.Description<{
    readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
    }>
    , pool: meshPool.MeshPool<{}>)
    {
        const drawn = scene.add({
          Vertex: Vertex,
          at: this.at,
          surfaceOf: this.surfaceOf,
          color: passes.shaded,
          draw: (pipeline: TgpuRenderPipeline<never>) =>
            pipeline
              .withIndexBuffer(pool.indices)
              .drawIndexed(
                this.mesh!.indexCount,
                1,
                this.mesh!.firstIndex,
                this.mesh!.baseVertex,
              ),
        });

        return drawn;
    }

    public cast(shadow: lighting.Shadow, pool: meshPool.MeshPool<{}>)
    {
        const casted = shadow.add({
          Vertex: Vertex,
          inject: () => pool.inject(),
          at: this.at,
          draw: (pipeline) =>
            pipeline
              .withIndexBuffer(pool.indices)
              .drawIndexed(
                this.mesh!.indexCount,
                1,
                this.mesh!.firstIndex,
                this.mesh!.baseVertex,
              ),
        });
        return casted;
    }

      public at = (vertexIndex: number, _instanceIndex: number) => {
        "use gpu";
        const vertex = meshPool.vertexAt(vertexIndex);
        const rotatedPosition = this.rotationUniform.$ * d.vec4f(vertex.position, 0);
        const position = d.vec3f(
            rotatedPosition.x + this.positionUniform.$.x,
            rotatedPosition.y + this.positionUniform.$.y,
            rotatedPosition.z + this.positionUniform.$.z,
        );
        const rotatedNormal = this.rotationUniform.$ * d.vec4f(vertex.normal, 0);
        return Vertex({
            position: camera.$.viewProjection * d.vec4f(position, 1),
            world: position,
            normal: d.vec3f(rotatedNormal.x, rotatedNormal.y, rotatedNormal.z),
        });
     };
    
      public surfaceOf = (vertex: d.Infer<typeof Vertex>) => {
        "use gpu";
        const point = shading.point(vertex.world, vertex.normal);
        const material = materials.metal(d.vec3f(0.0, 0.0, 0.0), 0.2);
        return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });
     };
}

function rotationMatrix(yaw: number): d.m4x4f {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    return d.mat4x4f(
        cos, 0, -sin, 0,
        0, 1, 0, 0,
        sin, 0, cos, 0,
        0, 0, 0, 1,
    );
}