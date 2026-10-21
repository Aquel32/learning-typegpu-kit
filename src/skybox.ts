import { camera, materials, meshPool, passes, shading } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { d, std, type TgpuCommandEncoder, type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import { Fragment, Vertex } from "./static";
import { perlin3d } from "@typegpu/noise";

export class Skybox {
    private mesh: meshPool.Mesh | null;
    private shape;
    private sunDirection: d.v3f;
    private sunDirectionUniform;

    constructor(root: TgpuRoot, sunDirection: d.v3f) {
        this.shape = meshes.box({ width: 100, height: 100, depth: 100 });
        this.mesh = null;
        this.sunDirection = sunDirection;
        this.sunDirectionUniform  = root.createUniform(d.vec3f, sunDirection);
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
        const cameraDirection = std.normalize(vertex.world - camera.$.position);
        const baseColor = d.vec3f(102, 189, 255) / 255;

        const perlinScale = 5;
        const cloud = perlin3d.sample(cameraDirection * perlinScale) * 0.5 + 0.1;

        const sunDirection = std.normalize(this.sunDirectionUniform.$);

        let color = d.vec3f(baseColor);

        const sunDot = std.dot(cameraDirection, sunDirection);
            const sunColor = d.vec3f(1, 0.9, 0.7);

        if(sunDot > 0.95) {
            color = d.vec3f(sunColor);
        }

        color += d.vec3f(1, 1, 1) * std.max(0, cloud);
        return Fragment({ color: d.vec4f(color, 1) });
     };

    public draw(scene: passes.Description<{
        readonly hdr: typeof passes.color;
        readonly depth: typeof passes.depth;
        }>
        , pool: meshPool.MeshPool<{}>)
        {
            const drawn = scene.add({
              Vertex: Vertex,
              at: this.at,
              surfaceOf: this.surfaceOf,
              color: passes.shaded,
              draw: (pipeline: TgpuRenderPipeline<never>) =>
                pipeline
                  .withIndexBuffer(pool.indices)
                  .drawIndexed(
                    this.mesh!.indexCount,
                    1,
                    this.mesh!.firstIndex,
                    this.mesh!.baseVertex,
                  ),
            });
    
            return drawn;
        }
}