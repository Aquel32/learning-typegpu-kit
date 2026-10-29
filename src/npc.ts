import { d, std, type TgpuComputePass, type TgpuRoot } from "typegpu";
import type { CollisionSystem } from "./collision";
import { gltf, instances, lighting, passes, skins, type meshPool } from "@typegpu/kit";

type Animation = {
    name: string;
    file: string;
    clip: gltf.ClipData | null;
}
export type AnimationName = "idle" | "walk" | "interactStanding";

export type NPC = {
    instanceID: any;
    position: d.v3f;
    rotation: d.v4f;
    animation: AnimationName;
    goal: d.v3f | null;
    pose: number;
    visible: boolean;
    arrivedCallback?: ((npc: NPC) => void) | undefined;
}

export class NPCController {
    private animations: Map<AnimationName, Animation> = new Map([
        ["idle", { name: "idle", file: "idle.glb", clip: null }],
        ["walk", { name: "walk", file: "walk.glb", clip: null }],
        ["interactStanding", { name: "interactStanding", file: "interactStanding.glb", clip: null }],
    ]);
    private poseIds: Partial<Record<AnimationName, number>> = {};
    private characterFile: string = "characterLargeMale.glb";
    private characterModel: meshPool.Model | null = null;
    private things;
    private npc;
    private figures: skins.Poses<"idle" | "walk" | "interactStanding"> | null = null;
    private root;

    private spawnedNPCs: NPC[] = [];

    constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>) {
        this.root = root;
        this.npc = instances.define('npc', {
            host: { pose: d.u32 },
            pose: (npc) => {
                'use gpu';
                return npc.pose;
            },
        });

        this.things = instances.create(root, pool, {kind: this.npc, capacity: 10});
        this.characterModel = null;
    }

    public async addToPool(pool: meshPool.MeshPool<{}>) {
        for (const animation of this.animations.values()) {
            const response = await fetch(`/models/characters/${animation.file}`);
            const data = gltf.read(await response.arrayBuffer());
            const clip = data.clips.find((candidate) => candidate.duration > 0) || null;
            animation.clip = clip;
        }

        const response = await fetch(`/models/characters/${this.characterFile}`);
        const data = gltf.read(await response.arrayBuffer());
        this.characterModel = pool.add(data);

        const idle = this.animations.get("idle")!.clip;
        const walk = this.animations.get("walk")!.clip;
        const interactStanding = this.animations.get("interactStanding")!.clip;
        if (!idle || !walk || !interactStanding) {
            throw new Error("NPC animation clips could not be loaded.");
        }

        this.figures = skins.create(
            this.root,
            data.skin!,
            { idle, walk, interactStanding },
            { capacity: 256 },
        );

        return this.characterModel;
    }

    private getPose(animationName: AnimationName): number {
        const cached = this.poseIds[animationName];
        if (cached !== undefined) {
            return cached;
        }

        const pose = this.figures!.add(animationName, 0);
        this.poseIds[animationName] = pose;
        return pose;
    }

    private setAnimation(npc: NPC, animationName: AnimationName) {
        if (npc.animation === animationName) {
            return;
        }

        if(!this.things.has(npc.instanceID)) {
            return;
        }

        npc.animation = animationName;
        npc.pose = this.getPose(animationName);
        this.things.write(npc.instanceID, { pose: npc.pose });
    }

    public add(position: d.v3f, rotation: d.v4f, animationName: AnimationName) {
        if (!this.characterModel) {
            console.log("Character model not loaded yet.");
            throw new Error("Character model not loaded yet.");
        }

        const animation = this.animations.get(animationName);
        if (!animation || !animation.clip) {
            console.log(`Animation ${animationName} not loaded yet.`);
            throw new Error(`Animation ${animationName} not loaded yet.`);
        }

        const pose = this.getPose(animationName);
        const id = this.things.add(this.characterModel, {position, rotation, pose, scale: 0.04});
        this.things.flush();

        const npc: NPC = {
            instanceID: id,
            position,
            rotation,
            animation: animationName,
            goal: null,
            pose,
            visible: true,
        };

        this.spawnedNPCs.push(npc);
        return npc;
    }

    public update(deltaTime: number)
    {
        for (const npc of this.spawnedNPCs) {
            if (!npc.goal) {
                this.setAnimation(npc, "idle");
                continue;
            }

            const sub = npc.goal.sub(npc.position);
            const distance = std.length(sub);

            if (distance <= 0.1) {
                npc.goal = null;
                npc.arrivedCallback?.(npc);
                npc.arrivedCallback = undefined;
                this.setAnimation(npc, "idle");
                continue;
            }

            if (npc.animation !== "walk") {
                this.setAnimation(npc, "walk");
            }

            if(!this.things.has(npc.instanceID)) {
                continue;
            }

            const direction = std.normalize(sub);
            const speed = 0.1;
            const movement = direction.mul(speed * deltaTime);
            npc.position = npc.position.add(movement);
            const yaw = Math.atan2(direction.x, direction.z);
            npc.rotation = d.vec4f(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
            this.things.write(npc.instanceID, { position: npc.position, rotation: npc.rotation });
        }
        this.things.flush();
    }

    public remove(npc: NPC) {
        this.things.remove(npc.instanceID);
        this.spawnedNPCs = this.spawnedNPCs.filter((n) => n.instanceID !== npc.instanceID);
    }

    public setNPCGoal(npc: NPC, goal: d.v3f | null, arrivedCallback?: (npc: NPC) => void) {
        npc.goal = goal;
        npc.arrivedCallback = arrivedCallback;
    }

    public setNPCTransform(npc: NPC, position: d.v3f, rotation: d.v4f) {
        npc.position = position;
        npc.rotation = rotation;
        this.things.write(npc.instanceID, { position: npc.position, rotation: npc.rotation });
    }

    public setNPCVisibility(npc: NPC, visible: boolean) {
        npc.visible = visible;
        this.things.write(npc.instanceID, { scale: visible ? 0.04 : 0 });
    }

    public animate(pass: TgpuComputePass, time: number) {
        this.figures?.animate(pass, time);
    }

    public draw(scene: passes.Description<{
            readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
        }>,
        light: lighting.Lighting)
    {
        const drawn = scene.add(this.things.renderer(light).pipe(this.figures!.inject()));
        return drawn;
    }
    
    public cast(shadow: lighting.Shadow, light: lighting.Lighting)
    {
        const casted = shadow.add(this.things.renderer(light).pipe(this.figures!.inject()));
        return casted;
    }

    public async initAsync() {
        await this.figures?.initAsync();
    }
}