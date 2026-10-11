"""S6 — the drop: nine rapid-fire shots, each handing its motion to the next."""
import math
import os
import cairo
import numpy as np

from engine import *
from timeline import *

PAL = [PAPER, YELLOW, INK, BLUE, MINT, CORAL, LILAC]


# ----------------------------------------------------------------------------
# 10.0 – 11.0  burst: shockwave, sunburst, confetti physics
# ----------------------------------------------------------------------------

def _confetti_init(n=210, seed=3):
    r = rng(seed)
    ang = r.uniform(0, TAU, n)
    sp = r.uniform(900, 3600, n) * (1 + 0.3 * r.standard_normal(n).clip(-1, 1))
    return dict(
        vx=np.cos(ang) * sp, vy=np.sin(ang) * sp * 1.15 - 500,
        kind=r.integers(0, 5, n), col=r.integers(0, 6, n),
        size=r.uniform(14, 34, n), spin=r.uniform(-14, 14, n),
        flip=r.uniform(6, 16, n), ph=r.uniform(0, TAU, n),
        drag=r.uniform(2.2, 3.6, n))


CONF = _confetti_init()
CONF_COLS = [PAPER, YELLOW, INK, BLUE, MINT, LILAC]


def confetti(ctx, lt, ox=CX, oy=CY, alpha=1.0):
    c = CONF
    g = 2600.0
    k = c['drag']
    e = np.exp(-k * lt)
    x = ox + c['vx'] * (1 - e) / k
    y = oy + c['vy'] * (1 - e) / k + g / k * (lt - (1 - e) / k)
    for i in range(len(x)):
        s = c['size'][i]
        rot = c['ph'][i] + c['spin'][i] * lt
        fl = math.cos(c['ph'][i] + c['flip'][i] * lt)
        ctx.save()
        ctx.translate(x[i], y[i])
        ctx.rotate(rot)
        ctx.scale(1, max(abs(fl), 0.08))
        kd = c['kind'][i]
        col = CONF_COLS[c['col'][i]]
        if kd == 0:
            ctx.rectangle(-s / 2, -s * 0.3, s, s * 0.6)
            rgb(ctx, col, alpha)
            ctx.fill()
        elif kd == 1:
            circle(ctx, 0, 0, s * 0.4)
            rgb(ctx, col, alpha)
            ctx.fill()
        elif kd == 2:
            poly(ctx, ngon_pts(0, 0, s * 0.55, 3))
            rgb(ctx, col, alpha)
            ctx.fill()
        elif kd == 3:
            circle(ctx, 0, 0, s * 0.38)
            rgb(ctx, col, alpha)
            ctx.set_line_width(s * 0.18)
            ctx.stroke()
        else:
            for j in range(9):
                xx = -s + j * s / 4
                yy = math.sin(j * 1.5) * s * 0.25
                ctx.line_to(xx, yy) if j else ctx.move_to(xx, yy)
            rgb(ctx, col, alpha)
            ctx.set_line_width(s * 0.16)
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            ctx.stroke()
        ctx.restore()


def sunburst(ctx, x, y, n, rot, c1, c2, rad=2600):
    rgb(ctx, c1)
    ctx.paint()
    for i in range(n):
        a0 = rot + i * TAU / n
        a1 = a0 + TAU / n / 2
        ctx.move_to(x, y)
        ctx.arc(x, y, rad, a0, a1)
        ctx.close_path()
    rgb(ctx, c2)
    ctx.fill()


