// ==UserScript==
// @name         Claude Beautiful – live sky
// @name:vi      Claude Beautiful – bầu trời sống cho Claude
// @namespace    https://github.com/tuananh6614/claude_beautiful
// @version      2.0.0
// @description  A live WebGL sky over Hanoi behind Claude: real time, real weather.
// @description:vi Bầu trời Hà Nội sống phía sau khung chat Claude, theo giờ và thời tiết thật.
// @author       tuananh6614 (based on Pixel Chat Themes by aqua2409z)
// @license      MIT
// @homepageURL  https://github.com/tuananh6614/claude_beautiful
// @supportURL   https://github.com/tuananh6614/claude_beautiful/issues
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// @inject-into  content
// @noframes
// @updateURL    https://raw.githubusercontent.com/tuananh6614/claude_beautiful/main/honu/pixel-troi.user.js
// @downloadURL  https://raw.githubusercontent.com/tuananh6614/claude_beautiful/main/honu/pixel-troi.user.js
// ==/UserScript==

/*
 * How it works
 *  1. A full-screen <canvas> sits behind the page (z-index -1) and draws a scene
 *     as a grid of small tiles, each holding one ASCII glyph – the "pixel" look.
 *  2. A scanner finds the page's opaque backgrounds: large ones become
 *     transparent, smaller panels (sidebar, composer, bubbles, menus) become
 *     frosted glass. It only looks at computed styles, not class names, so it
 *     keeps working when claude.ai changes its markup.
 *  3. Typing /theme in the chat box (or the floating button, or Alt+T) opens a
 *     picker. Settings are kept in localStorage.
 *
 * No innerHTML and no inline <style> (CSSOM only), so it also works on pages
 * with a strict Content-Security-Policy / Trusted Types.
 */
