"""Core toolkit: canvas size, easing, colour, vector fonts and drawing helpers.

Everything here is a pure function of its inputs so any frame can be rendered
independently (needed for multiprocessing and motion-blur sub-frames).
"""
import math
import os
import cairo
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

W, H = 1080, 1920
CX, CY = W / 2, H / 2
TAU = math.tau

# ----------------------------------------------------------------------------
# palette
# ----------------------------------------------------------------------------

def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

INK = hexc('#0E0E16')
INK2 = hexc('#1B1B2A')
PAPER = hexc('#F6F1E7')
YELLOW = hexc('#FFC929')
CORAL = hexc('#FF5544')
BLUE = hexc('#3157FF')
MINT = hexc('#2FE3AC')
LILAC = hexc('#A98BFF')
PINK = hexc('#FF8BCB')
WHITE = (1.0, 1.0, 1.0)

def mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def shade(c, k):
    """k<0 darker, k>0 lighter."""
    return mixc(c, (0, 0, 0), -k) if k < 0 else mixc(c, (1, 1, 1), k)

# ----------------------------------------------------------------------------
# maths / easing
# ----------------------------------------------------------------------------

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x

def lerp(a, b, t):
    return a + (b - a) * t

def remap(x, a, b):
    """0..1 progress of x through [a, b], clamped."""
    if b == a:
        return 1.0 if x >= b else 0.0
    return clamp((x - a) / (b - a))

def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)

def smoother(t):
    t = clamp(t)
    return t * t * t * (t * (t * 6 - 15) + 10)

def ease_in(t, p=3):
    return clamp(t) ** p

def ease_out(t, p=3):
    return 1 - (1 - clamp(t)) ** p

def ease_io(t, p=3):
    t = clamp(t)
    return 0.5 * (2 * t) ** p if t < 0.5 else 1 - 0.5 * (2 - 2 * t) ** p

def expo_out(t):
    t = clamp(t)
    return 1.0 if t >= 1 else 1 - 2 ** (-10 * t)

def expo_in(t):
    t = clamp(t)
    return 0.0 if t <= 0 else 2 ** (10 * (t - 1))

def expo_io(t):
    t = clamp(t)
    if t <= 0 or t >= 1:
        return t
    return 0.5 * 2 ** (20 * t - 10) if t < 0.5 else 1 - 0.5 * 2 ** (-20 * t + 10)

def back_out(t, s=1.70158):
    t = clamp(t) - 1
    return t * t * ((s + 1) * t + s) + 1

def back_in(t, s=1.70158):
    t = clamp(t)
    return t * t * ((s + 1) * t - s)

def elastic_out(t, period=0.3):
    t = clamp(t)
    if t <= 0 or t >= 1:
        return t
    return 2 ** (-10 * t) * math.sin((t - period / 4) * TAU / period) + 1

def spring(t, freq=4.0, damp=6.0):
    """Damped spring settling from 0 to 1. t in seconds."""
    if t <= 0:
        return 0.0
    return 1 - math.exp(-damp * t) * math.cos(TAU * freq * t)

def wobble(t, freq=5.0, damp=7.0):
    """Damped oscillation starting at 1 and decaying to 0."""
    if t < 0:
        return 0.0
    return math.exp(-damp * t) * math.cos(TAU * freq * t)

def pulse(t, attack=0.01, decay=0.15):
    if t < -attack:
        return 0.0
    if t < 0:
        return 1 + t / attack
    return math.exp(-t / decay)

def hash11(n):
    """Deterministic pseudo random in [0,1)."""
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)

def rng(seed):
    return np.random.default_rng(seed)

# ----------------------------------------------------------------------------
# fonts: real outlines loaded with fontTools, drawn as cairo paths
# ----------------------------------------------------------------------------

FONT_DIR = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts')


class _CairoRecPen(BasePen):
    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.cmds = []

    def _moveTo(self, p):
        self.cmds.append(('M', p))

    def _lineTo(self, p):
        self.cmds.append(('L', p))

    def _curveToOne(self, p1, p2, p3):
        self.cmds.append(('C', p1, p2, p3))

    def _closePath(self):
        self.cmds.append(('Z',))

    def _endPath(self):
        self.cmds.append(('Z',))


