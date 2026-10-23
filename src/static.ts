import { d } from "typegpu";

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 64;
export const MAP_SUBDIVISIONS = 70;

export const CHUNK_SIZE = 10;

export const Vertex = d.struct({ position: d.vec4f, world: d.vec3f, normal: d.vec3f });
export const Fragment = d.struct({ color: d.vec4f });

export const RoadNode = d.struct({
    position: d.vec3f,
});

export const RoadEdge = d.struct({
    start: RoadNode,
    end: RoadNode,
    controlPoint1: d.vec2f,
    controlPoint2: d.vec2f,
});

export const gravityMultiplier = d.f32(1.0);