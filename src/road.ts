import { camera, lighting, materials, meshPool, passes, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, tgpu, type TgpuCommandEncoder, type TgpuRoot, type TgpuUniform } from "typegpu";
import { Fragment, RoadNode, Vertex, RoadEdge, MAP_HEIGHT, MAP_WIDTH, roadWidth } from "./static";
import type { MapGenerator } from "./map";

type RoadVertex = d.Infer<typeof meshes.Surface>;

export type GroundType = "air" | "road" | "grass";

export class RoadGenerator {
  private nodes: d.Infer<typeof RoadNode>[];
  private edges: d.Infer<typeof RoadEdge>[];
  public mesh: meshPool.Mesh | null;
  private readonly shape: meshes.Geometry<typeof meshes.Surface>;
  private mapGenerator: MapGenerator;
  private offset: d.v3f;
  private offsetUniform: TgpuUniform<d.Vec3f>;
  private pool: meshPool.MeshPool<{}>;
  public network: d.Infer<typeof RoadEdge>[];

  constructor(
    root: TgpuRoot,
    pool: meshPool.MeshPool<{}>,
    map: MapGenerator,
    step: number,
    offset: d.v3f,
  ) {
    this.offset = offset;
    this.offsetUniform = root.createUniform(d.vec3f, offset);

    this.mapGenerator = map;

    this.nodes = this.getNodes(step);
    this.edges = [];
    this.edges = this.getEdges();

    this.network = this.getBiggestComponent();

    const vertexData: RoadVertex[] = [];

    for (const RoadEdge of this.edges) {
      const roadMeshVertices = this.generateRoadMesh(RoadEdge);
      vertexData.push(...roadMeshVertices);
    }

    const vertices = tgpu.const(d.arrayOf(meshes.Surface), vertexData);
    this.shape = {
      schema: meshes.Surface,
      topology: "triangle-list",
      vertexCount: vertexData.length,
      vertexAt: (index: number) => {
        "use gpu";
        return meshes.Surface(vertices.$[index]!);
      },
    };
    this.mesh = null;
    this.pool = pool;
  }