class Font:
    def __init__(self, filename, fallback=None):
        path = filename if os.path.isabs(filename) else os.path.join(FONT_DIR, filename)
        if not os.path.exists(path) and fallback:
            path = os.path.join(FONT_DIR, fallback)
        f = TTFont(path)
        self.upm = f['head'].unitsPerEm
        self.gs = f.getGlyphSet()
        self.cmap = f.getBestCmap()
        self.hmtx = f['hmtx']
        os2 = f['OS/2']
        self.cap = getattr(os2, 'sCapHeight', 0) or int(self.upm * 0.7)
        self.xh = getattr(os2, 'sxHeight', 0) or int(self.upm * 0.5)
        self.kern = {}
        if 'kern' in f:
            for kt in f['kern'].kernTables:
                if hasattr(kt, 'kernTable'):
                    self.kern.update(kt.kernTable)
        self._cache = {}

    def gname(self, ch):
        return self.cmap.get(ord(ch)) or self.cmap.get(ord('?'))

    def glyph(self, ch):
        g = self._cache.get(ch)
        if g is None:
            name = self.gname(ch)
            pen = _CairoRecPen(self.gs)
            self.gs[name].draw(pen)
            g = (pen.cmds, self.hmtx[name][0])
            self._cache[ch] = g
        return g

    def layout(self, text, size, tracking=0.0):
        """-> (list of (char, x), total width) in pixels; tracking in em."""
        s = size / self.upm
        out, x, prev = [], 0.0, None
        for ch in text:
            name = self.gname(ch)
            if prev is not None:
                x += self.kern.get((prev, name), 0) * s
            out.append((ch, x))
            x += self.glyph(ch)[1] * s + tracking * size
            prev = name
        w = x - tracking * size if text else 0.0
        return out, w

    def width(self, text, size, tracking=0.0):
        return self.layout(text, size, tracking)[1]

    def cap_px(self, size):
        return self.cap * size / self.upm

    def glyph_path(self, ctx, ch, x, y, size):
        """Append glyph outline with baseline origin at (x, y)."""
        cmds, _ = self.glyph(ch)
        s = size / self.upm
        for c in cmds:
            op = c[0]
            if op == 'M':
                ctx.move_to(x + c[1][0] * s, y - c[1][1] * s)
            elif op == 'L':
                ctx.line_to(x + c[1][0] * s, y - c[1][1] * s)
            elif op == 'C':
                (a, b), (cc, d), (e, f) = c[1], c[2], c[3]
                ctx.curve_to(x + a * s, y - b * s, x + cc * s, y - d * s, x + e * s, y - f * s)
            else:
                ctx.close_path()

    def glyph_contours(self, ch):
        """List of contours in font units as lists of cmds (for counters etc.)."""
        cmds, _ = self.glyph(ch)
        cons, cur = [], []
        for c in cmds:
            if c[0] == 'M' and cur:
                cons.append(cur)
                cur = []
            cur.append(c)
            if c[0] == 'Z':
                cons.append(cur)
                cur = []
        if cur:
            cons.append(cur)
        return [k for k in cons if len(k) > 1]

    def text_path(self, ctx, text, x, y, size, tracking=0.0, anchor='l'):
        lay, w = self.layout(text, size, tracking)
        if anchor == 'c':
            x -= w / 2
        elif anchor == 'r':
            x -= w
        for ch, gx in lay:
            self.glyph_path(ctx, ch, x + gx, y, size)
        return w


def contour_path(ctx, contour, x, y, size, upm):
    s = size / upm
    for c in contour:
        op = c[0]
        if op == 'M':
            ctx.move_to(x + c[1][0] * s, y - c[1][1] * s)
        elif op == 'L':
            ctx.line_to(x + c[1][0] * s, y - c[1][1] * s)
        elif op == 'C':
            (a, b), (cc, d), (e, f) = c[1], c[2], c[3]
            ctx.curve_to(x + a * s, y - b * s, x + cc * s, y - d * s, x + e * s, y - f * s)
        else:
            ctx.close_path()


