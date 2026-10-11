"""S3 — kinetic type rows, accordion, zoom through the counter of the '0'."""
import math
import cairo

from engine import *
from timeline import *


def sparkle(ctx, x, y, r, rot=0.0):
    pts = []
    for i in range(8):
        rr = r if i % 2 == 0 else r * 0.28
        a = rot + i * math.pi / 4
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    poly(ctx, pts)


class TypeRows:
    N = 11
    MID = 5
    WORDS = ['MOTION', 'DESIGN', 'SHOWREEL', 'TIMING', 'SPACING', None,
             'RHYTHM', 'EASING', 'SHOWREEL', 'FLOW', 'MOTION']
    STYLES = [(PAPER, True), (PAPER, False), (YELLOW, False), (PAPER, True), (PAPER, False), None,
              (PAPER, False), (PAPER, True), (YELLOW, False), (PAPER, False), (PAPER, True)]

    def __init__(self):
        self.year = str(CFG.get('year', '2026'))
        zi = -1
        for k, ch in enumerate(self.year):
            if len(BLACK.glyph_contours(ch)) > 1:
                zi = k
                if ch in '0O':
                    break
        self.zero_idx = max(zi, 0)
        ch = self.year[self.zero_idx]

        def box(c):
            pts = [p for cmd in c for p in cmd[1:]]
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return (max(xs) - min(xs)) * (max(ys) - min(ys)), (min(xs), max(xs), min(ys), max(ys))

        cons = sorted(BLACK.glyph_contours(ch), key=lambda c: box(c)[0])
        self.counter = cons[0]
        self.counter_box = box(cons[0])[1]
        self._tmp = cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))

    # ---------------------------------------------------------------- layout
    def accordion(self, t):
        return spring(t - 5.0, 2.2, 8.0) if t >= 5.0 else 0.0

    def heights(self, t):
        wc = 1 + 3.1 * self.accordion(t)
        tot = self.N - 1 + wc
        hs = [H / tot] * self.N
        hs[self.MID] = H * wc / tot
        return hs

    def center_layout(self, t):
        hs = self.heights(t)
        y0 = sum(hs[:self.MID])
        h = hs[self.MID]
        size = min(h * 0.8, (W - 90) / BLACK.width(self.year, 1))
        lay, ww = BLACK.layout(self.year, size)
        base = y0 + h / 2 + BLACK.cap_px(size) / 2
        return y0, h, size, lay, ww, base

    def row_offset(self, i, t):
        if i == self.MID:
            return 0.0
        d = abs(i - self.MID)
        st = 4.0 + 0.032 * d
        u = remap(t, st, st + 0.42)
        dirn = -1 if i % 2 else 1
        return dirn * 1250 * (1 - expo_out(u))

    # ---------------------------------------------------------------- rows
    def draw_row_text(self, ctx, i, y0, h, t):
        dirn = -1 if i % 2 else 1
        hb = H / self.N
        sy = h / hb
        size = hb * 0.86
        word = self.WORDS[i]
        col, outline = self.STYLES[i]
        gap = size * 0.55
        tile = BLACK.width(word, size) + gap
        d = abs(i - self.MID)
        u = remap(t, 4.0 + 0.032 * d, 4.6 + 0.032 * d)
        off = dirn * (150 * (t - 4.0) + 700 * (1 - expo_out(u))) + i * 137
        capc = BLACK.cap_px(size)
        ctx.save()
        ctx.rectangle(-60, y0, W + 120, h)
        ctx.clip()
        ctx.translate(0, y0 + h / 2)
        ctx.scale(1, sy)
        ctx.translate(0, capc / 2)
        x = (off % tile) - tile
        while x < W + 60:
            BLACK.text_path(ctx, word, x, 0, size)
            x += tile
        rgb(ctx, col)
        if outline:
            ctx.set_line_width(4)
            ctx.stroke()
        else:
            ctx.fill()
        x = (off % tile) - tile
        while x < W + tile:
            sparkle(ctx, x - gap / 2, -capc / 2, size * 0.17, t * 3 * dirn)
            x += tile
        rgb(ctx, CORAL if col == YELLOW else YELLOW)
        ctx.fill()
        ctx.restore()

    def draw_center(self, ctx, t):
        y0, h, size, lay, ww, base = self.center_layout(t)
        e = self.accordion(t)
        bg = mixc(INK, CORAL, smooth(remap(t, 4.97, 5.04)))
        rgb(ctx, bg)
        ctx.rectangle(-60, y0 - 0.5, W + 120, h + 1)
        ctx.fill()
        if e <= 0:
            hb = H / self.N
            sz = hb * 0.86
            gap = sz * 0.55
            tile = BLACK.width(self.year, sz) + gap
            off = 75 * (t - 4.0)
            b = y0 + h / 2 + BLACK.cap_px(sz) / 2
            x = (off % tile) - tile
            while x < W:
                BLACK.text_path(ctx, self.year, x, b, sz)
                x += tile
            rgb(ctx, PAPER)
            ctx.fill()
            return
        BLACK.text_path(ctx, self.year, CX - ww / 2, base, size)
        rgb(ctx, PAPER)
        ctx.fill()
        a = clamp((t - 5.08) / 0.1)
        rgb(ctx, INK, a)
        MONO.text_path(ctx, 'TRACKING 0', 60, y0 + 46, 24)
        MONO.text_path(ctx, f'SIZE {int(size)}PX', W - 60, y0 + 46, 24, anchor='r')
        MONO.text_path(ctx, 'BASELINE', 60, base + 36, 24)
        ctx.fill()
        ctx.rectangle(60, base + 6, (W - 120) * ease_out(remap(t, 5.08, 5.35)), 3)
        ctx.fill()

    # ---------------------------------------------------------------- camera
    def counter_path(self, ctx, t):
        y0, h, size, lay, ww, base = self.center_layout(t)
        gx = lay[self.zero_idx][1]
        ox = CX - ww / 2 + gx
        contour_path(ctx, self.counter, ox, base, size, BLACK.upm)
        x0, x1, ya, yb = self.counter_box
        s = size / BLACK.upm
        return ox + (x0 + x1) / 2 * s, base - (ya + yb) / 2 * s, (x1 - x0) / 2 * s, (yb - ya) / 2 * s

    def camera(self, ctx, t):
        a, b = TYPE_ZOOM
        u = remap(t, a, b)
        if u <= 0:
            return 1.0
        self._tmp.new_path()
        cx, cy, rx, ry = self.counter_path(self._tmp, t)
        self._tmp.new_path()
        zmax = 1.3 * math.sqrt((CX / (rx * 0.8)) ** 2 + (CY / (ry * 0.8)) ** 2)
        z = math.exp(math.log(zmax) * ease_in(u, 3.0))
        f = smooth(u) ** 0.6
        fx, fy = lerp(CX, cx, f), lerp(CY, cy, f)
        ctx.translate(CX, CY)
        ctx.rotate(-0.2 * ease_in(u, 2))
        ctx.scale(z, z)
        ctx.translate(-fx, -fy)
        return z

    def portal_progress(self, t):
        return remap(t, *TYPE_ZOOM)

    # ---------------------------------------------------------------- draw
    def draw(self, ctx, t, portal=None):
        hs = self.heights(t)
        ctx.save()
        self.camera(ctx, t)
        y = 0.0
        for i in range(self.N):
            h = hs[i]
            ctx.save()
            ctx.translate(self.row_offset(i, t), 0)
            if i == self.MID:
                self.draw_center(ctx, t)
            else:
                ws = 4.72 + 0.022 * i
                inv = ws <= t < ws + 0.045
                rgb(ctx, INK)
                ctx.rectangle(-60, y - 0.5, W + 120, h + 1)
                ctx.fill()
                self.draw_row_text(ctx, i, y, h, t)
                if inv:
                    ctx.save()
                    ctx.rectangle(-60, y, W + 120, h)
                    ctx.clip()
                    ctx.set_operator(cairo.OPERATOR_DIFFERENCE)
                    rgb(ctx, WHITE)
                    ctx.paint()
                    ctx.restore()
            ctx.restore()
            y += h
        if portal is not None and t >= TYPE_ZOOM[0]:
            ctx.new_path()
            self.counter_path(ctx, t)
            ctx.restore()          # back to screen space, path kept in device coords
            ctx.save()
            ctx.clip()
            portal(ctx, t, self.portal_progress(t))
        ctx.restore()


TYPE = TypeRows()
