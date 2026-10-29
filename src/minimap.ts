import { common, d, std, type TgpuRoot } from "typegpu";
import { bottomColor, topColor, type MapGenerator } from "./map";
import { bezierPoint, type RoadGenerator } from "./road";
import type { TownsGenerator } from "./towns";
import { frames, post, targets } from "@typegpu/kit";
import { MAP_HEIGHT, MAP_WIDTH, RoadEdge, roadWidth } from "./static";
import * as web from "@typegpu/kit/web";
import type { Player } from "./player";

const MINIMAP_SIZE = 200;
const MINIMAP_WORLD_SIZE = 32;

const edgeUniformType = d.struct({
    id: d.u32,
    start: d.vec2f,
    controlPoint1: d.vec2f,
    controlPoint2: d.vec2f,
    end: d.vec2f,
    onPath: d.u32,
});

export class Minimap {
  private root: TgpuRoot;
  private mapGenerator: MapGenerator;
  private roadGenerator: RoadGenerator;
  private townsGenerator: TownsGenerator;
  private player: Player;

  private target;
  private canvas: HTMLCanvasElement;
  private surface;
  private final;
  private readonly playerUniform;
  private readonly edgesUniform;
  private readonly edgeData: d.Infer<typeof edgeUniformType>[];
  private readonly minimapPipeline;

  
  constructor(
    root: TgpuRoot,
    mapGenerator: MapGenerator,
    roadGenerator: RoadGenerator,
    townsGenerator: TownsGenerator,
    player: Player,
  ) {
    this.mapGenerator = mapGenerator;
    this.root = root;
    this.roadGenerator = roadGenerator;
    this.townsGenerator = townsGenerator;
    this.player = player;

    const canvas = document.querySelector<HTMLCanvasElement>("canvas#minimap");
    if (!canvas) {
      throw new Error("Minimap canvas was not found");
    }
    this.canvas = canvas;
    this.surface = web.surface(root, this.canvas, {
      size: { width: MINIMAP_SIZE, height: MINIMAP_SIZE },
    });

    this.target = targets.create(root, this.canvas, {
      baseTexture: { format: "rgba16float", sampled: true },
      //   final: { format: "rgba16float", sampled: true },
    });

    this.final = post.create(root, {
      format: this.surface.format,
      source: () => this.target.textures.baseTexture,
    });

    // create map texture in compute shader
    // for each roadGenerator edge write a bezier curve to the texture
    // for each building write a rectangle to the texture
    const sampler = root.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    this.edgeData = this.roadGenerator.network.map((edge, i) => {
      const start = d.vec2f(edge.start.position.x, edge.start.position.z);
      const end = d.vec2f(edge.end.position.x, edge.end.position.z);
      return {
        id: i,
        start,
        end,
        controlPoint1: edge.controlPoint1,
        controlPoint2: edge.controlPoint2,
        onPath: 0,
      };
    });
    this.edgesUniform = root.createUniform(
      d.arrayOf(edgeUniformType, this.roadGenerator.network.length),
    );
    this.edgesUniform.write(this.edgeData);

    const bulidingUniform = root.createUniform(
      d.arrayOf(d.vec4f, this.townsGenerator.buildings.length),
    ); //xy position, zw size
    const buildingData: d.v4f[] = this.townsGenerator.buildings.map((building) => {
      return d.vec4f(
        building.position.x,
        building.position.z,
        building.dimensions.x,
        building.dimensions.z,
      );
    });
    bulidingUniform.write(buildingData);

    this.playerUniform = root.createUniform(
      d.struct({
        position: d.vec2f,
        yaw: d.f32,
      }),
      {
        position: d.vec2f(this.player.car.position.x, this.player.car.position.z),
        yaw: this.player.car.yaw,
      },
    );

    this.minimapPipeline = root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: ({ uv }) => {
        "use gpu";
        const local = (uv - d.vec2f(0.5, 0.5)) * -MINIMAP_WORLD_SIZE;
        const sinYaw = std.sin(this.playerUniform.$.yaw);
        const cosYaw = std.cos(this.playerUniform.$.yaw);

        const worldPosition = d.vec2f(
          this.playerUniform.$.position.x + local.x * cosYaw + local.y * sinYaw,
          this.playerUniform.$.position.y - local.x * sinYaw + local.y * cosYaw,
        );
        const mapUv = d.vec2f(
          (worldPosition.x + MAP_WIDTH / 2) / MAP_WIDTH,
          (worldPosition.y + MAP_HEIGHT / 2) / MAP_HEIGHT,
        );


        const height = std.textureSampleLevel(this.mapGenerator.view.$, sampler.$, mapUv, 0).x;
        const blendFactor = std.clamp((height + 1) / 2, 0, 1);
        let color = topColor * blendFactor + bottomColor * (1 - blendFactor);

        for (let i = 0; i < this.edgesUniform.$.length; i++) {
          const edge = this.edgesUniform.$[i];
          const p0 = edge.start;
          const p1 = edge.controlPoint1;
          const p2 = edge.controlPoint2;
          const p3 = edge.end;

          for (let t = d.f32(0); t <= d.f32(1); t += d.f32(0.01)) {
            const pointOnCurve = bezierPoint(p0, p1, p2, p3, t);
            const puv = d.vec2f(
              (pointOnCurve.x + MAP_WIDTH / 2) / MAP_WIDTH,
              (pointOnCurve.y + MAP_HEIGHT / 2) / MAP_HEIGHT,
            );
            const distance = std.distance(mapUv, puv);

            if (distance < roadWidth / MAP_WIDTH) {
              color = edge.onPath === 1 ? d.vec3f(1, 1, 0) : d.vec3f(0.2, 0.2, 0.2);
              break;
            }
          }
        }

        for (let i = 0; i < bulidingUniform.$.length; i++) {
          const building = bulidingUniform.$[i];
          const buildingPos = d.vec2f(building.x, building.y);
          const buildingSize = d.vec2f(building.z, building.w);

          const min = buildingPos;
          const max = buildingPos + buildingSize;

          if (
            worldPosition.x >= min.x &&
            worldPosition.x <= max.x &&
            worldPosition.y >= min.y &&
            worldPosition.y <= max.y
          ) {
            color = d.vec3f(0.5, 0.5, 0.5);
            break;
          }
        }

        if (std.distance(local, d.vec2f(0, 0)) < 0.8) {
          color = d.vec3f(1, 0.1, 0.1);
        }

        return d.vec4f(color, 1);
      },
      targets: { format: "rgba16float" },
    });
  }

  public render(frame: frames.Frame) {
    this.playerUniform.write({
      position: d.vec2f(this.player.car.position.x, this.player.car.position.z),
      yaw: this.player.car.yaw,
    });
    this.minimapPipeline.withColorAttachment({ view: this.target.textures.baseTexture }).draw(3);

    const output = frame.encoder.beginRenderPass({
      colorAttachments: { view: this.surface.view(frame) },
    });
    this.final.draw(output);
    output.end();
  }

//   public setSelectedPath(edges: d.Infer<typeof RoadEdge>[]) {
//     for(const edge of this.edgeData)
//     {
//         edge.onPath = edges.includes(this.roadGenerator.network[edge.id]) ? 1 : 0;
//     }
//   }
}
