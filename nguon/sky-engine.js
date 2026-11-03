  /* ---------------------------------------------- the sky, on its own thread */

  // Nothing the app does can hold this up: the scene lives in a Worker and its frames
  // go straight to the compositor. The function must stay self-contained, because its
  // source text is what the Worker runs. Where workers are refused it runs on the page.
  function skyEngine(port) {
    const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(std140) uniform F {
  vec4 uRes;     // canvas w, h, device pixel ratio
  vec4 uTime;    // seconds, rain fall, flash, flash x
  vec4 uFlow;    // cloud drift, -, rain cover, closed sky
  vec4 uWx;      // cloud, rain, storm, wind
  vec4 uWy;      // fog, tornado, deck, drizzle
  vec4 uDay;     // night, warm, moonlight, lit
  vec4 uSun;     // x, y, strength, waxing
  vec4 uMoon;    // x, y, strength, white text
  vec4 uC0; vec4 uC1; vec4 uC2; vec4 uC3; vec4 uFogCol;
  vec4 uText;    // text column x0, x1, soft edge
  vec4 uTree;    // root x, root y, pixels per unit, bend
  vec4 uSway;    // three phases, strength
  vec4 uLeaf0; vec4 uLeaf1; vec4 uLeaf2; vec4 uBark0; vec4 uBark1;
  vec4 uLight;   // direction x, y, contrast, wet
  vec4 uRainCol; // colour, slant
  vec4 uBow;     // centre x, y, radius, strength
  vec4 uGone[3]; // how far each breakable branch has gone, 0 to 1
};
`;

    // Shared by the sky and the rain, so the rain really leaves from the cloud base.
    const SHARED = `
float textMask(float x) {
  return smoothstep(uText.x - uText.z, uText.x + uText.z * 0.3, x) * smoothstep(uText.y + uText.z, uText.y - uText.z * 0.3, x);
}
float rainCell(float x) {
  float c = textureLod(uN, vec2(x * 0.2 - uFlow.x * 0.05, 0.27), 1.0).a;
  return smoothstep(0.56 - uFlow.z, 0.88 - uFlow.z, c);
}
float deckBase(float x) {
  float lumps = textureLod(uN, vec2(x * 0.21 - uFlow.x * 0.04, 0.61), 1.0).a;
  return mix(1.3, 0.44, uWy.z) + (lumps - 0.5) * 0.2 + (1.0 - rainCell(x)) * 0.3 * smoothstep(0.0, 0.3, uWy.z);
}
`;

    const SWAY = `
vec2 sway(vec2 p, vec4 s) {
  float u = max(p.y, 0.0);
  vec2 d = vec2(-uTree.w * u * u, -abs(uTree.w) * u * u * 0.18);
  float wave = p.x * 1.7;
  d.x += uSway.w * (s.x * sin(uSway.x + s.y + wave) + s.z * 0.55 * sin(uSway.y + s.w + wave));
  d.y += uSway.w * (s.x * 0.4 * sin(uSway.y + s.y * 1.7 + wave) + s.z * 0.4 * cos(uSway.x + s.w));
  return p + d;
}
float kept(float g) {
  int i = int(g + 0.5) - 1;
  return i < 0 ? 1.0 : 1.0 - uGone[i / 4][i % 4];
}
vec4 place(vec2 p) {
  vec2 px = uTree.xy + p * uTree.z;
  return vec4(px / uRes.xy * 2.0 - 1.0, 0.0, 1.0);
}
`;

    const FULL_VS = `${HEAD}
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

    const RAND = `
vec4 rand4(int i, int j) {
  uvec4 v = uvec4(uint(i), uint(j), 13u, 21u) * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return vec4(v >> 8u) / 16777216.0;
}
`;

    const SKY_FS = `${HEAD}
uniform sampler2D uN;
uniform sampler2D uR;
uniform vec2 uS;
uniform float uRaw;
out vec4 fragColor;
${SHARED}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Six octaves from two lookups: the noise is baked once into a tiling texture.
float fbm(vec2 p) {
  return texture(uN, p / 8.0).r + texture(uN, mat2(0.8, 0.6, -0.6, 0.8) * p * 2.0).r * 0.0625;
}
vec3 skyGradient(float t) {
  if (t < 0.38) return mix(uC0.rgb, uC1.rgb, t / 0.38);
  if (t < 0.74) return mix(uC1.rgb, uC2.rgb, (t - 0.38) / 0.36);
  return mix(uC2.rgb, uC3.rgb, clamp((t - 0.74) / 0.26, 0.0, 1.0));
}
vec3 stars(vec2 q) {
  vec3 col = vec3(0.0);
  float clear = uDay.x * (1.0 - uWx.x * 0.9);
  if (clear <= 0.01) return col;
  vec2 g = q * 90.0;
  vec2 id = floor(g);
  float h = hash(id);
  if (h > 0.965) {
    vec2 c = fract(g) - 0.5 - (vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5) * 0.7;
    float tw = 0.65 + 0.35 * sin(uTime.x * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(0.86, 0.9, 1.0) * smoothstep(0.06 + 0.1 * hash(id + 5.1), 0.0, length(c)) * tw;
  }
  // The Milky Way, drowned out by a bright moon.
  float band = exp(-pow((q.y - 0.95 + q.x * 0.42) * 4.2, 2.0));
  col += vec3(0.42, 0.44, 0.7) * band * smoothstep(0.34, 0.66, fbm(q * 4.0 + 3.0)) * 0.17 * (1.0 - 0.75 * uDay.z);
  return col * clear;
}
// Cloud forms: broad masses, billows on them and small lumps on those.
float cloudShape(vec2 c) {
  return texture(uN, c * 0.075).r * 0.6 + texture(uN, c * 0.2 + 0.31).b * 0.29 + texture(uN, c * 0.6 + 0.17).b * 0.11;
}
// The grey underside of rain cloud: heavy lumps, flattening towards the far edge.
void deck(inout vec3 col, vec2 q, vec2 p, vec3 hi, vec3 lo, vec3 far) {
  float y = p.y - deckBase(p.x);
  if (y < -0.3) return;
  vec2 c = vec2(q.x * 1.5 + uFlow.x * 1.5, pow(max(p.y - 0.2, 0.0) + 0.02, 0.6) * 3.6);
  float b = cloudShape(c);
  float m = smoothstep(0.0, 0.5, y * 5.0 + (b - 0.5) * 2.8);
  if (m < 0.002) return;
  // Light comes up from the pale band over the horizon, so each lump has a lighter belly.
  float lit = smoothstep(0.36, 0.64, b) * 0.72 + clamp((b - cloudShape(c - vec2(0.0, 0.2))) * 2.4, -0.2, 0.26);
  vec3 cloud = mix(lo, hi, clamp(lit, 0.0, 1.0));
  cloud = mix(cloud, far, exp(-max(y, 0.0) * 7.0) * 0.8);
  col = mix(col, cloud, m);
}
void main() {
  vec2 p = gl_FragCoord.xy / uS;
  float a = uRes.x / uRes.y;
  vec2 q = vec2(p.x * a, p.y);
  float night = uDay.x, warm = uDay.y, moonlight = uDay.z;
  float cloud = uWx.x, rain = uWx.y, storm = uWx.z, fog = uWy.x, dk = uWy.z;
  float wet = max(rain, storm);

  vec3 col = skyGradient(clamp((1.0 - p.y) / 0.84, 0.0, 1.0));

  // Under thick cloud the light comes from everywhere: pale low down, never black.
  vec3 moonGrey = vec3(0.125, 0.14, 0.18) + vec3(0.06, 0.07, 0.11) * moonlight;
  float heavy = smoothstep(0.2, 0.5, max(max(rain, storm), dk * 0.8));
  vec3 airHi = mix(mix(vec3(0.73, 0.76, 0.8), vec3(0.34, 0.375, 0.43), heavy), moonGrey, night);
  vec3 airLo = mix(mix(vec3(0.84, 0.86, 0.88), vec3(0.47, 0.5, 0.54), heavy), vec3(0.2, 0.17, 0.17), night);
  airHi = mix(airHi, airHi * vec3(1.06, 0.84, 0.8), warm * 0.6);
  airLo = mix(airLo, airLo * vec3(1.22, 0.84, 0.62), warm * 0.8);
  airHi *= 1.0 - storm * 0.3;
  airLo *= 1.0 - storm * 0.2;
  vec3 air = mix(airLo, airHi, smoothstep(0.14, 0.62, p.y));
  float grey = smoothstep(0.0, 0.5, dk);
  col = mix(col, air, grey);
  col += stars(q) * (1.0 - grey);

  // Sun: a disc, a tight bloom and a wide warm glow.
  vec2 sq = vec2(uSun.x * a, uSun.y);
  float sd = length(q - sq);
  if (uSun.z > 0.0) {
    vec3 tone = mix(vec3(1.0, 0.9, 0.72), vec3(1.0, 0.62, 0.3), warm);
    col += tone * uSun.z * (smoothstep(0.034, 0.026, sd) * 1.5 + exp(-sd * 16.0) * 0.62 + exp(-sd * 3.2) * (0.14 + 0.42 * warm));
  }

  // Moon: lit by the real phase angle.
  vec2 mq = vec2(uMoon.x * a, uMoon.y);
  float md = length(q - mq);
  if (uMoon.z > 0.0) {
    float r = 0.062;
    col += vec3(0.62, 0.7, 1.0) * exp(-md * 7.0) * 0.32 * uMoon.z * uDay.w * night;
    if (md < r) {
      vec2 n = (q - mq) / r;
      vec3 N = vec3(n, sqrt(max(0.0, 1.0 - dot(n, n))));
      float ang = acos(clamp(2.0 * uDay.w - 1.0, -1.0, 1.0));
      vec3 L = vec3(uSun.w * sin(ang), 0.0, cos(ang));
      float lit = smoothstep(-0.02, 0.12, dot(N, L));
      float maria = fbm(n * 2.6 + 4.0);
      vec3 surface = vec3(1.0, 0.97, 0.88) * (0.72 + 0.42 * smoothstep(0.38, 0.62, maria));
      vec3 shade = col * 0.82 + vec3(0.02, 0.025, 0.04);
      col = mix(col, mix(shade, surface, lit), smoothstep(1.0, 0.96, length(n)) * uMoon.z);
    }
  }

  // Fair-weather clouds on a sky plane, so they flatten towards the horizon.
  vec2 toLight = (uSun.z > 0.0 ? sq : mq) - q;
  toLight /= max(length(toLight), 0.24);
  if (p.y > 0.08 && dk < 0.96) {
    // Soft clouds on a sky plane, so they flatten towards the horizon. The fan of that
    // plane is held back: at full strength it sweeps clouds into streaks at the sides.
    float h = max(p.y - 0.1, 0.0) + 0.2;
    vec2 cp = vec2((q.x - a * 0.5) / mix(h, 1.0, 0.6), 1.0 / h) * 0.55 + vec2(uFlow.x, 0.0);
    vec2 warp = texture(uN, cp * 0.16).rg * 0.4;
    float d = fbm(cp * 2.1 + warp);
    float edge = mix(0.64, 0.36, cloud);
    float m = smoothstep(edge, edge + 0.14, d);
    if (m > 0.001) {
      float d2 = fbm(cp * 2.1 + warp + toLight * 0.16);
      float shade = clamp((d - d2) * 5.0 + 0.62, 0.0, 1.0);
      vec3 lit = mix(vec3(1.0), vec3(1.0, 0.72, 0.5), warm);
      vec3 dim = mix(vec3(0.13, 0.15, 0.24), vec3(0.42, 0.47, 0.64), moonlight);
      lit = mix(lit, dim, night);
      lit = mix(lit, airHi * 1.12, max(wet, grey) * 0.9);
      vec3 dark = lit * mix(0.72, 0.62, wet) * mix(vec3(0.92, 0.95, 1.0), vec3(0.9, 0.8, 0.95), warm);
      vec3 cloudCol = mix(dark, lit, shade);
      cloudCol += vec3(1.0, 0.86, 0.64) * pow(max(0.0, 1.0 - sd * 1.1), 5.0) * (1.0 - m) * uSun.z * 1.2;
      col = mix(col, cloudCol, m * mix(0.94, 1.0, cloud));
    }
  }
  // A closed sky is soft and even, not a flat wash.
  vec3 closed = mix(vec3(0.76, 0.79, 0.82), moonGrey * 1.15, night) * (0.92 + 0.16 * cloudShape(vec2(q.x * 0.9 + uFlow.x * 0.6, p.y * 1.5)));
  col = mix(col, closed, uFlow.w * 0.94 * (1.0 - grey * 0.6));

  if (dk > 0.02) {
    vec3 hi = mix(mix(vec3(0.8, 0.82, 0.85), mix(vec3(0.42, 0.46, 0.52), vec3(0.33, 0.36, 0.42), storm), heavy), moonGrey * 1.5, night);
    vec3 lo = mix(mix(vec3(0.6, 0.63, 0.68), mix(vec3(0.2, 0.225, 0.27), vec3(0.13, 0.15, 0.19), storm), heavy), moonGrey * 0.5, night);
    hi = mix(hi, hi * vec3(1.14, 0.86, 0.72), warm * 0.7);
    deck(col, q, p, hi, lo, mix(airLo, airHi, 0.5));
  }
  col = mix(col, uFogCol.rgb, fog * 0.62);

  if (uBow.w > 0.002) {
    float r = length(q - vec2(uBow.x * a, uBow.y)) / uBow.z;
    // Red on the outside, violet inside.
    float t = (r - 0.91) / 0.09;
    vec3 band = clamp(vec3(1.5 - abs(4.0 * t - 3.3), 1.5 - abs(4.0 * t - 2.1), 1.5 - abs(4.0 * t - 0.7)), 0.0, 1.0) * smoothstep(0.0, 0.14, t) * smoothstep(1.0, 0.86, t);
    // The fainter second bow has its colours the other way round.
    float u = 1.0 - (r - 1.2) / 0.12;
    vec3 band2 = clamp(vec3(1.5 - abs(4.0 * u - 3.3), 1.5 - abs(4.0 * u - 2.1), 1.5 - abs(4.0 * u - 0.7)), 0.0, 1.0) * smoothstep(0.0, 0.2, u) * smoothstep(1.0, 0.8, u);
    float fade = 0.5 + 0.5 * smoothstep(0.86, 0.3, (p.y - uBow.y) / uBow.z);
    float bright = smoothstep(0.55, 0.95, dot(col, vec3(0.2126, 0.7152, 0.0722)));
    vec3 add = (band * 0.34 + band2 * 0.09) * fade * (1.0 - 0.75 * bright) + vec3(smoothstep(0.93, 0.55, r) * 0.04);
    float gap = smoothstep(1.0, 1.03, r) * smoothstep(1.2, 1.17, r) * 0.05;
    col = (col + add * uBow.w) * (1.0 - gap * uBow.w);
  }

  // Mountains, far to near; their outlines are baked, so these lookups are cheap.
  vec4 ridge = texture(uR, vec2(p.x, 0.5));
  if (p.y < max(max(ridge.x, ridge.y), max(ridge.z, ridge.w)) + 0.01) {
    vec3 far = mix(uC3.rgb, uC2.rgb, 0.3);
    far = mix(far, airLo, grey * 0.8);
    vec3 near = mix(mix(vec3(0.24, 0.36, 0.33), vec3(0.1, 0.17, 0.19), max(night, 0.8 * warm)), vec3(0.32, 0.25, 0.22), warm * 0.6);
    float wood = texture(uN, mat2(0.8, 0.6, -0.6, 0.8) * q * vec2(3.4, 4.6)).r;
    for (int i = 0; i < 4; i++) {
      float k = float(i);
      float m = smoothstep(0.0, 1.6 / uS.y, ridge[i] - p.y);
      if (m > 0.0) {
        vec3 ground = mix(far, near, 0.34 + k * 0.22);
        ground *= mix(1.0, mix(0.3, 0.7, moonlight), night);
        ground *= 1.0 + (wood - 0.5) * k * 0.09;
        ground += vec3(1.0, 0.6, 0.3) * warm * 0.1 * (1.0 - k * 0.2) * smoothstep(0.1, 0.0, ridge[i] - p.y);
        float valley = smoothstep(0.0, 0.16, ridge[i] - p.y);
        ground = mix(ground, uFogCol.rgb, valley * fog * (0.85 - k * 0.12));
        ground = mix(ground, uFogCol.rgb, fog * (0.55 - k * 0.13));
        ground *= 1.0 - 0.44 * heavy;
        ground = mix(ground, airLo, wet * grey * (0.56 - k * 0.15));
        col = mix(col, ground, m);
      }
    }
  }

  if (fog > 0.01) {
    float wisp = fbm(vec2(q.x * 1.3 + uFlow.x * 3.0, p.y * 8.0 + 2.0));
    col = mix(col, uFogCol.rgb, fog * smoothstep(0.3, 0.62, wisp) * smoothstep(0.62, 0.12, p.y) * 0.86);
  }

  // Sheets of far rain hanging from the base, leaning with the wind.
  float base = deckBase(p.x);
  if (rain > 0.01 && p.y < base + 0.06) {
    float sx = p.x + (base - p.y) * uRainCol.a * 0.34;
    float sheet = texture(uN, vec2(sx * a * 0.42, p.y * 0.05 + uTime.y * 0.012)).a;
    float v = rainCell(sx) * smoothstep(base + 0.05, base - 0.16, p.y) * (0.7 + (sheet - 0.5) * 1.1);
    col = mix(col, mix(airLo, airHi, 0.6), clamp(v * rain * 0.74, 0.0, 0.78));
  }

  // Lightning lights the cloud around it from the inside.
  if (uTime.z > 0.0) {
    col += vec3(0.66, 0.72, 1.0) * uTime.z * exp(-length(q - vec2(uTime.w * a, 0.7)) * 1.7) * 0.8 * smoothstep(0.02, 0.3, p.y);
  }

  if (uWy.y > 0.01) {
    float T = uTime.x;
    float v = clamp((p.y - 0.1) / 0.74, 0.0, 1.0);
    float cx = (0.62 + 0.06 * sin(T * 0.12)) * a + sin(v * 2.6 + T * 0.5) * 0.05 * (1.0 - v) + sin(v * 9.0 + T * 2.0) * (0.008 + 0.012 * v);
    float width = 0.012 + 0.21 * pow(v, 2.2);
    float d = (q.x - cx) / width;
    if (p.y > 0.09 && p.y < 0.84 && abs(d) < 1.4) {
      float round_ = sqrt(max(0.0, 1.0 - d * d));
      float bands = fbm(vec2(asin(clamp(d, -1.0, 1.0)) * 2.0 + T * 5.0, v * 9.0 - T * 1.2));
      vec3 funnel = mix(vec3(0.15, 0.16, 0.19), vec3(0.47, 0.49, 0.53), bands * round_ + 0.1);
      funnel = mix(funnel, vec3(0.36, 0.31, 0.27), smoothstep(0.25, 0.0, v));
      col = mix(col, funnel, smoothstep(1.35, 0.75, abs(d)) * uWy.y * (0.65 + 0.35 * smoothstep(0.0, 0.1, v)) * smoothstep(0.84, 0.58, p.y));
    }
    float dust = length(vec2((q.x - cx) / 0.24, (p.y - 0.1) / 0.07));
    col = mix(col, vec3(0.4, 0.34, 0.29), smoothstep(1.0, 0.2, dust) * fbm(vec2(q.x * 9.0 + T * 2.0, p.y * 14.0 - T)) * uWy.y);
  }

  // City light bouncing off low cloud at night.
  col += vec3(0.5, 0.3, 0.18) * exp(-max(p.y - 0.12, 0.0) * 6.0) * night * cloud * 0.22 * smoothstep(0.0, 0.2, p.y);
  col = mix(col, uFogCol.rgb, fog * 0.12);

  // Behind the text the extremes are eased, so the letters always stand clear of it.
  if (uRaw < 0.5) {
    float m = textMask(p.x);
    if (m > 0.001) {
      float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float capped = L < 0.42 ? L : 0.42 + (1.0 - exp(-(L - 0.42) * 2.0)) * 0.22;
      col *= mix(1.0, capped / max(L, 0.001), m * uMoon.w);
    }
  }
  fragColor = vec4(max(col, vec3(0.012, 0.014, 0.02)), 1.0);
}`;

    const BLIT_FS = `${HEAD}
uniform sampler2D uImg;
out vec4 fragColor;
void main() {
  vec3 c = texture(uImg, gl_FragCoord.xy / uRes.xy).rgb;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(c + (n - 0.5) / 160.0, 1.0);
}`;

    const LIMB_VS = `${HEAD}
layout(location = 0) in vec4 aP;
layout(location = 1) in vec4 aS;
layout(location = 2) in vec3 aV;
out vec2 vV;
out float vL;
${SWAY}
void main() {
  vV = aV.xy;
  vL = dot(normalize(aP.zw + 1e-5), uLight.xy) * sign(aV.x);
  gl_Position = place(sway(aP.xy, aS) + aP.zw * kept(aV.z));
}`;

    const LIMB_FS = `${HEAD}
in vec2 vV;
in float vL;
out vec4 fragColor;
void main() {
  float x = abs(vV.x);
  float a = smoothstep(1.0, 1.0 - min(1.0, fwidth(vV.x) * 1.6), x);
  float k = clamp(0.32 + vL * x * uLight.z * 1.2 + (1.0 - x * x) * 0.22, 0.0, 1.0);
  vec3 c = mix(uBark0.rgb, uBark1.rgb, k);
  c += uRainCol.rgb * uLight.w * 0.16 * smoothstep(0.5, 0.95, vL * x + 0.4);
  fragColor = vec4(c * a, a);
}`;

    const LEAF_VS = `${HEAD}
layout(location = 0) in vec2 aQ;
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;
layout(location = 3) in vec4 aS;
layout(location = 4) in float aG;
out vec2 vQ;
out vec3 vC;
${SWAY}
void main() {
  float wind = uWx.w, rain = uWx.y;
  float rot = aB.x + sin(uSway.z + aB.w * 6.28) * (0.08 + 0.5 * wind) + wind * 0.8 * sin(3.1416 - aB.x);
  vec2 d = vec2(cos(rot), sin(rot));
  vec2 c = aB.y * kept(aG) * (aQ.x * d + aQ.y * 0.52 * vec2(-d.y, d.x));
  // Rain pattering on the leaves: a small dip and a wet glint.
  float tick = floor(uTime.x * 7.0 + aB.w * 5.0);
  float hit = step(1.0 - 0.035 * rain, fract(sin(tick * 1.7 + aB.w * 91.7) * 437.585));
  vec2 P = sway(aA.xy, aS) + aA.zw + c - vec2(0.0, hit * 0.0024);
  float l = aB.z + dot(normalize(aA.zw + 1e-5), uLight.xy) * uLight.z * 0.42;
  l += smoothstep(0.84, 1.0, sin(uSway.x + aB.w * 9.0 + aA.x * 3.0)) * wind * 0.3;
  l = clamp(l, 0.0, 1.0);
  vC = l < 0.5 ? mix(uLeaf0.rgb, uLeaf1.rgb, l * 2.0) : mix(uLeaf1.rgb, uLeaf2.rgb, l * 2.0 - 1.0);
  vC += uRainCol.rgb * hit * 0.16;
  vQ = aQ;
  gl_Position = place(P);
}`;

    const LEAF_FS = `${HEAD}
in vec2 vQ;
in vec3 vC;
out vec4 fragColor;
void main() {
  float d = abs(vQ.y) - (1.0 - vQ.x * vQ.x);
  float e = fwidth(d) + 0.001;
  float a = smoothstep(e, -e, d);
  if (a < 0.01) discard;
  fragColor = vec4(vC * a, a);
}`;

    // Thin streaks, mostly far away. They take their colour from the sky, so like real
    // rain they show against dark things and almost vanish against bright ones.
    const RAIN_VS = `${HEAD}
uniform sampler2D uN;
layout(location = 0) in vec2 aQ;
out vec2 vQ;
out float vA;
${SHARED}
${RAND}
void main() {
  vec4 r = rand4(gl_InstanceID, 7);
  float z = r.x * r.x * r.x * r.x;
  float fine = uWy.w;
  float len = mix(0.022, 0.1, z) * (1.0 - 0.72 * fine);
  float wid = mix(0.75, 1.5, z) * (1.0 - 0.2 * fine) * uRes.z;
  float u = fract(r.y + uTime.y * mix(0.64, 1.3, z));
  float y = 1.16 - 1.3 * u;
  float slant = uRainCol.a * (0.92 + 0.16 * r.w) * mix(0.8, 1.25, z);
  float span = 1.0 + 1.4 * max(uRainCol.a, 0.2);
  float x = fract(r.z + (y - 1.16) * slant * uRes.y / uRes.x / span) * span - (span - 1.0) * 0.5;
  float base = deckBase(x);
  float a = mix(0.13, 0.3, z) * (0.6 + 0.4 * uWx.y) * (1.0 - 0.1 * fine);
  a *= smoothstep(base + 0.015, base - 0.11, y) * rainCell(x) * (1.0 - 0.72 * textMask(x));
  a *= 1.0 - smoothstep(0.06, -0.08, y);
  vec2 head = vec2(x, y) * uRes.xy;
  vec2 up = normalize(vec2(slant, 1.0));
  vec2 n = vec2(-up.y, up.x);
  vec2 px = head + up * (aQ.y * 0.5 + 0.5) * len * uRes.y + n * aQ.x * (wid + 1.0);
  vQ = vec2(aQ.x * (wid + 1.0) / wid, aQ.y * 0.5 + 0.5);
  vA = a;
  gl_Position = vec4(px / uRes.xy * 2.0 - 1.0, 0.0, 1.0);
}`;

    const RAIN_FS = `${HEAD}
in vec2 vQ;
in float vA;
out vec4 fragColor;
void main() {
  float s = max(1.0 - abs(vQ.x), 0.0);
  float a = vA * s * s * smoothstep(0.0, 0.1, vQ.y) * (1.0 - vQ.y * vQ.y);
  fragColor = vec4(uRainCol.rgb * a, a * 0.6);
}`;

    // Drops bursting on the ground, nearest at the bottom of the screen.
    const SPLASH_VS = `${HEAD}
uniform sampler2D uN;
layout(location = 0) in vec2 aQ;
out vec2 vQ;
out float vA;
${SHARED}
${RAND}
void main() {
  vec4 r = rand4(gl_InstanceID, 3);
  float clock = uTime.x * (2.6 + r.x * 1.6) + r.y * 9.0;
  float age = fract(clock);
  vec4 s = rand4(gl_InstanceID, int(floor(clock)) & 1023);
  float depth = s.y;
  float size = mix(3.0, 13.0, 1.0 - depth) * uRes.z * (0.25 + 0.75 * age);
  vec2 px = vec2(s.x, depth * 0.055) * uRes.xy + aQ * vec2(size, size * 0.34);
  vQ = aQ;
  vA = (1.0 - age) * uWx.y * 0.3 * (1.0 - 0.8 * textMask(s.x)) * rainCell(s.x) * step(0.3, uWx.y);
  gl_Position = vec4(px / uRes.xy * 2.0 - 1.0, 0.0, 1.0);
}`;

    const SPLASH_FS = `${HEAD}
in vec2 vQ;
in float vA;
out vec4 fragColor;
void main() {
  float d = length(vQ);
  float a = vA * smoothstep(1.0, 0.82, d) * smoothstep(0.5, 0.82, d);
  fragColor = vec4(uRainCol.rgb * a, a * 0.5);
}`;

    // Birds, falling leaves, drips, fireflies, shooting stars and lightning.
    const SPRITE_VS = `${HEAD}
layout(location = 0) in vec2 aQ;
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;
layout(location = 3) in vec4 aC;
out vec2 vP;
out vec3 vL;
out vec4 vC;
out float vAdd;
void main() {
  vec2 d = aA.zw - aA.xy;
  float len = length(d);
  vec2 t = len > 0.001 ? d / len : vec2(1.0, 0.0);
  float pad = aB.x + 1.5;
  vP = vec2(aQ.x * (len * 0.5 + pad), aQ.y * pad);
  vec2 px = (aA.xy + aA.zw) * 0.5 + t * vP.x + vec2(-t.y, t.x) * vP.y;
  vL = vec3(len * 0.5, aB.x, aB.y);
  vC = aC;
  vAdd = aB.z;
  gl_Position = vec4(px / uRes.xy * 2.0 - 1.0, 0.0, 1.0);
}`;

    const SPRITE_FS = `${HEAD}
in vec2 vP;
in vec3 vL;
in vec4 vC;
in float vAdd;
out vec4 fragColor;
void main() {
  float d = length(vec2(max(abs(vP.x) - vL.x, 0.0), vP.y));
  float hard = smoothstep(vL.y + 0.7, vL.y - 0.7, d);
  float glow = max(1.0 - d / vL.y, 0.0);
  float a = mix(hard, glow * glow, vL.z) * vC.a;
  fragColor = vec4(vC.rgb * a, a * (1.0 - vAdd));
}`;

    /* ------------------------------------------------- random, noise, shapes */

    let seed = 0;
    const seedOf = (n) => (seed = n);
    function rand() {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const rr = (a, b) => a + rand() * (b - a);
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const smooth = (a, b, v) => {
      const t = clamp((v - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    function bakeNoise() {
      seedOf(77);
      const N = 256;
      const out = new Uint8Array(N * N * 4);
      const table = (per) => {
        const g = new Float32Array(per * per * 2);
        for (let i = 0; i < g.length; i += 2) {
          const a = rand() * 6.2832;
          g[i] = Math.cos(a);
          g[i + 1] = Math.sin(a);
        }
        return g;
      };
      const perlin = (g, per, x, y) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        const x1 = (x0 + 1) % per;
        const y1 = (y0 + 1) % per;
        const a = 2 * (y0 * per + x0);
        const b = 2 * (y0 * per + x1);
        const c = 2 * (y1 * per + x0);
        const d = 2 * (y1 * per + x1);
        const n0 = g[a] * fx + g[a + 1] * fy;
        const n1 = g[b] * (fx - 1) + g[b + 1] * fy;
        const n2 = g[c] * fx + g[c + 1] * (fy - 1);
        const n3 = g[d] * (fx - 1) + g[d + 1] * (fy - 1);
        return n0 + (n1 - n0) * u + (n2 - n0) * v + (n0 - n1 - n2 + n3) * u * v;
      };
      const points = (per) => Float32Array.from({ length: per * per * 2 }, rand);
      const worley = (p, per, x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        let best = 9;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = (ix + dx + per) % per;
            const cy = (iy + dy + per) % per;
            const i = 2 * (cy * per + cx);
            const ex = ix + dx + p[i] - x;
            const ey = iy + dy + p[i + 1] - y;
            const d = ex * ex + ey * ey;
            if (d < best) best = d;
          }
        }
        return Math.sqrt(best);
      };
      const R = [8, 16, 32, 64].map((p) => [table(p), p]);
      const G = [8, 16, 32, 64].map((p) => [table(p), p]);
      const A = [4, 8].map((p) => [table(p), p]);
      const B = [6, 12, 24].map((p) => [points(p), p]);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const fbm = (set) => {
            let s = 0;
            let amp = 0.5;
            for (const [g, per] of set) {
              s += amp * perlin(g, per, (x / N) * per, (y / N) * per);
              amp *= 0.5;
            }
            return s;
          };
          let puff = 0;
          let amp = 0.6;
          for (const [p, per] of B) {
            puff += amp * (1 - worley(p, per, (x / N) * per, (y / N) * per));
            amp *= 0.47;
          }
          const i = 4 * (y * N + x);
          out[i] = clamp(0.5 + fbm(R) * 1.5, 0, 1) * 255;
          out[i + 1] = clamp(0.5 + fbm(G) * 1.5, 0, 1) * 255;
          out[i + 2] = clamp(puff * 1.2, 0, 1) * 255;
          out[i + 3] = clamp(0.5 + fbm(A) * 1.9, 0, 1) * 255;
        }
      }
      return out;
    }

    const ihash = (x, y) => {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    function vnoise(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      let fx = x - ix;
      let fy = y - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const a = ihash(ix, iy);
      const b = ihash(ix + 1, iy);
      const c = ihash(ix, iy + 1);
      const d = ihash(ix + 1, iy + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function fbm1(x, y) {
      let s = 0;
      let amp = 0.5;
      for (let i = 0; i < 5; i++) {
        s += amp * vnoise(x, y);
        const nx = 1.6 * x + 1.2 * y;
        y = -1.2 * x + 1.6 * y;
        x = nx;
        amp *= 0.5;
      }
      return s;
    }

    // Mountains, higher at the sides so the sun and moon set behind them.
    function bakeRidges(aspect) {
      const W = 1024;
      const out = new Float32Array(W * 4);
      for (let i = 0; i < W; i++) {
        const px = i / (W - 1);
        const q = px * aspect;
        const side = Math.pow(Math.abs(px - 0.5) * 2, 3);
        for (let k = 0; k < 4; k++) {
          const n = fbm1(q * (1.1 + k * 0.7) + k * 13.7, k);
          const peaks = 1 - Math.abs(2 * n - 1);
          out[i * 4 + k] = 0.2 - k * 0.04 + (0.12 - k * 0.03) * side + (0.24 - k * 0.045) * (peaks - 0.5) + 0.012 * (vnoise(q * (40 + k * 30), k) - 0.5) * k;
        }
      }
      return out;
    }

    // Always the same tree: the seed is fixed and its shape never depends on the weather.
    function makeTree() {
      seedOf(20261102);
      const UP = Math.PI / 2;
      const limbs = [];
      const tips = [];
      const groups = [];
      const grow = (x, y, ang, len, wid, depth, s, group) => {
        const n = depth === 0 ? 8 : depth < 3 ? 5 : 3;
        const step = len / n;
        const bow = rr(-0.05, 0.05);
        const nodes = [];
        let a = ang;
        let w1 = s[0];
        let w2 = s[2];
        for (let i = 0; i <= n; i++) {
          nodes.push({ x, y, w: wid * (1 - 0.5 * (i / n)), s: [w1, s[1], w2, s[3]], g: group });
          if (i === n) break;
          a += bow + rr(-0.11, 0.11);
          a += (UP - a) * (0.03 + depth * 0.018);
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
          if (depth >= 1) w1 += step * 1.5;
          if (depth >= 3) w2 += step * 2.8;
        }
        limbs.push({ nodes, depth, group });
        if (depth >= 5) {
          tips.push(nodes[n]);
          return;
        }
        const at = (t) => nodes[Math.min(n, Math.round(t * n))];
        const end = nodes[n];
        const kid = (node, off, scale) => {
          const nextPh = depth === 0 ? rr(0, 6.28) : node.s[1];
          const nextPh2 = depth === 2 ? rr(0, 6.28) : node.s[3];
          const heading = at(1) === node ? a : ang + (a - ang) * 0.5;
          const sw = [depth === 0 ? 0 : node.s[0], nextPh, depth === 2 ? 0 : node.s[2], nextPh2];
          let g = group;
          if (!g && depth === 2 && groups.length < 12 && node.y > 0.42 && rand() < 0.5) {
            groups.push({ x: node.x, y: node.y, s: node.s, segs: [], dots: [] });
            g = groups.length;
          }
          grow(node.x, node.y, heading + off, len * scale, node.w * 0.66, depth + 1, sw, g);
        };
        if (depth === 0) {
          // The crown leans out over the screen; the right side is short and goes off it.
          for (const [t, off, scale] of [
            [0.56, 1.02, 0.6],
            [0.66, -0.86, 0.6],
            [0.76, 0.72, 0.74],
            [0.86, -0.5, 0.7],
            [0.94, 0.34, 0.8],
            [1, -0.06, 0.8],
          ]) {
            kid(at(t), off, scale);
          }
          return;
        }
        const side = rand() < 0.5 ? 1 : -1;
        const count = depth < 3 ? 4 : depth === 3 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const t = count === 2 ? 0.55 + i * 0.45 : 0.36 + (i / (count - 1)) * 0.64;
          const sign = i % 2 ? side : -side;
          const off = i === count - 1 ? sign * rr(0.1, 0.34) : sign * rr(0.38, 0.8);
          kid(at(t), off, rr(0.62, 0.78));
        }
      };
      grow(0, 0, UP + 0.1, 0.4, 0.052, 0, [0, 0, 0, 0], 0);

      // Tapered ribbons for the wood.
      const wood = [];
      const index = [];
      for (const { nodes, group } of limbs) {
        const start = wood.length / 11;
        if (group) {
          const piece = groups[group - 1];
          for (let i = 0; i + 1 < nodes.length && piece.segs.length < 16; i++) {
            piece.segs.push([nodes[i].x - piece.x, nodes[i].y - piece.y, nodes[i + 1].x - piece.x, nodes[i + 1].y - piece.y, nodes[i].w]);
          }
        }
        nodes.forEach((p, i) => {
          const a = nodes[Math.max(0, i - 1)];
          const b = nodes[Math.min(nodes.length - 1, i + 1)];
          const tx = b.x - a.x;
          const ty = b.y - a.y;
          const l = Math.hypot(tx, ty) || 1;
          const nx = (-ty / l) * p.w;
          const ny = (tx / l) * p.w;
          wood.push(p.x, p.y, nx, ny, ...p.s, 1, i, group, p.x, p.y, -nx, -ny, ...p.s, -1, i, group);
        });
        for (let i = 0; i + 1 < nodes.length; i++) {
          const v = start + i * 2;
          index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }

      // Leaves, one by one, gathered around the twig ends.
      let top = 0;
      let bottom = 9;
      let left = 0;
      let right = -9;
      for (const t of tips) {
        top = Math.max(top, t.y);
        bottom = Math.min(bottom, t.y);
        left = Math.min(left, t.x);
        right = Math.max(right, t.x);
      }
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const cr = Math.max(right - left, top - bottom) / 2;
      const back = [];
      const front = [];
      for (const t of tips) {
        if (t.g) {
          const piece = groups[t.g - 1];
          if (piece.dots.length < 20) piece.dots.push([t.x - piece.x, t.y - piece.y]);
        }
        const up = (t.y - bottom) / (top - bottom);
        const out = Math.hypot(t.x - cx, t.y - cy) / cr;
        const bias = rr(-0.1, 0.1);
        const R = rr(0.042, 0.06);
        const n = Math.round(rr(26, 38));
        for (let i = 0; i < n; i++) {
          const a = rand() * 6.2832;
          const r = R * Math.sqrt(rand());
          const ox = Math.cos(a) * r;
          const oy = Math.sin(a) * r * 0.82 + R * 0.25;
          const shade = clamp(0.16 + 0.24 * up + 0.14 * out + bias + (oy / R) * 0.56 + rr(-0.06, 0.06), 0, 1);
          const row = [t.x, t.y, ox, oy, a + rr(-0.8, 0.8), rr(0.0072, 0.0106), shade, rand(), ...t.s, t.g || 0];
          if (rand() < 0.3) {
            row[6] *= 0.62;
            back.push(row);
          } else {
            front.push(row);
          }
        }
      }
      front.sort((a, b) => a[6] - b[6]);
      return {
        wood: new Float32Array(wood),
        index: new Uint16Array(index),
        back: new Float32Array(back.flat()),
        front: new Float32Array(front.flat()),
        nBack: back.length,
        nFront: front.length,
        tips,
        groups,
        left,
        right,
        top,
        cx,
        cy,
      };
    }

    /* ----------------------------------------------------------- the GPU side */

    const tree = makeTree();
    const noiseData = bakeNoise();
    const F = new Float32Array(27 * 4);
    const put = (i, a, b, c, d) => {
      F[i * 4] = a;
      F[i * 4 + 1] = b;
      F[i * 4 + 2] = c;
      F[i * 4 + 3] = d;
    };
    const putc = (i, c, s = 1) => put(i, (c[0] / 255) * s, (c[1] / 255) * s, (c[2] / 255) * s, 1);
    const MAX_SPRITES = 600;
    const SP = new Float32Array(MAX_SPRITES * 12);
    let spN = 0;
    let cv = null;
    let gl = null;
    let P = null;
    let skyTex = null;
    let skyFbo = null;
    let tiny = null;
    let ridgeTex = null;
    let W = 2;
    let H = 2;
    let dpr = 1;
    let aspect = 0;
    let skyW = 2;
    let skyH = 2;
    let skyFloat = false;
    let lost = false;

    function program(vs, fs) {
      const p = gl.createProgram();
      for (const [type, src] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) port.postMessage({ t: 'log', text: gl.getShaderInfoLog(s) });
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) port.postMessage({ t: 'log', text: gl.getProgramInfoLog(p) });
      const i = gl.getUniformBlockIndex(p, 'F');
      if (i !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, i, 0);
      const o = { p };
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let k = 0; k < n; k++) {
        const name = gl.getActiveUniform(p, k).name;
        const loc = gl.getUniformLocation(p, name);
        if (loc) o[name] = loc;
      }
      return o;
    }

    function texture(unit, wrap, min, upload) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      upload();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }

    function buffer(type, data, usage) {
      const b = gl.createBuffer();
      gl.bindBuffer(type, b);
      gl.bufferData(type, data, usage);
      return b;
    }

    // attrs: [location, size, stride, offset, divisor]
    function vao(buf, attrs, quad, elements) {
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      if (quad) {
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      if (buf) gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [loc, size, stride, off, div] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
        gl.vertexAttribDivisor(loc, div);
      }
      if (elements) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
      return v;
    }

    function setup() {
      skyFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
      P = {
        sky: program(FULL_VS, SKY_FS),
        blit: program(FULL_VS, BLIT_FS),
        limb: program(LIMB_VS, LIMB_FS),
        leaf: program(LEAF_VS, LEAF_FS),
        rain: program(RAIN_VS, RAIN_FS),
        splash: program(SPLASH_VS, SPLASH_FS),
        sprite: program(SPRITE_VS, SPRITE_FS),
      };
      for (const [p, n, unit] of [
        [P.sky, 'uN', 1],
        [P.sky, 'uR', 2],
        [P.rain, 'uN', 1],
        [P.splash, 'uN', 1],
        [P.blit, 'uImg', 0],
      ]) {
        gl.useProgram(p.p);
        gl.uniform1i(p[n], unit);
      }
      const ubo = buffer(gl.UNIFORM_BUFFER, F.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
      texture(1, gl.REPEAT, gl.LINEAR_MIPMAP_LINEAR, () => {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
        gl.generateMipmap(gl.TEXTURE_2D);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      });
      const quad = buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const empty = gl.createVertexArray();
      const leafAttrs = [
        [1, 4, 52, 0, 1],
        [2, 4, 52, 16, 1],
        [3, 4, 52, 32, 1],
        [4, 1, 52, 48, 1],
      ];
      const sprites = buffer(gl.ARRAY_BUFFER, SP.byteLength, gl.DYNAMIC_DRAW);
      P.empty = empty;
      P.quad = vao(null, [], quad);
      P.wood = vao(
        buffer(gl.ARRAY_BUFFER, tree.wood, gl.STATIC_DRAW),
        [
          [0, 4, 44, 0, 0],
          [1, 4, 44, 16, 0],
          [2, 3, 44, 32, 0],
        ],
        null,
        buffer(gl.ELEMENT_ARRAY_BUFFER, tree.index, gl.STATIC_DRAW),
      );
      P.back = vao(buffer(gl.ARRAY_BUFFER, tree.back, gl.STATIC_DRAW), leafAttrs, quad);
      P.front = vao(buffer(gl.ARRAY_BUFFER, tree.front, gl.STATIC_DRAW), leafAttrs, quad);
      P.sprites = vao(
        sprites,
        [
          [1, 4, 48, 0, 1],
          [2, 4, 48, 16, 1],
          [3, 4, 48, 32, 1],
        ],
        quad,
      );
      P.spriteBuf = sprites;
      gl.bindVertexArray(null);

      // A tiny copy of the sky is read back now and then to choose the text colour.
      const fbo = gl.createFramebuffer();
      const t = texture(3, gl.CLAMP_TO_EDGE, gl.NEAREST, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 32, 18, 0, gl.RGBA, gl.UNSIGNED_BYTE, null));
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      tiny = { fbo, pbo: buffer(gl.PIXEL_PACK_BUFFER, 32 * 18 * 4, gl.STREAM_READ), sync: null, px: new Uint8Array(32 * 18 * 4) };
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      skyTex = null;
      aspect = 0;
      sized();
    }

    function sized() {
      if (!gl) return;
      if (cv.width !== W) cv.width = W;
      if (cv.height !== H) cv.height = H;
      const w = Math.min(1500, Math.round(W * 0.74));
      const h = Math.max(2, Math.round((w * H) / W));
      if (w !== skyW || h !== skyH || !skyTex) {
        skyW = w;
        skyH = h;
        if (skyTex) gl.deleteTexture(skyTex);
        if (skyFbo) gl.deleteFramebuffer(skyFbo);
        skyTex = texture(0, gl.CLAMP_TO_EDGE, gl.LINEAR, () => {
          if (skyFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
          else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        });
        skyFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      const ra = W / H;
      if (Math.abs(ra - aspect) > 0.01) {
        aspect = ra;
        if (ridgeTex) gl.deleteTexture(ridgeTex);
        const data = bakeRidges(aspect);
        ridgeTex = texture(2, gl.CLAMP_TO_EDGE, gl.LINEAR, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1024, 1, 0, gl.RGBA, gl.FLOAT, data));
      }
    }

    /* ----------------------------------------------------- the moving scene */

    // 0-11 sky colours, 12-14 fog colour, 15-17 sun, 18-20 moon, 21 lit, 22 waxing,
    // 23 night, 24 warm, 25 moonlight, 26 cloud, 27 rain, 28 storm, 29 wind, 30 fog,
    // 31 tornado, 32-33 text column, 34 white text, 35 rainbow, 36 sun elevation,
    // 37 how far the dark rain cloud has come in, 38 where the open sky ends on the right.
    const N = 39;
    const S = new Float64Array(N);
    const G = new Float64Array(N);
    let tau = 8;
    let stage = 40;
    let have = false;
    let T = 0;
    let fall = 0;
    let drift = 0;
    let gustAt = 0;
    let bend = 0;
    let bendV = 0;
    let slant = 0.1;
    const ph = [0, 2, 4];
    let swayAmp = 0;
    let squall = 0;
    let wetFor = 0;
    let sinceRain = 1e9;
    let nextSquall = 3;
    const gone = new Float32Array(12);
    const pieces = [];
    let rootX = -1;
    let flash = 0;
    let flashAt = 9;
    let flashX = 0.5;
    let nextFlash = 3;
    let bolts = [];
    let flock = null;
    let nextFlock = 6;
    let shoot = null;
    let nextShoot = 12;
    const fallen = [];
    const drips = Array.from({ length: 40 }, () => ({ x: 0, y: -1, v: 0 }));
    const flies = Array.from({ length: 24 }, () => ({ x: rand(), y: rr(0.06, 0.3), ph: rr(0, 6), f: rr(0.5, 1.4), d: rr(14, 40) }));
    const perch = tree.tips
      .filter((t) => t.y > 0.5)
      .sort((a, b) => a.x - b.x)
      .slice(0, 40)
      .filter((_, i) => i % 11 === 0)
      .map((tip) => ({ tip, state: 'sit', x: 0, y: 0, vx: 0, vy: 0, next: rr(14, 60), ph: rr(0, 6) }));

    function swayAt(t) {
      const u = Math.max(t.y, 0);
      const wave = t.x * 1.7;
      const s = t.s;
      const dx = -bend * u * u + swayAmp * (s[0] * Math.sin(ph[0] + s[1] + wave) + s[2] * 0.55 * Math.sin(ph[1] + s[3] + wave));
      const dy = -Math.abs(bend) * u * u * 0.18 + swayAmp * (s[0] * 0.4 * Math.sin(ph[1] + s[1] * 1.7 + wave) + s[2] * 0.4 * Math.cos(ph[0] + s[3]));
      return [F[14 * 4] + (t.x + dx) * F[14 * 4 + 2], F[14 * 4 + 1] + (t.y + dy) * F[14 * 4 + 2]];
    }

    function seg(x0, y0, x1, y1, w, soft, add, c, a) {
      if (spN >= MAX_SPRITES) return;
      const i = spN++ * 12;
      SP[i] = x0;
      SP[i + 1] = y0;
      SP[i + 2] = x1;
      SP[i + 3] = y1;
      SP[i + 4] = w;
      SP[i + 5] = soft;
      SP[i + 6] = add;
      SP[i + 8] = c[0];
      SP[i + 9] = c[1];
      SP[i + 10] = c[2];
      SP[i + 11] = a;
    }

    function bird(x, y, size, flap, c) {
      const up = flap * size;
      const w = 0.75 * dpr;
      for (const dir of [-1, 1]) {
        const mx = x + dir * size * 0.5;
        const my = y + size * 0.2 + up * 0.35;
        seg(x, y, mx, my, w, 0, 0, c, 1);
        seg(mx, my, x + dir * size, y + up, w * 0.7, 0, 0, c, 1);
      }
    }

    function snap() {
      const whole = [];
      tree.groups.forEach((g, i) => gone[i] === 0 && whole.push(i));
      if (!whole.length || pieces.length > 3) return;
      const i = whole[Math.floor(rand() * whole.length)];
      const g = tree.groups[i];
      const [x, y] = swayAt(g);
      gone[i] = 1;
      pieces.push({ g, x, y, vx: -rr(200, 420) * dpr, vy: rr(90, 280) * dpr, a: 0, spin: rr(-3.4, 3.4) });
    }

    function life(dt) {
      const night = S[23];
      const rain = S[27];
      const wind = S[29];
      const c = [0.07, 0.09, 0.13];
      const calm = wind < 0.45 && rain < 0.1 && night < 0.5;

      for (const b of perch) {
        const [hx, hy0] = swayAt(b.tip);
        const hy = hy0 + 7 * dpr;
        if (b.state === 'sit') {
          b.next -= dt;
          if (!calm || b.next <= 0) {
            b.state = 'away';
            b.x = hx;
            b.y = hy;
            b.vx = -rr(60, 110) * dpr;
            b.vy = rr(50, 90) * dpr;
          } else {
            seg(hx - 2.4 * dpr, hy - 0.6 * dpr, hx + 1.6 * dpr, hy + 0.6 * dpr, 1.9 * dpr, 0, 0, c, 1);
            seg(hx + 2.6 * dpr, hy + 2.2 * dpr, hx + 2.6 * dpr, hy + 2.2 * dpr, 1.3 * dpr, 0, 0, c, 1);
            seg(hx - 2.4 * dpr, hy - 0.6 * dpr, hx - 6 * dpr, hy - 2.4 * dpr, 0.7 * dpr, 0, 0, c, 1);
            continue;
          }
        }
        if (b.state === 'away') {
          b.vx *= 1 + dt * 0.5;
          b.vy *= 1 - dt * 0.4;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          bird(b.x, b.y, 7 * dpr, Math.sin(T * 16 + b.ph) * 0.7, c);
          if (b.x < -30 || b.y > H + 30) {
            b.state = 'gone';
            b.next = rr(30, 80);
          }
        } else if (b.state === 'gone') {
          b.next -= dt;
          if (b.next <= 0 && calm) {
            b.state = 'back';
            b.x = W + 30;
            b.y = rr(0.7, 0.95) * H;
          }
        } else if (b.state === 'back') {
          const dx = hx - b.x;
          const dy = hy - b.y;
          const d = Math.hypot(dx, dy);
          b.x += (dx / (d + 1)) * 90 * dpr * dt;
          b.y += (dy / (d + 1)) * 90 * dpr * dt;
          bird(b.x, b.y, 7 * dpr, Math.sin(T * 16 + b.ph) * 0.7, c);
          if (d < 6 * dpr) {
            b.state = 'sit';
            b.next = rr(20, 90);
          }
        }
      }

      if (calm) {
        nextFlock -= dt;
        if (!flock && nextFlock <= 0) {
          const n = 5 + Math.floor(rand() * 7);
          flock = { x: W + 40 * dpr, y: rr(0.58, 0.92) * H, v: rr(44, 74) * dpr, birds: Array.from({ length: n }, (_, i) => ({ dx: i * rr(16, 24) * dpr, dy: (i % 2 ? 1 : -1) * i * rr(6, 10) * dpr, ph: rr(0, 6) })) };
        }
      }
      if (flock) {
        if (!calm) {
          flock.v = Math.min(flock.v + 240 * dpr * dt, 460 * dpr);
          flock.y += 60 * dpr * dt;
        }
        flock.x -= flock.v * dt;
        for (const b of flock.birds) bird(flock.x + b.dx, flock.y + b.dy + Math.sin(T * 1.3 + b.ph) * 3 * dpr, 7 * dpr, Math.sin(T * 9 + b.ph) * 0.55, c);
        if (flock.x < -280 * dpr) {
          flock = null;
          nextFlock = S[24] > 0.2 ? rr(6, 16) : rr(16, 46);
        }
      }

      if (night > 0.4 && rain < 0.1) {
        for (const f of flies) {
          const a = Math.max(0, Math.sin(T * f.f + f.ph));
          if (a < 0.05) continue;
          const x = f.x * W + Math.sin(T * 0.4 + f.ph) * f.d * dpr;
          const y = f.y * H + Math.cos(T * 0.3 + f.ph) * f.d * 0.5 * dpr;
          seg(x, y, x, y, 7 * dpr, 1, 1, [0.86, 1, 0.44], a * night);
        }
      }

      if (night > 0.6 && S[26] < 0.6) {
        nextShoot -= dt;
        if (!shoot && nextShoot <= 0) shoot = { x: rr(0.35, 1) * W, y: rr(0.7, 1) * H, vx: -rr(380, 560) * dpr, vy: -rr(130, 220) * dpr, life: 0 };
        if (shoot) {
          shoot.life += dt;
          shoot.x += shoot.vx * dt;
          shoot.y += shoot.vy * dt;
          const a = clamp(1 - shoot.life / 0.9, 0, 1);
          for (let i = 0; i < 6; i++) {
            const k0 = i * 0.03;
            const k1 = (i + 1) * 0.03;
            seg(shoot.x - shoot.vx * k0, shoot.y - shoot.vy * k0, shoot.x - shoot.vx * k1, shoot.y - shoot.vy * k1, 1.1 * dpr * (1 - i * 0.12), 0, 1, [1, 1, 1], a * (1 - i / 6));
          }
          if (shoot.life > 0.9) {
            shoot = null;
            nextShoot = rr(10, 34);
          }
        }
      }

      // Leaves torn off by the wind, or the odd one falling on a calm day.
      const rate = wind * wind * wind * 26 * (1 + squall * 6) + 0.1;
      if (fallen.length < 34 && rand() < rate * dt) {
        const t = tree.tips[Math.floor(rand() * tree.tips.length)];
        const [x, y] = swayAt(t);
        fallen.push({ x, y, vx: -(14 + wind * 460) * rr(0.6, 1.3) * (1 + squall) * dpr, vy: rr(-50, 16 + squall * 200) * dpr, a: rr(0, 6), spin: rr(2, 9) });
      }
      const leaf = [F[17 * 4], F[17 * 4 + 1], F[17 * 4 + 2]];
      for (let i = fallen.length - 1; i >= 0; i--) {
        const f = fallen[i];
        f.x += (f.vx + Math.sin(T * 2 + f.a) * 20 * dpr) * dt;
        f.y += (f.vy - rain * 90 * dpr) * dt;
        f.a += f.spin * dt;
        const fast = Math.min(1, Math.abs(f.vx) / (420 * dpr));
        const ex = Math.cos(f.a) * 2.6 * dpr * (1 - fast) + f.vx * 0.016 * fast;
        const ey = Math.sin(f.a) * 1.3 * dpr * (1 - fast) + f.vy * 0.016 * fast;
        seg(f.x - ex, f.y - ey, f.x + ex, f.y + ey, (2 - fast) * dpr, 0, 0, leaf, 1 - fast * 0.35);
        if (f.x < -20 || f.y < -20) fallen.splice(i, 1);
      }

      // Branches torn off by the wind, carried away and falling.
      const wood = [F[20 * 4], F[20 * 4 + 1], F[20 * 4 + 2]];
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i];
        p.vx += (-(240 + wind * 700) * dpr - p.vx) * dt * 0.9;
        p.vy -= 430 * dpr * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.a += p.spin * dt;
        const co = Math.cos(p.a);
        const si = Math.sin(p.a);
        const k = F[14 * 4 + 2];
        const px = (x, y) => [p.x + (x * co - y * si) * k, p.y + (x * si + y * co) * k];
        for (const [x0, y0, x1, y1, w] of p.g.segs) {
          const [ax, ay] = px(x0, y0);
          const [bx, by] = px(x1, y1);
          seg(ax, ay, bx, by, Math.max(0.8 * dpr, w * k), 0, 0, wood, 1);
        }
        for (const [x, y] of p.g.dots) {
          const [ax, ay] = px(x, y);
          seg(ax - 2.4 * dpr, ay, ax + 2.4 * dpr, ay + 1.2 * dpr, 2.4 * dpr, 0, 0, leaf, 1);
        }
        if (p.x < -320 * dpr || p.y < -320 * dpr) pieces.splice(i, 1);
      }

      // Water gathering on the leaves and dripping off them.
      if (rain > 0.08) {
        const rc = [F[22 * 4], F[22 * 4 + 1], F[22 * 4 + 2]];
        for (const d of drips) {
          if (d.y < 0) {
            if (rand() < rain * 3.2 * dt) {
              const [x, y] = swayAt(tree.tips[Math.floor(rand() * tree.tips.length)]);
              d.x = x;
              d.y = y - 10 * dpr;
              d.v = 40 * dpr;
            }
            continue;
          }
          d.v += 900 * dpr * dt;
          d.y -= d.v * dt;
          d.x -= wind * 90 * dpr * dt;
          seg(d.x, d.y, d.x + wind * 2 * dpr, d.y + Math.min(14 * dpr, d.v * 0.012), 0.8 * dpr, 0, 0.5, rc, 0.4);
        }
      }

      // A storm flashes inside the cloud; only some strokes reach the ground.
      if (S[28] > 0.3) {
        nextFlash -= dt;
        if (nextFlash <= 0) {
          nextFlash = rr(2.5, 9) / S[28];
          flashAt = 0;
          flashX = rr(0.12, 0.8);
          bolts = [];
          if (rand() < 0.42) {
            const fork = (x, y, n, step, w, drift) => {
              const path = [[x, y]];
              for (let i = 0; i < n; i++) {
                x += (rr(-1, 1) * rr(0.2, 1) + drift) * step * 0.8;
                y -= step * rr(0.7, 1.3);
                path.push([x, y]);
                if (w > 0.8 * dpr && i > 2 && rand() < 0.1) fork(x, y, Math.ceil((n - i) * 0.55), step * 0.8, w * 0.5, rand() < 0.5 ? -0.8 : 0.8);
              }
              bolts.push({ path, w });
            };
            const top = H * (0.5 + rand() * 0.06);
            fork(flashX * W, top, 26, (top - H * 0.17) / 26, 1.1 * dpr, rr(-0.2, 0.2));
          }
        }
      }
      flashAt += dt;
      flash = Math.max(Math.exp(-flashAt * 14), flashAt > 0.1 ? 0.7 * Math.exp(-(flashAt - 0.1) * 12) : 0, flashAt > 0.22 ? 0.45 * Math.exp(-(flashAt - 0.22) * 9) : 0);
      if (flash < 0.01) flash = 0;
      if (flash > 0.3) {
        const a = Math.min(1, flash * 1.3);
        for (const b of bolts) {
          for (let i = 1; i < b.path.length; i++) {
            const [x0, y0] = b.path[i - 1];
            const [x1, y1] = b.path[i];
            seg(x0, y0, x1, y1, b.w * 9, 1, 1, [0.55, 0.65, 1], a * 0.22);
            seg(x0, y0, x1, y1, b.w, 0, 1, [0.9, 0.93, 1], a * 0.9);
          }
        }
      }
    }

    const toward = (i, goal, rate) => {
      const d = goal - S[i];
      S[i] += Math.abs(d) <= rate ? d : Math.sign(d) * rate;
    };

    // Weather never changes all at once. A storm brings its dark cloud first, then the
    // wind, then thunder, and only then rain; afterwards the rain stops first, the wind
    // drops, and the sky clears last.
    function weather(dt) {
      const r = dt / stage;
      const wetGoal = Math.max(G[27], G[28]);
      const gatherGoal = wetGoal > 0.01 ? Math.min(1, wetGoal * 1.3 + 0.06) : 0;
      const dry = S[27] < 0.03 && S[28] < 0.06;
      if (G[26] > S[26] || dry) toward(26, G[26], r);
      if (gatherGoal > S[37] || dry) toward(37, gatherGoal, r);
      const dark = S[37] >= gatherGoal - 0.08 && S[26] >= G[26] - 0.1;
      // Just ahead of heavy rain comes a gust front.
      const front = wetGoal > 0.4 && S[27] < G[27] - 0.1 ? Math.min(0.72, G[29] + 0.28) : G[29];
      if (front > S[29] ? dark : S[27] <= G[27] + 0.05) toward(29, front, r * 1.3);
      const blowing = S[29] >= front - 0.1;
      if (G[28] > S[28] ? dark && blowing : S[27] <= G[27] + 0.05) toward(28, G[28], r * 1.2);
      if (G[27] <= S[27] || (dark && blowing && S[28] >= G[28] - 0.15)) toward(27, G[27], r);
      toward(30, G[30], r);
      toward(31, S[28] > 0.6 ? G[31] : 0, r);
      // A rainbow needs rain that really fell, for a while, and not too long ago; it
      // waits until that rain is over and the cloud has opened.
      wetFor = S[27] > 0.15 ? wetFor + dt : 0;
      sinceRain = wetFor > 6 ? 0 : sinceRain + dt;
      toward(35, sinceRain < 1200 && S[27] < 0.03 && S[37] < 0.55 ? G[35] : 0, dt / 6);
    }

    function update(dt) {
      if (tau < 8) tau = Math.min(8, tau + dt * 0.6);
      if (stage < 40) stage = Math.min(40, stage + dt * 0.5);
      const k = 1 - Math.exp(-dt / tau);
      for (let i = 0; i < 26; i++) S[i] += (G[i] - S[i]) * k;
      for (let i = 32; i < 34; i++) S[i] += (G[i] - S[i]) * k;
      S[36] += (G[36] - S[36]) * k;
      S[38] += (G[38] - S[38]) * Math.min(1, dt * 1.5);
      S[34] += (G[34] - S[34]) * Math.min(1, dt * 3);
      weather(dt);
      const night = S[23];
      const warm = S[24];
      const moonlight = S[25];
      const cloud = S[26];
      const rain = S[27];
      const storm = S[28];
      const wind = S[29];
      const fog = S[30];

      T = (T + dt) % 86400;
      gustAt += dt * (0.7 + wind * 0.9);
      const gust = (Math.sin(gustAt) + Math.sin(gustAt * 2.3 + 1) * 0.6 + Math.sin(gustAt * 0.37 + 2) * 0.8) / 2.4;
      // A strong wind blows in squalls: a hard shove, then it eases off.
      if (wind > 0.5) {
        nextSquall -= dt;
        if (nextSquall <= 0) {
          nextSquall = rr(2.5, 6.5) * (1.6 - wind);
          squall = rr(0.65, 1);
          if (wind > 0.68 && storm > 0.3 && rand() < 0.6) snap();
        }
      }
      squall *= Math.exp(-dt * 1.5);
      const goal = Math.pow(wind, 1.3) * 0.3 + (0.01 + wind * 0.13) * gust + squall * wind * 0.24;
      bendV += ((goal - bend) * 9 - bendV * 2.6) * dt;
      bend += bendV * dt;
      for (let i = 0; i < 12; i++) if (gone[i] > 0 && wind < 0.35) gone[i] = Math.max(0, gone[i] - dt / 9);
      ph[0] = (ph[0] + dt * (1.1 + 3.6 * wind + 4 * squall)) % 6.2831853;
      ph[1] = (ph[1] + dt * (1.6 + 5 * wind + 5 * squall)) % 6.2831853;
      ph[2] = (ph[2] + dt * (2.2 + 11 * wind + 7 * rain)) % 6.2831853;
      swayAmp = (0.012 + 0.058 * wind) * (1 + 0.5 * gust * gust + squall * 0.9);
      slant += (0.09 + wind * 0.8 + gust * wind * 0.22 + squall * wind * 1.1 - slant) * Math.min(1, dt * 2.5);
      const fine = 1 - smooth(0.1, 0.42, rain);
      fall = (fall + dt * (1.75 + (0.5 - 1.75) * fine) * (1 + wind * 0.25)) % 4096;
      drift += dt * (0.008 + 0.06 * wind + 0.03 * storm + S[37] * 0.012);
      const heavy = smooth(0.2, 0.7, rain);
      const light = 1 - smooth(0.12, 0.36, rain);
      const cover = Math.max(heavy, light) * 0.62;
      const dk = clamp(Math.max(S[37], (cloud - 0.82) * 1.6), 0, 1);

      // A side pane covers the sky behind it, so the tree only counts the open part.
      const room = W * Math.max(0, S[38] - S[33]);
      const scale = clamp(room * 2.5, H * 0.58, H * 0.97);
      const reach = -tree.left * scale;
      const rx = Math.min(Math.max(W * 0.9, S[33] * W + reach + 14 * dpr), W + 0.02 * scale);
      rootX = rootX < 0 ? rx : rootX + (rx - rootX) * Math.min(1, dt * 1.6);

      const sunK = S[17] * clamp(1 - cloud * 0.9, 0.06, 1) * (1 - rain * 0.85) * (1 - fog * 0.6);
      const moonK = S[20] * (0.4 + 0.6 * night) * (1 - cloud * 0.85);
      put(0, W, H, dpr, 0);
      put(1, T, fall, flash, flashX);
      put(2, drift, 0, cover, smooth(0.7, 0.97, cloud));
      put(3, cloud, rain, storm, wind);
      put(4, fog, S[31], dk, fine);
      put(5, night, warm, moonlight, S[21]);
      put(6, S[15], S[16], sunK, S[22]);
      put(7, S[18], S[19], moonK, S[34]);
      for (let i = 0; i < 4; i++) put(8 + i, S[i * 3] / 255, S[i * 3 + 1] / 255, S[i * 3 + 2] / 255, 1);
      put(12, S[12] / 255, S[13] / 255, S[14] / 255, 1);
      put(13, S[32], S[33], 0.13, 0);
      put(14, rootX, -0.02 * H, scale, bend);
      put(15, ph[0], ph[1], ph[2], swayAmp);

      const gloom = 1 - 0.34 * smooth(0.2, 0.45, Math.max(rain, storm, S[37] * 0.7)) - 0.2 * storm;
      const dim = mixc([gloom, gloom, gloom], [0.2 + 0.3 * moonlight, 0.24 + 0.34 * moonlight, 0.33 + 0.46 * moonlight], night);
      const fogc = [S[12], S[13], S[14]];
      const tone = (c) => {
        const warmed = mixc(c, [c[0] * 1.5 + 30, c[1] * 1.02, c[2] * 0.7], warm * 0.7);
        const wet = [warmed[0] * dim[0] * (1 - 0.3 * rain), warmed[1] * dim[1] * (1 - 0.24 * rain), warmed[2] * dim[2] * (1 - 0.2 * rain)];
        return mixc(mixc(wet, fogc, fog * 0.45), [120, 132, 142], rain * 0.22 * (1 - night));
      };
      putc(16, tone([24, 50, 34]));
      putc(17, tone([48, 96, 50]));
      putc(18, tone([118, 168, 78]));
      putc(19, tone([30, 24, 22]));
      putc(20, tone([96, 76, 60]));
      const cx = rootX + tree.cx * scale;
      const cy = -0.02 * H + tree.cy * scale;
      const sx = sunK > moonK ? S[15] * W : S[18] * W;
      const sy = sunK > moonK ? S[16] * H : S[19] * H;
      const l = Math.hypot(sx - cx, sy - cy) || 1;
      put(21, (sx - cx) / l, (sy - cy) / l, 0.08 + 0.8 * Math.max(sunK, moonK * 0.7), rain);
      const lum = 0.34 + 0.42 * (1 - night) * (1 - storm * 0.3) + flash * 0.5;
      const rc = mixc([lum * 0.9, lum * 0.95, lum * 1.05], [1, 1, 1], flash * 0.5);
      put(22, rc[0], rc[1], rc[2], slant);
      put(23, clamp(1 - S[15], 0.22, 0.78), 0.16 - S[36] * 0.012, 0.66, S[35]);
      F.set(gone, 24 * 4);
    }

    let frameNo = 0;
    function drawSky(raw, target, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, w, h);
      gl.useProgram(P.sky.p);
      gl.uniform2f(P.sky.uS, w, h);
      gl.uniform1f(P.sky.uRaw, raw);
      gl.bindVertexArray(P.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function draw() {
      const rain = S[27];
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, F);
      if (frameNo % skyEvery === 0) drawSky(0, skyFbo, skyW, skyH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(P.blit.p);
      gl.bindVertexArray(P.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.BLEND);
      gl.useProgram(P.leaf.p);
      gl.bindVertexArray(P.back);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, tree.nBack);
      gl.useProgram(P.limb.p);
      gl.bindVertexArray(P.wood);
      gl.drawElements(gl.TRIANGLES, tree.index.length, gl.UNSIGNED_SHORT, 0);
      gl.useProgram(P.leaf.p);
      gl.bindVertexArray(P.front);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, tree.nFront);
      if (rain > 0.005) {
        const n = Math.round(clamp((W * H) / (dpr * dpr) / 300, 800, 4200) * Math.min(1, 0.16 + rain * 0.95));
        gl.bindVertexArray(P.quad);
        gl.useProgram(P.rain.p);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        if (rain > 0.3) {
          gl.useProgram(P.splash.p);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.round(rain * 170));
        }
      }
      if (spN) {
        gl.bindBuffer(gl.ARRAY_BUFFER, P.spriteBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, SP.subarray(0, spN * 12));
        gl.useProgram(P.sprite.p);
        gl.bindVertexArray(P.sprites);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spN);
      }
      gl.disable(gl.BLEND);
    }

    // How bright the sky really is behind the text, without the easing done for it.
    let readAt = 0;
    function measure(now) {
      if (tiny.sync) {
        const s = gl.clientWaitSync(tiny.sync, 0, 0);
        if (s !== gl.ALREADY_SIGNALED && s !== gl.CONDITION_SATISFIED) return;
        gl.deleteSync(tiny.sync);
        tiny.sync = null;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, tiny.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, tiny.px);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const x0 = clamp(Math.floor(S[32] * 32), 0, 31);
        const x1 = clamp(Math.ceil(S[33] * 32), x0 + 1, 32);
        let white = 0;
        let black = 0;
        let n = 0;
        for (let y = 3; y < 18; y++) {
          for (let x = x0; x < x1; x++) {
            const i = 4 * (y * 32 + x);
            const lin = (v) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            };
            const Y = 0.2126 * lin(tiny.px[i]) + 0.7152 * lin(tiny.px[i + 1]) + 0.0722 * lin(tiny.px[i + 2]);
            // Contrast either text colour would get here; white gets help from the easing.
            white += Math.min(4.5, 1.05 / (Math.min(Y, 0.3) + 0.05));
            black += Math.min(4.5, (Y + 0.05) / 0.06);
            n++;
          }
        }
        port.postMessage({ t: 'lum', white: white / n, black: black / n });
        return;
      }
      if (now < readAt) return;
      readAt = now + (stage < 10 ? 900 : 4000);
      const flashWas = F[6];
      F[6] = 0;
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, F);
      drawSky(1, tiny.fbo, 32, 18);
      F[6] = flashWas;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, tiny.pbo);
      gl.readPixels(0, 0, 32, 18, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      tiny.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function advance(dt) {
      spN = 0;
      update(dt);
      life(dt);
    }

    let raf = 0;
    let running = false;
    let last = 0;
    let waited = 0;
    let cap = 60;
    let skyEvery = 2;
    let frames = 0;
    let busy = 0;

    function frame(now) {
      raf = 0;
      if (!running || lost) return;
      raf = requestAnimationFrame(frame);
      const gap = last ? now - last : 16;
      last = now;
      waited += gap;
      if (waited < 1000 / cap - 4) return;
      const dt = Math.min(0.05, waited / 1000);
      waited = 0;
      const t0 = performance.now();
      advance(dt);
      frameNo++;
      draw();
      measure(now);
      frames++;
      busy += performance.now() - t0;
    }

    function setRunning(on) {
      running = on;
      last = 0;
      if (on && !raf && gl && !lost) raf = requestAnimationFrame(frame);
    }

    function once() {
      if (!gl || lost || !have) return;
      advance(1 / 60);
      frameNo = 0;
      draw();
      measure(performance.now());
    }

    function gpuTime() {
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < 10; i++) {
        frameNo = i;
        draw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / 10;
    }

    port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'init') {
        cv = m.canvas;
        W = m.w;
        H = m.h;
        dpr = m.dpr;
        cv.addEventListener('webglcontextlost', (ev) => {
          ev.preventDefault();
          lost = true;
        });
        cv.addEventListener('webglcontextrestored', () => {
          lost = false;
          setup();
          setRunning(running);
        });
        gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
        if (!gl) {
          port.postMessage({ t: 'fail' });
          return;
        }
        setup();
      } else if (m.t === 'size') {
        W = m.w;
        H = m.h;
        dpr = m.dpr;
        sized();
        if (!running) once();
      } else if (m.t === 'sky') {
        G.set(m.v);
        G[38] = m.free == null ? 1 : m.free;
        tau = m.tau || tau;
        if (m.wt) stage = m.wt;
        if (!have) {
          S.set(m.v);
          S[38] = G[38];
          S[37] = Math.max(S[27], S[28]) > 0.01 ? Math.min(1, Math.max(S[27], S[28]) * 1.3 + 0.06) : 0;
          have = true;
          update(0.001);
          slant = 0.09 + S[29] * 0.8;
          bend = Math.pow(S[29], 1.4) * 0.27;
        }
        if (!running) once();
      } else if (m.t === 'dry') {
        sinceRain = 1e9;
        wetFor = 0;
      } else if (m.t === 'run') {
        setRunning(m.on);
      } else if (m.t === 'cap') {
        cap = m.fps;
        skyEvery = m.fps > 40 ? 2 : 1;
      } else if (m.t === 'step') {
        // Fast-forward without drawing; used to look at a scene straight away.
        for (let i = 0; i < m.n; i++) advance(1 / 60);
        frameNo = 0;
        draw();
        measure(performance.now());
        port.postMessage({ t: 'stepped', id: m.id });
      } else if (m.t === 'thumb') {
        if (!gl || lost) return port.postMessage({ t: 'thumb', id: m.id });
        const fbo = gl.createFramebuffer();
        const tex = texture(4, gl.CLAMP_TO_EDGE, gl.NEAREST, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null));
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, F);
        drawSky(1, fbo, m.w, m.h);
        const px = new Uint8Array(m.w * m.h * 4);
        gl.readPixels(0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        port.postMessage({ t: 'thumb', id: m.id, px }, [px.buffer]);
      } else if (m.t === 'stats') {
        port.postMessage({ t: 'stats', id: m.id, fps: frames, cpuMs: frames ? busy / frames : 0, gpuMs: m.gpu && gl && !lost ? gpuTime() : undefined, worker: typeof document === 'undefined', leaves: tree.nBack + tree.nFront, limbs: tree.index.length / 6, res: [W, H, skyW, skyH], float: skyFloat });
        frames = 0;
        busy = 0;
      }
    };
    port.postMessage({ t: 'ready' });
  }

  /* --------------------------------------------- talking to that thread */

  let skyPort = null;
  let skyCanvas = null;
  let skyG = null;
  let skyTick = 0;
  let skyAsk = 0;
  const skyWait = new Map();

  let skyThumb = null;

  function skyPreview(cv) {
    skyCall({ t: 'thumb', w: 288, h: 180 }).then((m) => {
      if (!m || !m.px) return;
      const c = cv.getContext('2d');
      cv.width = 288;
      cv.height = 180;
      const img = c.createImageData(288, 180);
      for (let y = 0; y < 180; y++) img.data.set(m.px.subarray((179 - y) * 1152, (180 - y) * 1152), y * 1152);
      c.putImageData(img, 0, 0);
    });
  }

  function skySize() {
    const w = innerWidth;
    const h = innerHeight;
    const dpr = clamp(Math.min(devicePixelRatio || 1, 2, Math.sqrt(6e6 / (w * h))), 1, 2);
    return { w: Math.round(w * dpr), h: Math.round(h * dpr), dpr };
  }

  // The text column follows the prompt box; without one, the middle of the window.
  function skyColumn() {
    const b = promptBox();
    if (!b) return [0.26, 0.74];
    return [clamp((b.left - 12) / innerWidth, 0, 1), clamp((b.right + 12) / innerWidth, 0, 1)];
  }

  // The open sky ends where a side pane on the right begins.
  function skyFree() {
    let x = innerWidth;
    for (const p of document.querySelectorAll('[data-pane-root]')) {
      const b = p.getBoundingClientRect();
      if (b.width > 0 && b.right > innerWidth - 40) x = Math.min(x, b.left);
    }
    return clamp(x / innerWidth, 0, 1);
  }

  // The sun out and not too high, and enough open sky for it to shine through.
  // Whether it has just rained, the engine knows: it is the one that showed the rain.
  function skyBow(st) {
    const sun = clamp((st.sun.el - 2) / 4, 0, 1) * clamp((38 - st.sun.el) / 5, 0, 1);
    return sun * clamp((0.92 - skyWx.cloud) / 0.2, 0, 1);
  }

  function skyPush(tau, wt) {
    if (!skyPort) return;
    const st = skyState();
    if (world && world.th && world.th.engine) world.s.st = st;
    const hy = 0.84;
    const up = (el) => 1 - (hy - sind(el) * hy * 0.9);
    const rise = (el) => clamp((el + 5) / 4, 0, 1);
    const w = skyWx;
    const [x0, x1] = skyColumn();
    skyPort.postMessage({
      t: 'sky',
      tau,
      wt,
      free: skyFree(),
      v: [...st.c.flat(), ...st.fogCol, skyX(st.dayP, 1), up(st.sun.el), rise(st.sun.el), skyX(st.moonP, 1), up(st.moon.el), rise(st.moon.el), st.lit, st.waxing ? 1 : -1, st.night, st.warm, st.moonlight, w.cloud, w.rain, w.storm, w.wind, w.fog, w.tornado, x0, x1, skyNight ? 1 : 0, skyBow(st), st.sun.el],
    });
  }

  function skyListen(e) {
    const m = e.data;
    if (m.t === 'lum') {
      skyG = m;
      const was = skyNight;
      skyMode();
      if (was !== skyNight) skyPush();
    } else if (m.t === 'log') {
      console.error('[troi]', m.text);
    } else if (m.t === 'fail') {
      // No WebGL2 here: the drawn sky stands in, now and whenever this one is picked again.
      skyFailed = true;
      setTimeout(() => applyTheme('troi'), 0);
    } else if (skyWait.has(m.id)) {
      skyWait.get(m.id)(m);
      skyWait.delete(m.id);
    }
  }

  function skyCall(msg) {
    return new Promise((done) => {
      if (!skyPort) return done(null);
      skyAsk += 1;
      skyWait.set(skyAsk, done);
      skyPort.postMessage({ ...msg, id: skyAsk });
    });
  }

  function skyBegin(port, canvasForEngine, transfer) {
    skyPort = port;
    port.postMessage({ t: 'init', canvas: canvasForEngine, ...skySize() }, transfer);
    port.postMessage({ t: 'cap', fps: 60 });
    skyPush(0.5);
    skyRun();
  }

  function skyStart() {
    if (skyCanvas) {
      if (!skyCanvas.isConnected) root.appendChild(skyCanvas);
      return;
    }
    skyCanvas = document.createElement('canvas');
    skyCanvas.setAttribute('data-pxt-ui', 'sky');
    skyCanvas.setAttribute('aria-hidden', 'true');
    root.appendChild(skyCanvas);

    let settled = false;
    const onPage = () => {
      if (settled) return;
      settled = true;
      const port = { onmessage: null, postMessage: (msg) => port.onmessage({ data: msg }) };
      const face = { postMessage: (msg) => skyListen({ data: msg }) };
      Object.defineProperty(face, 'onmessage', { set: (fn) => (port.onmessage = fn) });
      skyEngine(face);
      skyBegin(port, skyCanvas, []);
    };
    try {
      if (window.__pxtNoWorker || !skyCanvas.transferControlToOffscreen) throw new Error('page');
      const url = URL.createObjectURL(new Blob([`(${skyEngine})(self);`], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const late = setTimeout(onPage, 1500);
      worker.onerror = () => {
        clearTimeout(late);
        onPage();
      };
      worker.onmessage = (e) => {
        if (e.data.t !== 'ready' || settled) return;
        settled = true;
        clearTimeout(late);
        URL.revokeObjectURL(url);
        worker.onerror = null;
        worker.onmessage = skyListen;
        const off = skyCanvas.transferControlToOffscreen();
        skyBegin(worker, off, [off]);
      };
    } catch (e) {
      onPage();
    }
    addEventListener('resize', () => {
      clearTimeout(skySizeTimer);
      skySizeTimer = setTimeout(() => {
        if (skyPort) skyPort.postMessage({ t: 'size', ...skySize() });
        skyPush();
      }, 120);
    });
    addEventListener('focus', () => skyPort && skyPort.postMessage({ t: 'cap', fps: 60 }));
    addEventListener('blur', () => skyPort && skyPort.postMessage({ t: 'cap', fps: 30 }));
  }
  let skySizeTimer = 0;
  let skyFailed = false;

  // The page only tells the engine what is true now; it never draws.
  function skyRun() {
    const th = world && world.th;
    const on = !!(th && th.engine) && curId !== 'off';
    root.toggleAttribute('data-pxt-gl', on);
    if (!skyPort) return;
    skyPort.postMessage({ t: 'run', on: on && cfg.motion && !reduce.matches && !document.hidden });
    clearInterval(skyTick);
    skyTick = 0;
    if (on && !document.hidden) {
      skyTick = setInterval(() => {
        skyPush();
        skyMode();
      }, 2000);
    }
  }

  THEMES.push({
    id: 'troi3d',
    name: 'Bầu trời',
    sky: true,
    engine: true,
    fps: 60,
    veilScale: 0.01,
    get dark() {
      return skyAt(skyMs()).sun.el < -6;
    },
    alias: ['bau', 'bautroi', 'bau troi', 'that', 'webgl', '3d', 'gpu'],
    glyphs: '.',
    bg(c, w, h) {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
    },
    init(w) {
      const s = w.s;
      s.st = skyState();
      if (w !== world) {
        skyThumb = w.cv;
        return;
      }
      skyStart();
      skyPush(1, 6);
      if (!wxTimer) {
        wxTimer = setInterval(wxTick, 15 * 60e3);
        loadWeather();
      }
    },
    frame(w) {
      // Only the little preview in the picker comes here.
      const g = w.ctx.createLinearGradient(0, 0, 0, w.h);
      w.s.st.c.forEach((c, i) => g.addColorStop(i / 3, css(c)));
      w.ctx.fillStyle = g;
      w.ctx.fillRect(0, 0, w.w, w.h);
    },
  });

