import { camera, lighting, materials, meshPool, passes, shading, targets } from "@typegpu/kit";
import { meshes } from "@typegpu/kit/geometry";
import { common, d, std, tgpu, type StorageFlag, type TgpuBuffer, type TgpuCommandEncoder, type TgpuFixedSampler, type TgpuRoot, type TgpuTextureView, type UniformFlag } from "typegpu";
import { Fragment, HEIGHT_MAP_SCALE, MAP_HEIGHT, MAP_SUBDIVISIONS, MAP_WIDTH, Vertex } from "./static";
import { perlin } from "./perlin";
import { perlin2d } from "@typegpu/noise";

const flatRadius = 0.1;
const flatTransition = 0.16;
const terrainScale = 3;
const terrainHeight = 2;

const heightMapWidth = MAP_WIDTH * MAP_SUBDIVISIONS * HEIGHT_MAP_SCALE;
const heightMapHeight = MAP_HEIGHT * MAP_SUBDIVISIONS * HEIGHT_MAP_SCALE;


const heightAt = (u: number, v: number) => {
    "use gpu";

    const point = d.vec2f(u * terrainScale, v * terrainScale);
    const broadNoise = perlin2d.sample(point);
    const detailNoise = perlin2d.sample(d.vec2f(point.x * 2, point.y * 2)) * 0.35;
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
  private readonly shape: meshes.Geometry<typeof meshes.Surface>;
  public mesh: meshPool.Mesh | null;
  private heightMap: Map<string, number>;
  private pool: meshPool.MeshPool<{}>;
  private heightMapStorage: TgpuBuffer<d.WgslArray<d.F32>> & UniformFlag & StorageFlag

  constructor(root: TgpuRoot, pool: meshPool.MeshPool<{}>) {
    this.pool = pool;

    this.heightMap = new Map();

    const size = { width: heightMapWidth, height: heightMapHeight };
    const target = targets.create(root, size, {
        perlin: { format: 'r16float', layers: 1, sampled: true },
    });
    const view = target.textures.perlin.createView();
   const sampler = root.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
    });

    function sampleHeight(u: number, v: number): number {
        "use gpu";
        return std.textureSampleLevel(view.$, sampler.$, d.vec2f(u, v), 0).x;
    }

    const pipeline = root.createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: ({ uv }) => {
            "use gpu";

            return d.vec4f(heightAt(uv.x, uv.y), 0, 0, 1);
        },
        targets: {format: 'r16float'}
    });
    pipeline.withColorAttachment({view:target.textures.perlin}).draw(3)

    this.mesh = null;
    
    this.shape = meshes.parametric(
      {
        at: (u, v) => {
          "use gpu";
          const height = sampleHeight(u, v);
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

    this.heightMapStorage = root.createBuffer(d.arrayOf(d.f32, heightMapWidth * heightMapHeight)).$usage("storage", "uniform");
    const fooLayout = tgpu.bindGroupLayout({
        storage: { storage: d.arrayOf(d.f32), access: "mutable" },
    });
    const fooBindGroup = root.createBindGroup(fooLayout, {
        storage: this.heightMapStorage,
    });

    const computePipeline = root.createGuardedComputePipeline((x, y)=>{
        "use gpu";
        const u = x / (heightMapWidth - 1);
        const v = y / (heightMapHeight - 1);
        const height = sampleHeight(u, v);
        const index = y * (heightMapWidth) + x;
        fooLayout.$.storage[index] = height;
    })
    computePipeline.with(fooBindGroup).dispatchThreads(heightMapWidth, heightMapHeight);
  }

  public async loadHeightMap() {
    const heightMapData = await this.heightMapStorage.read();

    for(let i = 0; i < heightMapData.length; i++) {
        const x = i % heightMapWidth;
        const z = Math.floor(i / heightMapWidth);
        const height = heightMapData[i];
        this.heightMap.set(this.getKey(d.vec2f(x, z)), height);
    }

    this.heightMapStorage.destroy();
  }

  public getHeightAtWorldPosition(position: d.v3f): number {
    const uv = this.worldPositionToUV(position);
    return this.getHeightAtUV(uv.x, uv.y);
  }

  public worldPositionToUV(position: d.v3f): d.v2f {
    const x = position.x + MAP_WIDTH / 2;
    const z = position.z + MAP_HEIGHT / 2;
    const u = x / MAP_WIDTH;
    const v = z / MAP_HEIGHT;
    return d.vec2f(u, v);
  }

  public uvToWorldPosition(uv: d.v2f): d.v3f {
    const x = uv.x * MAP_WIDTH - MAP_WIDTH / 2;
    const z = uv.y * MAP_HEIGHT - MAP_HEIGHT / 2;
    const height = this.getHeightAtUV(uv.x, uv.y);
    return d.vec3f(x, height, z);
  }

  public getHeightAtUV(u: number, v: number): number {
    const x = Math.floor(u * (heightMapWidth - 1));
    const z = Math.floor(v * (heightMapHeight - 1));

    const sampleOffsets = [
        d.vec2f(0, 0),
        d.vec2f(-1, 0),
        d.vec2f(1, 0),
        d.vec2f(0, -1),
        d.vec2f(0, 1),
    ];

    let totalHeight = 0;
    let sampleCount = 0;

    for (const offset of sampleOffsets) {
        const sampleX = x + offset.x;
        const sampleZ = z + offset.y;

        if (sampleX >= 0 && sampleX < heightMapWidth &&
            sampleZ >= 0 && sampleZ < heightMapHeight) {
                const height = this.heightMap.get(this.getKey(d.vec2f(sampleX, sampleZ)));
                totalHeight += height ?? 0;
            sampleCount++;
        }
    }

    return totalHeight / sampleCount;
  }

  public getKey(position: d.v2f): string {
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
 };
}