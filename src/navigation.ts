import type { d } from "typegpu";
import type { Minimap } from "./minimap";
import type { Player } from "./player";
import type { RoadGenerator } from "./road";
import type { RoadEdge } from "./static";
import type { Building, TownsGenerator } from "./towns";

export class Navigation {
    private roadGenerator: RoadGenerator;
    private townsGenerator: TownsGenerator;
    private player: Player;
    private minimap: Minimap;

    constructor(roadGenerator: RoadGenerator, townsGenerator: TownsGenerator, player: Player, minimap: Minimap) {
        this.roadGenerator = roadGenerator;
        this.townsGenerator = townsGenerator;
        this.player = player;
        this.minimap = minimap;
    }

    public navigateToBuilding(from: d.v3f, building: Building): d.Infer<typeof RoadEdge>[] {
        const path = this.townsGenerator.getPathToBuilding(from, building);
        this.minimap.setSelectedPath(path);
        return path;
    }
}