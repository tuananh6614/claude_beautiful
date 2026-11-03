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