(function () {
  'use strict';
  // A clear line in the console, so a run from DevTools shows it worked.
  const say = (text) => console.info('%c' + text, 'color:#2f8a58;font-weight:bold');
  if (window.__pixelThemes) {
    say('Pixel Themes đang chạy rồi. Bấm Alt+T (hoặc nút ô vuông màu ở cạnh phải) để chọn theme.');
    return;
  }

  /* ------------------------------------------------------------------ utils */

  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // Stable pseudo-random number in [0, 1) for integer coordinates.
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function vgrad(c, w, h, stops) {
    const g = c.createLinearGradient(0, 0, 0, h);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function rglow(c, x, y, r, hex, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a));
    g.addColorStop(1, rgba(hex, 0));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // A sprite is ASCII art: every non-space char is a key into a palette of
  // [tileColor, glyphColor, fixedGlyph?, alpha?].
  function sprite(rows, pal) {
    const w = Math.max(...rows.map((r) => r.length));
    return { rows: rows.map((r) => r.padEnd(w)), w, h: rows.length, pal };
  }

  const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

  /* ------------------------------------------------------------------ world */

  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  class World {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.tiles = new Map();
      this.glows = new Map();
      this.s = {};
      this.t = 0;
      this.veil = 0;
      this.veilColor = '#ffffff';
    }

    resize(w, h, cell, dpr) {
      this.w = w;
      this.h = h;
      this.cell = cell;
      this.dpr = dpr;
      this.cv.width = Math.max(1, Math.round(w * dpr));
      this.cv.height = Math.max(1, Math.round(h * dpr));
      this.cols = Math.ceil(w / cell);
      this.rows = Math.ceil(h / cell);
      this.glyphsOn = cell >= 8;
      this.tiles.clear();
      this.under = this.over = null;
    }

    setTheme(th) {
      this.th = th;
      this.s = {};
      this.t = 0;
      this.tiles.clear();
      this.under = this.over = null;
      th.init(this);
    }

    // Static parts of a scene are drawn once into an offscreen layer.
    layer(fn) {
      const c = document.createElement('canvas');
      c.width = this.cv.width;
      c.height = this.cv.height;
      const x = c.getContext('2d');
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const prev = this.ctx;
      this.ctx = x;
      try {
        fn(x);
      } finally {
        this.ctx = prev;
      }
      return c;
    }

    draw(dt) {
      const th = this.th;
      const ctx = this.ctx;
      if (!th) return;
      this.t += dt;
      if (!this.under) {
        this.under = this.layer((c) => {
          th.bg(c, this.w, this.h, this);
          if (th.under) th.under(this);
        });
      }
      if (th.over && !this.over) this.over = this.layer(() => th.over(this));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.under, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      th.frame(this, dt);
      if (this.over) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.over, 0, 0);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (this.veil > 0) {
        ctx.globalAlpha = this.veil;
        ctx.fillStyle = this.veilColor;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalAlpha = 1;
      }
    }

    // One tile = rounded square + glyph, rendered once and reused.
    img(bg, fg, ch) {
      const key = bg + '|' + fg + '|' + ch;
      let c = this.tiles.get(key);
      if (c) return c;
      if (this.tiles.size > 900) this.tiles.clear();
      const s = this.cell;
      const px = Math.max(1, Math.ceil(s * this.dpr));
      c = document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.scale(px / s, px / s);
      if (bg) {
        const gap = s > 6 ? Math.max(1, s * 0.09) : 0.5;
        const r = s > 6 ? s * 0.16 : 0;
        x.fillStyle = bg;
        if (r && x.roundRect) {
          x.beginPath();
          x.roundRect(gap / 2, gap / 2, s - gap, s - gap, r);
          x.fill();
        } else {
          x.fillRect(gap / 2, gap / 2, s - gap, s - gap);
        }
      }
      if (ch && fg && this.glyphsOn) {
        x.fillStyle = fg;
        x.font = `600 ${Math.round(s * 0.7)}px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(ch, s / 2, s / 2 + s * 0.05);
      } else if (ch && fg && !bg) {
        const d = Math.max(1, s * 0.4);
        x.fillStyle = fg;
        x.fillRect((s - d) / 2, (s - d) / 2, d, d);
      }
      this.tiles.set(key, c);
      return c;
    }

    tile(x, y, bg, fg, ch, a = 1) {
      x = Math.round(x);
      y = Math.round(y);
      if (a <= 0.01 || x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const ctx = this.ctx;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(this.img(bg, fg, ch), x * this.cell, y * this.cell, this.cell, this.cell);
      ctx.globalAlpha = 1;
    }

    glyph(x, y, ch, fg, a) {
      this.tile(x, y, null, fg, ch, a);
    }

    ch(i, j, seed) {
      const g = this.th.glyphs;
      return g[(hash(i, j, seed) * g.length) | 0];
    }

    sprite(sp, x, y, o = {}) {
      const X = Math.round(x);
      const Y = Math.round(y);
      const pal = o.pal || sp.pal;
      const a = o.a == null ? 1 : o.a;
      const seed = o.seed || 0;
      for (let j = 0; j < sp.h; j++) {
        const row = sp.rows[j];
        for (let i = 0; i < sp.w; i++) {
          const p = pal[row[i]];
          if (!p) continue;
          const gx = X + (o.flip ? sp.w - 1 - i : i);
          this.tile(gx, Y + j, p[0], p[1], p[2] != null ? p[2] : this.ch(i, j, seed), a * (p[3] == null ? 1 : p[3]));
        }
      }
    }

    glow(x, y, r, hex, a) {
      if (a <= 0.01) return;
      let g = this.glows.get(hex);
      if (!g) {
        g = document.createElement('canvas');
        g.width = g.height = 64;
        rglow(g.getContext('2d'), 32, 32, 32, hex, 1);
        this.glows.set(hex, g);
      }
      const c = this.cell;
      const R = r * c;
      this.ctx.globalAlpha = clamp(a, 0, 1);
      this.ctx.drawImage(g, (x + 0.5) * c - R, (y + 0.5) * c - R, R * 2, R * 2);
      this.ctx.globalAlpha = 1;
    }

    dot(x, y, color, a, size = 0.3) {
      if (a <= 0.01) return;
      const c = this.cell;
      const d = Math.max(1, c * size);
      this.ctx.globalAlpha = clamp(a, 0, 1);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(Math.round(x) * c + (c - d) / 2, Math.round(y) * c + (c - d) / 2, d, d);
      this.ctx.globalAlpha = 1;
    }
  }

  // Flat-bottomed cloud made of a few overlapping ellipses.
  function cloudRows(w, h) {
    const E = [{ x: w / 2, y: h - h * 0.32, rx: w / 2, ry: h * 0.34 }];
    for (let k = rint(2, 4); k > 0; k--) {
      const rx = rnd(w * 0.16, w * 0.3);
      E.push({ x: rnd(rx * 0.9, w - rx * 0.9), y: h - h * 0.4 - rnd(0, h * 0.2), rx, ry: Math.min(rx * 0.8, h * 0.6) });
    }
    const inside = (i, j) => E.some((e) => ((i + 0.5 - e.x) / e.rx) ** 2 + ((j + 0.5 - e.y) / e.ry) ** 2 <= 1);
    const rows = [];
    for (let j = 0; j < h; j++) {
      let r = '';
      for (let i = 0; i < w; i++) {
        if (!inside(i, j)) r += ' ';
        else r += !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1) ? 'e' : 'c';
      }
      rows.push(r);
    }
    return rows;
  }

  const THEMES = [];

  /* --------------------------------------------- real sky over Hanoi (UTC+7) */

  // Low-precision positions from the Astronomical Almanac. They use the UTC
  // instant, so the machine's time zone setting does not matter.
  const HN = { lat: 21.03, lon: 105.85 };
  const RAD = Math.PI / 180;
  const sind = (a) => Math.sin(a * RAD);
  const cosd = (a) => Math.cos(a * RAD);

  function horizontal(ra, dec, d) {
    const gmst = 280.46061837 + 360.98564736629 * d;
    const H = ((((gmst + HN.lon - ra) % 360) + 540) % 360) - 180;
    const el = Math.asin(sind(HN.lat) * sind(dec) + cosd(HN.lat) * cosd(dec) * cosd(H)) / RAD;
    const az = Math.atan2(sind(H), cosd(H) * sind(HN.lat) - (sind(dec) / cosd(dec)) * cosd(HN.lat)) / RAD + 180;
    return { el, az: ((az % 360) + 360) % 360, H };
  }

  function skyAt(ms) {
    const d = ms / 86400000 - 10957.5; // days since J2000
    const obl = 23.439 - 0.00000036 * d;
    const g = 357.529 + 0.98560028 * d;
    const sunLon = 280.459 + 0.98564736 * d + 1.915 * sind(g) + 0.02 * sind(2 * g);
    const sunRa = Math.atan2(cosd(obl) * sind(sunLon), cosd(sunLon)) / RAD;
    const sunDec = Math.asin(sind(obl) * sind(sunLon)) / RAD;

    const M = 134.963 + 13.064993 * d;
    const F = 93.272 + 13.22935 * d;
    const mLon = 218.316 + 13.176396 * d + 6.289 * sind(M);
    const mLat = 5.128 * sind(F);
    const mRa = Math.atan2(sind(mLon) * cosd(obl) - (sind(mLat) / cosd(mLat)) * sind(obl), cosd(mLon)) / RAD;
    const mDec = Math.asin(sind(mLat) * cosd(obl) + cosd(mLat) * sind(obl) * sind(mLon)) / RAD;
    return {
      sun: horizontal(sunRa, sunDec, d),
      sunDec,
      moon: horizontal(mRa, mDec, d),
      moonDec: mDec,
      lit: (1 - cosd(mLon - sunLon)) / 2,
      waxing: sind(mLon - sunLon) > 0,
    };
  }

  // Set from the console to preview a Vietnam hour: __pixelThemes.skyHour(18.5)
  let skyHour = null;
  const WX = {
    nang: { cloud: 0.03, rain: 0, storm: 0, wind: 0.1, fog: 0, tornado: 0 },
    nangnhe: { cloud: 0.42, rain: 0, storm: 0, wind: 0.15, fog: 0, tornado: 0 },
    am: { cloud: 0.95, rain: 0, storm: 0, wind: 0.2, fog: 0, tornado: 0 },
    suong: { cloud: 0.86, rain: 0, storm: 0, wind: 0.05, fog: 0.85, tornado: 0 },
    phun: { cloud: 0.97, rain: 0.18, storm: 0, wind: 0.1, fog: 0.2, tornado: 0 },
    rao: { cloud: 0.8, rain: 0.5, storm: 0, wind: 0.3, fog: 0, tornado: 0 },
    to: { cloud: 1, rain: 0.85, storm: 0, wind: 0.35, fog: 0, tornado: 0 },
    gio: { cloud: 0.5, rain: 0, storm: 0, wind: 0.75, fog: 0, tornado: 0 },
    den: { cloud: 0.98, rain: 0, storm: 0.32, wind: 0.3, fog: 0, tornado: 0 },
    gionoi: { cloud: 1, rain: 0, storm: 0.55, wind: 0.64, fog: 0, tornado: 0 },
    giong: { cloud: 1, rain: 0, storm: 0.9, wind: 0.72, fog: 0, tornado: 0 },
    doxuong: { cloud: 1, rain: 0.85, storm: 0.8, wind: 0.74, fog: 0, tornado: 0 },
    bao: { cloud: 1, rain: 1, storm: 1, wind: 0.94, fog: 0, tornado: 0 },
    loc: { cloud: 1, rain: 0.7, storm: 0.8, wind: 1, fog: 0, tornado: 1 },
  };
  const WX_DAYS = ['nang', 'nang', 'nangnhe', 'nangnhe', 'am', 'phun', 'rao', 'to', 'bao'];
  const WX_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=21.03&longitude=105.85&current=weather_code,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,visibility';
  const RAIN_OF_CODE = { 51: 0.15, 53: 0.2, 55: 0.3, 56: 0.2, 57: 0.3, 61: 0.35, 63: 0.6, 65: 0.9, 66: 0.5, 67: 0.9, 80: 0.4, 81: 0.65, 82: 1, 95: 0.85, 96: 1, 99: 1 };
  let skyWx = { ...WX.nang };
  let wxForced = null;
  let wxTimer = 0;
  let wxLive = false;

  function wxFromApi(c) {
    const code = c.weather_code || 0;
    const mm = c.precipitation || 0;
    const gust = c.wind_gusts_10m || 0;
    const vis = c.visibility == null ? 20000 : c.visibility;
    const rain = Math.max(RAIN_OF_CODE[code] || 0, mm > 0 ? Math.min(1, 0.15 + mm / 10) : 0);
    const storm = code >= 95 ? (code === 95 ? 0.8 : 1) : 0;
    return {
      cloud: Math.max((c.cloud_cover || 0) / 100, rain > 0 ? 0.7 : 0),
      rain,
      storm,
      wind: clamp(Math.max(c.wind_speed_10m || 0, gust * 0.6) / 60, 0, 1),
      fog: code === 45 || code === 48 ? 0.8 : vis < 1000 ? 1 - vis / 1000 : 0,
      tornado: storm && gust >= 90 ? 1 : 0,
    };
  }

  async function loadWeather() {
    if (wxForced) return;
    try {
      const r = await fetch(WX_URL);
      if (!r.ok) throw new Error(r.status);
      skyWx = wxFromApi((await r.json()).current);
      wxLive = true;
    } catch (e) {
      // A passing failure keeps the last real reading.
      if (wxLive) return;
      const day = Math.floor((Date.now() + 7 * 3600e3) / 86400e3);
      skyWx = { ...WX[WX_DAYS[(hash(day, 0, 7) * WX_DAYS.length) | 0]] };
    }
  }

  // Every quarter hour, but only while a sky is on screen.
  function wxTick() {
    if (!document.hidden && (byId(curId) || {}).sky) loadWeather();
  }

  let skyDemoAt = 0;
  let skyMoon = null;
  function skyMs() {
    const now = Date.now();
    if (skyDemoAt) {
      // One whole day in 40 seconds, from 4 a.m. Vietnam time.
      const run = now - skyDemoAt;
      if (run < 40000) return Math.floor((now + 7 * 3600e3) / 86400e3) * 86400e3 - 3 * 3600e3 + run * 2160;
      skyDemoAt = 0;
    }
    if (skyHour == null) return now;
    const vnDay = Math.floor((now + 7 * 3600e3) / 86400e3) * 86400e3;
    return vnDay + (skyHour - 7) * 3600e3;
  }

  // Colours by sun elevation: [zenith, upper, lower, horizon].
  const SKY_STOPS = [
    [-18, '#070b28', '#0e1544', '#1b2464', '#2e3686'],
    [-9, '#0e1648', '#1d2566', '#3f3a86', '#7a4f8c'],
    [-3, '#1c2b6b', '#4a3f8c', '#b4577a', '#f0855a'],
    [1, '#2f4f9f', '#7a6fb8', '#ef8f6a', '#ffb65c'],
    [6, '#3f79cc', '#7fb0e6', '#f3c9a4', '#ffd98f'],
    [18, '#4a96e6', '#74b8f2', '#aedcf8', '#dff1fb'],
    [60, '#4390e4', '#6cb4f0', '#a2d8f8', '#d2ebfb'],
  ];
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const css = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;

  function skyColors(el) {
    const T = SKY_STOPS;
    if (el <= T[0][0]) return T[0].slice(1).map(rgbOf);
    for (let i = 1; i < T.length; i++) {
      if (el <= T[i][0]) {
        const t = (el - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
        const u = t * t * (3 - 2 * t);
        return [1, 2, 3, 4].map((k) => mixRgb(rgbOf(T[i - 1][k]), rgbOf(T[i][k]), u));
      }
    }
    return T[T.length - 1].slice(1).map(rgbOf);
  }

  // Facing south: east on the left, west on the right.
  // Both cross the whole width: p runs 0 to 1 over the day, or over the night.
  const skyX = (p, w) => w * (0.04 + 0.92 * clamp(p, 0, 1));
  const skyY = (el, hy) => hy - sind(el) * hy * 0.9;

  function skyPhase(ms) {
    const { el, H } = skyAt(ms).sun;
    if (el < -6) return 'Đêm';
    if (el < 6) return H < 0 ? 'Bình minh' : 'Hoàng hôn';
    if (Math.abs(H) < 15) return 'Trưa';
    return H < 0 ? 'Sáng' : 'Chiều';
  }

  function skyState() {
    const ms = skyMs();
    const now = skyAt(ms);
    if (skyMoon) Object.assign(now, { lit: skyMoon, waxing: true, moon: { el: 52, az: 0, H: 40 } });
    const { el, H } = now.sun;
    const arc = (dec) => Math.acos(clamp(-Math.tan(HN.lat * RAD) * Math.tan(dec * RAD), -1, 1)) / RAD;
    const H0 = arc(now.sunDec);
    const M0 = arc(now.moonDec);
    const am = H < 0;
    const warm = clamp(1 - Math.abs(el - 2) / 10, 0, 1);
    const noon = el > 6 ? clamp(1 - Math.abs(H) / 25, 0, 1) : 0;
    const low = el > 6 ? clamp((45 - el) / 39, 0, 1) : 0;
    // Each part of the day has its own light: pink dawn, fresh morning, deep noon
    // blue, golden afternoon, red sunset.
    const c = skyColors(el);
    const tint = (i, col, k) => (c[i] = mixRgb(c[i], col, k));
    if (am) {
      tint(2, [255, 176, 200], 0.4 * warm);
      tint(3, [255, 190, 205], 0.4 * warm);
      tint(3, [232, 250, 236], 0.35 * low);
    } else {
      tint(2, [255, 130, 70], 0.3 * warm);
      tint(3, [255, 110, 60], 0.3 * warm);
      tint(1, [255, 232, 186], 0.3 * low);
      tint(2, [255, 214, 140], 0.5 * low);
      tint(3, [255, 200, 110], 0.6 * low);
    }
    tint(0, [44, 120, 222], 0.35 * noon);
    const night = clamp((-el - 1) / 9, 0, 1);
    const moonlight = night * now.lit * clamp(now.moon.el / 15, 0, 1) * (1 - skyWx.cloud * 0.8);
    for (const i of [0, 1, 2]) tint(i, [44, 60, 124], 0.4 * moonlight);
    const fogCol = mixRgb([214, 219, 224], [70, 76, 92], night);
    for (const i of [0, 1, 2, 3]) tint(i, fogCol, 0.8 * skyWx.fog);
    return {
      ...now,
      ms,
      c,
      am,
      wx: skyWx,
      fogCol,
      warm,
      noon,
      night,
      moonlight,
      mist: am && el > -6 ? clamp(1 - (el - 2) / 14, 0, 1) : 0,
      dayP: (H + H0) / (2 * H0),
      moonP: (now.moon.H + M0) / (2 * M0),
    };
  }

  // Brightness of the sky behind the text, 0 to 1.
  function skyLum(st) {
    const c = [0, 1, 2].map((i) => (st.c[0][i] + st.c[1][i] + st.c[2][i]) / 3);
    const L = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return L * (1 - 0.32 * skyWx.cloud - 0.3 * skyWx.rain - 0.15 * skyWx.storm);
  }

  function promptBox() {
    for (const el of document.querySelectorAll('textarea, [contenteditable="true"]')) {
      const b = el.getBoundingClientRect();
      if (b.width > 240 && b.height > 0) return b;
    }
    return null;
  }

  function softDot(hex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    rglow(c.getContext('2d'), 32, 32, 32, hex, 1);
    return c;
  }

  function rays(c, x, y, len, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, len);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    for (let i = 0; i < 9; i++) {
      const t = -Math.PI / 2 + (i - 4) * 0.36;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(t - 0.07) * len, y + Math.sin(t - 0.07) * len);
      c.lineTo(x + Math.cos(t + 0.07) * len, y + Math.sin(t + 0.07) * len);
      c.fill();
    }
  }

  const st_wx = (s) => s.st.wx !== skyWx;

  function paintDeck(d, w, st) {
    const heavy = Math.max(st.wx.rain, st.wx.storm);
    const key = `${heavy.toFixed(1)}|${st.night.toFixed(1)}|${w.w}|${w.h}`;
    if (d.key === key) return;
    d.key = key;
    const cell = d.cell;
    const W = Math.ceil(w.w / cell) * cell;
    const H = Math.round(w.h * d.depth);
    d.W = W;
    d.H = H;
    d.cv.width = Math.ceil(W * w.dpr);
    d.cv.height = Math.ceil(H * w.dpr);
    const c = d.cv.getContext('2d');
    c.setTransform(w.dpr, 0, 0, w.dpr, 0, 0);
    const lit = mixRgb(mixRgb([178, 186, 198], [96, 102, 116], heavy), [36, 42, 60], st.night * 0.85);
    const deep = mixRgb(mixRgb([128, 136, 150], [36, 41, 52], heavy), [14, 18, 30], st.night * 0.85);
    for (let x = 0; x < W; x += cell) {
      const u = (x / W) * Math.PI * 2;
      // Rounded billows hanging down, the way a storm base looks from below.
      const edge = H * (0.42 + 0.26 * Math.abs(Math.sin(2 * u + d.ph[0])) + 0.2 * Math.abs(Math.sin(5 * u + d.ph[1])) + 0.1 * Math.abs(Math.sin(11 * u + d.ph[2])));
      for (let y = 0; y < edge; y += cell) {
        const k = clamp((edge - y) / (H * 0.28), 0, 1);
        const speck = hash(x, y, 5) * 0.14 - 0.07;
        c.fillStyle = css(mixRgb(lit, deep, clamp(k + speck, 0, 1)));
        c.fillRect(x, y, cell, cell);
      }
    }
  }

  function makeDeck(w, near) {
    return {
      cv: document.createElement('canvas'),
      cell: Math.max(4, Math.round(w.cell * 0.8)),
      depth: near ? 0.24 : 0.4,
      speed: near ? 24 : 11,
      x: rnd(0, w.w),
      ph: [rnd(0, 6), rnd(0, 6), rnd(0, 6)],
    };
  }

  function hillH(x, a, b, seed) {
    return a + b * (0.5 + 0.3 * Math.sin(x * 0.021 + seed) + 0.2 * Math.sin(x * 0.057 + seed * 2.3));
  }

  function drawDisc(c, x, y, r, px, fn) {
    const n = Math.ceil(r / px);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const dx = (i + 0.5) * px;
        const dy = (j + 0.5) * px;
        if (dx * dx + dy * dy > r * r) continue;
        const col = fn(dx / r, dy / r);
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x + i * px + 0.5, y + j * px + 0.5, px - 1, px - 1);
      }
    }
  }

  function makeCloud(w, st, scale) {
    const cell = Math.max(3, Math.round(w.cell * 0.7));
    const cols = Math.round(rnd(14, 30) * scale);
    const rows = Math.max(4, Math.round(cols * 0.28));
    return { x: rnd(-w.w * 0.1, w.w), y: rnd(w.h * 0.04, w.h * 0.46), v: rnd(4, 11) * scale, cols, rows, cell, map: cloudRows(cols, rows), a: rnd(0.7, 0.95) * clamp(scale, 0.75, 1) };
  }

  function paintCloud(k, st, dpr) {
    const cv = k.cv || (k.cv = document.createElement('canvas'));
    cv.width = Math.ceil(k.cols * k.cell * dpr);
    cv.height = Math.ceil(k.rows * k.cell * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const day = [255, 255, 255];
    const dusk = st.am ? [255, 206, 222] : [255, 186, 130];
    const dark = mixRgb([58, 68, 118], [128, 142, 198], st.moonlight);
    const lit = mixRgb(mixRgb(mixRgb(day, dusk, st.warm), dark, st.night), [104, 112, 130], st.wx.rain * 0.85 + st.wx.cloud * 0.12);
    const edge = mixRgb(lit, mixRgb(st.c[1], [196, 208, 255], st.night), 0.3);
    const gap = 0.6;
    k.map.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === ' ') continue;
        c.fillStyle = css(row[i] === 'e' ? edge : lit);
        c.fillRect(i * k.cell + gap / 2, j * k.cell + gap / 2, k.cell - gap, k.cell - gap);
      }
    });
  }

  THEMES.push({
    id: 'troi',
    sky: true,
    name: 'Pixel',
    fps: 60,
    veilScale: 0.25,
    get dark() {
      return skyAt(skyMs()).sun.el < -6;
    },
    alias: ['bau troi', 'ha noi', 'hanoi', 'gio thuc', 'realtime', 'mat troi'],
    glyphs: '.',
    bg(c, w, h, W) {
      const st = W.s.st || (W.s.st = skyState());
      const g = c.createLinearGradient(0, 0, 0, h * 0.84);
      st.c.forEach((col, i) => g.addColorStop([0, 0.38, 0.74, 1][i], css(col)));
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    },
    under(W) {
      const c = W.ctx;
      const { w, h } = W;
      const st = W.s.st;
      const hy = h * 0.84;
      const px = Math.max(2, Math.round(W.cell * 0.5));

      if (st.night > 0) {
        const clear = st.night * (1 - st.wx.cloud * 0.9);
        const dark = clear * (1 - 0.75 * st.moonlight);
        for (const n of W.s.nebula) rglow(c, n.x * w, n.y * hy, n.r * Math.max(w, h), n.col, n.a * dark);
        for (const b of W.s.milky) {
          c.fillStyle = `rgba(225,232,255,${dark * b.a})`;
          c.fillRect(b.x * w, b.y * hy, b.s, b.s);
        }
        for (const b of W.s.stars) {
          const x = b.x * w;
          const y = b.y * hy;
          c.fillStyle = `rgba(${b.col},${clear * (1 - 0.45 * st.moonlight) * b.a})`;
          c.fillRect(x, y, b.s, b.s);
          if (b.s > 1) {
            c.fillRect(x - 2, y + 0.5, b.s + 4, 1);
            c.fillRect(x + 0.5, y - 2, 1, b.s + 4);
          }
        }
      }

      if (st.sun.el > -3) {
        const x = skyX(st.dayP, w);
        const y = skyY(st.sun.el, hy);
        const R = Math.min(w, h);
        c.save();
        c.globalAlpha = clamp(1 - st.wx.cloud * 0.9, 0.06, 1) * (1 - st.wx.rain * 0.85) * (1 - st.wx.fog * 0.6);
        rays(c, x, y, R * (0.5 + st.warm * 0.5 + st.noon * 0.2), st.warm > 0.3 ? '255,190,130' : '255,250,225', 0.1 + 0.12 * st.warm + 0.08 * st.noon);
        const hue = st.warm > 0.3 ? '#ffb066' : '#fff4c8';
        rglow(c, x, y, R * (0.34 + st.warm * 0.3), hue, 0.42 + st.warm * 0.3);
        rglow(c, x, y, R * 0.11, '#fff9e0', 0.75);
        const r = Math.max(10, R * 0.045);
        const core = mixRgb([255, 247, 205], [255, 170, 90], st.warm);
        drawDisc(c, x, y, r, px, (u, v) => css(mixRgb(core, [255, 255, 255], clamp(0.5 - Math.hypot(u, v), 0, 1))));
        c.restore();
      }

      // The real moon: it rises and sets at its true times, faint by day.
      if (st.moon.el > -3) {
        const x = skyX(st.moonP, w);
        const y = skyY(st.moon.el, hy);
        // Dimmer while it passes behind the conversation, so the text stays readable.
        const box = promptBox();
        const inside = box ? clamp(Math.min(x - box.left, box.right - x) / 120 + 0.5, 0, 1) : 0;
        const show = (0.4 + 0.6 * st.night) * (1 - 0.3 * inside);
        const glow = st.night * (1 - 0.3 * inside);
        const R = Math.max(14, Math.min(w, h) * 0.065);
        c.save();
        c.globalAlpha = 1 - st.wx.cloud * 0.85;
        rglow(c, x, y, R * 9, '#9fb8ff', 0.3 * glow * st.lit + 0.06 * glow);
        rglow(c, x, y, R * 3, '#fff1c9', 0.42 * glow * st.lit + 0.1 * glow);
        const k = 1 - 2 * st.lit;
        drawDisc(c, x, y, R, px, (u, v) => {
          const edge = Math.sqrt(Math.max(0, 1 - v * v));
          const on = (st.waxing ? u : -u) > k * edge;
          if (!on && st.night < 0.3) return null;
          const crater = hash(Math.round(u * 7), Math.round(v * 7), 11) < 0.14;
          const col = on ? (crater ? [232, 222, 186] : [255, 248, 220]) : mixRgb(st.c[1], [255, 244, 205], 0.16);
          return css(col, show);
        });
        c.restore();
      }

      const glowY = hy;
      if (st.warm > 0) rglow(c, skyX(st.dayP, w), glowY, w * 0.5, st.am ? '#ffb0c8' : '#ff8a45', 0.38 * st.warm);

      const cell = W.cell;
      const shade = [
        [0.2, 0.15, 1.7, [84, 112, 150]],
        [0.16, 0.13, 3.1, [58, 92, 122]],
        [0.11, 0.1, 5.7, [40, 76, 84]],
        [0.06, 0.08, 8.3, [28, 58, 56]],
      ];
      const dim = mixRgb([255, 255, 255], mixRgb([64, 74, 124], [142, 158, 224], st.moonlight), st.night);
      shade.forEach(([a, b, seed, col], layer) => {
        const tint = mixRgb(col, st.c[3], 0.55 - layer * 0.18).map((v, i) => (v * dim[i]) / 255);
        const haze = mixRgb(mixRgb(tint, [255, 150, 90], st.warm * 0.14), st.fogCol, st.wx.fog * (0.8 - layer * 0.2));
        c.fillStyle = css(haze);
        for (let x = 0; x < w; x += cell) {
          const side = Math.abs(x / w - 0.5) * 2;
          const rise = h * (0.2 - layer * 0.05) * side * side * side;
          const top = Math.round((hillH(x, h * a, h * b, seed) + rise) / cell) * cell;
          c.fillRect(x, h - top, cell, top);
        }
        // Fog lies in the valley behind each ridge.
        if (st.wx.fog > 0.01) {
          const y0 = h * (1 - a - b);
          const g = c.createLinearGradient(0, y0, 0, h * (1 - a * 0.45));
          g.addColorStop(0, css(st.fogCol, 0));
          g.addColorStop(1, css(st.fogCol, 0.9 * st.wx.fog));
          c.fillStyle = g;
          c.fillRect(0, y0, w, h - y0);
        }
      });

      // A low line of houses; windows come on after sunset.
      c.fillStyle = css(mixRgb([26, 44, 46], [14, 18, 44], st.night));
      const on = clamp((-st.sun.el + 1) / 5, 0, 1);
      for (let x = 0, i = 0; x < w; i++) {
        const bw = (2 + ((hash(i, 0, 5) * 5) | 0)) * cell;
        const bh = (3 + ((hash(i, 1, 5) * 7) | 0)) * cell;
        c.fillRect(x, h - bh, bw - 1, bh);
        for (let wy = h - bh + cell; wy < h - cell; wy += cell * 1.5) {
          for (let wx = x + cell * 0.5; wx < x + bw - cell; wx += cell * 1.5) {
            if (on > 0 && hash(wx | 0, wy | 0, 9) < 0.14) {
              c.fillStyle = `rgba(255,214,130,${0.5 * on})`;
              c.fillRect(wx, wy, cell * 0.4, cell * 0.4);
            }
          }
        }
        c.fillStyle = css(mixRgb([26, 44, 46], [14, 18, 44], st.night));
        x += bw;
      }
    },
    init(w) {
      const s = w.s;
      s.st = skyState();
      s.at = s.st.ms;
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.14;
      const band = () => {
        const u = Math.random();
        return { x: u + gauss() * 0.5, y: 0.04 + 0.7 * u + gauss() };
      };
      s.stars = Array.from({ length: Math.round(clamp((w.w * w.h) / 3000, 30, 380)) }, () => ({
        x: Math.random(),
        y: Math.random() * 0.92,
        a: rnd(0.3, 1),
        s: Math.random() < 0.1 ? 2 : 1,
        col: pick(['232,236,255', '200,220,255', '255,240,210', '255,214,190']),
        ph: rnd(0, 6),
        f: rnd(0.6, 2.2),
      }));
      s.milky = Array.from({ length: Math.round(clamp((w.w * w.h) / 1800, 60, 700)) }, () => ({ ...band(), a: rnd(0.15, 0.6), s: 1 }));
      s.nebula = Array.from({ length: 9 }, (_, i) => ({
        x: (i + 0.5) / 9,
        y: 0.04 + (0.7 * (i + 0.5)) / 9 + gauss() * 0.3,
        r: rnd(0.1, 0.17),
        col: pick(['#5b54c8', '#3f7ad0', '#8a5fc0']),
        a: rnd(0.14, 0.24),
      }));
      s.clouds = Array.from({ length: Math.round(clamp(w.w / 160, 5, 14)) }, (_, i) => makeCloud(w, s.st, i % 3 ? 1 : 0.65));
      s.clouds.sort((a, b) => a.v - b.v);
      s.clouds.forEach((k) => paintCloud(k, s.st, w.dpr));
      s.decks = [makeDeck(w, false), makeDeck(w, true)];
      if (skyWx.cloud > 0.55) s.decks.forEach((d) => paintDeck(d, w, s.st));
      s.mist = Array.from({ length: 9 }, () => ({ x: rnd(0, w.w), y: rnd(0.5, 0.9), rx: rnd(0.2, 0.5), ry: rnd(0.03, 0.09), v: rnd(3, 9) }));
      s.flies = Array.from({ length: Math.round(clamp(w.w / 60, 8, 30)) }, () => ({ x: Math.random(), y: rnd(0.74, 0.93), ph: rnd(0, 6), f: rnd(0.5, 1.4), d: rnd(14, 40) }));
      s.puff = softDot('#ffffff');
      s.fly = softDot('#dcff70');
      s.birds = null;
      s.nextBird = rnd(4, 20);
      s.shoot = null;
      s.nextShoot = rnd(6, 25);
      s.wx = { ...skyWx };
      s.flash = 0;
      s.bolt = null;
      s.nextFlash = rnd(2, 6);
      s.junk = Array.from({ length: 34 }, () => ({ a: rnd(0, 6.28), r: rnd(30, 150), lift: rnd(0, 150), v: rnd(2.5, 6), size: rnd(6, 16) }));
      s.brown = softDot('#6e6156');
      if (!wxTimer) {
        wxTimer = setInterval(wxTick, 15 * 60e3);
        loadWeather();
      }
      s.drops = Array.from({ length: Math.round(clamp((w.w * w.h) / 5000, 60, 340)) }, () => ({ x: Math.random(), y: Math.random(), l: rnd(10, 24), v: rnd(620, 980) }));
    },
    frame(w, dt) {
      const s = w.s;
      const c = w.ctx;
      // The sky changes slowly: repaint the cached layer once every 15 s.
      const ms = skyMs();
      if (Math.abs(ms - s.at) >= (skyDemoAt ? 300000 : 15000) || st_wx(s)) {
        s.at = ms;
        s.st = skyState();
        w.under = null;
        s.clouds.forEach((k) => paintCloud(k, s.st, w.dpr));
        if (skyWx.cloud > 0.55) s.decks.forEach((d) => paintDeck(d, w, s.st));
      }
      const st = s.st;

      if (st.night > 0.05) {
        c.fillStyle = '#ffffff';
        for (let i = 0; i < s.stars.length; i += 3) {
          const b = s.stars[i];
          c.globalAlpha = st.night * b.a * Math.max(0, Math.sin(w.t * b.f + b.ph));
          c.fillRect(b.x * w.w, b.y * w.h * 0.84, b.s + 0.5, b.s + 0.5);
        }
        c.globalAlpha = 1;
      }

      const wx = s.wx;
      for (const key in skyWx) wx[key] += (skyWx[key] - wx[key]) * Math.min(1, dt / 8);
      if (wx.cloud > 0.3) {
        const sheet = mixRgb([168, 178, 192], [16, 20, 34], st.night);
        c.fillStyle = css(sheet, (wx.cloud - 0.3) * 0.8);
        c.fillRect(0, 0, w.w, w.h);
      }

      const shown = Math.ceil(s.clouds.length * (0.2 + 0.8 * wx.cloud));
      for (let i = 0; i < shown; i++) {
        const k = s.clouds[i];
        k.x += k.v * (1 + wx.wind * 6) * dt;
        const W = k.cols * k.cell;
        if (k.x > w.w + 10) {
          k.x = -W - rnd(0, 120);
          k.y = rnd(w.h * 0.04, w.h * 0.46);
        }
        c.globalAlpha = k.a * (1 - st.night * 0.45);
        c.drawImage(k.cv, Math.round(k.x * w.dpr) / w.dpr, Math.round(k.y * w.dpr) / w.dpr, W, k.rows * k.cell);
      }
      c.globalAlpha = 1;

      const fade = clamp((wx.cloud - 0.55) / 0.35, 0, 1) * (1 - wx.fog);
      if (fade > 0.01) {
        c.globalAlpha = fade;
        for (const d of s.decks) {
          if (!d.W) continue;
          d.x = (d.x + d.speed * (1 + wx.wind * 5) * dt) % d.W;
          c.drawImage(d.cv, d.x - d.W, 0, d.W, d.H);
          c.drawImage(d.cv, d.x, 0, d.W, d.H);
        }
        c.globalAlpha = 1;
      }

      // Morning mist in the valley, fireflies at night.
      const mist = Math.max(st.mist * 0.28, wx.fog * 0.42);
      if (mist > 0.01) {
        c.globalAlpha = mist;
        for (const m of s.mist) {
          const rx = m.rx * w.w;
          const ry = m.ry * w.h;
          m.x += m.v * dt;
          if (m.x - rx > w.w) m.x = -rx;
          c.drawImage(s.puff, m.x - rx, m.y * w.h - ry, rx * 2, ry * 2);
        }
        c.globalAlpha = 1;
      }
      if (st.night > 0.4) {
        for (const f of s.flies) {
          const a = Math.max(0, Math.sin(w.t * f.f + f.ph));
          if (a < 0.05) continue;
          c.globalAlpha = a * st.night;
          c.drawImage(s.fly, f.x * w.w + Math.sin(w.t * 0.4 + f.ph) * f.d - 8, f.y * w.h + Math.cos(w.t * 0.3 + f.ph) * f.d * 0.5 - 8, 16, 16);
        }
        c.globalAlpha = 1;
      }

      if (wx.fog > 0.01) {
        c.fillStyle = css(mixRgb([214, 220, 226], [70, 78, 98], st.night), wx.fog * 0.12);
        c.fillRect(0, 0, w.w, w.h);
      }

      const gloom = wx.rain * 0.42 + wx.storm * 0.25;
      if (gloom > 0.01) {
        c.fillStyle = `rgba(24,30,44,${gloom})`;
        c.fillRect(0, 0, w.w, w.h);
      }

      if (wx.rain > 0.01) {
        const n = Math.round(s.drops.length * wx.rain);
        const slant = 0.12 + wx.wind * 0.7;
        c.strokeStyle = `rgba(205,224,245,${0.28 + 0.34 * wx.rain})`;
        c.lineWidth = wx.rain > 0.7 ? 1.4 : 1;
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const d = s.drops[i];
          d.y += (d.v * (1 + wx.wind * 0.6) * dt) / w.h;
          if (d.y > 1) {
            d.y -= 1.05;
            d.x = Math.random() * 1.6;
          }
          const x = d.x * w.w - d.y * w.h * slant;
          const y = d.y * w.h;
          c.moveTo(x, y);
          c.lineTo(x - d.l * slant, y + d.l);
        }
        c.stroke();
        c.fillStyle = `rgba(215,230,250,${0.4 * wx.rain})`;
        for (let i = 0; i < n; i += 3) {
          const d = s.drops[i];
          if (d.y > 0.9) c.fillRect((d.x * w.w * 3) % w.w, w.h * (0.88 + (i % 6) * 0.02), 6, 1);
        }
        if (wx.rain > 0.45) {
          // Curtains of heavier rain sweeping across.
          c.fillStyle = `rgba(190,205,225,${0.07 * wx.rain})`;
          for (let i = 0; i < 3; i++) {
            const span = w.w * 1.5;
            const x = ((i * span) / 3 + w.t * (70 + wx.wind * 240)) % span - w.w * 0.25;
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x + w.w * 0.18, 0);
            c.lineTo(x + w.w * 0.18 - w.h * slant, w.h);
            c.lineTo(x - w.h * slant, w.h);
            c.fill();
          }
        }
      }

      if (wx.storm > 0.2) {
        const g = c.createLinearGradient(0, w.h * 0.4, 0, w.h * 0.9);
        g.addColorStop(0, 'rgba(120,150,120,0)');
        g.addColorStop(1, `rgba(120,150,120,${0.2 * wx.storm})`);
        c.fillStyle = g;
        c.fillRect(0, w.h * 0.4, w.w, w.h * 0.6);
      }

      // Lightning lights the clouds around the bolt, not the whole window.
      if (wx.storm > 0.3) {
        s.nextFlash -= dt;
        if (s.nextFlash <= 0) {
          s.nextFlash = rnd(3, 11) / wx.storm;
          s.flash = 1;
          s.bolts = [];
          const fork = (x, y, len, width) => {
            const path = [[x, y]];
            for (let i = 0; i < len; i++) {
              x += rnd(-30, 30);
              y += rnd(18, 44);
              path.push([x, y]);
              if (width > 1.2 && Math.random() < 0.18) fork(x, y, Math.ceil(len / 2), width * 0.55);
            }
            s.bolts.push({ path, width });
          };
          s.flashX = rnd(w.w * 0.15, w.w * 0.85);
          fork(s.flashX, w.h * 0.12, 11, 2.6);
        }
      }
      if (s.flash > 0) {
        const R = w.h * 0.9;
        c.globalAlpha = 0.5 * s.flash;
        c.drawImage(s.puff, s.flashX - R * 1.2, -R * 0.6, R * 2.4, R * 1.4);
        if (s.flash > 0.4) {
          c.globalAlpha = Math.min(1, s.flash * 1.4);
          c.strokeStyle = '#eef2ff';
          c.shadowColor = '#9fb6ff';
          c.shadowBlur = 14;
          for (const b of s.bolts) {
            c.lineWidth = b.width;
            c.beginPath();
            b.path.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
            c.stroke();
          }
          c.shadowBlur = 0;
        }
        c.globalAlpha = 1;
        s.flash -= dt * 3.2;
      }

      if (wx.tornado > 0.05) {
        const cell = Math.max(4, Math.round(w.cell * 0.7));
        const base = w.h * 0.9;
        const top = w.h * 0.2;
        const x0 = w.w * (0.72 + Math.sin(w.t * 0.12) * 0.08);
        const rows = Math.round((base - top) / cell);
        const spin = w.t * 7;
        for (let i = 0; i < rows; i++) {
          const u = i / rows;
          const half = 5 + 150 * Math.pow(u, 2.3);
          const bend = Math.sin(u * 2.6 + w.t * 0.5) * 46 * (1 - u) + Math.sin(u * 9 + w.t * 2) * (6 + 8 * u);
          const y = base - i * cell;
          const n = Math.ceil((half * 2) / cell);
          for (let j = 0; j < n; j++) {
            const v = (j + 0.5) / n;
            const round = Math.sin(v * Math.PI);
            const band = 0.5 + 0.5 * Math.sin(v * 7 - spin + u * 14);
            const g = Math.round(58 + 78 * round * (0.35 + 0.65 * band));
            c.globalAlpha = wx.tornado * (0.3 + 0.7 * round);
            c.fillStyle = `rgb(${g},${g + 5},${g + 14})`;
            c.fillRect(x0 + bend - half + j * cell, y, cell - 0.5, cell - 0.5);
          }
        }
        const foot = x0 + Math.sin(w.t * 0.5) * 46;
        for (const j of s.junk) {
          j.a += j.v * dt;
          j.lift = (j.lift + j.v * 9 * dt) % 150;
          const r = j.r * (0.5 + j.lift / 200);
          const x = foot + Math.cos(j.a) * r;
          const y = base - j.lift + Math.sin(j.a) * r * 0.26;
          c.globalAlpha = wx.tornado * 0.55;
          c.drawImage(s.brown, x - j.size * 3, y - j.size * 1.4, j.size * 6, j.size * 2.8);
          c.globalAlpha = wx.tornado;
          c.fillStyle = '#23262e';
          c.fillRect(x, y, j.size * 0.4, j.size * 0.4);
        }
        c.globalAlpha = 1;
      }

      if (st.night < 0.6 && wx.rain < 0.1 && wx.cloud < 0.7) {
        s.nextBird -= dt;
        if (!s.birds && s.nextBird <= 0) {
          const y = rnd(w.h * 0.12, w.h * 0.5);
          s.birds = { x: -40, y, v: rnd(34, 55), b: Array.from({ length: rint(3, 7) }, (_, i) => ({ dx: -i * rnd(14, 20), dy: (i % 2 ? 1 : -1) * i * rnd(4, 8), ph: rnd(0, 6) })) };
        }
        if (s.birds) {
          const B = s.birds;
          B.x += B.v * dt;
          c.strokeStyle = css(mixRgb([30, 40, 60], [10, 12, 30], st.warm));
          c.lineWidth = 1.5;
          c.beginPath();
          for (const b of B.b) {
            const f = Math.sin(w.t * 9 + b.ph) * 3;
            const x = B.x + b.dx;
            const y = B.y + b.dy + Math.sin(w.t * 1.3 + b.ph) * 3;
            c.moveTo(x - 6, y - f);
            c.quadraticCurveTo(x - 3, y - 1, x, y);
            c.quadraticCurveTo(x + 3, y - 1, x + 6, y - f);
          }
          c.stroke();
          if (B.x > w.w + 160) {
            s.birds = null;
            s.nextBird = st.warm > 0.2 ? rnd(8, 20) : rnd(35, 90);
          }
        }
      }

      if (st.night > 0.6) {
        s.nextShoot -= dt;
        if (!s.shoot && s.nextShoot <= 0) s.shoot = { x: rnd(w.w * 0.35, w.w), y: rnd(0, w.h * 0.3), vx: -rnd(380, 560), vy: rnd(130, 220), life: 0 };
        if (s.shoot) {
          const S = s.shoot;
          S.life += dt;
          S.x += S.vx * dt;
          S.y += S.vy * dt;
          const a = clamp(1 - S.life / 0.9, 0, 1);
          const g = c.createLinearGradient(S.x, S.y, S.x - S.vx * 0.16, S.y - S.vy * 0.16);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          c.strokeStyle = g;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(S.x, S.y);
          c.lineTo(S.x - S.vx * 0.16, S.y - S.vy * 0.16);
          c.stroke();
          if (S.life > 0.9) {
            s.shoot = null;
            s.nextShoot = rnd(12, 40);
          }
        }
      }
    },
  });

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

  const ITEMS = THEMES.map((t) => t.id).concat('off');
  const byId = (id) => THEMES.find((t) => t.id === id);

  /* --------------------------------------------------------------- settings */

  const KEY = 'pixel-themes:v1';
  const cfg = { theme: 'troi3d', veil: 0.2, glass: 0.72, motion: true, button: true };
  try {
    Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    /* storage blocked: keep defaults */
  }
  if (!ITEMS.includes(cfg.theme)) cfg.theme = 'troi3d';
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {
      /* ignore */
    }
  };

  /* ----------------------------------------------------------------- styles */

  const PAGE_CSS = `
html[data-pxt-sky] [data-pxt-ink] { color: var(--pxt-ink) !important; }
html[data-pxt-sky] body { text-shadow: 0 0 3px var(--pxt-halo); }
html[data-pxt-sky] dialog, html[data-pxt-sky] [role="dialog"], html[data-pxt-sky] [role="menu"], html[data-pxt-sky] [role="tooltip"], html[data-pxt-sky] pre, html[data-pxt-sky] code { text-shadow: none; }
html[data-pxt-flip] body { filter: invert(1) hue-rotate(180deg); }
html[data-pxt-flip] body img, html[data-pxt-flip] body video, html[data-pxt-flip] body iframe, html[data-pxt-flip] body canvas { filter: hue-rotate(180deg) invert(1); }
html[data-pxt-on], html[data-pxt-on] body { background-color: transparent !important; background-image: none !important; }
html[data-pxt-on] [data-pxt="clear"] { background-color: transparent !important; background-image: none !important; }
html[data-pxt-on] [data-pxt="glass"] {
  background-color: rgba(var(--pxt-rgb), var(--pxt-alpha, .72)) !important;
  background-image: none !important;
  -webkit-backdrop-filter: blur(var(--pxt-blur, 12px)) saturate(1.35);
  backdrop-filter: blur(var(--pxt-blur, 12px)) saturate(1.35);
}
canvas[data-pxt-ui="bg"] { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: -1 !important; pointer-events: none !important; display: none; }
html[data-pxt-on] canvas[data-pxt-ui="bg"] { display: block !important; }
canvas[data-pxt-ui="sky"] { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: -1 !important; pointer-events: none !important; display: none; }
html[data-pxt-gl] canvas[data-pxt-ui="sky"] { display: block !important; }
html[data-pxt-gl] canvas[data-pxt-ui="bg"] { display: none !important; }
[data-pxt-ui="dock"] { position: fixed; right: 10px; top: 50%; z-index: 40; pointer-events: auto; }
[data-pxt-ui="dock"][data-docked] { position: absolute; }
html[data-pxt-flip] [data-pxt-ui="dock"][data-docked], html[data-pxt-flip] [data-engine-site="AbovePrompt"], html[data-pxt-flip] [data-cds="Tooltip"] { filter: hue-rotate(180deg) invert(1); }
html[data-pxt-sky] [data-cds-dock-masked] { --cds-page-bg: transparent !important; }
html[data-pxt-sky] .pointer-events-none.sticky.bottom-0 { background: none !important; }
html[data-pxt-sky] .scroll-fade-strip-bottom, html[data-pxt-sky] .scroll-fade-strip-top { display: none !important; }
html[data-pxt-sky] [data-code-composer-column], html[data-pxt-sky] [data-code-composer-column] :has([data-engine-site="AbovePrompt"]), html[data-pxt-sky] [data-code-composer-column] [class*="bg-alpha-1"][class*="min-h-[40px]"] { background: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; box-shadow: none !important; }
html[data-pxt-sky] [data-cds="ChatComposer"] { background-color: rgba(255, 255, 255, .78) !important; border-radius: 14px; -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6); box-shadow: 0 8px 26px rgba(0, 0, 0, .16), inset 0 0 0 .5px rgba(255, 255, 255, .45); }
html[data-pxt-sky][data-mode="dark"] [data-cds="ChatComposer"] { background-color: rgba(34, 34, 38, .74) !important; box-shadow: 0 8px 26px rgba(0, 0, 0, .3), inset 0 0 0 .5px rgba(255, 255, 255, .14); }
html[data-pxt-sky] [data-cds="ChatComposer"] > :has([data-cds="ChatComposerEditor"]) { background: none !important; box-shadow: none !important; }
html[data-pxt-sky] [data-cds="AssistantMessage"] [data-cds="Prose"] { background: rgba(255, 255, 255, .52); -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); border-radius: 16px; padding: 12px 18px; margin-inline: -18px; box-shadow: 0 6px 20px rgba(0, 0, 0, .08), inset 0 0 0 .5px rgba(255, 255, 255, .5); }
html[data-pxt-sky][data-mode="dark"] [data-cds="AssistantMessage"] [data-cds="Prose"] { background: rgba(26, 26, 30, .52); box-shadow: 0 6px 20px rgba(0, 0, 0, .25), inset 0 0 0 .5px rgba(255, 255, 255, .08); }
html[data-pxt-sky] [data-cds="UserMessage"] [class*="message-bubble-radius"] { background-color: rgba(255, 255, 255, .66) !important; -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); margin-inline-end: -18px; box-shadow: 0 6px 20px rgba(0, 0, 0, .1), inset 0 0 0 .5px rgba(255, 255, 255, .55); }
html[data-pxt-sky][data-mode="dark"] [data-cds="UserMessage"] [class*="message-bubble-radius"] { background-color: rgba(48, 48, 56, .66) !important; box-shadow: 0 6px 20px rgba(0, 0, 0, .3), inset 0 0 0 .5px rgba(255, 255, 255, .1); }
html[data-pxt-sky] [data-pxt-fade] { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--pxt-fade, 0px) - 44px), transparent calc(100% - var(--pxt-fade, 0px))); mask-image: linear-gradient(to bottom, #000 calc(100% - var(--pxt-fade, 0px) - 44px), transparent calc(100% - var(--pxt-fade, 0px))); }
html[data-pxt-sky] { --cds-tooltip-bg: #262624 !important; --cds-tooltip-fg: #f6f5f0 !important; }
html[data-pxt-sky] [data-cds="Tooltip"] [role="tooltip"] { background-color: #262624 !important; color: #f6f5f0 !important; border-color: rgba(255,255,255,.14) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
`;

  const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.rim { position: absolute; overflow: hidden; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .8s, visibility 0s .8s; }
.rim.on { opacity: 1; visibility: visible; transition: opacity .5s; }
.rim i { position: absolute; left: 0; width: 34%; height: 12px; will-change: transform; background: linear-gradient(90deg, transparent, #d97757 34%, #ffc98a 76%, #fff6e4 95%, transparent); animation: 4.4s linear infinite paused; }
.rim.on i { animation-play-state: running; }
.rim i:first-child { top: 0; animation-name: rim-top; -webkit-mask-image: linear-gradient(to bottom, #000, rgba(0,0,0,.42) 2px, rgba(0,0,0,.12) 6px, transparent); mask-image: linear-gradient(to bottom, #000, rgba(0,0,0,.42) 2px, rgba(0,0,0,.12) 6px, transparent); }
.rim i:last-child { bottom: 0; animation-name: rim-low; -webkit-mask-image: linear-gradient(to top, #000, rgba(0,0,0,.42) 2px, rgba(0,0,0,.12) 6px, transparent); mask-image: linear-gradient(to top, #000, rgba(0,0,0,.42) 2px, rgba(0,0,0,.12) 6px, transparent); }
@keyframes rim-top { 0% { transform: translateX(-100%); } 54%, 100% { transform: translateX(294%); } }
@keyframes rim-low { 0%, 46% { transform: translateX(294%) scaleX(-1); } 100% { transform: translateX(-100%) scaleX(-1); } }
@media (prefers-reduced-motion: reduce) { .rim i { display: none; } .rim { box-shadow: inset 0 0 0 1px #ffc98a; } }
.fab {
  position: relative; display: grid; grid-template-columns: repeat(3, 5px); grid-auto-rows: 5px; gap: 2.5px; place-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 14px; cursor: pointer; background: transparent;
  transition: background .18s, transform .22s cubic-bezier(.3,1.7,.55,1);
}
:host(:not([data-docked])) .fab { width: 34px; height: 34px; border-radius: 11px; background: rgba(24,24,28,.55); }
.fab:hover { background: rgba(255,255,255,.16); transform: scale(1.1); }
.fab:active { transform: scale(.9); }
.fab:focus-visible { outline: 2px solid #5aa2ff; outline-offset: 1px; }
.fab i { display: block; border-radius: 1.6px; }
.fab.on::after { content: ""; position: absolute; left: 50%; bottom: 0; width: 3px; height: 3px; margin-left: -1.5px; border-radius: 50%; background: #fff; }
.panel {
  position: fixed; z-index: 2147483001; width: min(440px, calc(100vw - 20px)); border-radius: 14px; overflow: hidden;
  color: #1d1d1f; background: rgba(246,246,248,.92); border: .5px solid rgba(0,0,0,.2);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.5), 0 24px 70px rgba(0,0,0,.34), 0 6px 18px rgba(0,0,0,.2);
  -webkit-backdrop-filter: blur(26px) saturate(1.7); backdrop-filter: blur(26px) saturate(1.7);
  font: 13px/1.35 "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
  -webkit-font-smoothing: antialiased; will-change: transform, opacity;
}
.panel.dark { color: #f5f5f7; background: rgba(36,36,40,.92); border-color: rgba(255,255,255,.16); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.08), 0 24px 70px rgba(0,0,0,.5), 0 6px 18px rgba(0,0,0,.3); }
.hd { position: relative; display: flex; align-items: center; height: 40px; padding: 0 14px; border-bottom: .5px solid rgba(127,127,127,.25); }
.lights { position: relative; z-index: 1; display: flex; gap: 8px; }
.lights button { width: 12px; height: 12px; padding: 0; border: .5px solid rgba(0,0,0,.16); border-radius: 50%; cursor: pointer; color: transparent; font: 700 10px/10px "Segoe UI", sans-serif; text-align: center; }
.lights:hover button { color: rgba(0,0,0,.6); }
.lights .r { background: #ff5f57; }
.lights .y { background: #febc2e; }
.lights .g { background: #28c840; }
.ttl { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 600; pointer-events: none; }
.note { padding: 10px 14px 0; font-size: 12px; opacity: .75; }
.list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 14px; outline: none; }
.it { min-width: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.th { display: block; aspect-ratio: 8 / 5; border-radius: 9px; overflow: hidden; outline: 2.5px solid transparent; outline-offset: 2px; background: rgba(127,127,127,.2); box-shadow: 0 1px 4px rgba(0,0,0,.28); transition: outline-color .15s, transform .22s cubic-bezier(.3,1.5,.6,1); }
.th canvas { display: block; width: 100%; height: 100%; }
.it:hover .th { transform: translateY(-2px); }
.it.sel .th { outline-color: #0a84ff; }
.nm { display: block; margin-top: 7px; font-size: 12.5px; font-weight: 500; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.it.cur .nm::after { content: " \\2713"; color: #0a84ff; font-weight: 700; }
.off { display: grid; place-items: center; height: 100%; font-weight: 600; opacity: .7; background: repeating-linear-gradient(45deg, rgba(127,127,127,.2) 0 6px, transparent 6px 12px); }
.ctl { margin: 0 14px 14px; border-radius: 10px; background: rgba(127,127,127,.13); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 36px; padding: 0 12px; font-size: 12.5px; }
.row + .row { border-top: .5px solid rgba(127,127,127,.25); }
.row input[type=range] { width: 170px; margin: 0; accent-color: #0a84ff; cursor: pointer; }
.sw { appearance: none; -webkit-appearance: none; position: relative; width: 34px; height: 20px; margin: 0; border-radius: 10px; background: rgba(127,127,127,.42); cursor: pointer; transition: background .2s; }
.sw::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.4); transition: transform .22s cubic-bezier(.3,1.4,.6,1); }
.sw:checked { background: #34c759; }
.sw:checked::after { transform: translateX(14px); }
.act { padding: 3px 14px; border: 0; border-radius: 7px; background: #0a84ff; color: #fff; font: 600 12px/1.5 inherit; cursor: pointer; }
.act:hover { background: #2a96ff; }
`;

  function sheet(css, target) {
    try {
      const s = new CSSStyleSheet();
      s.replaceSync(css);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, s];
      return;
    } catch (e) {
      /* older browser: fall back to a <style> element */
    }
    const el = document.createElement('style');
    el.textContent = css;
    (target === document ? document.head || document.documentElement : target).appendChild(el);
  }

  /* ---------------------------------------------------- background scanner */

  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const colors = new Map();

  // Any CSS color (rgb, hsl, oklch, ...) -> {r, g, b, a}.
  function toRGBA(s) {
    if (!s || s === 'transparent') return null;
    if (colors.has(s)) return colors.get(s);
    let v = null;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
    if (m) {
      v = { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : m[5] ? m[4] / 100 : +m[4] };
    } else {
      pctx.fillStyle = '#010203';
      pctx.fillStyle = s;
      if (pctx.fillStyle !== '#010203') {
        pctx.clearRect(0, 0, 1, 1);
        pctx.fillRect(0, 0, 1, 1);
        const d = pctx.getImageData(0, 0, 1, 1).data;
        v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
    }
    if (colors.size > 500) colors.clear();
    colors.set(s, v);
    return v;
  }

  const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

  // Saturated colors are buttons / badges: leave them alone.
  function accent(c) {
    const r = c.r / 255;
    const g = c.g / 255;
    const b = c.b / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return s > 0.4 && l > 0.18 && l < 0.85;
  }

  const SKIP = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|PICTURE|INPUT|SELECT|OPTION|SCRIPT|STYLE|LINK|META|HEAD|BR|HR|PATH|G|USE|HTML|BODY)$/i;
  const UI_SEL = 'button, a, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"]';
  const OVERLAY_SEL = 'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-radix-popper-content-wrapper]';

  const glassColor = new WeakMap();

  function mark(el, kind, c) {
    if (kind === 'glass') {
      glassColor.set(el, c);
      el.style.setProperty('--pxt-rgb', `${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}`);
    }
    el.setAttribute('data-pxt', kind);
  }

  function classify(el, vw, vh, area) {
    if (el.nodeType === 1 && el.closest(OVERLAY_SEL)) return;
    if (el.nodeType !== 1 || el.hasAttribute('data-pxt') || el.hasAttribute('data-pxt-ui') || SKIP.test(el.tagName)) return;
    const cs = getComputedStyle(el);
    const ink = toRGBA(cs.color);
    if (ink && Math.max(ink.r, ink.g, ink.b) - Math.min(ink.r, ink.g, ink.b) < 34 && lum(ink) > 0.2 && lum(ink) < 0.74 && !el.closest(UI_SEL) && !el.closest('pre, code')) el.setAttribute('data-pxt-ink', '');
    // Inline boxes (code chips, highlights) keep their look: a blurred inline box
    // that wraps across lines would blur the text next to it.
    if (cs.display === 'none' || cs.display === 'inline' || cs.display === 'contents' || cs.visibility === 'hidden') return;
    const img = cs.backgroundImage;
    const grad = img !== 'none' && /gradient/.test(img);
    if (img !== 'none' && !grad) return;
    const c = toRGBA(cs.backgroundColor);
    const solid = c && c.a >= 0.6;
    if (!solid && !grad) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const ratio = (Math.min(r.width, vw) * Math.min(r.height, vh)) / area;
    const ui = el.matches(UI_SEL);
    // Drawers, popovers and modals float above other content, so they need glass, not a hole.
    const floating = el.closest(OVERLAY_SEL) || ((cs.position === 'fixed' || cs.position === 'absolute') && cs.zIndex !== 'auto' && ratio < 0.95);

    // The frames around the prompt stay see-through; the prompt box keeps its glass.
    if ((byId(curId) || {}).fps && ((r.height > 110 && el.querySelector('textarea, [contenteditable="true"]')) || (r.height < 200 && el.querySelector('iframe')))) return mark(el, 'clear');
    // Small pop-ups (the menu on selected text, tooltips) keep the app's own look.
    if (floating && ratio < 0.12 && !el.querySelector('textarea, [contenteditable="true"]')) return;
    if (ratio >= 0.4 && !floating) return mark(el, 'clear');
    if (!solid) {
      // Fade gradients (e.g. above the composer) would paint a band of solid color.
      if (!ui && ratio >= 0.02) mark(el, 'clear');
      return;
    }
    if (ratio < 0.0015 || accent(c) || (ui && ratio < 0.03)) return;
    const outer = el.parentElement && el.parentElement.closest('[data-pxt="glass"]');
    if (outer) {
      // Same-colored wrapper inside a glass panel: drop it so the alpha doesn't stack.
      const o = glassColor.get(outer);
      if (!o || Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 24) return mark(el, 'clear');
      if (ratio < 0.02) return;
    }
    mark(el, 'glass', c);
  }

  // The veil and the picker follow the page's light/dark mode, read from its text color.
  function computeDark() {
    const mode = document.documentElement.dataset.mode;
    if (mode === 'dark' || mode === 'light') return mode === 'dark';
    const els = document.body ? document.body.querySelectorAll('p, li, h1, h2, h3, button, a') : [];
    let n = 0;
    let light = 0;
    for (const el of els) {
      if (n >= 24) break;
      if (!el.textContent.trim()) continue;
      const c = toRGBA(getComputedStyle(el).color);
      if (!c || c.a < 0.3) continue;
      n++;
      if (lum(c) > 0.55) light++;
    }
    if (!n) {
      const c = document.body && toRGBA(getComputedStyle(document.body).color);
      return c ? lum(c) > 0.55 : matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return light / n > 0.5;
  }

  let scanning = false;
  let sampleTimer = 0;
  let flushTimer = 0;
  const deepQ = new Set();
  const shallowQ = new Set();

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1) deepQ.add(n);
      } else if (m.target.nodeType === 1 && !m.target.hasAttribute('data-pxt')) {
        shallowQ.add(m.target);
      }
    }
    if (!flushTimer) flushTimer = setTimeout(flush, 350);
  });

  const work = [];
  let workAt = 0;

  // Small slices, so a large re-render never blocks the app's own animations.
  function flush() {
    flushTimer = 0;
    for (const el of deepQ) {
      if (!el.isConnected) continue;
      work.push(el);
      const all = el.getElementsByTagName('*');
      for (let i = 0; i < all.length && i < 3000; i++) work.push(all[i]);
    }
    for (const el of shallowQ) work.push(el);
    deepQ.clear();
    shallowQ.clear();
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    const stop = performance.now() + 5;
    while (workAt < work.length && performance.now() < stop) {
      const el = work[workAt++];
      if (el.isConnected) classify(el, vw, vh, area);
    }
    if (workAt < work.length) {
      flushTimer = setTimeout(flush, 32);
    } else {
      work.length = 0;
      workAt = 0;
      dockFab();
    }
  }

  function fullScan() {
    const all = document.body.getElementsByTagName('*');
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    let i = 0;
    (function chunk() {
      if (!scanning) return;
      const end = Math.min(all.length, i + 600);
      for (; i < end; i++) classify(all[i], vw, vh, area);
      if (i < all.length && i < 20000) setTimeout(chunk, 16);
    })();
  }

  // Catches elements that were hidden during the first scan and shown later.
  function sample() {
    if (document.hidden) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    const seen = new Set();
    for (let i = 1; i < 7; i++) {
      for (let j = 1; j < 9; j++) {
        const stack = document.elementsFromPoint((i / 7) * vw, (j / 9) * vh);
        for (let k = stack.length - 1; k >= 0; k--) {
          if (seen.has(stack[k])) continue;
          seen.add(stack[k]);
          classify(stack[k], vw, vh, area);
        }
      }
    }
    const d = computeDark();
    if (d !== siteDark) {
      siteDark = d;
      reglass();
      syncPanel();
      if (!raf) paint(0);
    }
  }

  function startScan() {
    if (scanning) return;
    scanning = true;
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    fullScan();
    sampleTimer = setInterval(sample, 6000);
    setTimeout(sample, 600);
  }

  function stopScan() {
    if (!scanning) return;
    scanning = false;
    mo.disconnect();
    clearInterval(sampleTimer);
    clearTimeout(flushTimer);
    flushTimer = 0;
    deepQ.clear();
    shallowQ.clear();
  }

  /* --------------------------------------------------------------- renderer */

  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const FPS = 30;
  let siteDark = false;
  let canvas = null;
  let world = null;
  let curId = 'off';
  let raf = 0;
  let last = 0;

  function measure() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    const cell = 10;
    // Keep the backing store under ~6M pixels on big screens.
    const dpr = clamp(Math.min(devicePixelRatio || 1, 2, Math.sqrt(6e6 / (w * h))), 1, 2);
    return { w, h, cell, dpr };
  }

  function ensureCanvas() {
    if (canvas && canvas.isConnected) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('data-pxt-ui', 'bg');
      canvas.setAttribute('aria-hidden', 'true');
      world = new World(canvas);
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);
      addEventListener('resize', onResize);
    }
    root.appendChild(canvas);
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeNow, 120);
  }

  function resizeNow() {
    if (!world || !world.th || curId === 'off') return;
    const m = measure();
    if (Math.abs(m.w - world.w) < 1 && Math.abs(m.h - world.h) < 1 && m.dpr === world.dpr) return;
    const { cols, rows, cell } = world;
    world.resize(m.w, m.h, m.cell, m.dpr);
    // Small changes (mobile toolbars) keep the scene; big ones rebuild it.
    if (m.cell !== cell || Math.abs(world.cols - cols) / cols > 0.25 || Math.abs(world.rows - rows) / rows > 0.25) world.setTheme(world.th);
    paint(0);
    if (open) place();
  }

  let readAt = 0;
  let skyNight = false;
  let inkFor = null;
  let hostMode = null;
  let hostWait = 0;

  // The app's own light and dark modes give true colours, sharp text and window
  // buttons that match the sky. Where it does not follow (a fixed choice in its
  // settings) the page is inverted instead.
  function skyHost(mode) {
    const ctl = window.electronWindowControl;
    if (mode === hostMode || !ctl || !ctl.setThemeMode) return;
    hostMode = mode;
    Promise.resolve(ctl.setThemeMode(mode || 'system')).catch(() => {});
    clearTimeout(hostWait);
    hostWait = setTimeout(() => {
      hostWait = 0;
      const d = computeDark();
      if (d !== siteDark) {
        siteDark = d;
        reglass();
      }
      skyMode();
      syncPanel();
    }, 400);
  }

  // Glass keeps the colour of the panel under it, which a new mode has changed.
  function reglass() {
    const els = [...document.querySelectorAll('[data-pxt="glass"]')];
    for (const el of els) el.removeAttribute('data-pxt');
    const colors = els.map((el) => toRGBA(getComputedStyle(el).backgroundColor));
    els.forEach((el, i) => mark(el, 'glass', colors[i] || glassColor.get(el)));
  }

  // The app keeps its own colours, so when the sky disagrees with them the whole
  // page is inverted; the canvas lives outside <body> and stays as drawn.
  function skyMode() {
    const st = (byId(curId) || {}).sky && world && world.s.st;
    root.toggleAttribute('data-pxt-sky', !!st);
    if (st) {
      // Measured on the picture itself when the engine is drawing it.
      // Close calls (dawn, dusk) go to white text, which the engine can help along.
      if (world.th.engine && skyG) skyNight = skyG.black - skyG.white < 0.5 ? true : skyG.black - skyG.white > 0.8 ? false : skyNight;
      else {
        const L = skyLum(st);
        skyNight = L < 0.46 ? true : L > 0.54 ? false : skyNight;
      }
    }
    skyHost(st ? (skyNight ? 'dark' : 'light') : null);
    if (!hostWait) root.toggleAttribute('data-pxt-flip', !!st && skyNight !== siteDark);
    // Only when it changes: a new value on the root restyles the whole app.
    if (inkFor !== siteDark) {
      inkFor = siteDark;
      root.style.setProperty('--pxt-halo', siteDark ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.8)');
      root.style.setProperty('--pxt-ink', siteDark ? '#d8d7d1' : '#3a3a37');
    }
  }

  function paint(dt) {
    if (world && world.th && world.th.engine) return;
    if (!world || !world.th) return;
    world.veilColor = siteDark ? '#141413' : '#fbfaf6';
    const mismatch = world.th.fps || world.th.dark === siteDark ? 0 : 0.42;
    world.veil = clamp(cfg.veil * (world.th.veilScale || 1) + mismatch, 0, 0.9);
    const now = performance.now();
    if (now > readAt) {
      readAt = now + 700;
      skyMode();
    }
    world.draw(dt);
  }

  const running = () => curId !== 'off' && !world.th.engine && cfg.motion && !reduce.matches && !document.hidden;

  function loop(now) {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(loop);
    if (last && now - last < 1000 / FPS - 2) return;
    const dt = last ? Math.min(0.2, (now - last) / 1000) : 1 / FPS;
    last = now;
    paint(dt);
  }

  function startLoop() {
    skyRun();
    if (!raf && running()) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  function stopLoop() {
    skyRun();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));

  function applyTheme(id) {
    if (id === 'troi3d' && skyFailed) id = 'troi';
    const th = byId(id);
    if (!th) {
      root.removeAttribute('data-pxt-on');
      stopLoop();
      stopScan();
      curId = 'off';
      skyRun();
      skyMode();
      syncPanel();
      return;
    }
    ensureCanvas();
    root.setAttribute('data-pxt-on', '');
    root.style.setProperty('--pxt-alpha', String(cfg.glass));
    root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 || (byId(id) || {}).fps ? '0px' : '12px');
    siteDark = computeDark();
    const m = measure();
    if (m.w !== world.w || m.h !== world.h || m.dpr !== world.dpr || m.cell !== world.cell) world.resize(m.w, m.h, m.cell, m.dpr);
    if (curId !== id) {
      world.setTheme(th);
      curId = id;
    }
    skyMode();
    syncPanel();
    startScan();
    paint(0);
    startLoop();
  }

  /* --------------------------------------------------------------------- UI */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  const FAB_COLORS = ['#86c3f2', '#ffffff', '#d97757', '#34b6c4', '#ff8fc8', '#d9ff6e', '#b49cff', '#fff2c7', '#ff7b2e'];

  let host = null;
  let fab = null;
  let dock = null;
  let rim = null;
  let rimBox = '';
  let dockSeen = null;
  let bandHost = null;
  let fadeEl = null;
  let veilRow = null;
  let panelRun = null;
  let panel = null;
  let note = null;
  let list = null;
  let items = [];
  let open = false;
  let fromCmd = false;
  let editor = null;
  let anchor = null;
  let sel = 0;

  function thumb(th) {
    const cv = document.createElement('canvas');
    const w = new World(cv);
    w.resize(92, 60, 4, 2);
    w.setTheme(th);
    w.draw(0.5);
    w.draw(0.5);
    return cv;
  }

  function buildUI() {
    host = h('div', { 'data-pxt-ui': 'host' });
    const sh = host.attachShadow({ mode: 'open' });
    sheet(UI_CSS, sh);

    fab = h(
      'button',
      { class: 'fab', type: 'button', title: 'Hình nền (Alt+T)', 'aria-label': 'Đổi hình nền', onclick: () => (open ? closePicker(false) : openPicker(null, false)) },
      FAB_COLORS.map((c) => {
        const i = h('i');
        i.style.setProperty('background', c);
        return i;
      }),
    );
    fab.hidden = !cfg.button;

    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Chọn hình nền', hidden: true });
    sh.append(panel);
    root.appendChild(host);

    dock = h('div', { 'data-pxt-ui': 'dock' });
    const ds = dock.attachShadow({ mode: 'open' });
    sheet(UI_CSS, ds);
    rim = h('div', { class: 'rim' }, h('i'), h('i'));
    ds.append(rim, fab);
    root.appendChild(dock);
    if (window.ResizeObserver) dockSeen = new ResizeObserver(() => dockFab());
    dockFab();
    setInterval(() => document.hidden || dockFab(), 2000);
    skyReport();
  }

  function skyReport() {
    let long = 0;
    let worst = 0;
    const watch = new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        long += 1;
        worst = Math.max(worst, task.duration);
      }
    });
    try {
      watch.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      /* ignore */
    }
    setTimeout(async () => {
      watch.disconnect();
      const m = await skyCall({ t: 'stats', gpu: true });
      if (m) console.warn(`[troi] ${Math.round(m.fps / 20)} hình/giây, CPU ${m.cpuMs.toFixed(2)} ms, GPU ${m.gpuMs == null ? '–' : m.gpuMs.toFixed(2)} ms, nền ${m.res[0]}×${m.res[1]}, ${document.getElementsByTagName('*').length} phần tử, ${long} tác vụ dài trên trang, lâu nhất ${Math.round(worst)} ms, chữ tan dần: ${fadeEl && fadeEl.hasAttribute('data-pxt-fade') ? 'có' : 'không'}, thanh: ${bandHost ? 'có' : 'không'}`);
    }, 20000);
  }

  const glassed = new WeakSet();
  const bandImage = (site) => {
    const drawn = site.querySelector('[data-plugin-drawn]');
    const shadow = drawn && drawn.shadowRoot;
    const img = shadow && shadow.querySelector('img[alt^="Quota"]');
    if (img && !glassed.has(shadow)) {
      glassed.add(shadow);
      sheet('img[alt^="Quota"] { width: 600px; height: auto !important; aspect-ratio: 600 / 36; margin-inline: auto; border-radius: 18px; -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7); }', shadow);
      new MutationObserver(() => dockFab()).observe(shadow, { subtree: true, childList: true, attributes: true, attributeFilter: ['alt'] });
    }
    return img;
  };

  // The app draws the quota band in a shadow root, in its "above the prompt" site.
  function findBand() {
    const site = document.querySelector('[data-engine-site="AbovePrompt"]');
    return site && bandImage(site) ? site : null;
  }

  // Text scrolling down dissolves just above the band instead of running on behind
  // the band and the prompt.
  function skyFade(edge) {
    const column = document.querySelector('[data-epitaxy-transcript-region]') || document.querySelector('[data-epitaxy-chat-column]');
    if (!fadeEl || !fadeEl.isConnected || !fadeEl.contains(column)) {
      if (fadeEl) fadeEl.removeAttribute('data-pxt-fade');
      fadeEl = null;
      for (let el = column; el && el !== document.body; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.clientHeight > innerHeight * 0.4) {
          fadeEl = el;
          break;
        }
      }
    }
    if (!fadeEl) return;
    // Never on a box that also holds the prompt or the band: the mask would hide them.
    if (fadeEl.querySelector('textarea, [contenteditable="true"]') || (bandHost && fadeEl.contains(bandHost))) {
      fadeEl.removeAttribute('data-pxt-fade');
      return;
    }
    fadeEl.setAttribute('data-pxt-fade', '');
    fadeEl.style.setProperty('--pxt-fade', `${Math.max(0, Math.round(fadeEl.getBoundingClientRect().bottom - edge + 4))}px`);
  }

  // The button sits in the slot the band leaves at its right end, as a neighbour of
  // the band, so it moves with the prompt by itself.
  function dockFab() {
    if (!dock) return;
    const band = findBand();
    if (band !== bandHost) {
      bandHost = band;
      if (dockSeen) {
        dockSeen.disconnect();
        if (band) {
          dockSeen.observe(band);
          dockSeen.observe(band.parentElement);
          const box = document.querySelector('textarea, [contenteditable="true"]');
          if (box) dockSeen.observe(box);
        }
      }
    }
    if (!band) {
      if (dock.parentElement !== root) root.appendChild(dock);
      dock.removeAttribute('data-docked');
      dock.style.removeProperty('right');
      dock.style.removeProperty('top');
      rim.classList.remove('on');
      const box = promptBox();
      if (box) skyFade(box.top);
      return;
    }
    const parent = band.parentElement;
    if (dock.parentElement !== parent) parent.appendChild(dock);
    dock.setAttribute('data-docked', '');
    if (getComputedStyle(parent).position === 'static') parent.style.setProperty('position', 'relative');
    const b = bandImage(band).getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    // The image box can be wider than the drawing, which then sits in its middle.
    const k = Math.min(b.width / 600, b.height / 36);
    const end = b.left + (b.width + 600 * k) / 2;
    dock.style.setProperty('right', `${p.right - end + 18 * k - 14}px`);
    dock.style.setProperty('top', `${b.top - p.top + b.height / 2 - 14}px`);
    const glass = `right:${14 - 18 * k}px;top:${14 - 18 * k}px;width:${600 * k}px;height:${36 * k}px;border-radius:${18 * k}px`;
    if (glass !== rimBox) rim.style.cssText = rimBox = glass;
    rim.classList.toggle('on', bandImage(band).alt.endsWith('đang làm việc'));
    skyFade(b.top);
  }

  function buildPanel() {
    list = h('div', { class: 'list', role: 'listbox', 'aria-label': 'Themes' });
    items = ITEMS.map((id, i) => {
      const th = byId(id);
      const btn = h(
        'button',
        {
          class: 'it',
          type: 'button',
          role: 'option',
          onclick: () => {
            sel = i;
            commit(id);
            if (fromCmd) {
              fromCmd = false;
              clearEditor(editor);
            }
          },
        },
        h('span', { class: 'th' }, th ? thumb(th) : h('span', { class: 'off' }, 'OFF')),
        h('span', { class: 'nm' }, th ? th.name : 'Tắt'),
      );
      list.append(btn);
      return btn;
    });

    const row = (label, control) => h('div', { class: 'row' }, h('span', null, label), control);
    const range = (min, max, key, after) =>
      h('input', {
        type: 'range',
        min,
        max,
        step: '0.05',
        value: String(cfg[key]),
        'aria-label': key,
        oninput: (e) => {
          cfg[key] = +e.target.value;
          save();
          after();
        },
      });
    const check = (key, after) =>
      h('input', {
        class: 'sw',
        type: 'checkbox',
        checked: cfg[key],
        'aria-label': key,
        onchange: (e) => {
          cfg[key] = e.target.checked;
          save();
          after();
        },
      });
    const light = (cls, title, glyph, press) => h('button', { class: cls, type: 'button', title, 'aria-label': title, onclick: press }, glyph);
    const tour = () => (closePicker(true), startTour());

    note = h('div', { class: 'note', hidden: true });
    veilRow = row(
      'Làm dịu nền',
      range('0', '0.8', 'veil', () => {
        if (!raf) paint(0);
      }),
    );
    panel.append(
      h(
        'div',
        { class: 'hd' },
        h('div', { class: 'lights' }, light('r', 'Đóng', '\u00d7', () => closePicker(false)), light('y', 'Thu về nút', '\u2212', () => closePicker(false)), light('g', 'Xem tất cả', '+', tour)),
        h('span', { class: 'ttl' }, 'Hình nền'),
      ),
      note,
      list,
      h(
        'div',
        { class: 'ctl' },
        veilRow,
        row(
          'Độ đục khung',
          range('0.3', '0.95', 'glass', () => {
            root.style.setProperty('--pxt-alpha', String(cfg.glass));
            root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 || (byId(curId) || {}).fps ? '0px' : '12px');
          }),
        ),
        row(
          'Chuyển động',
          check('motion', () => {
            if (cfg.motion) startLoop();
            else stopLoop();
          }),
        ),
        row(
          'Hiện nút',
          check('button', () => {
            fab.hidden = !cfg.button;
          }),
        ),
        row('Xem mọi buổi và thời tiết', h('button', { class: 'act', type: 'button', onclick: tour }, 'Xem')),
      ),
    );
  }

  function syncPanel() {
    if (!panel) return;
    const th = byId(curId);
    panel.classList.toggle('dark', th && th.sky ? skyNight : siteDark);
    if (veilRow) veilRow.hidden = !!(th && th.engine);
    if (!note) return;
    note.hidden = !th || th.fps || th.dark === siteDark;
    note.textContent = th && th.dark ? 'Theme tối: bật giao diện Dark của trang để màu rõ hơn.' : 'Theme sáng: hợp với giao diện Light của trang hơn.';
  }

  function highlight() {
    syncPanel();
    items.forEach((b, i) => {
      b.classList.toggle('sel', i === sel);
      b.classList.toggle('cur', ITEMS[i] === cfg.theme);
      b.setAttribute('aria-selected', String(i === sel));
    });
    // The grid wraps; on a short screen it scrolls vertically to keep the selection in view.
    const b = items[sel];
    if (b && list) {
      const T = b.offsetTop;
      const B = T + b.offsetHeight;
      if (T < list.scrollTop) list.scrollTop = T - 4;
      else if (B > list.scrollTop + list.clientHeight) list.scrollTop = B - list.clientHeight + 4;
    }
  }

  function place() {
    const a = anchor && anchor.isConnected ? (anchor.closest('fieldset, form') || anchor).getBoundingClientRect() : null;
    const ph = panel.offsetHeight;
    const pw = panel.offsetWidth;
    const vh = innerHeight;
    const vw = document.documentElement.clientWidth || innerWidth;
    let top = vh - ph - 96;
    if (a && a.top - ph - 12 > 8) top = a.top - ph - 12;
    else if (a && a.bottom + ph + 10 < vh) top = a.bottom + 10;
    panel.style.setProperty('top', Math.max(8, top) + 'px');
    panel.style.setProperty('left', clamp(a ? a.left + a.width / 2 : vw / 2, pw / 2 + 10, vw - pw / 2 - 10) - pw / 2 + 'px');
  }

  function openPicker(anchorEl, cmd) {
    if (!items.length) buildPanel();
    open = true;
    fromCmd = !!cmd;
    anchor = anchorEl || (fab.hidden ? null : fab);
    sel = Math.max(0, ITEMS.indexOf(cfg.theme));
    panel.hidden = false;
    highlight();
    place();
    if (skyThumb) skyPreview(skyThumb);
    fab.classList.add('on');
    panelMotion(true);
  }

  // Opens and closes like a Mac app: out of its Dock icon on a spring, back into it.
  function panelMotion(opening) {
    if (panelRun) panelRun.cancel();
    panelRun = null;
    const settle = () => {
      panelRun = null;
      if (!opening) panel.hidden = true;
    };
    if (reduce.matches || !panel.animate) return settle();
    const p = panel.getBoundingClientRect();
    const f = !fab.hidden && fab.getBoundingClientRect();
    const x = f && f.width ? f.left + f.width / 2 - p.left : p.width / 2;
    const y = f && f.width ? f.top + f.height / 2 - p.top : p.height;
    panel.style.setProperty('transform-origin', `${x}px ${y}px`);
    const away = 'perspective(900px) rotateX(-24deg) scale(0.08, 0.03)';
    panelRun = panel.animate(
      opening
        ? [
            { transform: away, opacity: 0 },
            { transform: 'perspective(900px) rotateX(-8deg) scale(0.72, 0.6)', opacity: 1, offset: 0.34 },
            { transform: 'perspective(900px) rotateX(0deg) scale(1.016)', opacity: 1, offset: 0.68 },
            { transform: 'perspective(900px) rotateX(0deg) scale(0.997)', opacity: 1, offset: 0.86 },
            { transform: 'perspective(900px) rotateX(0deg) scale(1)', opacity: 1 },
          ]
        : [
            { transform: 'perspective(900px) rotateX(0deg) scale(1)', opacity: 1 },
            { transform: 'perspective(900px) rotateX(-8deg) scale(0.66, 0.52)', opacity: 1, offset: 0.55 },
            { transform: away, opacity: 0 },
          ],
      { duration: opening ? 440 : 260, easing: opening ? 'cubic-bezier(.2,.7,.3,1)' : 'cubic-bezier(.45,0,.8,.5)' },
    );
    panelRun.onfinish = settle;
    if (opening && !fab.hidden) {
      fab.animate(
        [
          { transform: 'translateY(0)' },
          { transform: 'translateY(-5px)', offset: 0.3 },
          { transform: 'translateY(0)', offset: 0.6 },
          { transform: 'translateY(-2px)', offset: 0.8 },
          { transform: 'translateY(0)' },
        ],
        { duration: 480, easing: 'ease-out' },
      );
    }
  }

  function closePicker(keep) {
    if (!open) return;
    if (!keep && curId !== cfg.theme) applyTheme(cfg.theme);
    open = false;
    fromCmd = false;
    anchor = null;
    fab.classList.remove('on');
    panelMotion(false);
  }

  function move(d) {
    sel = (sel + d + ITEMS.length) % ITEMS.length;
    applyTheme(ITEMS[sel]); // live preview, saved only on Enter / click
    highlight();
  }

  function commit(id) {
    cfg.theme = id;
    save();
    applyTheme(id);
    if (open) highlight();
  }

  function findTheme(q) {
    q = strip(q);
    if (!q) return -1;
    if (/^(off|tat|none|0)$/.test(q)) return ITEMS.indexOf('off');
    const exact = THEMES.findIndex((t) => t.id === q || strip(t.name) === q || t.alias.includes(q));
    if (exact >= 0) return exact;
    return THEMES.findIndex((t) => t.id.startsWith(q) || strip(t.name).includes(q) || t.alias.some((a) => a.startsWith(q)));
  }

  /* ------------------------------------------------------- /theme command */

  // "/thêm" and "/nen" are there because Vietnamese Telex keyboards turn "theme" into "thêm".
  const CMD = /^\/(theme|thêm|them|nen|nền)(?:\s+(.*))?$/iu;

  function editableRoot(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search)$/i.test(t.type))) return t;
    return t.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  }

  const textOf = (el) => (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText || '');

  function clearEditor(el) {
    if (!el || !el.isConnected) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    if (!document.execCommand('delete', false)) el.textContent = '';
  }

  function runCommand(text) {
    const m = CMD.exec(String(text).normalize('NFC').trim());
    if (!m) return false;
    const i = m[2] ? findTheme(m[2]) : -1;
    if (i >= 0) commit(ITEMS[i]);
    else openPicker(null, false);
    return true;
  }

  document.addEventListener(
    'input',
    (e) => {
      const el = editableRoot(e.target);
      if (!el || (host && host.contains(el))) return;
      if (/^\/xem$/i.test(textOf(el).normalize('NFC').trim())) {
        setTimeout(() => {
          clearEditor(el);
          startTour();
        }, 0);
        return;
      }
      const m = CMD.exec(textOf(el).normalize('NFC').trim());
      if (m) {
        editor = el;
        if (!open) openPicker(el, true);
        fromCmd = true;
        const i = m[2] ? findTheme(m[2]) : -1;
        if (i >= 0 && i !== sel) {
          sel = i;
          applyTheme(ITEMS[i]);
          highlight();
        }
      } else if (open && fromCmd) {
        closePicker(false);
      }
    },
    true,
  );

  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && tourTimer) {
        // In the app Esc also stops Claude's work: here it only ends the tour.
        e.preventDefault();
        e.stopImmediatePropagation();
        stopTour();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const box = editableRoot(e.composedPath()[0]);
        if (box && /^\/xem$/i.test(textOf(box).normalize('NFC').trim())) {
          e.preventDefault();
          e.stopImmediatePropagation();
          clearEditor(box);
          startTour();
          return;
        }
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        if (open) closePicker(false);
        else openPicker(editableRoot(document.activeElement), false);
        return;
      }
      if (!open || e.isComposing) return;
      const target = e.composedPath()[0];
      if (target && target.tagName === 'INPUT' && target.type === 'range') return;
      // Opened from the button while the user types elsewhere: only Esc belongs to us.
      if (!fromCmd && editableRoot(document.activeElement) && e.key !== 'Escape') return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        stop();
        move(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        stop();
        const wasCmd = fromCmd;
        commit(ITEMS[sel]);
        closePicker(true);
        if (wasCmd) clearEditor(editor);
      } else if (e.key === 'Escape') {
        stop();
        closePicker(false);
      }
    },
    true,
  );

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (open && !e.composedPath().includes(host) && !e.composedPath().includes(dock) && !(fromCmd && e.composedPath().includes(editor))) closePicker(false);
    },
    true,
  );

  addEventListener('resize', () => open && place());
  if (window.visualViewport) visualViewport.addEventListener('resize', () => open && place());
  reduce.addEventListener && reduce.addEventListener('change', () => (running() ? startLoop() : (stopLoop(), paint(0))));

  /* ------------------------------------------------------------------- boot */

  window.__pixelThemes = {
    themes: ITEMS.slice(),
    get current() {
      return cfg.theme;
    },
    set(id) {
      if (!ITEMS.includes(id)) return false;
      commit(id);
      return true;
    },
    open: () => openPicker(null, false),
    close: () => closePicker(true),
    command: runCommand,
    skyHour(h) {
      skyHour = h == null ? null : +h;
      if (world && world.th && world.th.sky) world.setTheme(world.th);
      paint(0);
    },
    skyWeather(name) {
      wxForced = WX[name] ? name : null;
      if (wxForced) skyWx = { ...WX[name] };
      else loadWeather();
      if (world && world.th && world.th.sky) world.setTheme(world.th);
      paint(0);
    },
    weather: () => ({ ...skyWx }),
    skyDemo() {
      skyDemoAt = Date.now();
      const id = setInterval(() => {
        if (!skyDemoAt || !skyPort) {
          clearInterval(id);
          skyPush(1);
        } else skyPush(0.25);
      }, 100);
    },
    sky: () => ({ ...skyAt(skyMs()), phase: skyPhase(skyMs()) }),
    stats: (gpu) => skyCall({ t: 'stats', gpu }),
    tour: startTour,
    skyStep: (n) => skyCall({ t: 'step', n }),
    dockState: () => ({ band: !!bandHost, docked: dock.hasAttribute('data-docked'), fade: !!(fadeEl && fadeEl.hasAttribute('data-pxt-fade')), mode: root.dataset.mode, flip: root.hasAttribute('data-pxt-flip'), rim: !!rim && rim.classList.contains('on') }),
  };

  // One day, with its weather coming and going in the order it really does:
  // seconds, hour from, hour to, weather, label, moon.
  const TOUR = [
    [6, 5.3, 5.95, 'nang', 'Trước bình minh'],
    [7, 5.95, 6.7, 'nang', 'Bình minh'],
    [8, 6.7, 7.6, 'suong', 'Sương sớm'],
    [8, 7.6, 9.4, 'nangnhe', 'Sáng, nắng nhẹ'],
    [7, 9.4, 11.4, 'nang', 'Trưa, nắng to'],
    [8, 11.4, 12.2, 'den', 'Mây đen kéo đến'],
    [7, 12.2, 12.7, 'gionoi', 'Gió nổi'],
    [7, 12.7, 13.1, 'giong', 'Sấm chớp'],
    [9, 13.1, 13.6, 'doxuong', 'Mưa đổ xuống'],
    [12, 13.6, 14.1, 'bao', 'Bão, gió giật gãy cành'],
    [8, 14.1, 14.4, 'loc', 'Lốc xoáy'],
    [7, 14.4, 14.7, 'rao', 'Mưa nhỏ dần'],
    [6, 14.7, 15, 'phun', 'Sắp tạnh'],
    [13, 15, 15.9, 'nangnhe', 'Trời quang, cầu vồng'],
    [7, 15.9, 16.7, 'nang', 'Chiều nắng vàng'],
    [9, 16.7, 17.4, 'nang', 'Hoàng hôn'],
    [7, 17.4, 18.2, 'nang', 'Chạng vạng'],
    [8, 18.2, 20.5, 'nang', 'Đêm không trăng', 0.001],
    [5, 20.5, 21, 'nang', 'Trăng lưỡi liềm', 0.15],
    [5, 21, 21.5, 'nang', 'Trăng bán nguyệt', 0.5],
    [6, 21.5, 22, 'nang', 'Trăng tròn', 1],
  ];
  let tourTimer = 0;
  let tourNote = null;

  function stopTour() {
    clearInterval(tourTimer);
    tourTimer = 0;
    if (tourNote) tourNote.remove();
    tourNote = null;
    skyHour = null;
    skyMoon = null;
    wxForced = null;
    if (skyPort) skyPort.postMessage({ t: 'dry' });
    loadWeather();
    skyPush(3, 8);
    skyMode();
  }

  function startTour() {
    if (tourTimer) stopTour();
    if (curId !== 'troi3d') applyTheme('troi3d');
    if (skyPort) skyPort.postMessage({ t: 'dry' });
    tourNote = document.createElement('div');
    tourNote.setAttribute('data-pxt-ui', 'note');
    Object.assign(tourNote.style, {
      position: 'fixed',
      top: '52px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '7px 16px',
      borderRadius: '999px',
      background: 'rgba(10,14,30,.75)',
      color: '#fff',
      font: '600 14px "Segoe UI", sans-serif',
      zIndex: '2147483000',
    });
    root.appendChild(tourNote);
    const started = performance.now();
    let shown = -1;
    tourTimer = setInterval(() => {
      let at = (performance.now() - started) / 1000;
      let i = 0;
      while (i < TOUR.length && at >= TOUR[i][0]) at -= TOUR[i++][0];
      if (i >= TOUR.length) return stopTour();
      const [seconds, from, to, weather, label, moon] = TOUR[i];
      skyHour = from + ((to - from) * at) / seconds;
      if (i !== shown) {
        shown = i;
        tourNote.textContent = `${label} · Esc để thoát`;
        skyMoon = moon || null;
        wxForced = weather;
        skyWx = { ...WX[weather] };
      }
      skyPush(0.8, 2.4);
      skyMode();
    }, 125);
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 50);
      return;
    }
    sheet(PAGE_CSS, document);
    buildUI();
    applyTheme(cfg.theme);
    say('✅ Pixel Themes đã chạy. Bấm Alt+T (hoặc nút ô vuông màu ở cạnh phải) để chọn theme.');
  }

  boot();
})();
