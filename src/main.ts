import { tgpu, common, d, std } from "typegpu";
import {
  camera,
  cameras,
  frames,
  lighting,
  materials,
  meshPool,
  passes,
  post,
  shading,
  targets,
} from "@typegpu/kit";
import * as web from "@typegpu/kit/web";
import { meshes } from "@typegpu/kit/geometry";
import { MapGenerator } from "./map";
import { Fragment, Vertex } from "./static";
import { RoadGenerator } from "./road";

const root = await tgpu.init();

const WIDTH = 800;
const HEIGHT = 600;

const canvas = document.querySelector("canvas")!;
const surface = web.surface(root, canvas, {
  size: { width: WIDTH, height: HEIGHT },
});

const view = cameras.orbit(root, {
  size: surface,
  target: [0, 1, 0],
  distance: 12,
});
web.orbitControls(view, canvas);

const MAP_WIDTH = 30;
const MAP_HEIGHT = 30;
const NODE_COUNT = 8;

const mapGenerator = new MapGenerator(MAP_WIDTH, MAP_HEIGHT, 1);
const roadGenerator = new RoadGenerator(root, MAP_WIDTH, MAP_HEIGHT, NODE_COUNT, d.vec3f(-MAP_WIDTH / 2, 0.01, -MAP_HEIGHT / 2));

const pool = meshPool.create(root, { capacity: 4 });
const encoder = root["~unstable"].createCommandEncoder();
mapGenerator.addToPool(pool, encoder);
roadGenerator.addToPool(pool, encoder);
const boxGeometry = meshes.roundedBox();
const box = pool.add(boxGeometry, encoder);
const ballGeometry = meshes.sphere();
const ball = pool.add(ballGeometry, encoder);
encoder.submit();

const light = lighting.create(root, {
  settings: { sunDirection: [0.4, 1, 0.3], sunIntensity: 2 },
  points: { capacity: 1 },
  shadow: { size: 2048, extent: 9 },
});

const screen = targets.create(root, surface, {
  hdr: { format: "rgba16float", sampled: true },
  depth: { format: "depth24plus", sampled: true },
});
const scene = passes
  .create(root, screen, { hdr: passes.color, depth: passes.depth })
  .pipe(view.inject())
  .pipe(light.inject())
  .pipe(pool.inject());

const final = post.create(root, {
  format: surface.format,
  source: () => screen.textures.hdr,
});

const timeUniform = root.createUniform(d.f32, 0);

const boxDrawn = scene.add({
  Vertex: Vertex,
  at: (vertexIndex, instanceIndex) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position + d.vec3f(timeUniform.$, 6, 0);
    return Vertex({
      position: view.uniform.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  surfaceOf: (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    const point = shading.point(vertex.world, vertex.normal);
    const material = materials.matte(d.vec3f(0.8, 0.2, 0.2));
    return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });
  },
  color: passes.shaded,
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(box.indexCount, 1, box.firstIndex, box.baseVertex),
});

const boxCast = light.shadow.add({
  Vertex: Vertex,
  inject: () => pool.inject(),
  at: (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position + d.vec3f(timeUniform.$, 6, 0);
    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(box.indexCount, 1, box.firstIndex, box.baseVertex),
});

const ballDrawn = scene.add({
  Vertex: Vertex,
  at: (vertexIndex, instanceIndex) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position + d.vec3f(timeUniform.$, 3, 0) - 2;
    return Vertex({
      position: view.uniform.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  surfaceOf: (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    const point = shading.point(vertex.world, vertex.normal);
    const material = materials.matte(d.vec3f(0.8, 0.2, 0.7));
    return Fragment({ color: d.vec4f(shading.shade(material, point), 1) });
  },
  color: passes.shaded,
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(ball.indexCount, 1, ball.firstIndex, ball.baseVertex),
});
const ballCast = light.shadow.add({
  Vertex: Vertex,
  inject: () => pool.inject(),
  at: (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position + d.vec3f(timeUniform.$, 3, 0) - 2;
    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(ball.indexCount, 1, ball.firstIndex, ball.baseVertex),
});

const mapDrawn = scene.add({
  Vertex: Vertex,
  at: mapGenerator.at,
  surfaceOf: mapGenerator.surfaceOf,
  color: passes.shaded,
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(
        mapGenerator.mesh!.indexCount,
        1,
        mapGenerator.mesh!.firstIndex,
        mapGenerator.mesh!.baseVertex,
      ),
});

const mapCast = light.shadow.add({
  Vertex: Vertex,
  inject: () => pool.inject(),
  at: (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position;
    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(
        mapGenerator.mesh!.indexCount,
        1,
        mapGenerator.mesh!.firstIndex,
        mapGenerator.mesh!.baseVertex,
      ),
});

const roadDrawn = scene.add({
  Vertex: Vertex,
  at: roadGenerator.at,
  surfaceOf: roadGenerator.surfaceOf,
  color: passes.shaded,
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(
        roadGenerator.mesh!.indexCount,
        1,
        roadGenerator.mesh!.firstIndex,
        roadGenerator.mesh!.baseVertex,
      ),
});

const roadCast = light.shadow.add({
  Vertex: Vertex,
  inject: () => pool.inject(),
  at: (vertexIndex: number, _instanceIndex: number) => {
    "use gpu";
    const vertex = meshPool.vertexAt(vertexIndex);
    const position = vertex.position;
    return Vertex({
      position: camera.$.viewProjection * d.vec4f(position, 1),
      world: position,
      normal: vertex.normal,
    });
  },
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(
        roadGenerator.mesh!.indexCount,
        1,
        roadGenerator.mesh!.firstIndex,
        roadGenerator.mesh!.baseVertex,
      ),
});

await Promise.all([scene.initAsync(), light.shadow.initAsync(), final.initAsync()]);

const loop = frames.create(root, (frame) => {
  timeUniform.write(std.sin(frame.time));
  view.update(frame.dt);

  light.shadow.record(frame.encoder, [boxCast, ballCast, mapCast, roadCast]);
  scene.record(frame, [boxDrawn, ballDrawn, mapDrawn, roadDrawn]);

  const output = frame.encoder.beginRenderPass({
    colorAttachments: { view: surface.view(frame) },
  });
  final.draw(output);
  output.end();
});

web.animate(loop);
