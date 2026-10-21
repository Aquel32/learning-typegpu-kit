import { camera, materials, meshPool, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { perlin2d } from "@typegpu/noise";
import { d, std, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import { Fragment, Vertex } from "./static";

// const heightAt = (u: number, v: number) => {
//   "use gpu";
//   const point = d.vec2f(u * 5, v * 5);
//   return (
//     (perlin2d.sample(point.xy) * 0.22 +
//       perlin2d.sample(point.yx) * 0.12 +
//       perlin2d.sample(point.xy * 3.2) * 0.04) *
//     1
//   );
// };



export class MapGenerator {
  private width: number;
  private depth: number;
  private subdivisions: number;

  public shape;
  public mesh: meshPool.Mesh | null;

  constructor(width: number, depth: number, subdivisions: number) {
    this.width = width;
    this.depth = depth;
    this.subdivisions = subdivisions;

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
    this.shape = meshes.plane({ width, depth, widthSegments: subdivisions, depthSegments: subdivisions });
    this.mesh = null;
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
    const material = materials.matte(d.vec3f(0.2, 0.6, 0.3));
    return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });
 };
}
