import { cameras, instances, lighting, materials, passes, shading, type meshPool } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import type { Player } from "./player";

type Particle = {
    id: any;
    position: d.v3f;
    velocity: d.v3f;
    rotation: d.v4f;
    lifetime: number;
}

export class ParticleSystem {
    private pool: meshPool.MeshPool<{}>;
    private player: Player;
    private things;
    private kind;

    private shape;
    private model: meshPool.Mesh | null;

    private capacity: number;
    private size: number;
    private lifetime: number;
    private spawnRate: number;
    
    private spawnTimer: number;

    private particles: Particle[];

    public ready: boolean;

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>, player: Player, capacity: number, size: number, lifetime: number, spawnRate: number) {
        this.pool = pool;
        this.capacity = capacity;
        this.shape = meshes.plane({width: 1, depth: 1, widthSegments: 1, depthSegments: 1});

        this.kind = instances.define('particle', {
            surface: (point, instance, base) => {
                "use gpu";
                const distance = std.distance(point.uv, d.vec2f(0.5, 0.5)) * 2;
                const toEdge = 1 - std.smoothstep(0, 1, distance);

                const innerColor = d.vec3f(0.3,0.3,0.3);
                const outerColor = d.vec3f(0.9,0.9,0.9);

                // const blend = std.max(1, toEdge);
                const color = std.mix(outerColor, innerColor, toEdge);

                const material = materials.glow(color, 1);

                return instances.Surface({
                    point,
                    material: material,
                    coverage: toEdge,
                });
            }
        });

        this.ready = false;
        this.things = instances.create(root, pool, { kind: this.kind, capacity: this.capacity });
        this.model = null;
        this.size = size;
        this.lifetime = lifetime;
        this.spawnRate = spawnRate;
        this.player = player;
        this.particles = [];

        this.spawnTimer = 0;
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.model = pool.add(this.shape, encoder);
        this.ready = true;
        return this.model;
    }

    public spawnParticle(position: d.v3f, velocity: d.v3f) {
        const rotation = this.getDirectionTowardsCamera(position);
        const scale = d.vec3f(this.size);

        const id = this.things.add(this.model!, {
            position: position,
            rotation: rotation,
            scale: scale,
        });
        
        this.particles.push({ id, position, rotation, velocity, lifetime: 0 });
    }

    public update(deltaTime: number) {
        for (const particle of this.particles) {
            particle.lifetime += deltaTime;

            if(particle.lifetime > this.lifetime) {
                this.things.remove(particle.id);
                this.particles = this.particles.filter(p => p.id !== particle.id);
                continue;
            }

            particle.position = particle.position;

            const randomVelocityOffset = d.vec3f(
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1
            );

            particle.position = std.add(particle.position, std.mul(particle.velocity.add(randomVelocityOffset), deltaTime));
            particle.rotation = this.getDirectionTowardsCamera(particle.position);

            const size = this.size * (1 - particle.lifetime / this.lifetime);

            this.things.write(particle.id, {
                position: particle.position,
                rotation: particle.rotation,
                scale: d.vec3f(size),
            });
            
        }
        this.things.flush();
    }

    public getDirectionTowardsCamera(position: d.v3f): d.v4f {
        "use tsover";
        const cameraPosition = d.vec3f(0, 0, 0);
        cameras.eyeOf(this.player.view.current, cameraPosition);

        const direction = std.normalize(std.sub(cameraPosition, position));
        const yaw = Math.atan2(direction.x, direction.z) * 0.5;
        const pitch = Math.asin(Math.max(-1, Math.min(1, direction.y))) * -0.5;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);

        const facing = d.vec4f(cy * sp, sy * cp, -sy * sp, cy * cp);
        const halfQuarterTurn = Math.SQRT1_2;
        const planeToFacing = d.vec4f(halfQuarterTurn, 0, 0, halfQuarterTurn);

        return d.vec4f(
            facing.w * planeToFacing.x + facing.x * planeToFacing.w,
            facing.y * planeToFacing.w + facing.z * planeToFacing.x,
            facing.z * planeToFacing.w - facing.y * planeToFacing.x,
            facing.w * planeToFacing.w - facing.x * planeToFacing.x,
        );
    }

    public draw(scene: passes.Description<{
    readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
    }>,
    light: lighting.Lighting)
    {
        const drawn = scene.add(this.things.renderer(light, {
            alpha: "blend",
        }));
        return drawn;
    }
    
    public cast(shadow: lighting.Shadow, light: lighting.Lighting)
    {
        const casted = shadow.add(this.things.renderer(light));
        return casted;
    }
}