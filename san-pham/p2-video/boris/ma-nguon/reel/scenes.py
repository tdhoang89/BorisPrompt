"""All scenes of the reel. draw(ctx, t) renders the full frame at time t."""
import math
import cairo
import numpy as np

from engine import *
from timeline import *

# ============================================================================
# shared: HUD overlay, camera shake
# ============================================================================

SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/&*+'


def scramble_text(txt, t_since, dur=0.22):
    """Chars resolve left-to-right; unresolved chars flicker through glyphs."""
    if t_since >= dur:
        return txt
    n = len(txt)
    k = int(n * clamp(t_since / dur))
    out = list(txt[:k])
    fr = int(t_since * 60)
    for i in range(k, n):
        ch = txt[i]
        if ch == ' ':
            out.append(' ')
        else:
            out.append(SCRAMBLE[int(hash11(i * 13 + fr * 7) * len(SCRAMBLE))])
    return ''.join(out)


def draw_hud(ctx, t):
    tt = t % DUR
    ctx.save()
    ctx.set_operator(cairo.OPERATOR_DIFFERENCE)
    a = 0.92
    rgb(ctx, WHITE, a)
    sz = 25
    name = CFG['name'].upper()
    MONO.text_path(ctx, f'{name}/MOTION', 60, 246, sz)
    ctx.fill()
    fr = int(round(tt * FPS))
    tc = f'{fr // (FPS * 60):02d}:{(fr // FPS) % 60:02d}:{fr % FPS:02d}'
    MONO.text_path(ctx, f'REEL·26  {tc}', W - 60, 246, sz, anchor='r')
    ctx.fill()
    # progress bar
    ctx.rectangle(60, 200, (W - 120) * (tt / DUR), 4)
    ctx.fill()
    for i in range(11):
        ctx.rectangle(60 + (W - 120) * i / 10 - 1, 194, 2, 16 if i % 5 == 0 else 10)
    ctx.fill()
    # chapter
    start, num, label = chapter_at(tt)
    since = tt - start
    lbl = scramble_text(label, since)
    pop = back_out(remap(since, 0, 0.18), 2.5)
    ctx.save()
    ctx.translate(60, 290)
    ctx.scale(1, max(pop, 0.01))
    rrect(ctx, 0, -27, 52, 36, 6)
    ctx.fill()
    ctx.restore()
    ctx.set_operator(cairo.OPERATOR_DIFFERENCE)
    rgb(ctx, WHITE, 1)
    # number knocked out of the box: draw again with difference -> inverted
    MONO.text_path(ctx, num, 60 + 26, 288, sz, anchor='c')
    ctx.fill()
    MONO.text_path(ctx, lbl, 128, 288, sz)
    ctx.fill()
    ctx.restore()


def impact_amount(t):
    s = 0.0
    for ti, amp in IMPACTS:
        d = t - ti
        if -0.02 < d < 0.6:
            s = max(s, amp * pulse(d, 0.01, 0.12))
    return s


def shake(ctx, t, amt):
    if amt <= 0.001:
        return
    fr = t * 60
    dx = (hash11(math.floor(fr) * 3.1) - 0.5) * 2
    dy = (hash11(math.floor(fr) * 7.7 + 1) - 0.5) * 2
    ctx.translate(CX, CY)
    ctx.rotate(dx * 0.012 * amt)
    ctx.translate(-CX + dx * 26 * amt, -CY + dy * 26 * amt)


def bg_grid(ctx, col, alpha, step=120, size=9, off=(0, 0)):
    rgb(ctx, col, alpha)
    ox, oy = off[0] % step, off[1] % step
    y = oy - step
    while y < H + step:
        x = ox - step
        while x < W + step:
            ctx.rectangle(x - size / 2, y - 1, size, 2)
            ctx.rectangle(x - 1, y - size / 2, 2, size)
            x += step
        y += step
    ctx.fill()


# ============================================================================
# S1 — squash & stretch: a ball bounces down a staircase of words
# ============================================================================

