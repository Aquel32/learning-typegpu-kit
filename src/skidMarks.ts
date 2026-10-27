import { d, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import type { CarManager } from "./carManager";
import { camera, lighting, materials, meshPool, passes, pipelines, shading } from "@typegpu/kit";
import type { Car } from "./car";
import { Fragment, Vertex } from "./static";
import { meshes } from "@typegpu/kit/geometry";

const MAX_SKID_MARKS = 1000;

export class SkidMarkSystem {
    private carManager: CarManager;
    private pool: meshPool.MeshPool<{}>;
    private offsetUniform;

    private shape;
    private mesh: meshPool.Mesh | null;

    private skidMarks: d.v4f[]; // xy = current position, zw = previous position
    private skidMarksUniform;

    private nextSkidMark: number;
    private activeSkidMarks: number;

    private previousStates: Map<Car, {position: d.v3f, yaw: number}>;

    constructor(root: TgpuRoot, carManager: CarManager, pool: meshPool.MeshPool<{}>) {
        this.carManager = carManager;
        this.pool = pool;
        this.offsetUniform = root.createUniform(d.vec3f, d.vec3f(0, 0.01, 0));

        this.shape = meshes.plane({width: 0.1, depth: 0.02, widthSegments: 1, depthSegments: 1});
        this.mesh = null;

        this.skidMarks = Array.from(
            { length: MAX_SKID_MARKS },
            () => d.vec4f(0, 0, 0, 0),
        );
        this.previousStates = new Map<Car, {position: d.v3f, yaw: number}>();
        this.nextSkidMark = 0;
        this.activeSkidMarks = 0;

        this.skidMarksUniform = root.createUniform(d.arrayOf(d.vec4f, MAX_SKID_MARKS), this.skidMarks);
    }

    public addToPool(pool: meshPool.MeshPool<{}>, encoder: TgpuCommandEncoder) {
        this.mesh = pool.add(this.shape, encoder);
        return this.mesh;
    }

    public update(deltaTime: number) {
        for(const car of this.carManager.cars) {
            if(car.isSkidding)
            {
                this.updateCarSkid(car);
            }

            this.previousStates.set(car, {position: car.position, yaw: car.yaw});
        }
    }

    private updateCarSkid(car: Car)
    {
        const previousState = this.previousStates.get(car);
        if(!previousState) {
            this.previousStates.set(car, {position: car.position, yaw: car.yaw});
            return;
        }

        const skidMarkIndex = this.nextSkidMark;
        const currentPosition = car.position;
        this.skidMarks[skidMarkIndex] = d.vec4f(currentPosition.x, currentPosition.z, previousState.position.x, previousState.position.z);
        this.nextSkidMark = (this.nextSkidMark + 1) % MAX_SKID_MARKS;
        this.activeSkidMarks = Math.min(
            this.activeSkidMarks + 1,
            MAX_SKID_MARKS,
        );
        this.skidMarksUniform.write(this.skidMarks);
    }

  public at = (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const skidMark = this.skidMarksUniform.$[_instanceIndex % MAX_SKID_MARKS];

    const startPosition = d.vec3f(skidMark.x, 0, skidMark.y);
    const endPosition = d.vec3f(skidMark.z, 0, skidMark.w);
    const direction = endPosition - startPosition;
    const length = Math.sqrt(
      direction.x * direction.x + direction.z * direction.z,
    );
    const safeLength = Math.max(length, 0.0001);
    const forward = d.vec3f(
      direction.x / safeLength,
      0,
      direction.z / safeLength,
    );
    const side = d.vec3f(-forward.z, 0, forward.x);
    const center = (startPosition + endPosition) * 0.5;
    const position =
      center +
      side * vertex.position.x +
      forward * (vertex.position.z / 0.02 * length) +
      this.offsetUniform.$ + d.vec3f(0, 0.01, 0);
    

    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  };

  public surfaceOf = (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    const point = shading.point(vertex.world, vertex.normal);
    const material = materials.matte(d.vec3f(0, 0, 0))
    return Fragment({ color: shading.shadeClear(material, point, 0.6) });
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
      blend: pipelines.blend.over,
      draw: (pipeline) =>
        pipeline
          .withIndexBuffer(this.pool.indices)
          .drawIndexed(this.mesh!.indexCount, this.activeSkidMarks, this.mesh!.firstIndex, this.mesh!.baseVertex),
    });
  }
}