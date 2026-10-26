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
import { CANVAS_HEIGHT, CANVAS_WIDTH, Fragment, MAP_HEIGHT, MAP_WIDTH, Vertex } from "./static";
import { RoadGenerator } from "./road";
import { Player } from "./player";
import { CarManager } from "./carManager";
import { Skybox } from "./skybox";
import { TreeGenerator } from "./trees";
import { TownsGenerator } from "./towns";
import { CollisionSystem } from "./collision";

const root = await tgpu.init();

const canvas = document.querySelector("canvas")!;
const surface = web.surface(root, canvas, {
  size: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
});

const screen = targets.create(root, surface, {
  hdr: { format: "rgba16float", sampled: true },
  depth: { format: "depth24plus", sampled: true },
});

const sunDirection = d.vec3f(0.4, 1, 0.3);
const light = lighting.create(root, {
  settings: { sunDirection: sunDirection, sunIntensity: 2 },
  points: { capacity: 1 },
  shadow: { size: 2048 * 3, extent: 30 },
});
const skybox = new Skybox(root, sunDirection);


const pool = meshPool.create(root, { capacity: 64 });

const mapGenerator = new MapGenerator(root, pool);
const collisionSystem = new CollisionSystem(root, mapGenerator);

// const roadGenerator = new RoadGenerator(root, pool, mapGenerator, 8, d.vec3f(0,0.01,0));
const carManager = new CarManager(root, pool);
// const treeGenerator = new TreeGenerator(root, pool, mapGenerator, collisionSystem, 5000);
// const townsGenerator = new TownsGenerator(root, pool, mapGenerator, 3, 5, 0);
// const player = new Player(root, collisionSystem, carManager, surface, canvas, roadGenerator.getStartPosition(), roadGenerator.getStartDirection(), d.vec3f(0, 0, 0), 5, d.vec3f(0.1, 0.1, 0.2));
const player = new Player(root, collisionSystem, carManager, surface, canvas, d.vec3f(0,0,0), d.vec3f(0,0,0), d.vec3f(0, 0, 0), 5, d.vec3f(0.1, 0.1, 0.2));

// const view = cameras.orbit(root, {
//   size: surface,
//   target: [0, 1, 10],
//   distance: 40,
// });
// web.orbitControls(view, canvas);

const encoder = root["~unstable"].createCommandEncoder();
skybox.addToPool(pool, encoder);
mapGenerator.addToPool(pool, encoder);
// roadGenerator.addToPool(pool, encoder);
// await treeGenerator.addToPool(pool);
// townsGenerator.addToPool(pool, encoder);
encoder.submit();

const scene = passes
  .create(root, screen, { hdr: passes.color, depth: passes.depth })
  .pipe(player.view.inject())
  .pipe(light.inject())
  .pipe(pool.inject());

const final = post.create(root, {
  format: surface.format,
  source: () => screen.textures.hdr,
});

const skyboxDrawn = skybox.draw(scene, pool);

const mapDrawn = mapGenerator.draw(scene, light);
const mapCast = mapGenerator.cast(light.shadow, pool);

// const roadDrawn = roadGenerator.draw(scene, light);
// const roadCast = roadGenerator.cast(light.shadow);

const carsDrawn = carManager.draw(scene, light);
const carsCast = carManager.cast(light.shadow, light);


// const treesDrawn = treeGenerator.draw(scene, light);
// const treesCast = treeGenerator.cast(light.shadow, light);

// const townsDrawn = townsGenerator.draw(scene, light);
// const townsCast = townsGenerator.cast(light.shadow, light);

await Promise.all([scene.initAsync(), light.shadow.initAsync(), final.initAsync()]);

const loop = frames.create(root, (frame) => {
  player.update(frame.dt);
  carManager.update(frame.dt);

  // light.shadow.record(frame.encoder, [mapCast, roadCast, carsCast, treesCast, townsCast]);
  // scene.record(frame, [skyboxDrawn, mapDrawn, roadDrawn, carsDrawn, treesDrawn, townsDrawn]);

  light.shadow.record(frame.encoder, [mapCast, carsCast]);
  scene.record(frame, [skyboxDrawn, mapDrawn, carsDrawn]);

  const output = frame.encoder.beginRenderPass({
    colorAttachments: { view: surface.view(frame) },
  });
  final.draw(output);
  output.end();
});

web.animate(loop);