class Intro:
    X0 = 64
    BR = 36
    G = 10000.0
    CONTACT = 0.05

    def __init__(self):
        w = [s.upper() for s in CFG['intro_words']]
        self.words = w
        sizes = [180, 180, 280]
        # fit to width (MOVE line incl. the period-ball)
        maxw = W - 2 * self.X0 - 2 * self.BR - 20
        for i in range(3):
            ww = BLACK.width(w[i], sizes[i]) + (14 + 2 * self.BR if i == 2 else 0)
            if ww > maxw:
                sizes[i] *= maxw / ww
        self.sizes = sizes
        caps = [BLACK.cap_px(s) for s in sizes]
        self.caps = caps
        gap = 52
        total = caps[0] + gap + caps[1] + gap + caps[2]
        top = CY - total / 2 + 10
        self.base = [top + caps[0], top + caps[0] + gap + caps[1], top + total]
        self.lay = [BLACK.layout(w[i], sizes[i]) for i in range(3)]
        widths = [l[1] for l in self.lay]
        self.widths = widths
        # contact x on each word (right shoulder), final = period position
        cx = [self.X0 + widths[0] - 0.24 * sizes[0],
              self.X0 + widths[1] - 0.22 * sizes[1],
              self.X0 + widths[2] - 0.2 * sizes[2],
              self.X0 + widths[2] + 14 + self.BR]
        self.cx = cx
        # nominal surfaces (y of ball bottom at contact)
        self.surf = [self.base[0] - caps[0], self.base[1] - caps[1], self.base[2] - caps[2], self.base[2]]
        # contact letter index per word
        self.cl = []
        for i in range(3):
            lay = self.lay[i][0]
            idx = 0
            for j, (ch, gx) in enumerate(lay):
                if self.X0 + gx <= cx[i]:
                    idx = j
            self.cl.append(idx)

    # --- word letters -------------------------------------------------------
    def letter_sy(self, i, j, t):
        T = BOUNCES[i]
        d = abs(j - self.cl[i])
        start = T - 0.13 + 0.035 * d
        u = remap(t, start, start + 0.13)
        if u <= 0:
            return 0.0
        sy = back_out(u, 1.4) if u < 1 else 1.0
        # impact wave travelling outward through the letters
        sy *= 1 - 0.2 * wobble(t - T - 0.03 * d, 3.2, 8.0) * (1 if t >= T + 0.03 * d else 0)
        return sy

    def surface_y(self, i, t):
        if i == 3:
            return self.surf[3]
        sy = self.letter_sy(i, self.cl[i], t)
        return self.base[i] - self.caps[i] * sy

    # --- ball state ---------------------------------------------------------
    def ball(self, t):
        """-> x, y(center), rx, ry, angle"""
        BR, G = self.BR, self.G
        T = BOUNCES
        if t < T[0]:
            # launched from the CTA button at the end of the reel (loop seam)
            TL = LAUNCH_T - DUR
            tt = clamp(t, TL, 0.0) - TL
            Tf = -TL
            xa, ya = LAUNCH
            xb, yb = self.cx[0], self.surf[0] - BR
            v0 = (yb - ya - 0.5 * G * Tf * Tf) / Tf
            x = lerp(xa, xb, tt / Tf)
            y = ya + v0 * tt + 0.5 * G * tt * tt
            return self._flight(x, y, (xb - xa) / Tf, v0 + G * tt)
        for i in range(4):
            Ti = T[i]
            nxt = T[i + 1] if i < 3 else 99
            if t < Ti + self.CONTACT or i == 3:
                if i == 3:
                    t = min(t, BALL_ZOOM[0])
                    dt = t - Ti
                    q = 0.45 * wobble(dt, 3.0, 7.0)
                    # anticipation before the zoom
                    q += 0.22 * smooth(remap(t, 1.6, BALL_ZOOM[0]))
                else:
                    dt = t - Ti
                    q = 0.46 * (1 - dt / self.CONTACT) ** 1.3
                q = clamp(q, -0.3, 0.6)
                ry = BR * (1 - q)
                rx = BR * (1 + q * 0.85)
                bottom = self.surface_y(i, t)
                return self.cx[i], bottom - ry, rx, ry, 0.0
            if t < nxt:
                ts = Ti + self.CONTACT
                Tf = nxt - ts
                xa = self.cx[i]
                ya = self.surface_y(i, ts) - BR
                xb = self.cx[i + 1]
                yb = self.surf[i + 1] - BR
                v0 = (yb - ya - 0.5 * G * Tf * Tf) / Tf
                u = t - ts
                x = lerp(xa, xb, u / Tf)
                y = ya + v0 * u + 0.5 * G * u * u
                return self._flight(x, y, (xb - xa) / Tf, v0 + G * u)
        return self.cx[3], self.surf[3] - BR, BR, BR, 0.0

    def _flight(self, x, y, vx, vy):
        sp = math.hypot(vx, vy)
        st = 1 + min(sp / 6500, 0.38)
        return x, y, self.BR * st, self.BR / st, math.atan2(vy, vx)

    # --- drawing ------------------------------------------------------------
    def draw_words(self, ctx, t):
        for i in range(3):
            lay, wtot = self.lay[i]
            size = self.sizes[i]
            base = self.base[i]
            for j, (ch, gx) in enumerate(lay):
                sy = self.letter_sy(i, j, t)
                if sy <= 0.001:
                    continue
                adv = BLACK.glyph(ch)[1] * size / BLACK.upm
                lx = self.X0 + gx + adv / 2
                sx = 1 + (1 - sy) * 0.35
                ctx.save()
                ctx.translate(lx, base)
                ctx.scale(sx, sy)
                ctx.translate(-lx, -base)
                BLACK.glyph_path(ctx, ch, self.X0 + gx, base, size)
                ctx.restore()
            if i == 1:
                rgb(ctx, PAPER)
                ctx.set_line_width(5)
                ctx.set_line_join(cairo.LINE_JOIN_ROUND)
                ctx.stroke()
            else:
                rgb(ctx, PAPER)
                ctx.fill()

    def draw_fx(self, ctx, t):
        # impact rings + dust
        for i, Ti in enumerate(BOUNCES):
            d = t - Ti
            if 0 <= d < 0.45:
                u = d / 0.45
                x, y = self.cx[i], self.surf[i]
                r = 24 + 120 * expo_out(u)
                ctx.save()
                ctx.translate(x, y)
                ctx.scale(1, 0.22)
                circle(ctx, 0, 0, r)
                ctx.restore()
                rgb(ctx, PAPER, 1 - u)
                ctx.set_line_width(4 * (1 - u) + 0.5)
                ctx.stroke()
                for k in range(6):
                    side = -1 if k % 2 == 0 else 1
                    sp = 300 + 420 * hash11(k + i * 10)
                    ang = side * (0.25 + 0.5 * hash11(k * 3 + i))
                    dd = sp * (1 - math.exp(-d * 7)) / 7 * 6
                    px = x + side * dd * math.cos(ang)
                    py = y - dd * abs(math.sin(ang)) * 0.6 + 900 * d * d
                    rr = (3 + 5 * hash11(k + 77)) * (1 - u)
                    circle(ctx, px, py, rr)
                rgb(ctx, YELLOW)
                ctx.fill()

    def draw_trail(self, ctx, t):
        for k in range(1, 30):
            tk = t - k * 0.018
            if tk < LAUNCH_T - DUR:
                break
            x, y, *_ = self.ball(tk)
            a = 0.55 * (1 - k / 30)
            circle(ctx, x, y, 4.5)
            rgb(ctx, PAPER, a)
            ctx.fill()

    def draw_ball(self, ctx, t, col=YELLOW):
        x, y, rx, ry, ang = self.ball(t)
        if t < 0:
            k = back_out(remap(t, LAUNCH_T - DUR - 0.08, LAUNCH_T - DUR + 0.04), 2.5)
            if k <= 0:
                return
            rx, ry = rx * k, ry * k
        ellipse(ctx, x, y, rx, ry, ang)
        rgb(ctx, col)
        ctx.fill()

    def callout(self, ctx, t, t0, t1, label, ax, ay, dx, dy):
        if not (t0 <= t < t1):
            return
        a = smooth(remap(t, t0, t0 + 0.06)) * (1 - smooth(remap(t, t1 - 0.08, t1)))
        ex, ey = ax + dx, ay + dy
        circle(ctx, ax, ay, 6)
        rgb(ctx, YELLOW, a)
        ctx.fill()
        ctx.move_to(ax, ay)
        ctx.line_to(ex, ey)
        ctx.line_to(ex + (40 if dx > 0 else -40), ey)
        ctx.set_line_width(2.5)
        ctx.stroke()
        txt = scramble_text(label, t - t0, 0.15)
        MONO.text_path(ctx, txt, ex + (52 if dx > 0 else -52), ey + 8, 24, anchor='l' if dx > 0 else 'r')
        ctx.fill()

    def draw_annotations(self, ctx, t):
        x, y, *_ = self.ball(t)
        self.callout(ctx, t, 0.0, 0.42, 'SQUASH 46%', self.cx[0] + 40, self.surf[0] - 10, 110, -150)
        self.callout(ctx, t, 0.56, 0.95, 'STRETCH', x + 30, y - 20, 120, -110)
        tk = 1.08
        bx, by, *_ = self.ball(tk)
        self.callout(ctx, t, 1.12, 1.48, 'ARC', bx + 10, by - 10, 100, -120)
        self.callout(ctx, t, 1.55, 1.74, 'ANTICIPATION', self.cx[3] - 10, self.surf[3] + 4, -70, 95)

    def draw_graph(self, ctx, t):
        a = 1 - smooth(remap(t, 1.6, 1.75))
        if a <= 0:
            return
        x0, x1, y0, y1 = 60, W - 60, 1440, 1610
        ta, tb = -0.25, 1.75
        rgb(ctx, PAPER, 0.35 * a)
        ctx.set_line_width(2)
        rrect(ctx, x0, y0, x1 - x0, y1 - y0, 10)
        ctx.stroke()
        MONO.text_path(ctx, 'GRAPH EDITOR', x0 + 18, y0 + 34, 22)
        MONO.text_path(ctx, 'BALL.POSITION.Y', x1 - 18, y0 + 34, 22, anchor='r')
        ctx.fill()

        def gp(tt):
            yy = self.ball(tt)[1]
            gx = lerp(x0 + 20, x1 - 20, (tt - ta) / (tb - ta))
            gy = lerp(y0 + 52, y1 - 16, clamp((yy - 380) / (1250 - 380)))
            return gx, gy

        n = 140
        tc = min(t, tb)
        for i in range(n + 1):
            tt = lerp(ta, tc, i / n)
            p = gp(tt)
            ctx.line_to(*p) if i else ctx.move_to(*p)
        rgb(ctx, PAPER, a)
        ctx.set_line_width(4)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
        for bt in BOUNCES:
            if bt <= t:
                px, py = gp(bt)
                s = 11 * back_out(remap(t, bt, bt + 0.15), 3)
                poly(ctx, [(px, py - s), (px + s, py), (px, py + s), (px - s, py)])
                rgb(ctx, YELLOW, a)
                ctx.fill()
        px, py = gp(tc)
        ctx.rectangle(px - 1, y0 + 46, 2, y1 - y0 - 56)
        rgb(ctx, YELLOW, a)
        ctx.fill()
        circle(ctx, px, py, 7)
        ctx.fill()

    def draw(self, ctx, t):
        fill_bg(ctx, BLUE)
        bg_grid(ctx, PAPER, 0.13)
        if 0 <= t:
            self.draw_graph(ctx, t)
        z0, z1 = BALL_ZOOM
        u = remap(t, z0, z1)
        ctx.save()
        if u > 0:
            # camera pushes in on the period-ball
            px, py = self.cx[3], self.surf[3] - self.BR
            zc = 1 + 1.6 * ease_in(u, 3)
            ctx.translate(px, py)
            ctx.scale(zc, zc)
            ctx.translate(-px, -py)
        self.draw_trail(ctx, t) if t < z0 else None
        self.draw_words(ctx, t)
        self.draw_fx(ctx, t)
        if 0 <= t < z0:
            self.draw_annotations(ctx, t)
        ctx.restore()
        if u <= 0:
            self.draw_ball(ctx, t)
        else:
            x, y, rx, ry, _ = self.ball(z0)
            k = expo_in(u) if u < 1 else 1
            k = max(k, ease_in(u, 3))
            r = lerp(self.BR, 1250, k)
            sq = lerp(ry / self.BR, 1.0, smooth(u * 3))
            cxp = lerp(x, CX, ease_io(u, 2))
            cyp = lerp(y, CY, ease_io(u, 2))
            ellipse(ctx, cxp, cyp, r * (2 - sq) ** 0.5, r * sq, 0)
            rgb(ctx, YELLOW)
            ctx.fill()


