import { d } from "typegpu";

export const Vertex = d.struct({ position: d.vec4f, world: d.vec3f, normal: d.vec3f });
export const Fragment = d.struct({ color: d.vec4f });
