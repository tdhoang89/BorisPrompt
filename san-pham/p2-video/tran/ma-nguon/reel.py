"""
Showreel motion graphics 20s — 1080x1920 @ 60fps, render bằng cairo + numpy,
ghép nhạc từ music.py rồi xuất MP4 (H.264 + AAC) cho TikTok.

    python reel.py                       # render đầy đủ -> showreel_tiktok.mp4
    python reel.py --stills 1.5,5,9.2    # xuất ảnh tĩnh để duyệt nhanh
"""
import math
import os
import subprocess
import sys

import cairo
import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

import music

# ------------------------------------------------------------------ config
NAME = ""                      # vd "NGUYEN VAN A" — để trống thì không hiện
HANDLE = ""                    # vd "@yourname"
YEAR = "2026"

W, H, FPS = 1080, 1920, 60
DUR = music.DUR
NF = int(FPS * DUR)
CX, CY = W / 2, 900            # tâm thị giác (né UI TikTok ở đáy)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "showreel_tiktok.mp4")


def hexc(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


BG = hexc("#0B0B0E")
INK = hexc("#F2F0EA")
LIME = hexc("#D4FF3A")
CORAL = hexc("#FF4D2E")
BLUE = hexc("#3A5BFF")
DEEP = hexc("#10153A")

# ------------------------------------------------------------------ timing
KICKS = np.array(music.kick_times())
CLAPS = np.array(music.clap_times())
HITS = np.array(music.HITS)


def since(times, t):
    i = np.searchsorted(times, t + 1e-9, side="right") - 1
    return t - times[i] if i >= 0 else 1e9


def pulse(times, t, k):
    return math.exp(-since(times, t) * k)


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def prog(t, a, b):
    return clamp((t - a) / (b - a))


def lerp(a, b, x):
    return a + (b - a) * x


def mixc(c1, c2, x):
    return tuple(lerp(a, b, x) for a, b in zip(c1, c2))


def eo_expo(x):
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def ei_expo(x):
    return 0.0 if x <= 0 else 2 ** (10 * x - 10)


def eio_expo(x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    return 2 ** (20 * x - 10) / 2 if x < 0.5 else (2 - 2 ** (-20 * x + 10)) / 2


def eio_cubic(x):
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def eo_back(x, s=1.7):
    return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2


# ------------------------------------------------------------------ fonts
class _OpsPen(BasePen):
    def __init__(self, gs):
        super().__init__(gs)
        self.ops = []

    def _moveTo(self, p):
        self.ops.append((0, p))

    def _lineTo(self, p):
        self.ops.append((1, p))

    def _curveToOne(self, a, b, c):
        self.ops.append((2, (a, b, c)))

    def _closePath(self):
        self.ops.append((3, None))

    _endPath = _closePath


class Font:
    """Vẽ chữ từ outline TTF (fontTools) để kiểm soát từng glyph."""

    def __init__(self, path, axes=None):
        f = TTFont(path)
        if axes:
            f = instancer.instantiateVariableFont(
                f, axes, overlap=instancer.OverlapMode.REMOVE)
        self.upm = f["head"].unitsPerEm
        self.cap = f["OS/2"].sCapHeight / self.upm
        self.cmap = f.getBestCmap()
        self.gs = f.getGlyphSet()
        self.hmtx = f["hmtx"].metrics
        self.cache = {}

    def glyph(self, ch):
        name = self.cmap.get(ord(ch), ".notdef")
        if name not in self.cache:
            pen = _OpsPen(self.gs)
            self.gs[name].draw(pen)
            self.cache[name] = (pen.ops, self.hmtx[name][0])
        return self.cache[name]

    def adv(self, ch, size):
        return self.glyph(ch)[1] * size / self.upm

    def width(self, s, size, track=0.0):
        return sum(self.adv(c, size) for c in s) + track * max(0, len(s) - 1)

    def fit(self, s, w, track_em=0.0):
        return w / (self.width(s, 1000, track_em * 1000) / 1000)

    def glyph_path(self, ctx, ch, x, y, size):
        ops, _ = self.glyph(ch)
        k = size / self.upm
        for op, p in ops:
            if op == 0:
                ctx.move_to(x + p[0] * k, y - p[1] * k)
            elif op == 1:
                ctx.line_to(x + p[0] * k, y - p[1] * k)
            elif op == 2:
                a, b, c = p
                ctx.curve_to(x + a[0] * k, y - a[1] * k, x + b[0] * k,
                             y - b[1] * k, x + c[0] * k, y - c[1] * k)
            else:
                ctx.close_path()

    def layout(self, s, x, size, track=0.0, align="left"):
        w = self.width(s, size, track)
        x -= {"left": 0, "center": w / 2, "right": w}[align]
        out = []
        for ch in s:
            a = self.adv(ch, size)
            out.append((ch, x, a))
            x += a + track
        return out, w

    def path(self, ctx, s, x, y, size, track=0.0, align="left"):
        lay, w = self.layout(s, x, size, track, align)
        for ch, gx, _ in lay:
            self.glyph_path(ctx, ch, gx, y, size)
        return w


FD = Font("C:/Windows/Fonts/bahnschrift.ttf", {"wght": 700, "wdth": 75})   # display condensed
FW = Font("C:/Windows/Fonts/bahnschrift.ttf", {"wght": 600, "wdth": 100})  # wide label
FB = Font("C:/Windows/Fonts/seguibl.ttf")                                  # black punch
FM = Font("C:/Windows/Fonts/consola.ttf")                                  # mono HUD


# ------------------------------------------------------------------ draw helpers
def rgb(ctx, c, a=1.0):
    ctx.set_source_rgba(c[0], c[1], c[2], a)


def paint(ctx, c):
    rgb(ctx, c)
    ctx.paint()


def text(ctx, font, s, x, y, size, color, track=0.0, align="left", alpha=1.0,
         stroke=0.0):
    ctx.new_path()
    w = font.path(ctx, s, x, y, size, track, align)
    rgb(ctx, color, alpha)
    if stroke:
        ctx.set_line_width(stroke)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
    else:
        ctx.fill()
    return w


def typed(s, p):
    return s[:int(round(len(s) * clamp(p)))]


def rrect(ctx, x, y, w, h, r):
    r = max(0.0, min(r, w / 2, h / 2))
    if r < 0.5:
        ctx.rectangle(x, y, w, h)
        return
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    ctx.close_path()


# ------------------------------------------------------------------ HUD
SECTIONS = [(0, "00", "INTRO"), (4, "01", "FORM"), (8, "02", "TYPE"),
            (12, "03", "SPACE"), (16, "04", "REEL")]


def hud(ctx, t, color, alpha=0.9):
    show = eo_expo(prog(t, 0.15, 0.9)) * (1 - eio_cubic(prog(t, 19.0, 19.5)))
    if show <= 0.001:
        return
    x0, x1, y0, y1 = 64, W - 64, 150, 1560
    arm = 46 * show
    ctx.set_line_width(3)
    rgb(ctx, color, alpha)
    for (x, y, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        ctx.move_to(x, y + dy * arm)
        ctx.line_to(x, y)
        ctx.line_to(x + dx * arm, y)
    ctx.stroke()

    f = int(t * FPS)
    tc = "%02d:%02d:%02d:%02d" % (0, 0, f // FPS, f % FPS)
    sz = 26
    text(ctx, FM, typed("TC " + tc, show * 1.2), x0 + 4, y0 + 52, sz, color, alpha=alpha)
    num, name = SECTIONS[0][1:]
    for s0, n, nm in SECTIONS:
        if t >= s0:
            num, name = n, nm
    text(ctx, FM, typed(f"{num} / {name}", show * 1.4), x1 - 4, y0 + 52, sz, color,
         align="right", alpha=alpha)
    # REC chấm nhấp nháy
    if (t * 2) % 1 < 0.6:
        rgb(ctx, CORAL, alpha * show)
        ctx.arc(x1 - 10, y0 + 82, 7, 0, 2 * math.pi)
        ctx.fill()
    text(ctx, FM, typed("REC", show), x1 - 26, y0 + 91, sz, color, align="right", alpha=alpha)
    text(ctx, FM, typed("1080\u00d71920 \u00b7 60FPS", show * 1.3), x0 + 4, y1 - 22, sz,
         color, alpha=alpha)
    text(ctx, FM, typed(f"SHOWREEL \u2014 {YEAR}", show * 1.3), x1 - 4, y1 - 22, sz,
         color, align="right", alpha=alpha)
    # thanh tiến trình
    py = y1 + 26
    rgb(ctx, color, 0.25 * alpha * show)
    ctx.rectangle(x0, py, x1 - x0, 3)
    ctx.fill()
    rgb(ctx, color, alpha * show)
    ctx.rectangle(x0, py, (x1 - x0) * t / DUR, 3)
    ctx.fill()


# ------------------------------------------------------------------ scene 0: intro (0–4s)
def scene_intro(ctx, t):
    paint(ctx, BG)
    ke = pulse(KICKS, t, 7)

    lp = eio_expo(prog(t, 0.2, 0.7))
    sep = eio_expo(prog(t, 0.55, 1.05)) * 285
    half = 440 * lp
    # chấm -> đường kẻ
    r = (14 + 10 * ke) * (1 - prog(t, 0.2, 0.35))
    if r > 0.3:
        rgb(ctx, LIME)
        ctx.arc(CX, CY, r, 0, 2 * math.pi)
        ctx.fill()
    if lp > 0:
        rgb(ctx, INK)
        for sgn in (-1, 1):
            ctx.rectangle(CX - half, CY + sgn * sep - 1.5, 2 * half, 3)
        ctx.fill()

    build = prog(t, 2.9, 3.6)
    grow = 1 + 0.06 * eio_cubic(build)
    track = 10 + 14 * eio_cubic(build)
    ctx.save()
    ctx.translate(CX, CY)
    ctx.scale(grow, grow)
    ctx.translate(-CX, -CY)
    jit = build ** 2 * 6

    # MOTION: chữ trồi lên trong mask
    size = FD.fit("MOTION", 800, 10 / 800)
    cap = FD.cap * size
    ctx.save()
    ctx.rectangle(0, CY - sep + 4, W, max(0, sep - 6))
    ctx.clip()
    lay, _ = FD.layout("MOTION", CX, size, track, "center")
    for i, (ch, gx, _) in enumerate(lay):
        e = eo_expo(prog(t, 0.7 + i * 0.05, 1.25 + i * 0.05))
        dy = (1 - e) * (cap + 40)
        ctx.new_path()
        FD.glyph_path(ctx, ch, gx + jit * math.sin(t * 90 + i), CY - 26 + dy, size)
        rgb(ctx, INK)
        ctx.fill()
    ctx.restore()

    # DESIGN: chữ viền lime rơi xuống
    ctx.save()
    ctx.rectangle(0, CY + 2, W, max(0, sep - 6))
    ctx.clip()
    lay, _ = FD.layout("DESIGN", CX, size, track, "center")
    for i, (ch, gx, _) in enumerate(lay):
        e = eo_expo(prog(t, 1.05 + i * 0.05, 1.6 + i * 0.05))
        dy = -(1 - e) * (cap + 40)
        ctx.new_path()
        FD.glyph_path(ctx, ch, gx + jit * math.sin(t * 70 + i * 2), CY + 26 + cap + dy, size)
        rgb(ctx, LIME)
        ctx.set_line_width(4)
        ctx.stroke()
    ctx.restore()
    ctx.restore()

    # chú thích mono
    p = prog(t, 1.5, 2.1)
    if p > 0:
        text(ctx, FM, typed("// SELECTED WORKS", p), CX - 440, CY + sep + 52, 28, INK, alpha=0.75)
        text(ctx, FM, typed(f"VOL.{YEAR[-2:]}", p), CX + 440, CY + sep + 52, 28, LIME, align="right")

    hud(ctx, t, INK, 0.85)

    # iris lime mở ra -> drop
    ir = ei_expo(prog(t, 3.5, 4.0)) * 2300
    if ir > 0.5:
        rgb(ctx, LIME)
        ctx.arc(CX, CY, ir, 0, 2 * math.pi)
        ctx.fill()


# ------------------------------------------------------------------ scene 1: form grid (4–8s)
STATES = [(1.0, 0.5), (1.0, 0.06), (0.34, 0.06), (1.0, 0.06)]  # (độ dày tay, bo góc)


def shape(ctx, x, y, s, arm, rad, rot):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    a = s * arm
    r = rad * 2 * a if arm < 1 else rad * 2 * s
    rrect(ctx, -s, -a, 2 * s, 2 * a, min(r, a))
    rrect(ctx, -a, -s, 2 * a, 2 * s, min(r, a))
    ctx.restore()


def scene_form(ctx, t):
    phase2 = t >= 6.0
    paint(ctx, BG if phase2 else LIME)
    sp = W / 7
    rot_g = eo_expo(prog(t, 6.0, 6.6)) * math.radians(-14) + (t - 6) * 0.03 * phase2
    cr, sr = math.cos(rot_g), math.sin(rot_g)
    ks = [k for k in KICKS if 4.0 <= k <= t][-3:]
    pal = [LIME, CORAL, BLUE, INK]
    rng_i = range(-3, 10) if phase2 else range(0, 7)
    for j in range(-8, 9):
        for i in rng_i:
            gx = (i - 3) * sp
            gy = j * sp
            x = CX + gx * cr - gy * sr
            y = CY + gx * sr + gy * cr
            if x < -sp or x > W + sp or y < -sp or y > H + sp:
                continue
            d = math.hypot(x - CX, y - CY)
            tl = t - d / 2600
            pop = eo_back(prog(tl, 4.0, 4.4)) if tl < 4.4 else 1.0
            if pop <= 0:
                continue
            bl = (tl - 4.0) / music.BEAT
            k = math.floor(bl)
            e = eo_expo(clamp((bl - k) / 0.55))
            a0, r0 = STATES[(k - 1) % 4]
            a1, r1 = STATES[k % 4]
            arm, rad = lerp(a0, a1, e), lerp(r0, r1, e)
            rot = (k - 1 + eo_back(clamp((bl - k) / 0.6))) * math.pi / 4
            rip = 0.0
            for tk in ks:
                dt = t - tk
                rip += math.exp(-((d - 2400 * dt) / 170) ** 2) * math.exp(-dt * 2.2)
            s = sp * 0.27 * (1 + 0.6 * rip) * pop
            ex = eio_cubic(prog(t, 7.45 + (y / H) * 0.25, 7.72 + (y / H) * 0.25))
            s *= 1 - ex
            if s < 0.5:
                continue
            col = BG if not phase2 else pal[(i + j * 2) % 4]
            shape(ctx, x, y, s, arm, rad, rot + rot_g)
            rgb(ctx, col)
            ctx.fill()

    # nhãn lớn
    lab = "FORM \u00b7 RHYTHM \u00b7 SHAPE"
    p = prog(t, 4.15, 4.8)
    if p > 0:
        lw = FW.width(lab, 40, 6) * eo_expo(p) + 64
        rgb(ctx, BG)
        rrect(ctx, CX - lw / 2, 1378, lw, 74, 37)
        ctx.fill()
        text(ctx, FW, typed(lab, p), CX, 1430, 40, LIME, track=6, align="center")
    hud(ctx, t, BG if not phase2 else INK)

    # panel coral đẩy lên chuyển cảnh
    w = eio_expo(prog(t, 7.68, 8.0))
    if w > 0:
        top = H + 260 - w * (H + 520)
        rgb(ctx, CORAL)
        ctx.move_to(0, top + 260)
        ctx.line_to(W, top)
        ctx.line_to(W, H + 10)
        ctx.line_to(0, H + 10)
        ctx.close_path()
        ctx.fill()


# ------------------------------------------------------------------ scene 2: type (8–12s)
ROW_WORDS = ["MOTION", "DESIGN", "KINETIC", "TYPE", "RHYTHM", "FLOW",
             "IMPACT", "TIMING", "CRAFT", "SHOWREEL", "FRAME"]
PUNCH = [("BOLD.", CORAL, BG), ("FAST.", BLUE, INK), ("CLEAN.", LIME, BG), ("LOUD.", INK, BG)]


def kick_steps(t, t0):
    return sum(eo_expo(clamp((t - k) / 0.32)) for k in KICKS if t0 <= k <= t)


def scene_marquee(ctx, t):
    paint(ctx, BG)
    ctx.save()
    ctx.translate(CX, CY)
    ctx.rotate(math.radians(-11))
    size = 250
    cap = FD.cap * size
    collapse = ei_expo(prog(t, 9.7, 10.0))
    lh = (cap + 46) * (1 - 0.85 * collapse)
    steps = kick_steps(t, 8.0)
    for j in range(-6, 7):
        word = ROW_WORDS[j % len(ROW_WORDS)]
        unit = word + "  \u2022  "
        uw = FD.width(unit, size)
        d = 1 if j % 2 == 0 else -1
        ent = 1 - eo_expo(prog(t, 8.0 + abs(j) * 0.035, 8.65 + abs(j) * 0.035))
        off = d * (130 * (t - 8) + 170 * steps) + j * 211 + d * ent * 1600
        x = (off % uw) - 2 * uw - 900
        y = j * lh + cap / 2
        ctx.new_path()
        while x < 900:
            FD.path(ctx, unit, x, y, size)
            x += uw
        if j == 0:
            rgb(ctx, LIME)
            ctx.fill()
        elif j in (-3, 4):
            rgb(ctx, CORAL)
            ctx.fill()
        elif j % 2:
            rgb(ctx, INK, 0.9)
            ctx.set_line_width(2.5)
            ctx.stroke()
        else:
            rgb(ctx, INK)
            ctx.fill()
    ctx.restore()
    hud(ctx, t, INK)

    # panel coral rút lên (nối từ cảnh trước)
    w = eo_expo(prog(t, 8.0, 8.38))
    if w < 1:
        bot = (H + 260) * (1 - w)
        rgb(ctx, CORAL)
        ctx.move_to(0, -10)
        ctx.line_to(W, -10)
        ctx.line_to(W, bot - 260)
        ctx.line_to(0, bot)
        ctx.close_path()
        ctx.fill()


def scene_punch(ctx, t):
    k = min(3, int((t - 10.0) / music.BEAT))
    tl = t - (10.0 + k * music.BEAT)
    word, bg, fg = PUNCH[k]
    if t >= 11.75 and int((t - 11.75) / (music.BEAT / 8)) % 2 == 1:
        bg, fg = fg, bg   # stutter đảo màu theo 1/32
    paint(ctx, bg)
    size = FB.fit(word, 940)
    cap = FB.cap * size
    e = eo_expo(clamp(tl / 0.28))
    sc = 1 + 0.28 * (1 - e)
    spread = eo_expo(clamp(tl / 0.4))
    ctx.save()
    ctx.translate(CX, CY)
    ctx.scale(sc, sc)
    for n in range(-4, 5):
        if n == 0:
            continue
        y = cap / 2 + n * cap * 1.12 * spread
        text(ctx, FB, word, 0, y, size, fg, align="center", alpha=0.55 / abs(n) ** 0.7, stroke=2.5)
    text(ctx, FB, word, 0, cap / 2, size, fg, align="center")
    ctx.restore()
    idx = f"{k + 1:02d}/04"
    text(ctx, FM, idx, CX, CY + cap / 2 + 120, 30, fg, align="center", track=4)
    hud(ctx, t, fg)


# ------------------------------------------------------------------ scene 3: space (12–16s)
NP = 1100
_rng = np.random.default_rng(3)
_i = np.arange(NP) + 0.5
_phi = np.arccos(1 - 2 * _i / NP)
_th = math.pi * (1 + 5 ** 0.5) * _i
SPHERE = np.stack([np.cos(_th) * np.sin(_phi), np.cos(_phi), np.sin(_th) * np.sin(_phi)], 1)


def _knot():
    u = np.linspace(0, 2 * np.pi, NP, endpoint=False)

    def c(u):
        r = np.cos(3 * u) + 2.2
        return np.stack([r * np.cos(2 * u), -np.sin(3 * u) * 1.1, r * np.sin(2 * u)], 1) / 3.0

    p = c(u)
    tng = c(u + 1e-3) - c(u - 1e-3)
    tng /= np.linalg.norm(tng, axis=1, keepdims=True)
    nrm = np.cross(tng, np.array([0, 1, 0]))
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    bn = np.cross(tng, nrm)
    v = _i * 2.39996
    return p + 0.11 * (np.cos(v)[:, None] * nrm + np.sin(v)[:, None] * bn)


KNOT = _knot()
JIT = _rng.uniform(-1, 1, NP)
RING_TXT = f"MOTION DESIGN \u2022 SHOWREEL {YEAR} \u2022 KINETIC TYPE \u2022 3D \u2022 "


def rot_mat(yaw, pitch, roll=0.0):
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, spp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -spp], [0, spp, cp]])
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return rz @ rx @ ry


def project(p, R=390.0, fz=1500.0):
    s = fz / (fz + p[..., 2] * R)
    return CX + p[..., 0] * R * s, CY + p[..., 1] * R * s, s


def scene_space(ctx, t):
    g = cairo.RadialGradient(CX, CY, 0, CX, CY, 1100)
    g.add_color_stop_rgb(0, *DEEP)
    g.add_color_stop_rgb(1, *BG)
    ctx.set_source(g)
    ctx.paint()

    ke = pulse(KICKS, t, 8)
    ce = pulse(CLAPS, t, 9)
    roll_in = clamp((t - 15.0) / 0.5)
    m = np.clip((t - 13.7 - 0.55 * (_i / NP)) / 0.6, 0, 1)
    m = np.where(m < 0.5, 4 * m ** 3, 1 - (-2 * m + 2) ** 3 / 2)[:, None]
    pts = SPHERE * (1 - m) + KNOT * m
    implode = 1 + 5 * (1 - eo_expo(prog(t, 12.0, 12.7)))
    explode = 1 + 7 * ei_expo(prog(t, 15.45, 16.0))
    scl = (1 + 0.08 * ke) * (1 + (0.1 * ce + 0.25 * roll_in ** 2) * JIT[:, None]) * implode * explode
    pts = pts * scl
    yaw = 0.9 * (t - 12) + 0.6 * kick_steps(t, 12.0) * 0.25
    Rm = rot_mat(yaw, 0.38 + 0.1 * math.sin(t * 1.3), 0.12 * math.sin(t * 0.9))
    P = pts @ Rm.T
    xs, ys, ss = project(P)
    order = np.argsort(-P[:, 2])
    fade = 1 - prog(t, 15.7, 16.0)

    # quỹ đạo + chữ vòng
    tilt = rot_mat(0, 0.38 + 1.15, 0.12 * math.sin(t * 0.9) - 0.25)
    ring_r = 1.55
    rp = prog(t, 12.2, 12.9)
    chars = []
    if rp > 0:
        th0 = -0.55 * (t - 12)
        size = 46
        x = 0.0
        for ch in RING_TXT:
            a = FW.adv(ch, size)
            th = th0 + (x + a / 2) / (ring_r * 360)
            x += a + 6
            if th - th0 > 2 * math.pi * rp - 0.01:
                break
            p3 = np.array([math.cos(th), 0, math.sin(th)]) * ring_r
            p3 = tilt @ p3 * explode
            p3b = tilt @ (np.array([math.cos(th + 0.01), 0, math.sin(th + 0.01)]) * ring_r) * explode
            px, py, s = project(p3)
            qx, qy, _ = project(p3b)
            chars.append((p3[2], ch, px, py, s, math.atan2(qy - py, qx - px), size))
        # đường quỹ đạo
        ctx.new_path()
        for k in range(181):
            th = 2 * math.pi * k / 180
            q = tilt @ (np.array([math.cos(th), 0, math.sin(th)]) * ring_r * 1.12) * explode
            px, py, _ = project(q)
            (ctx.move_to if k == 0 else ctx.line_to)(px, py)
        rgb(ctx, INK, 0.18 * fade)
        ctx.set_line_width(1.5)
        ctx.stroke()

    def draw_chars(front):
        for z, ch, px, py, s, ang, size in chars:
            if (z < 0) != front:
                continue
            ctx.save()
            ctx.translate(px, py)
            ctx.rotate(ang)
            ctx.new_path()
            FW.glyph_path(ctx, ch, -FW.adv(ch, size * s) / 2, size * s * FW.cap / 2, size * s)
            rgb(ctx, INK if front else mixc(INK, BLUE, 0.5), (1.0 if front else 0.4) * fade)
            ctx.fill()
            ctx.restore()

    draw_chars(False)
    zn = np.clip((P[:, 2] / (scl[:, 0] + 1e-6) + 1) / 2, 0, 1)
    for i in order:
        z = zn[i]
        col = mixc(LIME, BLUE, z ** 0.8)
        r = (2.2 + 4.2 * (1 - z)) * ss[i]
        rgb(ctx, col, (0.35 + 0.65 * (1 - z)) * fade)
        ctx.arc(xs[i], ys[i], r, 0, 2 * math.pi)
        ctx.fill()
    draw_chars(True)

    # readout
    v = Rm @ np.array([0.0, 0.0, 1.0])
    rd = f"X {v[0]:+.3f}  Y {v[1]:+.3f}  Z {v[2]:+.3f}"
    text(ctx, FM, rd, CX, 1470, 26, INK, align="center", alpha=0.7)
    lab = "SPHERE \u2192 TORUS KNOT" if t < 14.2 else "TORUS KNOT (2,3)"
    text(ctx, FM, lab, CX, 1430, 26, LIME, align="center", alpha=0.9)
    hud(ctx, t, INK)


# ------------------------------------------------------------------ scene 4: outro (16–20s)
def scene_outro(ctx, t):
    paint(ctx, BG)
    collapse = ei_expo(prog(t, 19.0, 19.6))
    final = t >= 18.0
    fe = eo_expo(prog(t, 18.0, 18.35))

    ctx.save()
    ctx.translate(CX, CY)
    s = (1.1 - 0.1 * eo_expo(prog(t, 16.0, 16.9)) + 0.03 * (t - 18) * final) * (1 - collapse)
    ctx.scale(max(s, 1e-4), max(s, 1e-4))
    ctx.rotate(collapse * 0.35)
    ctx.translate(-CX, -CY)

    # burst vòng khi hit cuối
    if final:
        for n, col in enumerate((LIME, CORAL, BLUE)):
            p = prog(t, 18.0 + n * 0.06, 18.9 + n * 0.06)
            if 0 < p < 1:
                rgb(ctx, col, 1 - p)
                ctx.set_line_width(26 * (1 - p) + 1)
                ctx.arc(CX, CY, 120 + eo_expo(p) * 900, 0, 2 * math.pi)
                ctx.stroke()

    top = NAME if NAME else "SHOWREEL"
    size = FD.fit(top, 940, 8 / 940)
    cap = FD.cap * size
    lay, _ = FD.layout(top, CX, size, 8, "center")
    base1 = CY - 40
    for i, (ch, gx, _) in enumerate(lay):
        dy = 7 * math.sin(t * 3.2 + i * 0.55) * (1 - fe * 0.5)
        ctx.new_path()
        FD.glyph_path(ctx, ch, gx, base1 + dy, size)
        rgb(ctx, INK)
        ctx.fill()

    y2 = YEAR
    size2 = FD.fit(y2, 640, 10 / 640)
    cap2 = FD.cap * size2
    base2 = base1 + 46 + cap2
    ctx.new_path()
    FD.path(ctx, y2, CX, base2, size2, 10, "center")
    if fe > 0:
        rgb(ctx, LIME, fe)
        ctx.fill_preserve()
    rgb(ctx, LIME)
    ctx.set_line_width(5)
    ctx.stroke()

    sub = "MOTION DESIGN PORTFOLIO" if not NAME else f"MOTION DESIGNER \u2014 SHOWREEL {YEAR}"
    text(ctx, FW, typed(sub, prog(t, 16.4, 17.0)), CX, base1 - cap - 46, 36, INK,
         track=8, align="center", alpha=0.85)
    bar = eio_expo(prog(t, 16.7, 17.3))
    rgb(ctx, CORAL)
    ctx.rectangle(CX - 300 * bar, base2 + 44, 600 * bar, 8)
    ctx.fill()
    cta = HANDLE if HANDLE else "AVAILABLE FOR PROJECTS"
    text(ctx, FM, typed(cta, prog(t, 17.0, 17.8)), CX, base2 + 110, 32, INK, align="center",
         track=3)
    ctx.restore()

    # thanh màu dọc phủ màn hình rồi rút lên
    cols = [LIME, CORAL, BLUE, INK]
    bw = W / 4
    for i, c in enumerate(cols):
        p = eio_expo(prog(t, 16.04 + i * 0.07, 16.62 + i * 0.07))
        h = H * (1 - p)
        if h > 0:
            rgb(ctx, c)
            ctx.rectangle(i * bw - 0.5, 0, bw + 1, h)
            ctx.fill()

    hud(ctx, t, INK)

    # trở về chấm lime -> loop liền với khung đầu
    dp = eo_back(prog(t, 19.45, 19.75))
    if dp > 0:
        ke = pulse(KICKS, t, 7)
        rgb(ctx, LIME)
        ctx.arc(CX, CY, max(0, 14 * dp), 0, 2 * math.pi)
        ctx.fill()


# ------------------------------------------------------------------ frame + post
def camera(ctx, t):
    he = pulse(HITS, t, 6)
    ke = pulse(KICKS, t, 10) * (1.0 if 4.0 <= t < 18.5 else 0.35)
    z = 1 + 0.02 * ke + 0.045 * he
    amp = 18 * he + 3 * ke
    sx = amp * (math.sin(t * 93.1) + 0.5 * math.sin(t * 211.7))
    sy = amp * (math.sin(t * 77.3 + 1.1) + 0.5 * math.sin(t * 187.9))
    ctx.translate(CX + sx, CY + sy)
    ctx.scale(z, z)
    ctx.translate(-CX, -CY)


def draw(ctx, t):
    ctx.save()
    camera(ctx, t)
    if t < 4.0:
        scene_intro(ctx, t)
    elif t < 8.0:
        scene_form(ctx, t)
    elif t < 10.0:
        scene_marquee(ctx, t)
    elif t < 12.0:
        scene_punch(ctx, t)
    elif t < 16.0:
        scene_space(ctx, t)
    else:
        scene_outro(ctx, t)
    ctx.restore()


_POST = {}


def _post_init():
    if _POST:
        return
    rng = np.random.default_rng(11)
    _POST["grain"] = [rng.normal(0, 4.0, (H, W, 1)).astype(np.int16) for _ in range(6)]
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - CX) / W) ** 2 + ((yy - CY) / H) ** 2 * 0.8)
    _POST["vig"] = (256 * (1 - 0.35 * np.clip(d - 0.25, 0, 1) ** 1.6)).astype(np.int32)[..., None]


