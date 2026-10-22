import { camera, materials, meshPool, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, tgpu, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import { Fragment, Vertex } from "./static";
import { perlin } from "./perlin";
import { perlin2d } from "@typegpu/noise";

const flatRadius = 0.1;
const flatTransition = 0.16;
const terrainScale = 3.5;
const terrainHeight = 2.5;

const heightAt = (u: number, v: number) => {
  const point = d.vec2f(u * terrainScale, v * terrainScale);
  const broadNoise = perlin.get(point);
  const detailNoise = perlin.get(d.vec2f(point.x * 2, point.y * 2)) * 0.35;
  const perlinValue = broadNoise * 0.8 + detailNoise;
  const distanceFromFlat = Math.abs(perlinValue);

  if (distanceFromFlat <= flatRadius) {
    return 0;
  }

  const transition = Math.min(
    1,
    Math.max(0, (distanceFromFlat - flatRadius) / flatTransition),
  );
  const smoothTransition = transition * transition * transition
    * (transition * (transition * 6 - 15) + 10);

  return Math.sign(perlinValue)
    * smoothTransition
    * distanceFromFlat
    * terrainHeight;
};

type MapVertex = d.Infer<typeof meshes.Surface>;

export class MapGenerator {
  public width: number;
  public depth: number;
  public subdivisions: number;

  private readonly shape: meshes.Geometry<typeof meshes.Surface>;
  public mesh: meshPool.Mesh | null;
  public heightMap: Map<string, number>;

  constructor(width: number, depth: number, subdivisions: number) {
    this.width = width;
    this.depth = depth;
    this.subdivisions = subdivisions;

    this.heightMap = new Map();
    const vertexData: MapVertex[] = this.generateVertices();
    for (let x = -Math.floor(width / 2); x < Math.ceil(width / 2); x++) {
      for (let z = -Math.floor(depth / 2); z < Math.ceil(depth / 2); z++) {
        const u = (x + width / 2) / width;
        const v = (z + depth / 2) / depth;
        this.heightMap.set(`${x},${z}`, heightAt(u, v));
      }
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

    // this.shape = meshes.parametric(
    //   {
    //     at: (u, v) => {
    //       "use gpu";
    //       return d.vec3f((u - 0.5) * width, heightAt(u, v), (v - 0.5) * depth);
    //     },
    //     normalAt: (u, v) => {
    //       "use gpu";
    //       const step = 0.001;
    //       const left = heightAt(std.max(u - step, 0), v);
    //       const right = heightAt(std.min(u + step, 1), v);
    //       const back = heightAt(u, std.max(v - step, 0));
    //       const front = heightAt(u, std.min(v + step, 1));
    //       const slopeX = (right - left) / (2 * step);
    //       const slopeZ = (front - back) / (2 * step);
        
    //       const normal = std.normalize(d.vec3f(-slopeX, 1, -slopeZ));
    //       return normal;
    //     },
    //   },
    //   { cols: subdivisions, rows: subdivisions },
    // );
    // // this.shape = meshes.plane({ width, depth, widthSegments: subdivisions, depthSegments: subdivisions });

    // this.mesh = null;

    // this.heightMap = new Map();
    // for (let i = 0; i <= subdivisions; i++) {
    //   for (let j = 0; j <= subdivisions; j++) {
    //     const u = i / subdivisions;
    //     const v = j / subdivisions;
    //     const height = 1;
    //     this.heightMap.set(d.vec2f(u, v), height);
    //   }
    // }
  }

  private generateVertices() {
    const vertexData: MapVertex[] = [];
    for (let i = 0; i < this.subdivisions; i++) {
      for (let j = 0; j < this.subdivisions; j++) {
        const u0 = i / this.subdivisions;
        const v0 = j / this.subdivisions;
        const u1 = (i + 1) / this.subdivisions;
        const v1 = (j + 1) / this.subdivisions;

        const p00 = d.vec3f((u0 - 0.5) * this.width, heightAt(u0, v0), (v0 - 0.5) * this.depth);
        const p10 = d.vec3f((u1 - 0.5) * this.width, heightAt(u1, v0), (v0 - 0.5) * this.depth);
        const p01 = d.vec3f((u0 - 0.5) * this.width, heightAt(u0, v1), (v1 - 0.5) * this.depth);
        const p11 = d.vec3f((u1 - 0.5) * this.width, heightAt(u1, v1), (v1 - 0.5) * this.depth);

        const n00 = std.normalize(d.vec3f(0, 1, 0));
        const n10 = std.normalize(d.vec3f(0, 1, 0));
        const n01 = std.normalize(d.vec3f(0, 1, 0));
        const n11 = std.normalize(d.vec3f(0, 1, 0));

        const uv00 = d.vec2f(u0, v0);
        const uv10 = d.vec2f(u1, v0);
        const uv01 = d.vec2f(u0, v1);
        const uv11 = d.vec2f(u1, v1);

        vertexData.push(
          { position: p00, normal: n00, uv: uv00 },
          { position: p10, normal: n10, uv: uv10 },
          { position: p01, normal: n01, uv: uv01 },
          { position: p10, normal: n10, uv: uv10 },
          { position: p11, normal: n11, uv: uv11 },
          { position: p01, normal: n01, uv: uv01 },
        );
      }
    }
    return vertexData;
}

  public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
    this.mesh = pool.add(this.shape, encoder);
    return this.mesh;
  }

  public at = (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position;
    return Vertex({
        position: camera.$.viewProjection * d.vec4f(position, 1),
        world: position,
        normal: vertex.normal,
    });
 };

  public surfaceOf = (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    const point = shading.point(vertex.world, vertex.normal);

    const topColor = d.vec3f(0.1, 0.5, 0.2);
    const bottomColor = d.vec3f(0.0, 0.3, 0.1);
    const blendFactor = std.clamp((point.position.y + 1) / 2, 0, 1);
    const blendedColor = topColor * blendFactor + bottomColor * (1 - blendFactor);

    const perlinFactor = perlin2d.sample(d.vec2f(point.position.x, point.position.z) * 0.5) * 0.5 + 0.5;
    const finalBlendFactor = std.clamp(blendFactor * 0.7 + perlinFactor * 0.3, 0, 1);
    const finalColor = topColor * finalBlendFactor + bottomColor * (1 - finalBlendFactor);

    const material = materials.matte(finalColor);
    return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });

    // const c = std.abs(point.position.y) === 0 ? 1 : 0;
    // return Fragment({ color: d.vec4f(c,c,c, 1) });
 };
}
