import { camera, materials, meshPool, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, tgpu, type TgpuCommandEncoder, type TgpuRoot, type TgpuUniform } from "typegpu";
import { Fragment, RoadNode, Vertex, RoadEdge } from "./static";



type RoadVertex = d.Infer<typeof meshes.Surface>;

export class RoadGenerator {
    public nodes: d.Infer<typeof RoadNode>[];
    public edges: d.Infer<typeof RoadEdge>[];
    public mesh: meshPool.Mesh | null;
    private readonly shape: meshes.Geometry<typeof meshes.Surface>;

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

    constructor(root: TgpuRoot, mapWidth: number, mapHeight: number, nodeCount: number, offset: d.v3f) {
        // pick a few random points on the map (nodes)
        // connect the nodes with roads (RoadEdges) that contain bezier curves properties
        // generate a mesh for each road segment based on the bezier curve properties    

        this.offset = offset;
        this.offsetUniform = root.createUniform(d.vec3f, offset);

        this.nodes = generateNodes(mapWidth, mapHeight, nodeCount);
        this.edges = generateRoadEdges(this.nodes);

        const vertexData: RoadVertex[] = [];
        const roadWidth = 0.5;

        for (const RoadEdge of this.edges) {
            const roadMeshVertices = generateRoadMesh(RoadEdge, roadWidth);
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

        const worldPosition = d.vec3f(this.nodes[0].position.x, 1, this.nodes[0].position.y).add(this.offset);
        return worldPosition;
    }

    public getStartDirection() {
        "use gpu";

        if(this.edges.length <= 1)
        {
            return d.vec3f(0, 0, -1);
        }

        const tangent = bezierTangent(this.edges[0].start.position, this.edges[0].controlPoint1, this.edges[0].controlPoint2, this.edges[0].end.position, 0);
        const direction = std.normalize(d.vec3f(tangent.x, 0, tangent.y));
        return direction;
    }
}

function generateNodes(mapWidth: number, mapHeight: number, nodeCount: number): d.Infer<typeof RoadNode>[] {
    const nodes: d.Infer<typeof RoadNode>[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const x = Math.random() * mapWidth;
        const y = Math.random() * mapHeight;
        nodes.push({ position: d.vec2f(x, y) });
        console.log(`Generated node ${i}: (${x.toFixed(2)}, ${y.toFixed(2)})`);
    }
    return nodes;
}

function generateRoadEdges(nodes: d.Infer<typeof RoadNode>[]): d.Infer<typeof RoadEdge>[] {
    const RoadEdges: d.Infer<typeof RoadEdge>[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
        const startNode = nodes[i];
        const endNode = nodes[i + 1];

        const controlPoint1 = d.vec2f(
            (startNode.position.x + endNode.position.x) / 2,
            startNode.position.y
        );
        const controlPoint2 = d.vec2f(
            (startNode.position.x + endNode.position.x) / 2,
            endNode.position.y
        );

        RoadEdges.push({
            start: startNode,
            end: endNode,
            controlPoint1: controlPoint1,
            controlPoint2: controlPoint2,
        });
    }
    return RoadEdges;
}

function generateRoadMesh(edge: d.Infer<typeof RoadEdge>, roadWidth: number): RoadVertex[] {
    const stripVertices: RoadVertex[] = [];
    const segments = 30;
    let previousLeft: RoadVertex | undefined;
    let previousRight: RoadVertex | undefined;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const pointOnCurve = bezierPoint(edge.start.position, edge.controlPoint1, edge.controlPoint2, edge.end.position, t);
        const tangent = bezierTangent(edge.start.position, edge.controlPoint1, edge.controlPoint2, edge.end.position, t);
        const normal = std.normalize(d.vec2f(-tangent.y, tangent.x));

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