def glitch_amt(t):
    g = 0.0
    for c in (4.0, 8.0, 12.0, 16.0):
        if c - 0.3 < t < c:
            g = max(g, ((t - (c - 0.3)) / 0.3) ** 2 * 0.8)
        elif t >= c:
            g = max(g, math.exp(-(t - c) * 12))
    if t >= 18.0:
        g = max(g, math.exp(-(t - 18.0) * 10))
    return g


def flash_amt(t):
    f = 0.0
    for c, a in ((4.0, 0.85), (8.0, 0.5), (12.0, 0.7), (16.0, 0.8), (18.0, 0.9), (6.0, 0.3)):
        if t >= c:
            f = max(f, a * math.exp(-(t - c) * 14))
    return f


def post(buf, t, fi):
    _post_init()
    img = buf[:, :, [2, 1, 0]].astype(np.int32)        # BGRA -> RGB
    ca = int(round(12 * pulse(HITS, t, 7) + 2.5 * pulse(KICKS, t, 12) * (4 <= t < 18.5)))
    if ca:
        img[:, :, 0] = np.roll(img[:, :, 0], -ca, axis=1)
        img[:, :, 2] = np.roll(img[:, :, 2], ca, axis=1)
    g = glitch_amt(t)
    if g > 0.02:
        rng = np.random.default_rng(fi)
        for _ in range(int(2 + 12 * g)):
            y = int(rng.integers(0, H - 20))
            h = int(rng.integers(6, 30 + int(120 * g)))
            sh = int(rng.normal(0, 90 * g))
            img[y:y + h] = np.roll(img[y:y + h], sh, axis=1)
            if rng.random() < 0.4:
                img[y:y + h, :, 1] = np.roll(img[y:y + h, :, 1], int(sh * 0.5), axis=1)
    f = flash_amt(t)
    if f > 0.01:
        img += ((255 - img) * f).astype(np.int32)
    img = (img * _POST["vig"]) >> 8
    img += _POST["grain"][fi % 6]
    return np.clip(img, 0, 255).astype(np.uint8)


