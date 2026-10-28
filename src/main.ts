import { tgpu, common, d, std } from "typegpu";
import {
  camera,
  cameras,
  clock,
  frames,
  lighting,
  materials,
  meshPool,
  Particle,
  particles,
  passes,
  post,
  shading,
  targets,
  trails,
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
import { SkidMarkSystem } from "./skidMarks";
import { ParticleSystem } from "./particleSystem";
import { NPCController } from "./npc";
import { MissionController } from "./missions";

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
await mapGenerator.loadHeightMap();

const roadGenerator = new RoadGenerator(root, pool, mapGenerator, 6, d.vec3f(0,0.01,0));
const collisionSystem = new CollisionSystem(root, mapGenerator, roadGenerator);
const carManager = new CarManager(root, pool);
const treeGenerator = new TreeGenerator(root, pool, mapGenerator, collisionSystem, 5000);
const townsGenerator = new TownsGenerator(root, pool, mapGenerator, roadGenerator, collisionSystem, 5, 3, 5);
const npcController = new NPCController(root, pool);
const player = new Player(root, collisionSystem, carManager, surface, canvas, roadGenerator.getStartPosition(), roadGenerator.getStartDirection(), d.vec3f(0, 0, 0), 5, d.vec3f(0.06, 0.008, 0.132));

const sim = clock.fixedStep({ step: 1 / 60 });
const tireSmoke = particles.create(root, player.view, {
  capacity: 4096,
  sim,
  blend: 'add',
  settings: { gravity: [0, 0, 0], drag: 0.8 },
});

const skidSystem = new SkidMarkSystem(root, carManager, pool);

const encoder = root["~unstable"].createCommandEncoder();
skybox.addToPool(pool, encoder);
mapGenerator.addToPool(pool, encoder);
roadGenerator.addToPool(pool, encoder);
await treeGenerator.addToPool(pool);
townsGenerator.addToPool(pool, encoder);
skidSystem.addToPool(pool, encoder);
await npcController.addToPool(pool);
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

const roadDrawn = roadGenerator.draw(scene, light);
const roadCast = roadGenerator.cast(light.shadow);

const carsDrawn = carManager.draw(scene, light);
const carsCast = carManager.cast(light.shadow, light);

const treesDrawn = treeGenerator.draw(scene, light);
const treesCast = treeGenerator.cast(light.shadow, light);

const townsDrawn = townsGenerator.draw(scene, light);
const townsCast = townsGenerator.cast(light.shadow, light);

const skidDrawn = skidSystem.draw(scene, light);

const tireSmokeDrawn = scene.add(tireSmoke.drawing);

const npcDrawn = npcController.draw(scene, light);
const npcCast = npcController.cast(light.shadow, light);

// const t =npcController.add(roadGenerator.getStartPosition(), d.vec4f(0, 1, 0, 0), "idle");
// npcController.setNPCGoal(t, roadGenerator.getStartPosition().add(d.vec3f(10, 0, 10)));
const missionController = new MissionController(root, player, npcController, townsGenerator);
const mission = missionController.generateNewMission();
player.car.position = mission.start.position.add(d.vec3f(2, 1, 0));

await Promise.all([scene.initAsync(), light.shadow.initAsync(), final.initAsync(), npcController.initAsync()]);

const loop = frames.create(root, (frame) => {
  "use gpu";

  player.update(frame.dt);
  carManager.update(frame.dt);

  skidSystem.update(tireSmoke, frame.dt);
  // npcController.setNPCGoal(t, player.car.position.add(d.vec3f(0, player.car.dimensions.y / 2, 0)));
  missionController.update(frame.dt);
  npcController.update(frame.dt);

  const compute = frame.encoder.beginComputePass();
  npcController.animate(compute, frame.time);
  tireSmoke.spawn(compute);
  for(let steps = sim.advance(frame.dt); steps > 0; steps--) {
    tireSmoke.step(compute);
  }
  tireSmoke.compact(compute);
  compute.end();

  light.shadow.record(frame.encoder, [mapCast, carsCast, treesCast, roadCast, townsCast, npcCast]);
  scene.record(frame, [skyboxDrawn, mapDrawn, carsDrawn, treesDrawn, roadDrawn, townsDrawn, skidDrawn, tireSmokeDrawn, npcDrawn]);

  const output = frame.encoder.beginRenderPass({
    colorAttachments: { view: surface.view(frame) },
  });
  final.draw(output);
  output.end();
});

web.animate(loop);