BLACK = Font('seguibl.ttf', 'ariblk.ttf')
BLACK_IT = Font('seguibli.ttf', 'seguibl.ttf')
MONO = Font('consolab.ttf', 'cour.ttf')

# ----------------------------------------------------------------------------
# drawing helpers
# ----------------------------------------------------------------------------

def rgb(ctx, c, a=1.0):
    if a >= 1:
        ctx.set_source_rgb(*c)
    else:
        ctx.set_source_rgba(c[0], c[1], c[2], a)

def fill_bg(ctx, c):
    rgb(ctx, c)
    ctx.paint()

def circle(ctx, x, y, r):
    ctx.new_sub_path()
    ctx.arc(x, y, max(r, 0.0), 0, TAU)

def ellipse(ctx, x, y, rx, ry, ang=0.0):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.scale(max(rx, 1e-4), max(ry, 1e-4))
    ctx.new_sub_path()
    ctx.arc(0, 0, 1, 0, TAU)
    ctx.restore()

def rrect(ctx, x, y, w, h, r):
    r = max(0.0, min(r, w / 2, h / 2))
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -TAU / 4, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, TAU / 4)
    ctx.arc(x + r, y + h - r, r, TAU / 4, TAU / 2)
    ctx.arc(x + r, y + r, r, TAU / 2, TAU * 3 / 4)
    ctx.close_path()

def poly(ctx, pts, close=True):
    if len(pts) == 0:
        return
    ctx.move_to(*pts[0])
    for p in pts[1:]:
        ctx.line_to(*p)
    if close:
        ctx.close_path()

def star_pts(x, y, r_out, r_in, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / n
        pts.append((x + math.cos(a) * r, y + math.sin(a) * r))
    return pts

def ngon_pts(x, y, r, n, rot=-math.pi / 2):
    return [(x + math.cos(rot + i * TAU / n) * r, y + math.sin(rot + i * TAU / n) * r) for i in range(n)]

def smooth_closed(ctx, pts, tension=1.0):
    """Catmull-Rom spline through closed point list."""
    n = len(pts)
    if n < 3:
        poly(ctx, pts)
        return
    ctx.move_to(*pts[0])
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension)
        ctx.curve_to(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])
    ctx.close_path()

def polar_shape_radius(verts, thetas):
    """Distance from origin to polygon boundary along each angle (star-shaped polys)."""
    v = np.asarray(verts, dtype=float)
    a = v
    b = np.roll(v, -1, axis=0)
    d = np.stack([np.cos(thetas), np.sin(thetas)], axis=1)  # (N,2)
    e = b - a  # (M,2)
    # solve t*d = a + u*e  -> for each ray/edge
    den = d[:, None, 0] * e[None, :, 1] - d[:, None, 1] * e[None, :, 0]
    den = np.where(np.abs(den) < 1e-12, 1e-12, den)
    tnum = a[None, :, 0] * e[None, :, 1] - a[None, :, 1] * e[None, :, 0]
    unum = a[None, :, 0] * d[:, None, 1] - a[None, :, 1] * d[:, None, 0]
    t = tnum / den
    u = unum / den
    ok = (u >= -1e-9) & (u <= 1 + 1e-9) & (t > 0)
    t = np.where(ok, t, np.inf)
    return t.min(axis=1)


class Layer:
    """Offscreen ARGB surface for masking / compositing tricks."""

    def __init__(self, w=W, h=H):
        self.surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
        self.ctx = cairo.Context(self.surf)

    def draw_to(self, ctx, alpha=1.0, op=None):
        ctx.save()
        if op is not None:
            ctx.set_operator(op)
        ctx.set_source_surface(self.surf, 0, 0)
        if alpha >= 1:
            ctx.paint()
        else:
            ctx.paint_with_alpha(alpha)
        ctx.restore()


def surf_array(surf):
    surf.flush()
    return np.ndarray((surf.get_height(), surf.get_width(), 4), np.uint8, surf.get_data())