def render_frame(fi, t=None):
    t = fi / FPS if t is None else t
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    draw(ctx, t)
    surf.flush()
    buf = np.ndarray((H, W, 4), np.uint8, surf.get_data())
    return post(buf, t, fi)


def _worker(fi):
    return render_frame(fi).tobytes()


# ------------------------------------------------------------------ main
def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    from PIL import Image
    if "--stills" in sys.argv:
        ts = [float(x) for x in sys.argv[sys.argv.index("--stills") + 1].split(",")]
        outdir = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else HERE
        for t in ts:
            Image.fromarray(render_frame(int(t * FPS), t)).save(os.path.join(outdir, f"still_{t:05.2f}.png"))
        return

    wav = os.path.join(HERE, "music.wav")
    if not os.path.exists(wav):
        music.write_wav(wav, music.render())
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav, "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
           "-profile:v", "high", "-level", "4.2", "-maxrate", "30M", "-bufsize", "60M",
           "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
           "-movflags", "+faststart", "-shortest", OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    from multiprocessing import Pool
    nw = max(1, os.cpu_count() - 1)
    with Pool(nw) as pool:
        # render theo lô để RAM không phình khi encoder chậm hơn renderer
        for s in range(0, NF, nw * 4):
            for b in pool.map(_worker, range(s, min(NF, s + nw * 4))):
                proc.stdin.write(b)
            print(f"  frame {min(NF, s + nw * 4)}/{NF}", flush=True)
    proc.stdin.close()
    proc.wait()
    Image.fromarray(render_frame(int(17.6 * FPS))).save(os.path.join(HERE, "cover.png"))
    print("done ->", OUT)


if __name__ == "__main__":
    main()
