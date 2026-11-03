"""Ghép cảnh trời và phông chữ vào bản script đã rà."""
import pathlib

d = pathlib.Path(__file__).parent
s = (d / 'claude-pixel-themes.muot.user.js').read_text(encoding='utf-8')
sky = (d / 'sky-scene.js').read_text(encoding='utf-8')
sky += (d / 'sky-engine.js').read_text(encoding='utf-8')


# Phần đầu userscript: tên, tác giả và địa chỉ tự cập nhật trỏ về repo này (giữ tên tác giả gốc).
HEADER = """// ==UserScript==
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
// ==/UserScript=="""
s = HEADER + s[s.index('// ==/UserScript==') + len('// ==/UserScript=='):]


def sub(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


sub("  const ITEMS = THEMES.map((t) => t.id).concat('off');", sky + "  const ITEMS = THEMES.map((t) => t.id).concat('off');")
sub("const cfg = { theme: 'cloud', veil: 0.2, glass: 0.72, motion: true, button: true };",
    "const cfg = { theme: 'cloud', veil: 0.2, glass: 0.72, motion: true, button: true };")
s = s.replace("root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 ? '0px' : '12px');",
              "root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 || (byId(curId) || {}).fps ? '0px' : '12px');")

sub("    command: runCommand,\n  };", "    command: runCommand,\n"
    "    skyHour(h) {\n"
    "      skyHour = h == null ? null : +h;\n"
    "      if (world && world.th && world.th.id === 'troi') world.setTheme(world.th);\n"
    "      paint(0);\n"
    "    },\n"
    "    skyWeather(name) {\n"
    "      wxForced = WX[name] ? name : null;\n"
    "      if (wxForced) skyWx = { ...WX[name] };\n"
    "      else loadWeather();\n"
    "      if (world && world.th && world.th.id === 'troi') world.setTheme(world.th);\n"
    "      paint(0);\n"
    "    },\n"
    "    weather: () => ({ ...skyWx }),\n"
    "    sky: () => skyAt(skyMs()),\n"
    "    stats: (gpu) => skyCall({ t: 'stats', gpu }),\n"
    "    skyStep: (n) => skyCall({ t: 'step', n }),\n"
    "    dockState: () => ({ band: !!bandHost, docked: dock.hasAttribute('data-docked'), fade: !!(fadeEl && fadeEl.hasAttribute('data-pxt-fade')), mode: root.dataset.mode, flip: root.hasAttribute('data-pxt-flip'), rim: !!rim && rim.classList.contains('on') }),\n"
    "  };")
sub("    sheet(PAGE_CSS, document);\n", "    sheet(PAGE_CSS, document);\n    applyFont();\n")

# Không phủ gì lên cảnh: chữ tự đổi theo trời, viền mờ giữ chữ nổi trên nền.
sub("    world.veil = clamp(cfg.veil * (world.th.veilScale || 1) + (world.th.dark === siteDark ? 0 : 0.42), 0, 0.9);\n",
    "    const mismatch = world.th.fps || world.th.dark === siteDark ? 0 : 0.42;\n"
    "    world.veil = clamp(cfg.veil * (world.th.veilScale || 1) + mismatch, 0, 0.9);\n"
    "    const now = performance.now();\n"
    "    if (now > readAt) {\n"
    "      readAt = now + 700;\n"
    "      skyMode();\n"
    "    }\n")
sub("html[data-pxt-on], html[data-pxt-on] body { background-color",
    "html[data-pxt-sky] body { text-shadow: 0 0 2px var(--pxt-halo), 0 0 7px var(--pxt-halo); }\n"
    "html[data-pxt-sky] dialog, html[data-pxt-sky] [role=\"dialog\"], html[data-pxt-sky] [role=\"menu\"], html[data-pxt-sky] pre, html[data-pxt-sky] code { text-shadow: none; }\n"
    "html[data-pxt-flip] body { filter: invert(1) hue-rotate(180deg); }\n"
    "html[data-pxt-flip] body img, html[data-pxt-flip] body video, html[data-pxt-flip] body iframe, html[data-pxt-flip] body canvas { filter: hue-rotate(180deg) invert(1); }\n"
    "html[data-pxt-on], html[data-pxt-on] body { background-color")
sub("    note.hidden = !th || th.dark === siteDark;\n", "    note.hidden = !th || th.fps || th.dark === siteDark;\n")

s = s.replace("    root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 || (byId(curId) || {}).fps", "    root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 || (byId(id) || {}).fps")

# Hộp thoại của app giữ nguyên: mở ra là đúng màu, không bị đổi sang kính sau đó.
sub("  function classify(el, vw, vh, area) {\n", "  function classify(el, vw, vh, area) {\n    if (el.nodeType === 1 && el.closest(OVERLAY_SEL)) return;\n")

# Chữ phụ màu xám là thứ khó đọc nhất trên nền trời: đậm lên, không đụng chữ có màu.
sub("    const cs = getComputedStyle(el);\n    // Inline boxes (code chips, highlights) keep their look",
    "    const cs = getComputedStyle(el);\n"
    "    const ink = toRGBA(cs.color);\n"
    "    if (ink && Math.max(ink.r, ink.g, ink.b) - Math.min(ink.r, ink.g, ink.b) < 34 && lum(ink) > 0.2 && lum(ink) < 0.74 && !el.closest(UI_SEL) && !el.closest('pre, code')) el.setAttribute('data-pxt-ink', '');\n"
    "    // Inline boxes (code chips, highlights) keep their look")
sub("html[data-pxt-sky] body { text-shadow:", "html[data-pxt-sky] [data-pxt-ink] { color: var(--pxt-ink) !important; }\nhtml[data-pxt-sky] body { text-shadow:")

# Trời tối thì cả app sang giao diện tối, trời sáng thì trả lại.
sub("  function paint(dt) {\n",
    "  let readAt = 0;\n  let skyNight = false;\n  let inkFor = null;\n  let hostMode = null;\n  let hostWait = 0;\n\n"
    "  // The app's own light and dark modes give true colours, sharp text and window\n"
    "  // buttons that match the sky. Where it does not follow (a fixed choice in its\n"
    "  // settings) the page is inverted instead.\n"
    "  function skyHost(mode) {\n"
    "    const ctl = window.electronWindowControl;\n"
    "    if (mode === hostMode || !ctl || !ctl.setThemeMode) return;\n"
    "    hostMode = mode;\n"
    "    Promise.resolve(ctl.setThemeMode(mode || 'system')).catch(() => {});\n"
    "    clearTimeout(hostWait);\n"
    "    hostWait = setTimeout(() => {\n"
    "      hostWait = 0;\n"
    "      const d = computeDark();\n"
    "      if (d !== siteDark) {\n"
    "        siteDark = d;\n"
    "        reglass();\n"
    "      }\n"
    "      skyMode();\n"
    "      syncPanel();\n"
    "    }, 400);\n"
    "  }\n\n"
    "  // Glass keeps the colour of the panel under it, which a new mode has changed.\n"
    "  function reglass() {\n"
    "    const els = [...document.querySelectorAll('[data-pxt=\"glass\"]')];\n"
    "    for (const el of els) el.removeAttribute('data-pxt');\n"
    "    const colors = els.map((el) => toRGBA(getComputedStyle(el).backgroundColor));\n"
    "    els.forEach((el, i) => mark(el, 'glass', colors[i] || glassColor.get(el)));\n"
    "  }\n\n"
    "  // The app keeps its own colours, so when the sky disagrees with them the whole\n"
    "  // page is inverted; the canvas lives outside <body> and stays as drawn.\n"
    "  function skyMode() {\n"
    "    const st = curId === 'troi' && world && world.s.st;\n"
    "    root.toggleAttribute('data-pxt-sky', !!st);\n"
    "    if (st) {\n"
    "      // Measured on the picture itself when the engine is drawing it.\n"
    "      // Close calls (dawn, dusk) go to white text, which the engine can help along.\n"
    "      if (world.th.engine && skyG) skyNight = skyG.black - skyG.white < 0.5 ? true : skyG.black - skyG.white > 0.8 ? false : skyNight;\n"
    "      else {\n"
    "        const L = skyLum(st);\n"
    "        skyNight = L < 0.46 ? true : L > 0.54 ? false : skyNight;\n"
    "      }\n"
    "    }\n"
    "    skyHost(st ? (skyNight ? 'dark' : 'light') : null);\n"
    "    if (!hostWait) root.toggleAttribute('data-pxt-flip', !!st && skyNight !== siteDark);\n"
    "    // Only when it changes: a new value on the root restyles the whole app.\n"
    "    if (inkFor !== siteDark) {\n"
    "      inkFor = siteDark;\n"
    "      root.style.setProperty('--pxt-halo', siteDark ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.8)');\n"
    "      root.style.setProperty('--pxt-ink', siteDark ? '#d8d7d1' : '#3a3a37');\n"
    "    }\n"
    "  }\n\n"
    "  function paint(dt) {\n"
    "    if (world && world.th && world.th.engine) return;\n")
sub("      curId = 'off';\n      syncPanel();\n", "      curId = 'off';\n      skyRun();\n      skyMode();\n      syncPanel();\n")

s = s.replace('    applyFont();\n', '')

sub("      curId = id;\n    }\n    syncPanel();\n", "      curId = id;\n    }\n    skyMode();\n    syncPanel();\n")

sub("    if (ratio >= 0.4 && !floating) return mark(el, 'clear');\n",
    "    // The frames around the prompt stay see-through; the prompt box keeps its glass.\n"
    "    if ((byId(curId) || {}).fps && ((r.height > 110 && el.querySelector('textarea, [contenteditable=\"true\"]')) || (r.height < 200 && el.querySelector('iframe')))) return mark(el, 'clear');\n"
    "    if (ratio >= 0.4 && !floating) return mark(el, 'clear');\n")

# Chỉ giữ hai cảnh Pixel và Bầu trời: bỏ các cảnh và hình vẽ riêng của chúng.
sprites = s.index("  /* ---------------------------------------------------------------- sprites */")
themes = s.index("  const THEMES = [];")
sky_at = s.index("  /* --------------------------------------------- real sky over Hanoi")
rows_at = s.index("  // Flat-bottomed cloud made of a few overlapping ellipses.")
rows_end = s.index("  function cloud(w, anywhere, pal)")
s = s[:sprites] + s[rows_at:rows_end] + "  const THEMES = [];\n\n" + s[sky_at:]
sub("const cfg = { theme: 'cloud',", "const cfg = { theme: 'troi',")
sub("if (!ITEMS.includes(cfg.theme)) cfg.theme = 'cloud';", "if (!ITEMS.includes(cfg.theme)) cfg.theme = 'troi';")

# Mượt: quét DOM theo từng lát 5 ms, nhường hẳn cho hiệu ứng đóng mở của app.
a = s.index("  function flush() {\n")
b = s.index("  function fullScan() {\n")
s = s[:a] + (
    "  const work = [];\n"
    "  let workAt = 0;\n\n"
    "  // Small slices, so a large re-render never blocks the app's own animations.\n"
    "  function flush() {\n"
    "    flushTimer = 0;\n"
    "    for (const el of deepQ) {\n"
    "      if (!el.isConnected) continue;\n"
    "      work.push(el);\n"
    "      const all = el.getElementsByTagName('*');\n"
    "      for (let i = 0; i < all.length && i < 3000; i++) work.push(all[i]);\n"
    "    }\n"
    "    for (const el of shallowQ) work.push(el);\n"
    "    deepQ.clear();\n"
    "    shallowQ.clear();\n"
    "    const vw = innerWidth;\n"
    "    const vh = innerHeight;\n"
    "    const area = vw * vh;\n"
    "    const stop = performance.now() + 5;\n"
    "    while (workAt < work.length && performance.now() < stop) {\n"
    "      const el = work[workAt++];\n"
    "      if (el.isConnected) classify(el, vw, vh, area);\n"
    "    }\n"
    "    if (workAt < work.length) {\n"
    "      flushTimer = setTimeout(flush, 32);\n"
    "    } else {\n"
    "      work.length = 0;\n"
    "      workAt = 0;\n"
    "    }\n"
    "  }\n\n"
) + s[b:]
sub("    if (!flushTimer) flushTimer = setTimeout(flush, 250);\n", "    if (!flushTimer) flushTimer = setTimeout(flush, 350);\n")

sub("text-shadow: 0 0 2px var(--pxt-halo), 0 0 7px var(--pxt-halo);", "text-shadow: 0 0 3px var(--pxt-halo);")

sub("    sky: () => skyAt(skyMs()),\n", "    skyDemo() {\n      skyDemoAt = Date.now();\n      const id = setInterval(() => {\n        if (!skyDemoAt || !skyPort) {\n          clearInterval(id);\n          skyPush(1);\n        } else skyPush(0.25);\n      }, 100);\n    },\n    sky: () => ({ ...skyAt(skyMs()), phase: skyPhase(skyMs()) }),\n")

# Menu nổi nhỏ (menu khi bôi đen chữ, chú thích) giữ nguyên nền của app.
sub("    if (ratio >= 0.4 && !floating) return mark(el, 'clear');\n",
    "    // Small pop-ups (the menu on selected text, tooltips) keep the app's own look.\n"
    "    if (floating && ratio < 0.12 && !el.querySelector('textarea, [contenteditable=\"true\"]')) return;\n"
    "    if (ratio >= 0.4 && !floating) return mark(el, 'clear');\n")

# /xem: chạy lần lượt mọi buổi, mọi kiểu thời tiết và các pha trăng.
sub("  function boot() {\n", """  // One day, with its weather coming and going in the order it really does:
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
""")
sub("      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {\n",
    "      if (e.key === 'Escape' && tourTimer) {\n"
    "        // In the app Esc also stops Claude's work: here it only ends the tour.\n"
    "        e.preventDefault();\n"
    "        e.stopImmediatePropagation();\n"
    "        stopTour();\n"
    "        return;\n"
    "      }\n"
    "      if (e.key === 'Enter' && !e.shiftKey) {\n"
    "        const box = editableRoot(e.composedPath()[0]);\n"
    "        if (box && /^\\/xem$/i.test(textOf(box).normalize('NFC').trim())) {\n"
    "          e.preventDefault();\n"
    "          e.stopImmediatePropagation();\n"
    "          clearEditor(box);\n"
    "          startTour();\n"
    "          return;\n"
    "        }\n"
    "      }\n"
    "      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {\n")
sub("        check('Chuyển động', 'motion', () => {",
    "        h('button', { type: 'button', onclick: () => (closePicker(true), startTour()) }, 'Xem tất cả'),\n"
    "        check('Chuyển động', 'motion', () => {")
sub(".ctl input[type=checkbox] { accent-color: #2f7cf6; }\n",
    ".ctl input[type=checkbox] { accent-color: #2f7cf6; }\n"
    ".ctl button { font-size: 11px; padding: 3px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; cursor: pointer; }\n")
sub("    stats: (gpu) => skyCall({ t: 'stats', gpu }),\n", "    stats: (gpu) => skyCall({ t: 'stats', gpu }),\n    tour: startTour,\n")

# Hai cảnh trời dùng chung phần đổi chữ, /xem và thời tiết.
assert "curId === 'troi' && world" in s
s = s.replace("curId === 'troi' && world", "(byId(curId) || {}).sky && world")
s = s.replace("world.th.id === 'troi'", "world.th.sky")

# /xem chạy ngay khi gõ đủ chữ, không phải đợi Enter.
sub("      if (!el || (host && host.contains(el))) return;\n      const m = CMD.exec(textOf(el).normalize('NFC').trim());\n",
    "      if (!el || (host && host.contains(el))) return;\n"
    "      if (/^\\/xem$/i.test(textOf(el).normalize('NFC').trim())) {\n"
    "        setTimeout(() => {\n"
    "          clearEditor(el);\n"
    "          startTour();\n"
    "        }, 0);\n"
    "        return;\n"
    "      }\n"
    "      const m = CMD.exec(textOf(el).normalize('NFC').trim());\n")
s = s.replace("const cfg = { theme: 'troi',", "const cfg = { theme: 'troi3d',")
s = s.replace("if (!ITEMS.includes(cfg.theme)) cfg.theme = 'troi';", "if (!ITEMS.includes(cfg.theme)) cfg.theme = 'troi3d';")

sub("  const running = () => curId !== 'off' && cfg.motion && !reduce.matches && !document.hidden;\n",
    "  const running = () => curId !== 'off' && !world.th.engine && cfg.motion && !reduce.matches && !document.hidden;\n")
sub("  function startLoop() {\n", "  function startLoop() {\n    skyRun();\n")
sub("  function stopLoop() {\n", "  function stopLoop() {\n    skyRun();\n")
sub('html[data-pxt-on] canvas[data-pxt-ui="bg"] { display: block !important; }\n',
    'html[data-pxt-on] canvas[data-pxt-ui="bg"] { display: block !important; }\n'
    'canvas[data-pxt-ui="sky"] { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: -1 !important; pointer-events: none !important; display: none; }\n'
    'html[data-pxt-gl] canvas[data-pxt-ui="sky"] { display: block !important; }\n'
    'html[data-pxt-gl] canvas[data-pxt-ui="bg"] { display: none !important; }\n')

# Giao diện: nút nằm trong thanh quota, bảng chọn kiểu cửa sổ macOS.
a = s.index("  const UI_CSS = `\n")
b = s.index("`;\n\n  function sheet(css, target) {")
s = s[:a] + "  const UI_CSS = `\n" + (d / 'sky-ui.css').read_text(encoding='utf-8') + s[b:]

sub("""    fab = h(
      'button',
      { class: 'fab', type: 'button', title: 'Pixel themes  (/theme · Alt+T)', 'aria-label': 'Đổi hình nền pixel', onclick: () => (open ? closePicker(false) : openPicker(null, false)) },
""", """    fab = h(
      'button',
      { class: 'fab', type: 'button', title: 'Hình nền (Alt+T)', 'aria-label': 'Đổi hình nền', onclick: () => (open ? closePicker(false) : openPicker(null, false)) },
""")
sub("""    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Chọn hình nền pixel', hidden: true });
    sh.append(fab, panel);
    root.appendChild(host);
  }
""", """    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Chọn hình nền', hidden: true });
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
""")
sub("  let fab = null;\n", "  let fab = null;\n  let dock = null;\n  let rim = null;\n  let rimBox = '';\n  let dockSeen = null;\n  let bandHost = null;\n  let fadeEl = null;\n  let veilRow = null;\n  let panelRun = null;\n")

a = s.index("    const range = (label, min, max, key, after) =>\n")
b = s.index("  function syncPanel() {\n")
s = s[:a] + """    const row = (label, control) => h('div', { class: 'row' }, h('span', null, label), control);
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
        h('div', { class: 'lights' }, light('r', 'Đóng', '\\u00d7', () => closePicker(false)), light('y', 'Thu về nút', '\\u2212', () => closePicker(false)), light('g', 'Xem tất cả', '+', tour)),
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

""" + s[b:]

sub("    panel.classList.toggle('dark', siteDark);\n    if (!note) return;\n    const th = byId(curId);\n",
    "    const th = byId(curId);\n    panel.classList.toggle('dark', th && th.sky ? skyNight : siteDark);\n    if (veilRow) veilRow.hidden = !!(th && th.engine);\n    if (!note) return;\n")
sub("    panel.style.setProperty('left', clamp(a ? a.left + a.width / 2 : vw / 2, pw / 2 + 10, vw - pw / 2 - 10) + 'px');\n",
    "    panel.style.setProperty('left', clamp(a ? a.left + a.width / 2 : vw / 2, pw / 2 + 10, vw - pw / 2 - 10) - pw / 2 + 'px');\n")
sub("    if (a && a.top - ph - 10 > 8) top = a.top - ph - 10;\n", "    if (a && a.top - ph - 12 > 8) top = a.top - ph - 12;\n")
sub("""    anchor = anchorEl;
    sel = Math.max(0, ITEMS.indexOf(cfg.theme));
    panel.hidden = false;
    highlight();
    place();
  }
""", """    anchor = anchorEl || (fab.hidden ? null : fab);
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
""")
sub("""    fromCmd = false;
    anchor = null;
    panel.hidden = true;
  }
""", """    fromCmd = false;
    anchor = null;
    fab.classList.remove('on');
    panelMotion(false);
  }
""")
sub("if (open && !e.composedPath().includes(host) && !(fromCmd && e.composedPath().includes(editor))) closePicker(false);",
    "if (open && !e.composedPath().includes(host) && !e.composedPath().includes(dock) && !(fromCmd && e.composedPath().includes(editor))) closePicker(false);")
sub("      work.length = 0;\n      workAt = 0;\n    }\n  }\n\n  function fullScan() {", "      work.length = 0;\n      workAt = 0;\n      dockFab();\n    }\n  }\n\n  function fullScan() {")

# Bảng quota và khung gợi ý của app: giữ đúng màu khi cả trang đảo màu, nền đặc, chữ rõ.
sub('html[data-pxt-gl] canvas[data-pxt-ui="bg"] { display: none !important; }\n',
    'html[data-pxt-gl] canvas[data-pxt-ui="bg"] { display: none !important; }\n'
    '[data-pxt-ui="dock"] { position: fixed; right: 10px; top: 50%; z-index: 40; pointer-events: auto; }\n'
    '[data-pxt-ui="dock"][data-docked] { position: absolute; }\n'
    'html[data-pxt-flip] [data-pxt-ui="dock"][data-docked], html[data-pxt-flip] [data-engine-site="AbovePrompt"], html[data-pxt-flip] [data-cds="Tooltip"] { filter: hue-rotate(180deg) invert(1); }\n'
    'html[data-pxt-sky] [data-cds-dock-masked] { --cds-page-bg: transparent !important; }\n'
    'html[data-pxt-sky] .pointer-events-none.sticky.bottom-0 { background: none !important; }\n'
    'html[data-pxt-sky] .scroll-fade-strip-bottom, html[data-pxt-sky] .scroll-fade-strip-top { display: none !important; }\n'
    'html[data-pxt-sky] [data-code-composer-column], html[data-pxt-sky] [data-code-composer-column] :has([data-engine-site="AbovePrompt"]), html[data-pxt-sky] [data-code-composer-column] [class*="bg-alpha-1"][class*="min-h-[40px]"] { background: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; box-shadow: none !important; }\n'
    'html[data-pxt-sky] [data-cds="ChatComposer"] { background-color: rgba(255, 255, 255, .78) !important; border-radius: 14px; -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6); box-shadow: 0 8px 26px rgba(0, 0, 0, .16), inset 0 0 0 .5px rgba(255, 255, 255, .45); }\n'
    'html[data-pxt-sky][data-mode="dark"] [data-cds="ChatComposer"] { background-color: rgba(34, 34, 38, .74) !important; box-shadow: 0 8px 26px rgba(0, 0, 0, .3), inset 0 0 0 .5px rgba(255, 255, 255, .14); }\n'
    'html[data-pxt-sky] [data-cds="ChatComposer"] > :has([data-cds="ChatComposerEditor"]) { background: none !important; box-shadow: none !important; }\n'
    # Câu hỏi và câu trả lời nằm trên kính mờ riêng; dòng tiến trình (TurnStatus) để trần.
    # Khung nới ra ngoài 18px nên chữ trong khung thẳng mép với chữ ngoài khung.
    'html[data-pxt-sky] [data-cds="AssistantMessage"] [data-cds="Prose"] { background: rgba(255, 255, 255, .52); -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); border-radius: 16px; padding: 12px 18px; margin-inline: -18px; box-shadow: 0 6px 20px rgba(0, 0, 0, .08), inset 0 0 0 .5px rgba(255, 255, 255, .5); }\n'
    'html[data-pxt-sky][data-mode="dark"] [data-cds="AssistantMessage"] [data-cds="Prose"] { background: rgba(26, 26, 30, .52); box-shadow: 0 6px 20px rgba(0, 0, 0, .25), inset 0 0 0 .5px rgba(255, 255, 255, .08); }\n'
    'html[data-pxt-sky] [data-cds="UserMessage"] [class*="message-bubble-radius"] { background-color: rgba(255, 255, 255, .66) !important; -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); margin-inline-end: -18px; box-shadow: 0 6px 20px rgba(0, 0, 0, .1), inset 0 0 0 .5px rgba(255, 255, 255, .55); }\n'
    'html[data-pxt-sky][data-mode="dark"] [data-cds="UserMessage"] [class*="message-bubble-radius"] { background-color: rgba(48, 48, 56, .66) !important; box-shadow: 0 6px 20px rgba(0, 0, 0, .3), inset 0 0 0 .5px rgba(255, 255, 255, .1); }\n'
    'html[data-pxt-sky] [data-pxt-fade] { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--pxt-fade, 0px) - 44px), transparent calc(100% - var(--pxt-fade, 0px))); mask-image: linear-gradient(to bottom, #000 calc(100% - var(--pxt-fade, 0px) - 44px), transparent calc(100% - var(--pxt-fade, 0px))); }\n'
    'html[data-pxt-sky] { --cds-tooltip-bg: #262624 !important; --cds-tooltip-fg: #f6f5f0 !important; }\n'
    'html[data-pxt-sky] [data-cds="Tooltip"] [role="tooltip"] { background-color: #262624 !important; color: #f6f5f0 !important; border-color: rgba(255,255,255,.14) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }\n')
sub('html[data-pxt-sky] dialog, html[data-pxt-sky] [role=\\"dialog\\"], html[data-pxt-sky] [role=\\"menu\\"], html[data-pxt-sky] pre, html[data-pxt-sky] code { text-shadow: none; }'.replace('\\"', '"'),
    'html[data-pxt-sky] dialog, html[data-pxt-sky] [role="dialog"], html[data-pxt-sky] [role="menu"], html[data-pxt-sky] [role="tooltip"], html[data-pxt-sky] pre, html[data-pxt-sky] code { text-shadow: none; }')

sub("    sampleTimer = setInterval(sample, 3000);\n", "    sampleTimer = setInterval(sample, 6000);\n")
# Đổi sáng/tối giữa chừng thì kính lấy lại màu mới, không giữ màu của chế độ cũ.
sub("      siteDark = d;\n      syncPanel();\n      if (!raf) paint(0);\n", "      siteDark = d;\n      reglass();\n      syncPanel();\n      if (!raf) paint(0);\n")
# Máy không có WebGL2: chọn lại Bầu trời thì dùng trời vẽ 2D, không để nền trống.
sub("  function applyTheme(id) {\n    const th = byId(id);\n", "  function applyTheme(id) {\n    if (id === 'troi3d' && skyFailed) id = 'troi';\n    const th = byId(id);\n")
sub("  function computeDark() {\n", "  function computeDark() {\n    const mode = document.documentElement.dataset.mode;\n    if (mode === 'dark' || mode === 'light') return mode === 'dark';\n")
s = s.replace("img[alt^=\"Max 5x\"]", "img[alt^=\"Quota\"]")

(d.parent / 'honu' / 'pixel-troi.user.js').write_text(s, encoding='utf-8', newline='\n')
print('ok', len(s))