def draw_burst(ctx, t):
    lt = t - 10.0
    grow = expo_out(lt / 0.35)
    ctx.save()
    sunburst(ctx, CX, CY, 22, lt * 0.9 + 0.5 * expo_out(lt / 0.5), CORAL, shade(CORAL, 0.1), rad=2600 * grow)
    ctx.restore()
    # big concentric target behind confetti
    for k, col in enumerate([YELLOW, PAPER, INK]):
        u = remap(lt, 0.02 + k * 0.05, 0.6 + k * 0.05)
        if 0 < u < 1:
            r = 40 + 1500 * expo_out(u)
            circle(ctx, CX, CY, r)
            rgb(ctx, col)
            ctx.set_line_width(70 * (1 - u) ** 1.5 + 1)
            ctx.stroke()
    # centre badge: rotating star sticker with the year
    pop = back_out(remap(lt, 0.03, 0.33), 2.4) * (1 - expo_in(remap(lt, 0.86, 1.0)))
    pop *= 1 + 0.12 * pulse(lt - 0.5, 0.01, 0.1)
    if pop > 0.01:
        ctx.save()
        ctx.translate(CX, CY)
        ctx.scale(pop, pop)
        ctx.rotate(-0.4 + lt * 0.8)
        pts = star_pts(0, 0, 330, 270, 14, 0)
        smooth_closed(ctx, pts, 0.4)
        rgb(ctx, INK)
        ctx.fill()
        ctx.rotate(0.4 - lt * 0.8 - 0.12)
        yr = str(CFG.get('year', '2026'))
        sz = 210
        w = BLACK.width(yr, sz)
        BLACK.text_path(ctx, yr, -w / 2, BLACK.cap_px(sz) / 2 - 14, sz)
        rgb(ctx, YELLOW)
        ctx.fill()
        MONO.text_path(ctx, 'NEW  REEL', 0, -BLACK.cap_px(sz) / 2 - 40, 34, anchor='c')
        MONO.text_path(ctx, 'OUT NOW', 0, BLACK.cap_px(sz) / 2 + 66, 34, anchor='c')
        rgb(ctx, PAPER)
        ctx.fill()
        ctx.restore()
    confetti(ctx, lt)
    # flash
    if lt < 0.09:
        rgb(ctx, PAPER, 1 - lt / 0.09)
        ctx.paint()


# ----------------------------------------------------------------------------
# cell grid helpers (burst -> grid -> flip)
# ----------------------------------------------------------------------------
CELL = 120
GCOLS, GROWS = 9, 16


def cell_centers():
    for j in range(GROWS):
        for i in range(GCOLS):
            yield i, j, (i + 0.5) * CELL, (j + 0.5) * CELL


def draw_cover_cells(ctx, t, t0, dur, col, origin='center'):
    """cells scale up in a wave until they tile the screen."""
    maxd = math.hypot(CX, CY)
    for i, j, x, y in cell_centers():
        if origin == 'center':
            d = math.hypot(x - CX, y - CY) / maxd
        else:
            d = (i / GCOLS + j / GROWS) / 2
        u = remap(t, t0 + d * dur * 0.6, t0 + d * dur * 0.6 + dur * 0.4)
        s = back_out(u, 1.3) * (CELL + 2)
        if s <= 0.5:
            continue
        rr = (CELL / 2) * (1 - u)
        rrect(ctx, x - s / 2, y - s / 2, s, s, rr)
    rgb(ctx, col)
    ctx.fill()


def draw_grid(ctx, t):
    fill_bg(ctx, YELLOW)
    lt = t - 11.0
    for i, j, x, y in cell_centers():
        d = math.hypot(x - CX, y - CY)
        e = expo_out(remap(lt, d * 0.00012, 0.18 + d * 0.00012))
        w = 0.5 + 0.5 * math.sin(d * 0.016 - lt * 15)
        size = lerp(CELL + 2, 26 + 74 * w, e)
        rot = e * (w * math.pi / 2 + lt * 2)
        rad = size * 0.5 * e * (1 - w)
        # cover back up at the end (diagonal wave)
        dd = (i / GCOLS + j / GROWS) / 2
        cu = back_out(remap(lt, 0.36 + dd * 0.08, 0.44 + dd * 0.08), 1.2)
        size = lerp(size, CELL + 2, cu)
        rot *= (1 - cu)
        rad *= (1 - cu)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        rrect(ctx, -size / 2, -size / 2, size, size, rad)
        ctx.restore()
    rgb(ctx, INK)
    ctx.fill()
    # accent dots in the cells
    for i, j, x, y in cell_centers():
        d = math.hypot(x - CX, y - CY)
        w = 0.5 + 0.5 * math.sin(d * 0.016 - lt * 15 + 1.4)
        if (i + j) % 3 == 0:
            circle(ctx, x, y, 9 * w * (1 - remap(lt, 0.34, 0.4)))
    rgb(ctx, CORAL)
    ctx.fill()


