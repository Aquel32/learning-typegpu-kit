import { camera, materials, meshPool, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, tgpu, type TgpuCommandEncoder, type TgpuRoot, type TgpuUniform } from "typegpu";
import { Fragment, RoadNode, Vertex, RoadEdge } from "./static";
import type { MapGenerator } from "./map";

type RoadVertex = d.Infer<typeof meshes.Surface>;

export class RoadGenerator {
    public nodes: d.Infer<typeof RoadNode>[];
    public edges: d.Infer<typeof RoadEdge>[];
    public mesh: meshPool.Mesh | null;
    private readonly shape: meshes.Geometry<typeof meshes.Surface>;
    private mapGenerator: MapGenerator;
    private readonly mapWidth: number;
    private readonly mapHeight: number;

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
    };;

    private offset: d.v3f;
    private offsetUniform: TgpuUniform<d.Vec3f>;

    constructor(root: TgpuRoot, map: MapGenerator, mapWidth: number, mapHeight: number, nodeCount: number, offset: d.v3f) {
        // pick a few random points on the map (nodes)
        // connect the nodes with roads (RoadEdges) that contain bezier curves properties
        // generate a mesh for each road segment based on the bezier curve properties    

        this.offset = offset;
        this.offsetUniform = root.createUniform(d.vec3f, offset);
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;

        this.mapGenerator = map;

        this.nodes = this.getNodes(mapWidth, mapHeight, nodeCount);
        this.edges = this.getEdges();

        const vertexData: RoadVertex[] = [];
        const roadWidth = 0.5;

        for (const RoadEdge of this.edges) {
            const roadMeshVertices = this.generateRoadMesh(RoadEdge, roadWidth);
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
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.mesh = pool.add(this.shape, encoder);
        return this.mesh;
    }

    public getStartPosition() {
        "use gpu";

        if(this.nodes.length <= 0)
        {
            return d.vec3f(0, 1, 0);
        }

        const worldPosition = this.nodes[0].position.add(this.offset);
        return worldPosition;
    }

    public getStartDirection() {
        "use gpu";

        return d.vec3f(0, 0, -1);
        // if(this.edges.length <= 1)
        // {
        //     return d.vec3f(0, 0, -1);
        // }

        // const tangent = bezierTangent(this.edges[0].start.position.xz, this.edges[0].controlPoint1, this.edges[0].controlPoint2, this.edges[0].end.position.xz, 0);
        // const direction = normalizeDirection(tangent.x, tangent.y);
        // return d.vec3f(direction.x, 0, direction.y);
    }

    private getKey(position: d.v2f): string {
        return `${position.x},${position.y}`;
    }

    private getIsolatedZones(mapWidth: number, mapHeight: number): d.v2f[] {
        const isolatedZones: d.v2f[] = [];

        const heightMap = this.mapGenerator.heightMap;
        const toCheck = new Set<string>();

        for(let x = 0; x < mapWidth; x += 1) {
            for(let z = 0; z < mapHeight; z += 1) {
                const point = d.vec2f(x - mapWidth / 2, z - mapHeight / 2);
                toCheck.add(this.getKey(point));
            }
        }

        const zoneSizes: number[] = [];

        while(toCheck.size > 0) {
            const firstKey = toCheck.values().next().value!;
            const [firstX, firstZ] = firstKey.split(",").map(Number);
            const firstPoint = d.vec2f(firstX, firstZ);
            const firstHeight = heightMap.get(firstKey) ?? Infinity;

            if(firstHeight === 0) {
                isolatedZones.push(firstPoint);
                zoneSizes.push(0);
            }

            const queue: d.v2f[] = [];
            queue.push(firstPoint);
            toCheck.delete(this.getKey(firstPoint));

            const visited = new Set<string>();

            while(queue.length > 0) {
                const current = queue.shift()!;
                const currentKey = this.getKey(current);
                if(visited.has(currentKey) && toCheck.has(currentKey)) {
                    continue;
                }
                visited.add(currentKey);

                const height = heightMap.get(currentKey) ?? Infinity;
                if(height !== 0) {
                    continue;
                }

                zoneSizes[zoneSizes.length - 1]++;

                const neighbors = [
                    d.vec2f(current.x + 1, current.y),
                    d.vec2f(current.x - 1, current.y),
                    d.vec2f(current.x, current.y + 1),
                    d.vec2f(current.x, current.y - 1),
                ];

                for(const neighbor of neighbors) {
                    const key = this.getKey(neighbor);
                    if (
                        neighbor.x >= -mapWidth / 2 &&
                        neighbor.x < mapWidth / 2 &&
                        neighbor.y >= -mapHeight / 2 &&
                        neighbor.y < mapHeight / 2 &&
                        !visited.has(key) &&
                        toCheck.has(key)
                    ) {
                        visited.add(key);
                        toCheck.delete(key);
                        queue.push(neighbor);
                    }
                }
            }
        }
        console.log(isolatedZones.map((zone, i) => `(${zone.x}, ${zone.y}), size: ${zoneSizes[i]}`));
        return isolatedZones;
    }

    private getNodes(mapWidth: number, mapHeight: number, anchorCount: number): d.Infer<typeof RoadNode>[] {
        const nodes: d.Infer<typeof RoadNode>[] = [];

        const anchorPoints = this.getAnchorPoints(mapWidth, mapHeight, anchorCount);

        for(const anchor of anchorPoints) {
            const node: d.Infer<typeof RoadNode> = {
                position: d.vec3f(anchor.x, 0, anchor.y),
            };
            nodes.push(node);
        }

        const path = this.findPathBetweenNodes(nodes[0], nodes[nodes.length - 1], mapWidth, mapHeight);
        if(path) {
            console.log("Path found between first and last node:");
            console.log(path.map(p => `(${p.x}, ${p.y})`).join(" -> "));
            console.log(`Path length: ${path.length}`);
        } else {
            console.log("No path found between first and last node.");
        }

        return nodes;
    }   

    private getAnchorPoints(mapWidth: number, mapHeight: number, count: number): d.v2f[] {
        const anchorPoints: d.v2f[] = [];
        for(let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * mapWidth) - mapWidth / 2;
            const z = Math.floor(Math.random() * mapHeight) - mapHeight / 2;
            const point = d.vec2f(x, z);
            const nearestRoadPoint = this.getNearestRoadAccesiblePoint(point, mapWidth, mapHeight);
            if(nearestRoadPoint) {
                anchorPoints.push(nearestRoadPoint);
            }
        }
        return anchorPoints;        
    }

    private getDistanceToClosestNode(point: d.v2f, mapWidth: number, mapHeight: number): number {
        let minDistance = Infinity;
        for(let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const distance = std.length(point.sub(node.position.xz));
            if(distance < minDistance) {
                minDistance = distance;
            }
        }
        return minDistance;
    }

    private findPathBetweenNodes(startNode: d.Infer<typeof RoadNode>, endNode: d.Infer<typeof RoadNode>, mapWidth: number, mapHeight: number): d.v2f[] | null {
        const start = startNode.position.xz;
        const end = endNode.position.xz;

        const heightMap = this.mapGenerator.heightMap;
        const visited = new Set<string>();
        const queue: { point: d.v2f, path: d.v2f[] }[] = [];
        queue.push({ point: start, path: [start] });

        while(queue.length > 0) {
            const current = queue.shift()!;
            const currentKey = this.getKey(current.point);
            if(visited.has(currentKey)) {
                continue;
            }
            visited.add(currentKey);

            const currentHeight = heightMap.get(currentKey) ?? Infinity;
            if(currentHeight !== 0) {
                continue;
            }

            if(current.point.x === end.x && current.point.y === end.y) {
                return current.path;
            }

            const neighbors = [
                d.vec2f(current.point.x + 1, current.point.y),
                d.vec2f(current.point.x - 1, current.point.y),
                d.vec2f(current.point.x, current.point.y + 1),
                d.vec2f(current.point.x, current.point.y - 1),
            ];

            for(const neighbor of neighbors) {
                const key = this.getKey(neighbor);
                if (
                    neighbor.x >= -mapWidth / 2 &&
                    neighbor.x < mapWidth / 2 &&
                    neighbor.y >= -mapHeight / 2 &&
                    neighbor.y < mapHeight / 2 &&
                    !visited.has(key) &&
                    (heightMap.get(key) ?? Infinity) === 0
                ) {
                    queue.push({ point: neighbor, path: [...current.path, neighbor] });
                }
            }
        }

        return null;
    }

    private getNearestRoadAccesiblePoint(point: d.v2f, mapWidth: number, mapHeight: number): d.v2f | null {
        const heightMap = this.mapGenerator.heightMap;
        const visited = new Set<string>();
        const queue: d.v2f[] = [];
        queue.push(point);

        while(queue.length > 0) {
            const current = queue.shift()!;
            const currentKey = this.getKey(current);
            if(visited.has(currentKey)) {
                continue;
            }
            visited.add(currentKey);

            const height = heightMap.get(currentKey) ?? Infinity;
            if(height === 0) {
                return current;
            }

            const neighbors = [
                d.vec2f(current.x + 1, current.y),
                d.vec2f(current.x - 1, current.y),
                d.vec2f(current.x, current.y + 1),
                d.vec2f(current.x, current.y - 1),
            ];

            for(const neighbor of neighbors) {
                const key = this.getKey(neighbor);
                if (
                    neighbor.x >= -mapWidth / 2 &&
                    neighbor.x < mapWidth / 2 &&
                    neighbor.y >= -mapHeight / 2 &&
                    neighbor.y < mapHeight / 2 &&
                    !visited.has(key)
                ) {
                    queue.push(neighbor);
                }
            }
        }

        return null;
    }

    private getEdges(): d.Infer<typeof RoadEdge>[] {
        const edges: d.Infer<typeof RoadEdge>[] = [];
        if (this.nodes.length < 2) {
            return edges;
        }

        for (let i = 0; i < this.nodes.length - 1; i++) {
            const path = this.findPathBetweenNodes(
                this.nodes[i],
                this.nodes[i + 1],
                this.mapWidth,
                this.mapHeight,
            );

            if (!path) {
                continue;
            }  

            const everyNthPoint = 3;
            const filteredPath = path.filter((_, index) => index % everyNthPoint === 0);

            for (let j = 0; j < filteredPath.length - 1; j++) {
                const start = this.nodeAt(filteredPath[j]!);
                const end = this.nodeAt(filteredPath[j + 1]!);

                const controlPoint1 = d.vec2f(
                    (start.position.x + end.position.x) / 2,
                    start.position.z,
                );
                const controlPoint2 = d.vec2f(
                    (start.position.x + end.position.x) / 2,
                    end.position.z,
                );

                edges.push({
                    start,
                    end,
                    controlPoint1,
                    controlPoint2,
                });
            }
        }
        return edges;
    }

    private nodeAt(point: d.v2f): d.Infer<typeof RoadNode> {
        const height = this.mapGenerator.heightMap.get(this.getKey(point)) ?? 0;
        return {
            position: d.vec3f(point.x, height + 0.03, point.y),
        };
    }

    // private generateRoadMesh(edge: d.Infer<typeof RoadEdge>, roadWidth: number): RoadVertex[] {
    //     const start = edge.start.position;
    //     const end = edge.end.position;
    //     const direction = normalizeDirection(end.x - start.x, end.z - start.z);
    //     const halfWidth = roadWidth / 2;
    //     const normal = d.vec2f(-direction.y, direction.x);

    //     const startLeft = d.vec3f(
    //         start.x + normal.x * halfWidth,
    //         start.y,
    //         start.z + normal.y * halfWidth,
    //     );
    //     const startRight = d.vec3f(
    //         start.x - normal.x * halfWidth,
    //         start.y,
    //         start.z - normal.y * halfWidth,
    //     );
    //     const endLeft = d.vec3f(
    //         end.x + normal.x * halfWidth,
    //         end.y,
    //         end.z + normal.y * halfWidth,
    //     );
    //     const endRight = d.vec3f(
    //         end.x - normal.x * halfWidth,
    //         end.y,
    //         end.z - normal.y * halfWidth,
    //     );
    //     const normalUp = d.vec3f(0, 1, 0);

    //     return [
    //         { position: startLeft, normal: normalUp, uv: d.vec2f(0, 0) },
    //         { position: endLeft, normal: normalUp, uv: d.vec2f(1, 0) },
    //         { position: startRight, normal: normalUp, uv: d.vec2f(0, 1) },
    //         { position: startRight, normal: normalUp, uv: d.vec2f(0, 1) },
    //         { position: endLeft, normal: normalUp, uv: d.vec2f(1, 0) },
    //         { position: endRight, normal: normalUp, uv: d.vec2f(1, 1) },
    //     ];
    // }

    private generateRoadMesh(edge: d.Infer<typeof RoadEdge>, roadWidth: number): RoadVertex[] {
        const stripVertices: RoadVertex[] = [];
        const segments = 30;
        let previousLeft: RoadVertex | undefined;
        let previousRight: RoadVertex | undefined;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const pointOnCurve = bezierPoint(edge.start.position.xz, edge.controlPoint1, edge.controlPoint2, edge.end.position.xz, t);
            const tangent = bezierTangent(edge.start.position.xz, edge.controlPoint1, edge.controlPoint2, edge.end.position.xz, t);
            const normal = safeNormalize(d.vec2f(-tangent.y, tangent.x));

            const leftVertex = {
                position: d.vec3f(pointOnCurve.x + normal.x * roadWidth / 2, 0, pointOnCurve.y + normal.y * roadWidth / 2),
                normal: d.vec3f(0, 1, 0),
                uv: d.vec2f(i / segments, 0),
            };
            const rightVertex = {
                position: d.vec3f(pointOnCurve.x - normal.x * roadWidth / 2, 0, pointOnCurve.y - normal.y * roadWidth / 2),
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
}

function safeNormalize(v: d.v2f): d.v2f {
    const length = std.length(v);
    if (length < 0.000001) {
        return d.vec2f(0, 1);
    }
    return v.div(length);
}

function bezierPoint(p0: d.v2f, p1: d.v2f, p2: d.v2f, p3: d.v2f, t: number): d.v2f {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const p = d.vec2f(
        uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
    );

    return p;
}

function bezierTangent(p0: d.v2f, p1: d.v2f, p2: d.v2f, p3: d.v2f, t: number): d.v2f {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;

    const tangent = d.vec2f(
        -3 * uu * p0.x + 3 * uu * p1.x - 6 * u * t * p1.x + 6 * u * t * p2.x - 3 * tt * p2.x + 3 * tt * p3.x,
        -3 * uu * p0.y + 3 * uu * p1.y - 6 * u * t * p1.y + 6 * u * t * p2.y - 3 * tt * p2.y + 3 * tt * p3.y
    );

    return tangent;
}

function normalizeDirection(x: number, y: number): d.v2f {
    const length = Math.sqrt(x * x + y * y);
    if (length < 0.000001) {
        return d.vec2f(0, 1);
    }
    return d.vec2f(x / length, y / length);
}

function gridKey(position: d.v2f): string {
    return `${position.x},${position.y}`;
}