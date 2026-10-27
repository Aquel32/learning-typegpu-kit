import { d, type TgpuCommandEncoder, type TgpuRoot } from "typegpu";
import type { CarManager } from "./carManager";
import { camera, lighting, materials, meshPool, passes, pipelines, shading } from "@typegpu/kit";
import type { Car } from "./car";
import { Fragment, Vertex } from "./static";
import { meshes } from "@typegpu/kit/geometry";

const MAX_SKID_MARKS = 4000;
const WHEEL_WIDTH = 0.01;

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

        this.shape = meshes.plane({width: 2, depth: 2, widthSegments: 1, depthSegments: 1});
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

        const currentPosition = car.position;

        const wheelOffsets = [
            d.vec2f(-car.dimensions.x / 2, -car.dimensions.z / 2),
            d.vec2f(car.dimensions.x / 2, -car.dimensions.z / 2),
            d.vec2f(-car.dimensions.x / 2, car.dimensions.z / 2),
            d.vec2f(car.dimensions.x / 2, car.dimensions.z / 2),
        ];

        for (const offset of wheelOffsets) {
            const currentWheelPosition = this.getWheelPosition(currentPosition, car.yaw, offset);
            const previousWheelPosition = this.getWheelPosition(previousState.position, previousState.yaw, offset);

            this.addSkidMark(d.vec4f(
                currentWheelPosition.x,
                currentWheelPosition.y,
                previousWheelPosition.x,
                previousWheelPosition.y,
            ));
        }
        this.skidMarksUniform.write(this.skidMarks);
    }

    private getWheelPosition(position: d.v3f, yaw: number, offset: d.v2f) {
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);

        return d.vec2f(
            position.x + offset.x * cos + offset.y * sin,
            position.z - offset.x * sin + offset.y * cos,
        );
    }

    private addSkidMark(data: d.v4f)
    {
      const skidMarkIndex = this.nextSkidMark;
      this.skidMarks[skidMarkIndex] = data;
      this.nextSkidMark = (this.nextSkidMark + 1) % MAX_SKID_MARKS;
      this.activeSkidMarks = Math.min(
          this.activeSkidMarks + 1,
          MAX_SKID_MARKS,
      );
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
        side * vertex.position.x * WHEEL_WIDTH +
        forward * vertex.position.z * length +
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
      const material = materials.matte(d.vec3f(0.03, 0.03, 0.03));
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
        // blend: pipelines.blend.over, // DELETED OPACITY BECAUSE OF Z CLIPPING
        draw: (pipeline) => {
          if(this.activeSkidMarks === 0) {
            return;
          }
          
          pipeline
            .withIndexBuffer(this.pool.indices)
            .drawIndexed(this.mesh!.indexCount, this.activeSkidMarks, this.mesh!.firstIndex, this.mesh!.baseVertex);
        }
      });
    }
}