# ----------------------------------------------------------------------------
# 11.5 – 12.0 card flip reveal
# ----------------------------------------------------------------------------
FC, FR = 6, 10
FW, FH = W / FC, H / FR


def flip_back_art(ctx):
    rgb(ctx, BLUE)
    ctx.paint()
    lines = ['IDEAS', 'IN', 'MOTION']
    sizes = [290, 290, 230]
    ys = [740, 1010, 1230]
    for k, (ln, sz, y) in enumerate(zip(lines, sizes, ys)):
        w = BLACK.width(ln, sz)
        sz2 = min(sz, sz * 960 / w)
        w = BLACK.width(ln, sz2)
        BLACK.text_path(ctx, ln, CX - w / 2, y, sz2)
        rgb(ctx, YELLOW if k == 1 else PAPER)
        ctx.fill()
    for k in range(12):
        sparkle_pts = star_pts(160 + (k % 4) * 250, 470 + (k // 4) * 500, 22, 7, 4, 0)
        poly(ctx, sparkle_pts)
    rgb(ctx, YELLOW)
    ctx.fill()


def draw_flip(ctx, t):
    fill_bg(ctx, INK)
    lt = t - 11.5
    for j in range(FR):
        for i in range(FC):
            st = 0.016 * (i + j)
            u = remap(lt, st, st + 0.2)
            th = math.pi * ease_io(u, 3)
            sx = math.cos(th)
            x0, y0 = i * FW, j * FH
            cx, cy = x0 + FW / 2, y0 + FH / 2
            lift = 1 + 0.12 * math.sin(th)
            ctx.save()
            ctx.translate(cx, cy)
            ctx.scale(max(abs(sx), 1e-3) * lift, lift)
            ctx.translate(-cx, -cy)
            ctx.rectangle(x0 - 0.5, y0 - 0.5, FW + 1, FH + 1)
            ctx.clip()
            if sx >= 0:
                rgb(ctx, INK)
                ctx.paint()
                rgb(ctx, CORAL)
                circle(ctx, cx, cy, 12)
                ctx.fill()
            else:
                flip_back_art(ctx)
                # shading while turning
                rgb(ctx, INK, 0.5 * (1 + sx))
                ctx.paint()
            ctx.restore()


# ----------------------------------------------------------------------------
# 12.0 – 13.0 isometric pillars
# ----------------------------------------------------------------------------
ISO_N = 7
ISO_COLS = [YELLOW, CORAL, MINT, PAPER, LILAC]


def draw_iso(ctx, t):
    lt = t - 12.0
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgb(0, *shade(BLUE, 0.1))
    g.add_color_stop_rgb(1, *shade(BLUE, -0.3))
    ctx.set_source(g)
    ctx.paint()
    az = math.radians(45 + 38 * ease_io(remap(lt, 0, 1.0), 2) + 8 * math.sin(lt * 3))
    el = math.radians(36)
    S = 112
    ca, sa = math.cos(az), math.sin(az)
    se, ce = math.sin(el), math.cos(el)
    oy = CY + 170

    def P(x, y, z):
        xr = x * ca - y * sa
        yr = x * sa + y * ca
        return CX + xr * S, oy + yr * S * se - z * S * ce, yr

    cubes = []
    half = (ISO_N - 1) / 2
    for i in range(ISO_N):
        for j in range(ISO_N):
            x, y = i - half, j - half
            d = math.hypot(x, y)
            land = 0.03 * (i + j)
            u = remap(lt, land, land + 0.22)
            drop = (1 - ease_in(u, 2)) * 14 if u < 1 else 0
            bounce = 0.25 * wobble(lt - land - 0.22, 3, 9) if u >= 1 else 0
            wave = 0.5 + 0.5 * math.sin(d * 1.1 - lt * 7.5)
            h = 0.35 + 2.3 * wave * smooth(remap(lt, 0.15, 0.4))
            # flatten at the end before the whip
            h *= 1 - 0.6 * smooth(remap(lt, 0.86, 1.0))
            z0 = drop - bounce
            xr = x * ca - y * sa
            yr = x * sa + y * ca
            cubes.append((yr + 0.001 * xr, x, y, z0, h, (i * 3 + j * 2) % len(ISO_COLS)))
    cubes.sort(key=lambda c: c[0])
    L = (-0.4, -0.7, 0.6)
    for _, x, y, z0, h, ci in cubes:
        s = 0.43
        col = ISO_COLS[ci]
        corners = [(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)]
        faces = []
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            nx, ny = (b[1] - a[1]), -(b[0] - a[0])
            nyr = nx * sa + ny * ca
            if nyr > 0:
                nxr = nx * ca - ny * sa
                faces.append((a, b, nxr))
        for a, b, nxr in faces:
            p1 = P(a[0], a[1], z0)
            p2 = P(b[0], b[1], z0)
            p3 = P(b[0], b[1], z0 + h)
            p4 = P(a[0], a[1], z0 + h)
            poly(ctx, [p1[:2], p2[:2], p3[:2], p4[:2]])
            k = -0.18 - 0.2 * (0.5 + 0.5 * nxr / (abs(nxr) + 1e-6) * 0.6)
            rgb(ctx, shade(col, k))
            ctx.fill()
        top = [P(cx_, cy_, z0 + h)[:2] for cx_, cy_ in corners]
        poly(ctx, top)
        rgb(ctx, col)
        ctx.fill()
    # floor shadow line
    rgb(ctx, PAPER, 0.85)
    MONO.text_path(ctx, f'AZ {math.degrees(az):05.1f}°  EL 36.0°', CX, 1560, 26, anchor='c')
    ctx.fill()


# ----------------------------------------------------------------------------
# 13.0 – 13.5 line terrain, collapsing into a single line
# ----------------------------------------------------------------------------
TER_COLS = [MINT, BLUE, LILAC, PINK, CORAL, YELLOW]


def terrain_col(k, n):
    f = k / (n - 1) * (len(TER_COLS) - 1)
    a = int(f)
    return mixc(TER_COLS[a], TER_COLS[min(a + 1, len(TER_COLS) - 1)], f - a)


def draw_terrain(ctx, t):
    fill_bg(ctx, INK)
    lt = t - 13.0
    n = 30
    F = 620
    horizon = 640
    travel = lt * 5.0
    collapse = ease_in(remap(lt, 0.36, 0.5), 2)
    xs = np.linspace(-4.0, 4.0, 200)
    kp = pulse(lt % BEAT, 0.005, 0.15)
    for k in range(n - 1, -1, -1):
        z = 1.0 + k * 0.32 - (travel % 0.32)
        sx = CX + xs * F / z
        h = (0.35 * np.exp(-(xs * 1.3) ** 2) * (1.2 + 0.6 * np.sin(z * 2.2 + lt * 6))
             + 0.06 * np.sin(xs * 7 + z * 3 - lt * 9) + 0.04 * np.sin(xs * 17 - z * 5))
        h = h * (1 + 0.5 * kp)
        h = np.maximum(h, 0) * (1 - collapse)
        base_y = horizon + 1.1 * F / z
        base_y = lerp(base_y, CY, collapse)
        sy = base_y - h * F / z * 1.6
        # occluding fill
        ctx.move_to(sx[0], H + 10)
        for x_, y_ in zip(sx, sy):
            ctx.line_to(x_, y_)
        ctx.line_to(sx[-1], H + 10)
        ctx.close_path()
        rgb(ctx, INK)
        ctx.fill()
        ctx.move_to(sx[0], sy[0])
        for x_, y_ in zip(sx[1:], sy[1:]):
            ctx.line_to(x_, y_)
        fog = clamp(1 - (z - 1) / (n * 0.32)) ** 0.8
        rgb(ctx, mixc(INK, terrain_col(n - 1 - k, n), fog))
        ctx.set_line_width(4.5 * (1.4 / z) + 1.5)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
    # sun
    r = 150
    ctx.save()
    circle(ctx, CX, horizon - 60, r * (1 - collapse))
    ctx.clip()
    gg = cairo.LinearGradient(0, horizon - 60 - r, 0, horizon - 60 + r)
    gg.add_color_stop_rgb(0, *YELLOW)
    gg.add_color_stop_rgb(1, *CORAL)
    ctx.set_source(gg)
    ctx.paint()
    for b in range(6):
        yy = horizon - 60 + b * 26 - 10 + (lt * 60) % 26
        ctx.rectangle(0, yy, W, 4 + b * 2)
    rgb(ctx, INK)
    ctx.fill()
    ctx.restore()


# ----------------------------------------------------------------------------
# 13.5 – 14.0 audio reactive bars (driven by the actual soundtrack)
# ----------------------------------------------------------------------------
_SPEC = None


def spectrum(t, nb=28):
    global _SPEC
    if _SPEC is None:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', 'spectrum.npy')
        _SPEC = np.load(p) if os.path.exists(p) else False
    if _SPEC is False:
        return np.array([0.5 + 0.5 * math.sin(t * 13 + i * 0.7) * math.sin(t * 5 + i * 0.3) for i in range(nb)])
    fi = int(clamp(t * FPS, 0, len(_SPEC) - 1))
    return _SPEC[fi][:nb]


def draw_eq(ctx, t):
    fill_bg(ctx, INK)
    lt = t - 13.5
    nb = 28
    sp = spectrum(t, nb)
    bw, gap = 24, 11
    total = nb * bw + (nb - 1) * gap
    x0 = CX - total / 2
    grow = expo_out(remap(lt, 0.0, 0.12))
    shrink = 1 - ease_in(remap(lt, 0.42, 0.5), 2)
    # baseline
    ctx.rectangle(x0, CY - 2, total * (1 - remap(lt, 0.44, 0.5)), 4)
    rgb(ctx, PAPER, 0.4)
    ctx.fill()
    for i in range(nb):
        v = float(sp[i])
        h = (20 + 560 * v) * grow * shrink
        x = x0 + i * (bw + gap)
        col = terrain_col(i, nb)
        rrect(ctx, x, CY - h, bw, 2 * h, bw / 2)
        rgb(ctx, col)
        ctx.fill()
        # mirrored peak dots
        circle(ctx, x + bw / 2, CY - h - 26, 6 * grow * shrink)
        circle(ctx, x + bw / 2, CY + h + 26, 6 * grow * shrink)
        rgb(ctx, PAPER)
        ctx.fill()
    rgb(ctx, PAPER, 0.8 * shrink)
    MONO.text_path(ctx, 'FFT  28 BANDS  LIVE', CX, 1560, 26, anchor='c')
    ctx.fill()


# ----------------------------------------------------------------------------
# 14.0 – 15.0 logo trace (trim paths), 15.0-15.25 glitch slices
# ----------------------------------------------------------------------------

def _flatten_monogram():
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, 4, 4)
    c = cairo.Context(surf)
    ch = (CFG['name'].strip() or 'B')[0].upper()
    size = 760
    w = BLACK.width(ch, size)
    BLACK.text_path(c, ch, CX - w / 2, CY + BLACK.cap_px(size) / 2, size)
    c.set_tolerance(0.3)
    path = c.copy_path_flat()
    polys, cur = [], []
    for kind, pts in path:
        if kind == cairo.PATH_MOVE_TO:
            if len(cur) > 1:
                polys.append(cur)
            cur = [pts]
        elif kind == cairo.PATH_LINE_TO:
            cur.append(pts)
        elif kind == cairo.PATH_CLOSE_PATH:
            if cur:
                cur.append(cur[0])
                polys.append(cur)
            cur = []
    if len(cur) > 1:
        polys.append(cur)
    out = []
    for p in polys:
        a = np.array(p, float)
        seg = np.sqrt(((a[1:] - a[:-1]) ** 2).sum(1))
        cum = np.concatenate([[0], np.cumsum(seg)])
        out.append((a, cum))
    return ch, size, out


MONO_CH, MONO_SIZE, MONO_POLYS = _flatten_monogram()


def trim(ctx, a, cum, s0, s1, offset=0.0):
    """stroke path polyline between fractions s0..s1 (with wrap offset)."""
    L = cum[-1]
    if L <= 0 or s1 <= s0:
        return
    s0, s1 = clamp(s0), clamp(s1)
    if s1 <= s0:
        return
    d0, d1 = s0 * L, s1 * L
    i0 = int(np.searchsorted(cum, d0))
    i1 = int(np.searchsorted(cum, d1))
    def pt(d):
        i = int(np.clip(np.searchsorted(cum, d) - 1, 0, len(cum) - 2))
        f = (d - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
        return a[i] + (a[i + 1] - a[i]) * f
    p = pt(d0)
    ctx.move_to(p[0], p[1])
    for i in range(i0, min(i1, len(a))):
        ctx.line_to(a[i][0], a[i][1])
    p = pt(d1)
    ctx.line_to(p[0], p[1])


def circle_poly(r, n=200, start=-math.pi / 2):
    th = np.linspace(start, start + TAU, n)
    a = np.stack([CX + np.cos(th) * r, CY + np.sin(th) * r], 1)
    seg = np.sqrt(((a[1:] - a[:-1]) ** 2).sum(1))
    return a, np.concatenate([[0], np.cumsum(seg)])


RING = circle_poly(430)
RING2 = circle_poly(470, start=math.pi / 2)


def draw_trace(ctx, t, bg=True):
    if bg:
        fill_bg(ctx, INK)
    lt = t - 14.0
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    # ring + ticks
    p = ease_io(remap(lt, 0.0, 0.5), 3)
    trim(ctx, *RING, 0, p)
    rgb(ctx, PAPER)
    ctx.set_line_width(6)
    ctx.stroke()
    q = ease_io(remap(lt, 0.08, 0.55), 3)
    trim(ctx, *RING2, 0, q)
    rgb(ctx, CORAL)
    ctx.set_line_width(14)
    ctx.stroke()
    for k in range(24):
        a = k / 24 * TAU
        u = back_out(remap(lt, 0.25 + k * 0.01, 0.4 + k * 0.01))
        r1, r2 = 380, 380 - 26 * u
        ctx.move_to(CX + math.cos(a) * r1, CY + math.sin(a) * r1)
        ctx.line_to(CX + math.cos(a) * r2, CY + math.sin(a) * r2)
    rgb(ctx, PAPER, 0.8)
    ctx.set_line_width(4)
    ctx.stroke()
    # tri-colour trim strokes chasing around the glyph outline
    fillp = remap(lt, 0.5, 0.62)
    for k, col in enumerate([MINT, YELLOW, CORAL]):
        head = ease_io(remap(lt, 0.02 + k * 0.07, 0.52 + k * 0.07), 2) * 1.35
        tail = head - 0.4
        for a, cum in MONO_POLYS:
            trim(ctx, a, cum, max(tail, 0), min(head, 1))
        rgb(ctx, col)
        ctx.set_line_width(12 - k * 2)
        ctx.stroke()
    final = ease_io(remap(lt, 0.15, 0.6), 2)
    for a, cum in MONO_POLYS:
        trim(ctx, a, cum, 0, final)
    rgb(ctx, PAPER)
    ctx.set_line_width(5)
    ctx.stroke()
    if fillp > 0:
        s = 1 + 0.12 * wobble(lt - 0.5, 3, 8)
        ctx.save()
        ctx.translate(CX, CY)
        ctx.scale(s, s)
        ctx.translate(-CX, -CY)
        w = BLACK.width(MONO_CH, MONO_SIZE)
        # offset shadow then fill
        BLACK.text_path(ctx, MONO_CH, CX - w / 2 + 16, CY + BLACK.cap_px(MONO_SIZE) / 2 + 16, MONO_SIZE)
        rgb(ctx, CORAL, clamp(fillp * 3))
        ctx.fill()
        BLACK.text_path(ctx, MONO_CH, CX - w / 2, CY + BLACK.cap_px(MONO_SIZE) / 2, MONO_SIZE)
        rgb(ctx, PAPER, clamp(fillp * 3))
        ctx.fill()
        ctx.restore()
        # burst sparks
        for k in range(16):
            a = k / 16 * TAU + 0.2
            u = remap(lt, 0.5, 0.85)
            if 0 < u < 1:
                r1 = 480 + 260 * expo_out(u)
                r2 = 480 + 260 * expo_out(max(u - 0.25, 0) / 0.75 * 1.0) if u > 0.25 else 480
                ctx.move_to(CX + math.cos(a) * r2, CY + math.sin(a) * r2)
                ctx.line_to(CX + math.cos(a) * r1, CY + math.sin(a) * r1)
        rgb(ctx, YELLOW)
        ctx.set_line_width(8)
        ctx.stroke()
    a = smooth(remap(lt, 0.6, 0.75))
    rgb(ctx, PAPER, a)
    MONO.text_path(ctx, 'LOGO ANIMATION  /  TRIM PATHS', CX, 1560, 26, anchor='c')
    ctx.fill()


# ----------------------------------------------------------------------------
# 15.0 – 16.0 glitch slices into hyperspace warp
# ----------------------------------------------------------------------------
_LAYER = None


def draw_slice(ctx, t):
    global _LAYER
    lt = t - 15.0
    # render the logo frame into an offscreen layer, then slice it
    if _LAYER is None:
        _LAYER = Layer()
    lc = _LAYER.ctx
    lc.save()
    lc.set_operator(cairo.OPERATOR_SOURCE)
    rgb(lc, INK)
    lc.paint()
    lc.restore()
    draw_trace(lc, 14.98 + lt * 0.2, bg=False)
    _LAYER.surf.flush()
    fill_bg(ctx, INK)
    n = 16
    hb = H / n
    fr = int(lt * 60 / 2)
    out = ease_in(remap(lt, 0.12, 0.3), 2)
    for k in range(n):
        h1 = hash11(k * 7.3 + fr * 1.1) - 0.5
        jit = h1 * 260 * (1 - out) * (0.4 + 0.6 * (fr % 2))
        side = -1 if k % 2 else 1
        dx = jit + side * out * 1400
        ctx.save()
        ctx.rectangle(0, k * hb, W, hb + 0.5)
        ctx.clip()
        ctx.translate(dx, 0)
        ctx.set_source_surface(_LAYER.surf, 0, 0)
        ctx.paint()
        if hash11(k * 3 + fr) > 0.75 and out < 0.5:
            ctx.set_operator(cairo.OPERATOR_DIFFERENCE)
            rgb(ctx, WHITE)
            ctx.paint()
        ctx.restore()
    if lt > 0.12:
        draw_warp(ctx, t, alpha=smooth(remap(lt, 0.12, 0.3)))


def draw_warp(ctx, t, alpha=1.0):
    lt = t - 15.12
    sp = 1 + 6 * ease_in(remap(t, 15.2, 15.98), 2)
    if alpha < 1:
        ctx.push_group()
    fill_bg(ctx, INK)
    # rings rushing out
    for k in range(10):
        ph = ((lt * 1.6 * sp + k / 10) % 1.0)
        r = 30 + 1500 * ph ** 2.2
        circle(ctx, CX, CY, r)
        rgb(ctx, PAL[k % 6 + 1] if k % 6 + 1 != 2 else PAPER, 0.85 * (1 - ph ** 3))
        ctx.set_line_width(4 + 40 * ph ** 2)
        ctx.stroke()
    # star streaks
    for j in range(200):
        ang = hash11(j * 1.7) * TAU
        ph = (hash11(j * 3.1) + lt * (0.6 + hash11(j) * 0.9) * sp * 0.5) % 1.0
        r1 = 40 + 1400 * ph ** 2
        ln = (40 + 500 * ph ** 2) * min(sp / 3, 2.2)
        r0 = max(r1 - ln, 10)
        ctx.move_to(CX + math.cos(ang) * r0, CY + math.sin(ang) * r0)
        ctx.line_to(CX + math.cos(ang) * r1, CY + math.sin(ang) * r1)
        col = [PAPER, YELLOW, MINT, PINK][j % 4]
        rgb(ctx, col, clamp(ph * 3))
        ctx.set_line_width(2 + 6 * ph)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    # core glow growing into the white flash
    g = smooth(remap(t, 15.5, 16.0))
    rg = cairo.RadialGradient(CX, CY, 0, CX, CY, 120 + 1500 * g ** 3)
    rg.add_color_stop_rgba(0, 1, 1, 1, 0.9)
    rg.add_color_stop_rgba(0.3, PAPER[0], PAPER[1], PAPER[2], 0.5 * g + 0.2)
    rg.add_color_stop_rgba(1, PAPER[0], PAPER[1], PAPER[2], 0)
    ctx.set_source(rg)
    ctx.paint()
    rgb(ctx, PAPER, ease_in(remap(t, 15.86, 16.0), 2))
    ctx.paint()
    if alpha < 1:
        ctx.pop_group_to_source()
        ctx.paint_with_alpha(alpha)


# ----------------------------------------------------------------------------
# dispatcher with in-between transitions
# ----------------------------------------------------------------------------

def whip(ctx, t, t0, dur, draw_a, draw_b, axis='y', dirn=1):
    """whip pan: A flies out, B flies in (motion blur does the rest)."""
    u = expo_io(remap(t, t0, t0 + dur))
    L = (H if axis == 'y' else W) + 40
    for fn, off in ((draw_a, -u * L * dirn), (draw_b, (1 - u) * L * dirn)):
        if abs(off) >= L:
            continue
        ctx.save()
        if axis == 'y':
            ctx.translate(0, off)
            ctx.rectangle(0, 0, W, H)
        else:
            ctx.translate(off, 0)
            ctx.rectangle(0, 0, W, H)
        ctx.clip()
        fn(ctx, t)
        ctx.restore()


def draw_drop(ctx, t):
    if t < 11.0:
        draw_burst(ctx, t)
        if t >= 10.86:
            draw_cover_cells(ctx, t, 10.86, 0.16, INK)
    elif t < 11.5:
        draw_grid(ctx, t)
    elif t < 11.95:
        draw_flip(ctx, t)
    elif t < 12.1:
        whip(ctx, t, 11.95, 0.15, draw_flip, draw_iso, 'y', 1)
    elif t < 12.95:
        draw_iso(ctx, t)
    elif t < 13.07:
        whip(ctx, t, 12.95, 0.12, draw_iso, draw_terrain, 'x', 1)
    elif t < 13.5:
        draw_terrain(ctx, t)
    elif t < 14.0:
        draw_eq(ctx, t)
    elif t < 15.0:
        draw_trace(ctx, t)
    elif t < 15.3:
        draw_slice(ctx, t)
    else:
        draw_warp(ctx, t)