  public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
    this.mesh = pool.add(this.shape, encoder);
    return this.mesh;
  }

  public at = (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position + this.offsetUniform.$;
    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  };

  public surfaceOf = (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    const point = shading.point(vertex.world, vertex.normal);
    const material = materials.matte(d.vec3f(0.1, 0.1, 0.1));
    return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });
  };

  public draw(
    scene: passes.Description<{
      readonly hdr: typeof passes.color;
      readonly depth: typeof passes.depth;
    }>,
    light: lighting.Lighting,
  ) {
    return scene.add({
      Vertex: Vertex,
      at: this.at,
      surfaceOf: this.surfaceOf,
      color: passes.shaded,
      draw: (pipeline) =>
        pipeline
          .withIndexBuffer(this.pool.indices)
          .drawIndexed(this.mesh!.indexCount, 1, this.mesh!.firstIndex, this.mesh!.baseVertex),
    });
  }

  public cast(shadow: lighting.Shadow) {
    return shadow.add({
      Vertex: Vertex,
      inject: () => this.pool.inject(),
      at: this.at,
      draw: (pipeline) =>
        pipeline
          .withIndexBuffer(this.pool.indices)
          .drawIndexed(this.mesh!.indexCount, 1, this.mesh!.firstIndex, this.mesh!.baseVertex),
    });
  }

  public getStartPosition() {
    "use gpu";

    if (this.nodes.length <= 0) {
      return d.vec3f(0, 1, 0);
    }

    const worldPosition = this.nodes[0].position.add(this.offset);
    return worldPosition;
  }

  public getStartDirection() {
    "use gpu";

    if(this.edges.length <= 1)
    {
        return d.vec3f(0, 0, -1);
    }

    const tangent = bezierTangent(this.edges[0].start.position.xz, this.edges[0].controlPoint1, this.edges[0].controlPoint2, this.edges[0].end.position.xz, 0);
    const direction = std.normalize(tangent);
    return d.vec3f(direction.x, 0, direction.y);
  }

  public getClosestNode(position: d.v3f): d.Infer<typeof RoadNode> | null {
    "use gpu";

    if (this.nodes.length <= 0) {
      return null;
    }

    let closestNode: d.Infer<typeof RoadNode> | null = null;
    let closestDistance = Infinity;

    for (const node of this.nodes) {
      const distanceX = node.position.x - position.x;
      const distanceZ = node.position.z - position.z;
      const distance = distanceX * distanceX + distanceZ * distanceZ;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestNode = node;
      }
    }

    return closestNode;
  }

  public getClosestEdge(position: d.v3f): d.Infer<typeof RoadEdge> | null {
    "use gpu";

    if (this.edges.length <= 0) {
      return null;
    }

    let closestEdge: d.Infer<typeof RoadEdge> | null = null;
    let closestDistance = Infinity;

    for (const edge of this.edges) {
      const distance = this.getDistanceToEdge(position, edge);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestEdge = edge;
      }
    }

    return closestEdge;
  }

  public getDistanceToClosestEdge(position: d.v3f): number {
    "use gpu";

    let closestDistance = Infinity;
    for (const edge of this.edges) {
      closestDistance = Math.min(closestDistance, this.getDistanceToEdge(position, edge));
    }

    return closestDistance;
  }

  private getDistanceToEdge(position: d.v3f, edge: d.Infer<typeof RoadEdge>): number {
    const points = this.getEdgePoints(edge, 10);
    let closestDistance = Infinity;

    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const segmentX = end.x - start.x;
      const segmentZ = end.y - start.y;
      const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
      const pointX = position.x - start.x;
      const pointZ = position.z - start.y;
      const segmentPosition = segmentLengthSquared > 0
        ? Math.max(0, Math.min(1, (pointX * segmentX + pointZ * segmentZ) / segmentLengthSquared))
        : 0;
      const closestX = start.x + segmentPosition * segmentX;
      const closestZ = start.y + segmentPosition * segmentZ;
      const distanceX = position.x - closestX;
      const distanceZ = position.z - closestZ;
      closestDistance = Math.min(closestDistance, distanceX * distanceX + distanceZ * distanceZ);
    }

    return closestDistance;
  }

  // PROCEDURAL GENERATION BELOW

  private getNodes(step: number): d.Infer<typeof RoadNode>[] {
    const nodes: d.Infer<typeof RoadNode>[] = [];

    for (let x = -MAP_WIDTH / 2 + step / 2; x < MAP_WIDTH / 2 - step / 2; x += step) {
      for (let z = -MAP_HEIGHT / 2 + step / 2; z < MAP_HEIGHT / 2 - step / 2; z += step) {
        const randomOffsetX = Math.random() * (step / 3) - (step / 3);
        const randomOffsetZ = Math.random() * (step / 3) - (step / 3);

        const groundHeight = this.mapGenerator.getHeightAtWorldPosition(d.vec3f(x + randomOffsetX, 0, z + randomOffsetZ));
        if (groundHeight !== 0) continue;

        nodes.push({
          position: d.vec3f(x + randomOffsetX, groundHeight, z + randomOffsetZ),
        });
      }
    }

    console.log(`Generated ${nodes.length} road nodes.`);
    return nodes;
  }

  private getEdges(): d.Infer<typeof RoadEdge>[] {
    const edges: d.Infer<typeof RoadEdge>[] = [];

    while (true) {
      let closestEdge: d.Infer<typeof RoadEdge> | null = null;
      let closestDistance = Infinity;

      for (let startIndex = 0; startIndex < this.nodes.length; startIndex++) {
        for (let endIndex = startIndex + 1; endIndex < this.nodes.length; endIndex++) {
          const start = this.nodes[startIndex]!;
          const end = this.nodes[endIndex]!;

          if (this.canTravelBetweenNodes(start, end, edges)) {
            continue;
          }

          const distanceX = end.position.x - start.position.x;
          const distanceZ = end.position.z - start.position.z;
          const distance = distanceX * distanceX + distanceZ * distanceZ;
          if (distance >= closestDistance) {
            continue;
          }

          const edge = this.getLegalEdge(start, end, edges);
          if (edge) {
            closestEdge = edge;
            closestDistance = distance;
          }
        }
      }

      if (!closestEdge) {
        break;
      }

      edges.push(closestEdge);
    }

    return edges;
  }

  private canTravelBetweenNodes(
    start: d.Infer<typeof RoadNode>,
    end: d.Infer<typeof RoadNode>,
    edges: d.Infer<typeof RoadEdge>[],
  ): boolean {
    const queue: d.Infer<typeof RoadNode>[] = [];
    const visited: Set<string> = new Set();

    queue.push(start);

    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      visited.add(`${currentNode.position.x},${currentNode.position.z}`);

      if (currentNode === end) {
        return true;
      }

      for (const edge of edges) {
        if (
          edge.start === currentNode &&
          !visited.has(`${edge.end.position.x},${edge.end.position.z}`)
        ) {
          queue.push(edge.end);
        } else if (
          edge.end === currentNode &&
          !visited.has(`${edge.start.position.x},${edge.start.position.z}`)
        ) {
          queue.push(edge.start);
        }
      }
    }

    return false;
  }

  private getLegalEdge(
    start: d.Infer<typeof RoadNode>,
    end: d.Infer<typeof RoadNode>,
    existingEdges: d.Infer<typeof RoadEdge>[],
  ): d.Infer<typeof RoadEdge> | null {
    const direction = d.vec2f(end.position.x - start.position.x, end.position.z - start.position.z);
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    const perpendicular = d.vec2f(-direction.y / length, direction.x / length);
    const bend = Math.min(length * 0.2, 2.5);

    for (const bendAmount of [bend * 0.25, -bend * 0.25, bend * 0.5, -bend * 0.5, bend, -bend]) {
      const edge = this.createEdge(start, end, perpendicular, bendAmount);
      if (
        this.doesEdgeLayOnFlatGround(edge) &&
        !this.doesEdgeIntersectExisting(edge, existingEdges)
      ) {
        return edge;
      }
    }

    return null;
  }

  private createEdge(
    start: d.Infer<typeof RoadNode>,
    end: d.Infer<typeof RoadNode>,
    perpendicular: d.v2f,
    bend: number,
  ): d.Infer<typeof RoadEdge> {
    const direction = d.vec2f(end.position.x - start.position.x, end.position.z - start.position.z);

    const controlPoint1 = d.vec2f(
      start.position.x + direction.x / 3 + perpendicular.x * bend,
      start.position.z + direction.y / 3 + perpendicular.y * bend,
    );
    const controlPoint2 = d.vec2f(
      start.position.x + (direction.x * 2) / 3 + perpendicular.x * bend,
      start.position.z + (direction.y * 2) / 3 + perpendicular.y * bend,
    );

    return {
      start: start,
      end: end,
      controlPoint1: controlPoint1,
      controlPoint2: controlPoint2,
    };
  }

  //   private generateNodesMesh(nodes: d.Infer<typeof RoadNode>[]): RoadVertex[] {
  //     const vertices: RoadVertex[] = [];
  //     const nodeSize = 1;

  //     for (const node of nodes) {
  //       const position = node.position;
  //       const halfSize = nodeSize / 2;

  //       const topLeft = d.vec3f(position.x - halfSize, position.y, position.z - halfSize);
  //       const topRight = d.vec3f(position.x + halfSize, position.y, position.z - halfSize);
  //       const bottomLeft = d.vec3f(position.x - halfSize, position.y, position.z + halfSize);
  //       const bottomRight = d.vec3f(position.x + halfSize, position.y, position.z + halfSize);
  //       const normalUp = d.vec3f(0, 1, 0);

  //       vertices.push(
  //         { position: topLeft, normal: normalUp, uv: d.vec2f(0, 0) },
  //         { position: bottomLeft, normal: normalUp, uv: d.vec2f(0, 1) },
  //         { position: topRight, normal: normalUp, uv: d.vec2f(1, 0) },
  //         { position: topRight, normal: normalUp, uv: d.vec2f(1, 0) },
  //         { position: bottomLeft, normal: normalUp, uv: d.vec2f(0, 1) },
  //         { position: bottomRight, normal: normalUp, uv: d.vec2f(1, 1) },
  //       );
  //     }

  //     return vertices;
  //   }

  private generateRoadMesh(edge: d.Infer<typeof RoadEdge>): RoadVertex[] {
    const stripVertices: RoadVertex[] = [];
    const segments = 30;
    let previousLeft: RoadVertex | undefined;
    let previousRight: RoadVertex | undefined;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pointOnCurve = bezierPoint(
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
      const normal = std.normalize(d.vec2f(-tangent.y, tangent.x));

      const leftVertex = {
        position: d.vec3f(
          pointOnCurve.x + (normal.x * roadWidth) / 2,
          0,
          pointOnCurve.y + (normal.y * roadWidth) / 2,
        ),
        normal: d.vec3f(0, 1, 0),
        uv: d.vec2f(i / segments, 0),
      };
      const rightVertex = {
        position: d.vec3f(
          pointOnCurve.x - (normal.x * roadWidth) / 2,
          0,
          pointOnCurve.y - (normal.y * roadWidth) / 2,
        ),
        normal: d.vec3f(0, 1, 0),
        uv: d.vec2f(i / segments, 1),
      };

      if (previousLeft && previousRight) {
        stripVertices.push(previousLeft, leftVertex, previousRight);
        stripVertices.push(previousRight, leftVertex, rightVertex);
      }
      previousLeft = leftVertex;
      previousRight = rightVertex;
    }

    return stripVertices;
  }

  private doesEdgeLayOnFlatGround(edge: d.Infer<typeof RoadEdge>): boolean {
    const segments = 30;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pointOnCurve = bezierPoint(
        edge.start.position.xz,
        edge.controlPoint1,
        edge.controlPoint2,
        edge.end.position.xz,
        t,
      );

      const groundHeight = this.mapGenerator.getHeightAtWorldPosition(
        d.vec3f(pointOnCurve.x, 0, pointOnCurve.y),
      );
      if (groundHeight !== 0) {
        return false;
      }
    }

    return true;
  }

  private doesEdgeIntersectExisting(
    edge: d.Infer<typeof RoadEdge>,
    existingEdges: d.Infer<typeof RoadEdge>[],
  ): boolean {
    const candidatePoints = this.getEdgePoints(edge);

    for (const existingEdge of existingEdges) {
      const existingPoints = this.getEdgePoints(existingEdge);
      const sharedStart = edge.start === existingEdge.start || edge.start === existingEdge.end;
      const sharedEnd = edge.end === existingEdge.start || edge.end === existingEdge.end;

      for (let candidateIndex = 0; candidateIndex < candidatePoints.length - 1; candidateIndex++) {
        for (let existingIndex = 0; existingIndex < existingPoints.length - 1; existingIndex++) {
          if (
            (sharedStart &&
              candidateIndex === 0 &&
              existingIndex === 0 &&
              candidatePoints[0]!.x === existingPoints[0]!.x &&
              candidatePoints[0]!.y === existingPoints[0]!.y) ||
            (sharedStart &&
              candidateIndex === 0 &&
              existingIndex === existingPoints.length - 2 &&
              candidatePoints[0]!.x === existingPoints[existingPoints.length - 1]!.x &&
              candidatePoints[0]!.y === existingPoints[existingPoints.length - 1]!.y) ||
            (sharedEnd &&
              candidateIndex === candidatePoints.length - 2 &&
              existingIndex === 0 &&
              candidatePoints[candidatePoints.length - 1]!.x === existingPoints[0]!.x &&
              candidatePoints[candidatePoints.length - 1]!.y === existingPoints[0]!.y) ||
            (sharedEnd &&
              candidateIndex === candidatePoints.length - 2 &&
              existingIndex === existingPoints.length - 2 &&
              candidatePoints[candidatePoints.length - 1]!.x ===
                existingPoints[existingPoints.length - 1]!.x &&
              candidatePoints[candidatePoints.length - 1]!.y ===
                existingPoints[existingPoints.length - 1]!.y)
          ) {
            continue;
          }

          if (
            this.lineSegmentsIntersect(
              candidatePoints[candidateIndex]!,
              candidatePoints[candidateIndex + 1]!,
              existingPoints[existingIndex]!,
              existingPoints[existingIndex + 1]!,
            )
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  public getEdgePoints(edge: d.Infer<typeof RoadEdge>, segments: number = 30): d.v2f[] {
    const points: d.v2f[] = [];

    for (let i = 0; i <= segments; i++) {
      points.push(
        bezierPoint(
          edge.start.position.xz,
          edge.controlPoint1,
          edge.controlPoint2,
          edge.end.position.xz,
          i / segments,
        ),
      );
    }

    return points;
  }

  private lineSegmentsIntersect(a: d.v2f, b: d.v2f, c: d.v2f, dPoint: d.v2f): boolean {
    const orientation = (first: d.v2f, second: d.v2f, third: d.v2f) =>
      (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
    const epsilon = 0.0001;
    const onSegment = (first: d.v2f, point: d.v2f, second: d.v2f) =>
      point.x >= Math.min(first.x, second.x) - epsilon &&
      point.x <= Math.max(first.x, second.x) + epsilon &&
      point.y >= Math.min(first.y, second.y) - epsilon &&
      point.y <= Math.max(first.y, second.y) + epsilon;

    const abC = orientation(a, b, c);
    const abD = orientation(a, b, dPoint);
    const cdA = orientation(c, dPoint, a);
    const cdB = orientation(c, dPoint, b);

    return (
      (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
        ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) ||
      (Math.abs(abC) <= epsilon && onSegment(a, c, b)) ||
      (Math.abs(abD) <= epsilon && onSegment(a, dPoint, b)) ||
      (Math.abs(cdA) <= epsilon && onSegment(c, a, dPoint)) ||
      (Math.abs(cdB) <= epsilon && onSegment(c, b, dPoint))
    );
  }

  private getBiggestComponent(): d.Infer<typeof RoadEdge>[] {
    const components: d.Infer<typeof RoadEdge>[][] = [];
    const visited = new Set<d.Infer<typeof RoadNode>>();

    for (const node of this.nodes) {
      if (visited.has(node)) {
        continue;
      }

      const componentEdges: d.Infer<typeof RoadEdge>[] = [];
      const queue = [node];
      visited.add(node);

      while (queue.length > 0) {
        const currentNode = queue.shift()!;
        for (const edge of this.edges) {
          if (edge.start === currentNode && !visited.has(edge.end)) {
            visited.add(edge.end);
            queue.push(edge.end);
            componentEdges.push(edge);
          } else if (edge.end === currentNode && !visited.has(edge.start)) {
            visited.add(edge.start);
            queue.push(edge.start);
            componentEdges.push(edge);
          }
        }
      }

      components.push(componentEdges);
    }

    let largestComponent: d.Infer<typeof RoadEdge>[] = [];
    for (const component of components) {
      if (component.length > largestComponent.length) {
        largestComponent = component;
      }
    }

    console.log(
      `Found ${components.length} road components. Largest component has ${largestComponent.length} edges.`,
    );
    return largestComponent;
  }

  public getNeighbours(edge: d.Infer<typeof RoadEdge>): d.Infer<typeof RoadEdge>[] {
    const neighbours: d.Infer<typeof RoadEdge>[] = [];
    for (const otherEdge of this.edges) {
      if (
        (edge.start === otherEdge.start || edge.start === otherEdge.end) ||
        (edge.end === otherEdge.start || edge.end === otherEdge.end)
      ) {
        neighbours.push(otherEdge);
      }
    }
    return neighbours;
  }
}

export function bezierPoint(p0: d.v2f, p1: d.v2f, p2: d.v2f, p3: d.v2f, t: number): d.v2f {
  "use gpu";

  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  const p = d.vec2f(
    uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  );

  return p;
}

export function bezierTangent(p0: d.v2f, p1: d.v2f, p2: d.v2f, p3: d.v2f, t: number): d.v2f {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;

  const tangent = d.vec2f(
    -3 * uu * p0.x +
      3 * uu * p1.x -
      6 * u * t * p1.x +
      6 * u * t * p2.x -
      3 * tt * p2.x +
      3 * tt * p3.x,
    -3 * uu * p0.y +
      3 * uu * p1.y -
      6 * u * t * p1.y +
      6 * u * t * p2.y -
      3 * tt * p2.y +
      3 * tt * p3.y,
  );

  return tangent;
}
