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
import { Player } from "./player";
import { CarManager } from "./carManager";
import { Skybox } from "./skybox";
import { TreeGenerator } from "./trees";
import { TownsGenerator } from "./towns";

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
  distance: 3,
});
web.orbitControls(view, canvas);

const MAP_WIDTH = 64;
const MAP_HEIGHT = 64;
const NODE_COUNT = 8;

const mapGenerator = new MapGenerator(MAP_WIDTH, MAP_HEIGHT, 70);
const roadGenerator = new RoadGenerator(root, mapGenerator, MAP_WIDTH, MAP_HEIGHT, NODE_COUNT, d.vec3f(0,0.01,0));

const pool = meshPool.create(root, { capacity: 64 });
const encoder = root["~unstable"].createCommandEncoder();

const sunDirection = d.vec3f(0.4, 1, 0.3);
const light = lighting.create(root, {
  settings: { sunDirection: sunDirection, sunIntensity: 2 },
  points: { capacity: 1 },
  shadow: { size: 2048 * 3, extent: 30 },
});

const screen = targets.create(root, surface, {
  hdr: { format: "rgba16float", sampled: true },
  depth: { format: "depth24plus", sampled: true },
});

const carManager = new CarManager(pool, encoder);
const player = new Player(root, carManager, roadGenerator.getStartPosition(), roadGenerator.getStartDirection(), d.vec3f(0, 0, 0), 5, d.vec3f(0.1, 0.1, 0.2));

const treeGenerator = new TreeGenerator(root, pool, mapGenerator, MAP_WIDTH, MAP_HEIGHT, 10000);
treeGenerator.addToPool(pool, encoder);

const townsGenerator = new TownsGenerator(root, pool, mapGenerator, MAP_WIDTH, MAP_HEIGHT, 3, 5, 0);
townsGenerator.addToPool(pool, encoder);

mapGenerator.addToPool(pool, encoder);
roadGenerator.addToPool(pool, encoder);
const boxGeometry = meshes.roundedBox();
const box = pool.add(boxGeometry, encoder);
const ballGeometry = meshes.sphere();
const ball = pool.add(ballGeometry, encoder);
const skybox = new Skybox(root, sunDirection);
skybox.addToPool(pool, encoder);
encoder.submit();

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
  at: mapGenerator.at,
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
  at: roadGenerator.at,
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

const castedCars = carManager.cast(light.shadow);
const drawnedCars = carManager.draw(scene);

const skyboxDrawn = skybox.draw(scene, pool);

const treesDrawn = treeGenerator.draw(scene, light);
const treesCast = treeGenerator.cast(light.shadow, light);

const townsDrawn = townsGenerator.draw(scene, light);
const townsCast = townsGenerator.cast(light.shadow, light);

await Promise.all([scene.initAsync(), light.shadow.initAsync(), final.initAsync()]);

const loop = frames.create(root, (frame) => {
  timeUniform.write(std.sin(frame.time));
  player.update(frame.dt);
  carManager.update(frame.dt);
  
  const carForward = player.car.getForward();
  view.goal.target = player.car.position;
  view.goal.yaw = std.atan2(-carForward.x, -carForward.z);
  view.goal.fov = player.drifts ? Math.PI / 2 : Math.PI / 3;
  view.update(frame.dt);

  light.shadow.record(frame.encoder, [boxCast, ballCast, mapCast, roadCast, ...castedCars, treesCast, townsCast]);
  scene.record(frame, [skyboxDrawn, boxDrawn, ballDrawn, mapDrawn, roadDrawn, ...drawnedCars, treesDrawn, townsDrawn]);

  const output = frame.encoder.beginRenderPass({
    colorAttachments: { view: surface.view(frame) },
  });
  final.draw(output);
  output.end();
});

web.animate(loop);
