import { instances, lighting, materials, meshPool, passes } from "@typegpu/kit";
import type { MapGenerator } from "./map";
import { d, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import { meshes } from "@typegpu/kit/geometry";
import { bezierPoint, bezierTangent, type RoadGenerator } from "./road";
import type { CollisionSystem } from "./collision";
import { RoadEdge, roadWidth } from "./static";

export type Building = {
  position: d.v3f;
  dimensions: d.v3f;
  color: d.v3f;
  mesh: meshPool.Mesh | null;
  rotation: d.v4f;
  shape: meshes.IndexedGeometry<
    d.WgslStruct<{
      position: d.Vec3f;
      normal: d.Vec3f;
      uv: d.Vec2f;
    }>
  >;
  edge: d.Infer<typeof RoadEdge>;
};

export class TownsGenerator {
  private mapGenerator: MapGenerator;
  private collisionSystem: CollisionSystem;
  private things;
  public buildings: Building[];
  private roadGenerator: RoadGenerator;

  constructor(
    root: TgpuRoot,
    pool: meshPool.MeshPool<{}>,
    mapGenerator: MapGenerator,
    roadGenerator: RoadGenerator,
    collisionSystem: CollisionSystem,
    townsTries: number = 3,
    buildingsPerTownTries: number = 5,
    loneBuildingsTries: number = 5,
  ) {
    "use gpu";
    this.collisionSystem = collisionSystem;
    this.roadGenerator = roadGenerator;
    this.mapGenerator = mapGenerator;
    this.things = instances.create(root, pool, {
      capacity: townsTries * buildingsPerTownTries + loneBuildingsTries,
    });
    this.buildings = [];

    const possibleEdges = [...roadGenerator.network];

    for (let i = 0; i < townsTries; i++) {
      if (possibleEdges.length === 0) {
        break;
      }

      const randomEdgeIndex = Math.floor(Math.random() * possibleEdges.length);
      const randomEdge = possibleEdges[randomEdgeIndex];
      possibleEdges.splice(randomEdgeIndex, 1);

      const possiblePoints = roadGenerator.getEdgePoints(randomEdge, 10);
      for (let j = 0; j < buildingsPerTownTries; j++) {
        if (possiblePoints.length === 0) {
          break;
        }

        const randomPointIndex = this.randomInt(2, possiblePoints.length - 3) % possiblePoints.length;
        const t = randomPointIndex / 10;
        const randomPoint = possiblePoints.splice(randomPointIndex, 1)[0]!;
        const tangent = bezierTangent(
          randomEdge.start.position.xz,
          randomEdge.controlPoint1,
          randomEdge.controlPoint2,
          randomEdge.end.position.xz,
          t,
        );

        const building = this.tryCreateBuilding(randomEdge, randomPoint, tangent);
        this.buildings.push(building);
      }
    }

    for (let i = 0; i < loneBuildingsTries; i++) {
      const randomEdgeIndex = Math.floor(Math.random() * possibleEdges.length);
      const edge = possibleEdges[randomEdgeIndex];
      possibleEdges.splice(randomEdgeIndex, 1);

      const t = 0.1 + Math.random() * 0.8;
      const point = bezierPoint(
        edge.start.position.xz,
        edge.controlPoint1,
        edge.controlPoint2,
        edge.end.position.xz,
        t,
      );
      const tangent = bezierTangent(
        edge.start.position.xz,
        edge.controlPoint1,
        edge.controlPoint2,
        edge.end.position.xz,
        t,
      );
      this.buildings.push(this.tryCreateBuilding(edge, point, tangent));
    }
  }

  private tryCreateBuilding(edge: d.Infer<typeof RoadEdge>, edgePoint: d.v2f, tangent: d.v2f): Building {
    "use gpu";

    let buildingHeight = this.randomInt(0.3, 0.6);
    let buildingWidth = this.randomInt(0.5, 1);
    let buildingDepth = this.randomInt(0.5, 1);
    let color = d.vec3f(Math.random(), Math.random(), Math.random());
    let shape = meshes.box({ width: buildingWidth, height: buildingHeight, depth: buildingDepth });

    const tangentLength = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y);
    const direction =
      tangentLength > 0
        ? d.vec2f(tangent.x / tangentLength, tangent.y / tangentLength)
        : d.vec2f(0, 1);
    const side = Math.random() < 0.5 ? -1 : 1;
    const normal = d.vec2f(-direction.y * side, direction.x * side);

    const roadEdgeOffset = d.vec3f(
      buildingWidth + roadWidth,
      0,
      buildingDepth + roadWidth,
    );


    const x = edgePoint.x + normal.x * roadEdgeOffset.x;
    const z = edgePoint.y + normal.y * roadEdgeOffset.z;
    const height = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(x, 0, z));
    const yaw = Math.atan2(direction.x, direction.y);

    // const cosYaw = Math.abs(Math.cos(yaw));
    // const sinYaw = Math.abs(Math.sin(yaw));
    // const rotatedDimensions = d.vec3f(
    //   buildingWidth * cosYaw + buildingDepth * sinYaw,
    //   buildingHeight,
    //   buildingWidth * sinYaw + buildingDepth * cosYaw,
    // );

    // this.collisionSystem.register(
    //   d.vec3f(x, height + buildingHeight / 2, z),
    //   rotatedDimensions,
    // );

    return {
      position: d.vec3f(x, height + buildingHeight / 2, z),
      dimensions: d.vec3f(buildingWidth, buildingHeight, buildingDepth),
      color: color,
      mesh: null,
      rotation: d.vec4f(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)),
      shape: shape,
      edge: edge,
    };
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
    for (const building of this.buildings) {
      building.mesh = pool.add(building.shape, encoder);
      this.things.add(building.mesh, {
        position: building.position,
        rotation: building.rotation,
        ...materials.matte(building.color),
      });
    }
    this.things.flush();
    return this.buildings.map((b) => b.mesh);
  }

  public draw(
    scene: passes.Description<{
      readonly hdr: typeof passes.color;
      readonly depth: typeof passes.depth;
    }>,
    light: lighting.Lighting,
  ) {
    const drawn = scene.add(this.things.renderer(light));
    return drawn;
  }

  public cast(shadow: lighting.Shadow, light: lighting.Lighting) {
    const casted = shadow.add(this.things.renderer(light));
    return casted;
  }

  public getRandomBuilding(): Building {
    const randomIndex = Math.floor(Math.random() * this.buildings.length);
    return this.buildings[randomIndex];
  }

  public getPathToBuilding(from: d.v3f, building: Building): d.Infer<typeof RoadEdge>[] {
    const buildingPosition = building.position;
    const startEdge = this.roadGenerator.getClosestEdge(from);
    const endEdge = this.roadGenerator.getClosestEdge(buildingPosition);
    if (!startEdge) {
      throw new Error("No closest edge found for building");
    }
    if (!endEdge) {
      throw new Error("No road edge found for building");
    }

    const queue: d.Infer<typeof RoadEdge>[] = [startEdge];
    const visitedEdges = new Set<d.Infer<typeof RoadEdge>>();
    const previousEdges = new Map<
      d.Infer<typeof RoadEdge>,
      d.Infer<typeof RoadEdge> | null
    >();

    visitedEdges.add(startEdge);
    previousEdges.set(startEdge, null);

    while (queue.length > 0) {
      const currentEdge = queue.shift()!;
      if (currentEdge === endEdge) {
        const path: d.Infer<typeof RoadEdge>[] = [];
        let edge: d.Infer<typeof RoadEdge> | null = currentEdge;

        while (edge) {
          path.unshift(edge);
          edge = previousEdges.get(edge) ?? null;
        }

        return path;
      }

      for (const neighbour of this.roadGenerator.getNeighbours(currentEdge)) {
        if (visitedEdges.has(neighbour)) {
          continue;
        }

        visitedEdges.add(neighbour);
        previousEdges.set(neighbour, currentEdge);
        queue.push(neighbour);
      }
    }

    return [];
  }
}
