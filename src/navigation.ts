import type { d } from "typegpu";
import type { Minimap } from "./minimap";
import type { Player } from "./player";
import type { RoadGenerator } from "./road";
import type { RoadEdge } from "./static";
import type { Building, TownsGenerator } from "./towns";

export type SelectionRange = {
    startT: number;
    endT: number;
}

export class Navigation {
    private roadGenerator: RoadGenerator;
    private townsGenerator: TownsGenerator;
    private player: Player;
    private minimap: Minimap;

    public currentTargetBuilding: Building | null = null;

    constructor(roadGenerator: RoadGenerator, townsGenerator: TownsGenerator, player: Player, minimap: Minimap) {
        this.roadGenerator = roadGenerator;
        this.townsGenerator = townsGenerator;
        this.player = player;
        this.minimap = minimap;
    }

    public navigateToBuilding(building: Building | null) {
        if(!building) {
            this.currentTargetBuilding = null;
            this.minimap.setSelectedPath([]);
        }

        this.currentTargetBuilding = building;
    } 

    public update()
    {
        if(!this.currentTargetBuilding) return;

        const path = this.townsGenerator.getPathToBuilding(this.player.car.position, this.currentTargetBuilding);
        this.minimap.setSelectedPath(path);
    }
}