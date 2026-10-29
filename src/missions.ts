import { d, std, type TgpuRoot } from "typegpu";
import type { NPC, NPCController } from "./npc";
import type { Building, TownsGenerator } from "./towns";
import type { Player } from "./player";
import type { Minimap } from "./minimap";
import type { Navigation } from "./navigation";

export type Mission = {
    start: Building;
    end: Building;
    npc: NPC;
    stage: MissionStage;
}

type MissionStage = "waitingForPickup" | "inTransit" | "droppedOff";

export class MissionController {
    private root;
    private npcController;
    private townsGenerator;
    private player;
    private navigation;

    public missions: Mission[] = [];

    constructor(root: TgpuRoot, player: Player, npcController: NPCController, townsGenerator: TownsGenerator, navigation: Navigation) {
        this.root = root;
        this.npcController = npcController;
        this.townsGenerator = townsGenerator;
        this.player = player;
        this.navigation = navigation;
    }

    public update(deltaTime: number) {
        for (const mission of this.missions) {
            this.handleMissionUpdate(mission);
        }
    }

    private handleMissionUpdate(mission: Mission) {
        console.log(mission.stage);
        switch (mission.stage) {
            case "waitingForPickup":
                const distance = std.distance(this.player.car.position, mission.npc.position);
                if (distance < 1) {
                    this.npcController.setNPCGoal(mission.npc, this.player.car.position.add(d.vec3f(0, this.player.car.dimensions.y / 2, 0)), this.arrivedToCar);
                }
                break;
            case "inTransit":
                const distanceToEnd = std.distance(this.player.car.position, mission.end.position);
                if (distanceToEnd < 1) {
                    this.npcController.setNPCVisibility(mission.npc, true);
                    const goal = d.vec3f(mission.end.position.x + mission.end.dimensions.x / 2 + 1, this.player.car.dimensions.y / 2, mission.end.position.z);
                    this.npcController.setNPCGoal(mission.npc, goal, this.removeNPC);
                    this.npcController.setNPCTransform(mission.npc, this.player.car.position.add(d.vec3f(0, this.player.car.dimensions.y / 2, 0)), d.vec4f(0, 1, 0, 0));
                    mission.stage = "droppedOff";

                    this.endMission(mission);
                }
                break;
        }
    }

    public generateNewMission() {
        const startBuilding = this.townsGenerator.getRandomBuilding();
        const endBuilding = this.townsGenerator.getRandomBuilding();
        const npcPosition = d.vec3f(startBuilding.position.x + startBuilding.dimensions.x / 2 + 1, 0, startBuilding.position.z);
        const npcRotation = d.vec4f(0, 1, 0, 0);

        const npc = this.npcController.add(npcPosition, npcRotation, "idle");

        const mission: Mission = {
            start: startBuilding,
            end: endBuilding,
            npc,
            stage: "waitingForPickup",
        };
        this.missions.push(mission);

        this.navigation.navigateToBuilding(startBuilding);

        return mission;
    }

    public endMission(mission: Mission) {
        this.missions = this.missions.filter(m => m !== mission);
        // this.minimap.setSelectedPath([]); new mission path will overwrite old one

        this.generateNewMission();
    }

    public arrivedToCar = (npc: NPC) => {
        const mission = this.missions.find(m => m.npc === npc);
        if (!mission) {
            console.error("Mission not found for NPC");
            return;
        }

        this.npcController.setNPCVisibility(npc, false);
        this.npcController.setNPCGoal(npc, null);
        mission.stage = "inTransit";

        this.navigation.navigateToBuilding(mission.end);
    }

    public removeNPC = (npc: NPC) => {
        this.npcController.remove(npc);
    }
}