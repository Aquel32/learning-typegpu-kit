import { camera, lighting, materials, meshPool, passes, shading, targets } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { common, d, std, tgpu, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import { Fragment, MAP_HEIGHT, MAP_SUBDIVISIONS, MAP_WIDTH, Vertex } from "./static";
import { perlin } from "./perlin";
import { perlin2d } from "@typegpu/noise";

const flatRadius = 0.1;
const flatTransition = 0.16;
const terrainScale = 3.5;
const terrainHeight = 2.5;

const heightAt = (u: number, v: number) => {
    "use gpu";

  const point = d.vec2f(u * terrainScale, v * terrainScale);
  const perlin = perlin2d.sample(point) * terrainHeight;
  return perlin;

//     const broadNoise = perlin2d.sample(point);
//     const detailNoise = perlin2d.sample(d.vec2f(point.x * 2, point.y * 2)) * 0.35;
//     const perlinValue = broadNoise * 0.8 + detailNoise;
//     const distanceFromFlat = Math.abs(perlinValue);

//   if (distanceFromFlat <= flatRadius) {
//     return 0;
//   }

//   const transition = Math.min(
//     1,
//     Math.max(0, (distanceFromFlat - flatRadius) / flatTransition),
//   );
//   const smoothTransition = transition * transition * transition
//     * (transition * (transition * 6 - 15) + 10);

//   return Math.sign(perlinValue)
//     * smoothTransition
//     * distanceFromFlat
//     * terrainHeight;
};

type MapVertex = d.Infer<typeof meshes.Surface>;

export class MapGenerator {
  private readonly shape: meshes.Geometry<typeof meshes.Surface>;
  public mesh: meshPool.Mesh | null;
  private heightMap: Map<string, number>;
  private pool: meshPool.MeshPool<{}>;

  constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>) {
    this.pool = pool;

    this.heightMap = new Map();

    const size = { width: MAP_WIDTH * MAP_SUBDIVISIONS, height: MAP_WIDTH * MAP_SUBDIVISIONS };
    const target = targets.create(root, size, {
        perlin: { format: 'r8unorm', layers: 1, sampled: true },
    });
    const view = target.textures.perlin.createView();
    const sampler = root.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
    });

    const pipeline = root.createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: ({ uv }) => {
            "use gpu";

            return d.vec4f(heightAt(uv.x, uv.y), 0, 0, 1);
        },
        targets: {format: 'r8unorm'}
    });
    pipeline.withColorAttachment({view:target.textures.perlin}).draw(3)

    this.mesh = null;
    
    function sampleHeight(u: number, v: number): number {
        "use gpu";
        return std.textureSampleLevel(view.$, sampler.$, d.vec2f(u, v), 0).x;
    }

    this.shape = meshes.parametric(
      {
        at: (u, v) => {
          "use gpu";
          const height = sampleHeight(u, v);
        //   const data = new Uint8Array(4);
        //   target.textures.perlin.write(data, {origin: [1,1], size: [1,1]});
          return d.vec3f((u - 0.5) * MAP_WIDTH, height, (v - 0.5) * MAP_HEIGHT);
        },
        normalAt: (u, v) => {
          "use gpu";
          const step = 0.001;
          const left = sampleHeight(std.max(u - step, 0), v);
          const right = sampleHeight(std.min(u + step, 1), v);
          const back = sampleHeight(u, std.max(v - step, 0));
          const front = sampleHeight(u, std.min(v + step, 1));
          const slopeX = (right - left) / (2 * step);
          const slopeZ = (front - back) / (2 * step);
        
          const normal = std.normalize(d.vec3f(-slopeX, 1, -slopeZ));
          return normal;
        },
      },
      { cols: MAP_WIDTH * MAP_SUBDIVISIONS, rows: MAP_HEIGHT * MAP_SUBDIVISIONS },
    );

    this.loadHeightMap(root, sampleHeight);
  }

  private async loadHeightMap(root: TgpuRoot, sampleHeight: (u: number, v: number) => number) {
    const heightMapStorage = root.createBuffer(d.arrayOf(d.f32, MAP_WIDTH * MAP_HEIGHT * MAP_SUBDIVISIONS * MAP_SUBDIVISIONS)).$usage("storage", "uniform");

    const fooLayout = tgpu.bindGroupLayout({
        storage: { storage: d.arrayOf(d.f32), access: "mutable" },
    });
    const fooBindGroup = root.createBindGroup(fooLayout, {
        storage: heightMapStorage,
    });

    const computePipeline = root.createGuardedComputePipeline((x, y)=>{
        "use gpu";
        const u = x / (MAP_WIDTH * MAP_SUBDIVISIONS - 1);
        const v = y / (MAP_HEIGHT * MAP_SUBDIVISIONS - 1);
        const height = sampleHeight(u, v);
        const index = y * (MAP_WIDTH * MAP_SUBDIVISIONS) + x;
        fooLayout.$.storage[index] = height;
    })
    computePipeline.with(fooBindGroup).dispatchThreads(MAP_WIDTH * MAP_SUBDIVISIONS, MAP_HEIGHT * MAP_SUBDIVISIONS);

    const heightMapData = await heightMapStorage.read();

    for(let i = 0; i < heightMapData.length; i++) {
        const x = i % (MAP_WIDTH * MAP_SUBDIVISIONS);
        const z = Math.floor(i / (MAP_WIDTH * MAP_SUBDIVISIONS));
        const height = heightMapData[i];
        this.heightMap.set(this.getKey(d.vec2f(x, z)), height);
    }
  }

  public getHeightAtWorldPosition(position: d.v3f): number {
    const x = position.x + MAP_WIDTH / 2;
    const z = position.z + MAP_HEIGHT / 2;
    const u = x / MAP_WIDTH;
    const v = z / MAP_HEIGHT;
    return this.getHeightAtUV(u, v);
  }

  private getHeightAtUV(u: number, v: number): number {
    const x = Math.floor(u * (MAP_WIDTH * MAP_SUBDIVISIONS));
    const z = Math.floor(v * (MAP_HEIGHT * MAP_SUBDIVISIONS));
    return this.heightMap.get(this.getKey(d.vec2f(x, z))) ?? 0;
  }

  private getKey(position: d.v2f): string {
    return `${position.x},${position.y}`;
  }

  public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
    this.mesh = pool.add(this.shape, encoder);
    return this.mesh;
  }

  public draw(scene: passes.Description<{
    readonly hdr: typeof passes.color;
    readonly depth: typeof passes.depth;
    }>,
    light: lighting.Lighting)
  {
    
    return scene.add({
      Vertex: Vertex,
      inject: light.inject,
      at: this.at,
      surfaceOf: this.surfaceOf,
      color: passes.shaded,
      draw: (pipeline) =>
        pipeline
          .withIndexBuffer(this.pool.indices)
          .drawIndexed(
            this.mesh!.indexCount,
            1,
            this.mesh!.firstIndex,
            this.mesh!.baseVertex,
          ),
    });
  }

  public cast(shadow: lighting.Shadow, pool: meshPool.MeshPool<{}>) {
  {
    return shadow.add({
      Vertex: Vertex,
      inject: () => pool.inject(),
      at: this.at,
      draw: (pipeline) =>
        pipeline
          .withIndexBuffer(pool.indices)
          .drawIndexed(
            this.mesh!.indexCount,
            1,
            this.mesh!.firstIndex,
            this.mesh!.baseVertex,
          ),
        });
    }
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
