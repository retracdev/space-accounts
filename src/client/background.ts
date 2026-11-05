// Procedural background shared with retrac.space, Copyright (c) 2026 Carter Welch.
// MIT licensed; see LICENSE.
import { motion } from "./motion";

const RES = 2;
const MAX_PIXELS = 8e6;
const FPS = 30;
const SPEED = 0.12;

// Each expression produces a field for the shared color palette: flowing
// ribbons, ripples and folded waves.
const SHADERS = [
  `float field(vec2 p, float t) {
    p.x += .6*sin(p.y*(1.5+iTweakA.x*.4)+t);
    return .5+.5*sin(p.x*(3.+iTweakB.x)+sin(p.y*2.-t)*2.+t);
  }`,
  `float field(vec2 p, float t) {
    vec2 center = .5*vec2(sin(t*.7+iTweakA.x), cos(t*.5+iTweakA.y));
    float r = length(p-center);
    float angle = atan(p.y-center.y, p.x-center.x);
    return .5+.5*cos(r*(7.+iTweakB.x*2.)-t*2.+sin(angle*3.+t)*.8);
  }`,
  `float field(vec2 p, float t) {
    float a = sin(p.x*2.+t+iTweakA.x)*cos(p.y*2.5-t*.6);
    float b = sin((p.x+p.y)*3.+a*3.+iTweakA.y);
    return .5+.5*sin(b*2.+a*2.+t*.4);
  }`,
];

const vertexSource = `#version 300 es
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p*2.-1., 0., 1.);
  }`;

function startBackground(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    powerPreference: "low-power",
  });
  if (!gl) return; // Keep the solid CSS background on unsupported devices.

  // All random state is chosen once. Restoring a context retains the same look.
  const pick = Math.floor(Math.random() * SHADERS.length);
  const tweaks = Array.from({ length: 8 }, () => Math.random() * 2 - 1);
  const hue = Math.floor(Math.random() * 360);
  let time = Math.random() * 50;
  canvas.style.filter = `hue-rotate(${hue}deg)`;

  const fragmentSource = `#version 300 es
    precision highp float;
    uniform vec3 iResolution;
    uniform float iTime;
    uniform vec4 iTweakA, iTweakB;
    out vec4 outColor;
    ${SHADERS[pick]}
    void main() {
      vec2 p = (2.*gl_FragCoord.xy-iResolution.xy)/iResolution.y;
      float angle = iTweakA.z*3.14159;
      p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle))*p;
      p *= 1.2+iTweakA.w*.5;
      float f = field(p, iTime);
      vec3 phase = vec3(.05, .35, .65)+iTweakB.z*.25;
      vec3 color = .5+.5*cos(6.28318*(f*(.6+iTweakB.w*.2)+phase));
      color /= max(max(color.r, color.g), max(color.b, .001));
      outColor = vec4(color*(.7+.3*clamp(f, 0., 1.)), 1.);
    }`;

  let program: WebGLProgram | null = null;
  let resolution: WebGLUniformLocation | null = null;
  let timeUniform: WebGLUniformLocation | null = null;
  let frame: number | null = null;
  let lastFrame = 0;
  let lost = false;
  let suspended = false;

  function compile(type: number, source: string) {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return shader;
    console.warn("Background shader failed:", gl!.getShaderInfoLog(shader));
    gl!.deleteShader(shader);
    return null;
  }

  function build() {
    const vs = compile(gl!.VERTEX_SHADER, vertexSource);
    const fs = compile(gl!.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) {
      if (vs) gl!.deleteShader(vs);
      if (fs) gl!.deleteShader(fs);
      canvas.style.visibility = "hidden";
      return false;
    }
    program = gl!.createProgram();
    if (program) {
      gl!.attachShader(program, vs);
      gl!.attachShader(program, fs);
      gl!.linkProgram(program);
    }
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!program || !gl!.getProgramParameter(program, gl!.LINK_STATUS)) {
      if (program) gl!.deleteProgram(program);
      program = null;
      canvas.style.visibility = "hidden";
      return false;
    }
    gl!.useProgram(program);
    resolution = gl!.getUniformLocation(program, "iResolution");
    timeUniform = gl!.getUniformLocation(program, "iTime");
    gl!.uniform4f(
      gl!.getUniformLocation(program, "iTweakA"),
      tweaks[0]!,
      tweaks[1]!,
      tweaks[2]!,
      tweaks[3]!,
    );
    gl!.uniform4f(
      gl!.getUniformLocation(program, "iTweakB"),
      tweaks[4]!,
      tweaks[5]!,
      tweaks[6]!,
      tweaks[7]!,
    );
    canvas.style.visibility = "";
    return true;
  }

  function draw() {
    const scale = Math.min(
      RES,
      Math.sqrt(MAX_PIXELS / Math.max(1, innerWidth * innerHeight)),
    );
    const width = Math.max(1, Math.floor(innerWidth * scale));
    const height = Math.max(1, Math.floor(innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(program);
    gl!.uniform3f(resolution, width, height, 1);
    gl!.uniform1f(timeUniform, time);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function step(now: number) {
    frame = null;
    if (now - lastFrame >= 1000 / FPS) {
      time += Math.min((now - lastFrame) / 1000, 0.1) * SPEED;
      lastFrame = now;
      draw();
    }
    frame = requestAnimationFrame(step);
  }

  function resume() {
    stop();
    if (lost || suspended || document.hidden || !program) return;
    draw();
    if (!motion.matches) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(step);
    }
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    program = null;
    canvas.style.visibility = "hidden";
    stop();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    if (build()) resume();
  });
  addEventListener("resize", resume);
  document.addEventListener("visibilitychange", resume);
  motion.onChange(resume);
  addEventListener("pagehide", () => {
    suspended = true;
    stop();
  });
  addEventListener("pageshow", () => {
    suspended = false;
    resume();
  });
  if (build()) resume();
}

const canvas = document.querySelector<HTMLCanvasElement>("#bgcanvas");
if (canvas) startBackground(canvas);
