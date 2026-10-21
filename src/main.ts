import { tgpu, common, d, std } from "typegpu";
import { cameras, frames, meshPool, passes, post, targets } from "@typegpu/kit";
import * as web from "@typegpu/kit/web";
import { meshes } from "@typegpu/kit/geometry";
import { MapGenerator } from "./map";
import { Fragment, Vertex } from "./static";

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

const mapGenerator = new MapGenerator(10, 10, 20);

const pool = meshPool.create(root, { capacity: 3 });
const encoder = root["~unstable"].createCommandEncoder();
mapGenerator.addToPool(pool, encoder);
const box = pool.add(meshes.roundedBox(), encoder);
const ball = pool.add(meshes.sphere(), encoder);
encoder.submit();

const screen = targets.create(root, surface, {
  hdr: { format: "rgba16float", sampled: true },
  depth: { format: "depth24plus", sampled: true },
});
const scene = passes
  .create(root, screen, { hdr: passes.color, depth: passes.depth })
  .pipe(pool.inject())
  .pipe(view.inject());

const final = post.create(root, {
  format: surface.format,
  source: () => screen.textures.hdr,
});

const timeUniform = root.createUniform(d.f32, 0);

const boxDrawn = scene.add({
  Vertex: Vertex,
  at: (vertexIndex, instanceIndex) => {
    "use gpu";
    const corner = meshPool.vertexAt(vertexIndex);
    return Vertex({
      position:
        view.uniform.$.viewProjection *
        d.vec4f(corner.position + d.vec3f(timeUniform.$, 0, 0), 1),
      world: corner.position,
    });
  },
  surfaceOf: (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    return Fragment({ color: d.vec4f(vertex.world * 0.25 + 0.5, 1) });
  },
  color: passes.shaded,
  draw: (pipeline) =>
    pipeline
      .withIndexBuffer(pool.indices)
      .drawIndexed(box.indexCount, 1, box.firstIndex, box.baseVertex),
});

const ballDrawn = scene.add({
  Vertex: Vertex,
  at: (vertexIndex, instanceIndex) => {
    "use gpu";
    const corner = meshPool.vertexAt(vertexIndex);
    return Vertex({
      position:
        view.uniform.$.viewProjection *
        d.vec4f(corner.position + d.vec3f(timeUniform.$, 0, 0) - 2, 1),
      world: corner.position,
    });
  },
  surfaceOf: (vertex: d.Infer<typeof Vertex>) => {
    "use gpu";
    return Fragment({ color: d.vec4f(vertex.world * 0.25 + 0.5, 1) });
  },
  color: passes.shaded,
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
      .drawIndexed(mapGenerator.mesh!.indexCount, 1, mapGenerator.mesh!.firstIndex, mapGenerator.mesh!.baseVertex),
});

await Promise.all([scene.initAsync(), final.initAsync()]);

const loop = frames.create(root, (frame) => {
  timeUniform.write(std.sin(frame.time));

  view.update(frame.dt);
  scene.record(frame, [boxDrawn, ballDrawn, mapDrawn]);

  const output = frame.encoder.beginRenderPass({
    colorAttachments: { view: surface.view(frame) },
  });
  final.draw(output);
  output.end();
});

web.animate(loop);