INTRO = Intro()


# ============================================================================
# S2 — shape morph with echo trails
# ============================================================================

class Morph:
    N = 300

    def __init__(self):
        th = np.linspace(0, TAU, self.N, endpoint=False)
        self.th = th
        circ = np.full(self.N, 280.0)
        sq = polar_shape_radius([(250, 250), (-250, 250), (-250, -250), (250, -250)], th)
        tri = polar_shape_radius(ngon_pts(0, 50, 380, 3), th)
        star = polar_shape_radius(star_pts(0, 15, 390, 175, 5), th)
        bar = polar_shape_radius([(900, 87.5), (-900, 87.5), (-900, -87.5), (900, -87.5)], th)
        self.shapes = [circ, sq, tri, star, bar]
        # extra rotation applied per stage
        self.rots = [0.0, math.pi / 4, math.pi / 2 + math.pi / 6, math.pi, math.pi * 2]

    def state(self, t):
        """radius array and rotation at time t (spring overshoot between stages)."""
        m = MORPHS
        if t < m[1]:
            k, e = 0, 0.0
        else:
            k = 0
            for i in range(1, len(m)):
                if t >= m[i]:
                    k = i
            dt = t - m[k]
            if k == 4:
                e = expo_out(dt / 0.16)
            else:
                e = spring(dt, 2.6, 9.0)
            k -= 1
            # from shape k -> k+1
        a = self.shapes[k]
        b = self.shapes[min(k + 1, 4)]
        if t < m[1]:
            r = a
            rot = 0.0
        else:
            r = a + (b - a) * e
            rot = lerp(self.rots[k], self.rots[k + 1], e)
        # pop in at the start
        pop = back_out(remap(t, m[0], m[0] + 0.32), 2.2)
        breathe = 1 + 0.03 * pulse((t - 2.0) % 0.5, 0.01, 0.1)
        return r * pop * breathe, rot + 0.15 * math.sin(t * 2) * (1 - smooth(remap(t, 3.6, 3.85)))

    def path(self, ctx, r, rot, x, y, sx=1.0, sy=1.0):
        th = self.th + rot
        xs = x + r * np.cos(th) * sx
        ys = y + r * np.sin(th) * sy
        ctx.move_to(xs[0], ys[0])
        for i in range(1, self.N):
            ctx.line_to(xs[i], ys[i])
        ctx.close_path()

    def draw(self, ctx, t, bg=True):
        if bg:
            fill_bg(ctx, YELLOW)
            bg_grid(ctx, INK, 0.1, off=(0, -(t - 2) * 60))
        # orbiting dots
        n = 12
        for i in range(n):
            a = i / n * TAU + t * 0.9
            pp = pulse((t - 2.0) % 0.5 - 0.04 * (i % 4), 0.01, 0.12)
            rr = 9 + 10 * pp
            rad = 455 + 25 * math.sin(t * 3 + i)
            circle(ctx, CX + math.cos(a) * rad, CY + math.sin(a) * rad * 1.08, rr * back_out(remap(t, 2.05 + i * 0.015, 2.35 + i * 0.015)))
        rgb(ctx, INK)
        ctx.fill()
        for mt in MORPHS[:4]:
            d = t - mt
            if 0 <= d < 0.6:
                u = d / 0.6
                circle(ctx, CX, CY, 300 + 650 * expo_out(u))
                rgb(ctx, INK, 0.5 * (1 - u))
                ctx.set_line_width(14 * (1 - u) + 1)
                ctx.stroke()
        cols = [MINT, BLUE, CORAL]
        for k, col in enumerate(cols):
            d = (len(cols) - k) * 0.045
            r, rot = self.state(t - d)
            self.path(ctx, r, rot, CX, CY)
            rgb(ctx, col)
            ctx.fill()
        r, rot = self.state(t)
        self.path(ctx, r, rot, CX, CY)
        rgb(ctx, INK)
        ctx.fill()
        # inner secondary action: lagging outline
        r2, rot2 = self.state(t - 0.09)
        self.path(ctx, r2 * 0.55, -rot2 * 0.7, CX, CY)
        rgb(ctx, YELLOW)
        ctx.set_line_width(7)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
        # captions
        names = ['CIRCLE', 'SQUARE', 'TRIANGLE', 'STAR']
        for i, nm in enumerate(names):
            ts = MORPHS[i] + 0.05
            if t >= ts:
                u = back_out(remap(t, ts, ts + 0.25), 2)
                x = 120 + i * 230
                txt = scramble_text(nm, t - ts, 0.2)
                ctx.save()
                ctx.translate(x, 1520 + 30 * (1 - u))
                MONO.text_path(ctx, txt, 0, 0, 28)
                rgb(ctx, INK, clamp(u))
                ctx.fill()
                ctx.restore()
        # arrow progress line
        prog = remap(t, 2.0, 3.6)
        ctx.rectangle(120, 1545, (W - 240) * prog, 3)
        rgb(ctx, INK)
        ctx.fill()


MORPH = Morph()


