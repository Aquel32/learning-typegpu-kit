'use strict';

import { d } from "typegpu";

export let perlin:any = {
    gradients: {} as Record<string, d.v2f>,
    memory: {} as Record<string, number>,
    rand_vect: function(){
        let theta = Math.random() * 2 * Math.PI;
        return d.vec2f(Math.cos(theta), Math.sin(theta));
    },
    dot_prod_grid: function(p1: d.v2f, p2: d.v2f){
        let g_vect;
        let d_vect = {x: p1.x - p2.x, y: p1.y - p2.y};
        const key = `${p2.x},${p2.y}`;
        if (this.gradients[key]){
            g_vect = this.gradients[key];
        } else {
            g_vect = this.rand_vect();
            this.gradients[key] = g_vect;
        }
        return d_vect.x * g_vect.x + d_vect.y * g_vect.y;
    },
    smootherstep: function(x: number){
        return 6*x**5 - 15*x**4 + 10*x**3;
    },
    interp: function(x: number, a: number, b: number){
        return a + this.smootherstep(x) * (b-a);
    },
    seed: function(){
        this.gradients = {};
        this.memory = {};
    },
    get: function(p: d.v2f){ {
        const key = `${p.x},${p.y}`;
        if (this.memory.hasOwnProperty(key))
            return this.memory[key];
        let x = p.x;
        let y = p.y;
        let xf = Math.floor(x);
        let yf = Math.floor(y);
        const pf = d.vec2f(xf, yf);
        //interpolate
        let tl = this.dot_prod_grid(p, pf);
        let tr = this.dot_prod_grid(p, d.vec2f(xf+1, yf));
        let bl = this.dot_prod_grid(p, d.vec2f(xf, yf+1));
        let br = this.dot_prod_grid(p, d.vec2f(xf+1, yf+1));
        let xt = this.interp(x-xf, tl, tr);
        let xb = this.interp(x-xf, bl, br);
        let v = this.interp(y-yf, xt, xb);
        this.memory[key] = v;
        return v;
    }
}
}
perlin.seed();