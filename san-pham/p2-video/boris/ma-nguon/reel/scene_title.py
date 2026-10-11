"""S7 — title card (name drop, extrusion, cast of shapes); S8 — CTA + loop back."""
import math
import cairo

from engine import *
from timeline import *

NAME = CFG['name'].upper()
ROLE = CFG.get('role', 'MOTION DESIGNER').upper()
HANDLE = CFG.get('handle', '')
CTA = CFG.get('cta', 'OPEN FOR PROJECTS').upper()
YEAR = str(CFG.get('year', '2026'))

NSIZE = min(330.0, 890.0 / max(BLACK.width(NAME, 1), 1e-3))
NLAY, NW = BLACK.layout(NAME, NSIZE)
NCAP = BLACK.cap_px(NSIZE)
NBASE = 990.0
LAND = [S7 + 0.065 * k for k in range(len(NAME))]
SHADOW_COLS = [MINT, BLUE, YELLOW, CORAL]


def group_lift(t):
    return -150 * ease_io(remap(t, 18.0, 18.4), 3)


def letter_state(k, t):
    L = LAND[k]
    if t < L - 0.17:
        return None
    if t < L:
        u = remap(t, L - 0.17, L)
        return -1400 * (1 - u) ** 2, 1.0 + 0.25 * (1 - u), 1.0
    q = 0.32 * wobble(t - L, 2.8, 7.5)
    sy = 1 - q
    return 0.0, sy, 1 + q * 0.6


def name_path(ctx, t, dx=0.0, dy=0.0):
    x0 = CX - NW / 2
    for k, (ch, gx) in enumerate(NLAY):
        st = letter_state(k, t)
        if st is None:
            continue
        off, sy, sx = st
        adv = BLACK.glyph(ch)[1] * NSIZE / BLACK.upm
        lx = x0 + gx + adv / 2
        ctx.save()
        ctx.translate(lx + dx, NBASE + off + dy)
        ctx.scale(sx, sy)
        ctx.translate(-lx, -NBASE)
        BLACK.glyph_path(ctx, ch, x0 + gx, NBASE, NSIZE)
        ctx.restore()


def draw_cast(ctx, t):
    items = [
        ('ball', YELLOW, -330, -470, 62),
        ('square', BLUE, 340, -430, 70),
        ('ring', LILAC, 300, 640, 50),
        ('star', MINT, 400, 470, 74),
        ('tri', CORAL, -400, 470, 70),
        ('blob', PINK, -280, 650, 54),
    ]
    for k, (kind, col, ox, oy, r) in enumerate(items):
        ts = 16.45 + 0.0625 * k
        if t < ts:
            continue
        s = back_out(remap(t, ts, ts + 0.3), 2.6)
        if s <= 0.002:
            continue
        bob = math.sin(t * 2.4 + k * 1.3) * 16
        rot = (t - ts) * (0.8 if k % 2 else -0.8)
        # leave at the end: fall with gravity
        fall = 0.0
        if t > 18.9:
            d = t - 18.9 - 0.03 * k
            fall = 3000 * max(d, 0) ** 2
        x = CX + ox
        y = CY + oy + bob + group_lift(t) * 0.6 + fall
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        ctx.scale(s, s)
        if kind == 'ball':
            circle(ctx, 0, 0, r)
            rgb(ctx, col); ctx.fill()
            circle(ctx, -r * 0.3, -r * 0.3, r * 0.22)
            rgb(ctx, PAPER, 0.8); ctx.fill()
        elif kind == 'square':
            rrect(ctx, -r, -r, 2 * r, 2 * r, r * 0.22)
            rgb(ctx, col); ctx.fill()
        elif kind == 'ring':
            circle(ctx, 0, 0, r)
            rgb(ctx, col); ctx.set_line_width(22); ctx.stroke()
        elif kind == 'star':
            poly(ctx, star_pts(0, 0, r, r * 0.45, 5))
            rgb(ctx, col); ctx.fill()
        elif kind == 'tri':
            poly(ctx, ngon_pts(0, 0, r, 3))
            rgb(ctx, col); ctx.set_line_width(18); ctx.set_line_join(cairo.LINE_JOIN_ROUND); ctx.stroke()
        else:
            pts = []
            for j in range(10):
                a = j / 10 * TAU
                rr = r * (1 + 0.18 * math.sin(a * 3 + t * 4))
                pts.append((math.cos(a) * rr, math.sin(a) * rr))
            smooth_closed(ctx, pts)
            rgb(ctx, col); ctx.fill()
        ctx.restore()


def draw_title(ctx, t):
    fill_bg(ctx, PAPER)
    lt = t - S7
    # slow push-in on the title (the outro/wipe layer stays in screen space)
    ctx.save()
    z = 1 + 0.05 * ease_out(lt / 3.5, 2)
    ctx.translate(CX, CY)
    ctx.rotate(-0.012 * ease_out(lt / 3.5, 2))
    ctx.scale(z, z)
    ctx.translate(-CX, -CY)
    # faint dot grid
    rgb(ctx, INK, 0.08)
    for j in range(17):
        for i in range(10):
            circle(ctx, 60 + i * 107, 60 + j * 114 + (t * 30) % 114, 3)
    ctx.fill()
    # shockwave from the flash
    u = remap(lt, 0, 0.5)
    if 0 < u < 1:
        circle(ctx, CX, CY, 60 + 1400 * expo_out(u))
        rgb(ctx, INK, 1 - u)
        ctx.set_line_width(30 * (1 - u) + 1)
        ctx.stroke()
    lift = group_lift(t)
    ctx.save()
    ctx.translate(0, lift)
    # extrusion: stacked colour copies
    e = spring(t - 16.32, 1.5, 7.0) if t >= 16.32 else 0.0
    for k in range(4, 0, -1):
        d = 9 * k * e
        name_path(ctx, t, d, d)
        rgb(ctx, SHADOW_COLS[k - 1])
        ctx.fill()
    name_path(ctx, t)
    rgb(ctx, INK)
    ctx.fill()
    # role line with tracking animation
    a = smooth(remap(t, 16.32, 16.6))
    tr = lerp(0.9, 0.16, expo_out(remap(t, 16.32, 16.9)))
    sz = 58
    BLACK.text_path(ctx, ROLE, CX, NBASE + 130, sz, tracking=tr, anchor='c')
    rgb(ctx, INK, a)
    ctx.fill()
    # squiggle underline
    p = ease_io(remap(t, 16.4, 16.85), 3)
    if p > 0:
        n = 80
        x0, x1 = CX - 300, CX + 300
        pts = [(lerp(x0, x1, i / n), NBASE + 46 + 12 * math.sin(i / n * TAU * 4 - t * 6)) for i in range(int(n * p) + 1)]
        poly(ctx, pts, close=False)
        rgb(ctx, CORAL)
        ctx.set_line_width(10)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    # chip
    cs = back_out(remap(t, 17.0, 17.3), 2.2)
    if cs > 0:
        txt = f'SHOWREEL {YEAR}'
        tw = MONO.width(txt, 32)
        ctx.save()
        ctx.translate(CX, NBASE - NCAP - 120)
        ctx.scale(cs, cs)
        rrect(ctx, -tw / 2 - 30, -34, tw + 60, 64, 32)
        rgb(ctx, INK)
        ctx.fill()
        circle(ctx, -tw / 2 - 2, -2, 8)
        rgb(ctx, CORAL if int(t * 4) % 2 == 0 else PAPER)
        ctx.fill()
        MONO.text_path(ctx, txt, 12, 10, 32, anchor='c')
        rgb(ctx, PAPER)
        ctx.fill()
        ctx.restore()
    ctx.restore()
    draw_cast(ctx, t)
    ctx.restore()
    draw_outro(ctx, t)


def cursor(ctx, x, y, s=1.0):
    pts = [(0, 0), (0, 46), (12, 35), (21, 56), (30, 52), (21, 32), (37, 31)]
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s * 1.6, s * 1.6)
    poly(ctx, pts)
    rgb(ctx, INK)
    ctx.fill_preserve()
    rgb(ctx, PAPER)
    ctx.set_line_width(2.5)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    ctx.restore()


CLICK_T = 19.0


def draw_outro(ctx, t):
    if t < 18.0:
        return
    import scenes
    # handle typing
    ht = t - 18.15
    if ht > 0 and HANDLE:
        n = int(clamp(ht / 0.35) * len(HANDLE) + 0.999)
        txt = HANDLE[:n]
        sz = min(60.0, 700.0 / max(MONO.width(HANDLE, 1) + 0.6, 1e-3))
        w = MONO.width(HANDLE, sz)
        MONO.text_path(ctx, txt, CX - w / 2, 1230, sz)
        rgb(ctx, INK)
        ctx.fill()
        if int(t * 6) % 2 == 0 or ht < 0.4:
            ctx.rectangle(CX - w / 2 + MONO.width(txt, sz) + 6, 1230 - sz * 0.83, sz * 0.43, sz)
            rgb(ctx, CORAL)
            ctx.fill()
    # CTA pill
    ps = back_out(remap(t, 18.45, 18.75), 2.5)
    press = 1 - 0.1 * pulse(t - CLICK_T, 0.03, 0.08)
    if ps > 0:
        sz = 40
        tw = BLACK.width(CTA, sz, 0.06)
        pw, ph = tw + 150, 104
        ctx.save()
        ctx.translate(CX, CTA_Y)
        ctx.scale(ps * press, ps * press)
        rrect(ctx, -pw / 2 + 8, -ph / 2 + 10, pw, ph, ph / 2)
        rgb(ctx, INK)
        ctx.fill()
        rrect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2)
        rgb(ctx, CORAL)
        ctx.fill()
        BLACK.text_path(ctx, CTA, -pw / 2 + 50, BLACK.cap_px(sz) / 2, sz, tracking=0.06)
        rgb(ctx, PAPER)
        ctx.fill()
        # arrow
        ax = pw / 2 - 62 + 8 * math.sin(t * 10)
        ctx.move_to(ax - 18, 0); ctx.line_to(ax + 14, 0)
        ctx.move_to(ax + 2, -13); ctx.line_to(ax + 15, 0); ctx.line_to(ax + 2, 13)
        ctx.set_line_width(7)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
        ctx.restore()
    # cursor flies in and clicks
    if 18.55 <= t < 19.5:
        u = ease_io(remap(t, 18.55, CLICK_T - 0.04), 3)
        x = lerp(W + 80, CX + 210, u) + 40 * math.sin(u * math.pi)
        y = lerp(H + 60, CTA_Y + 6, u) - 120 * math.sin(u * math.pi)
        cursor(ctx, x, y, 1 - 0.15 * pulse(t - CLICK_T, 0.03, 0.1))
        d = t - CLICK_T
        if d > 0:
            for k in range(2):
                v = remap(d, k * 0.06, 0.35 + k * 0.06)
                if 0 < v < 1:
                    circle(ctx, CX + 210, CTA_Y + 6, 20 + 140 * expo_out(v))
                    rgb(ctx, INK, 1 - v)
                    ctx.set_line_width(6 * (1 - v) + 1)
                    ctx.stroke()
    # blue wipe from the click, revealing the loop start (scene 1 at t-20)
    if t >= CLICK_T + 0.02:
        u = remap(t, CLICK_T + 0.02, CLICK_T + 0.45)
        r = 2300 * ease_in(u, 1.8) + 1
        ctx.save()
        circle(ctx, CX + 210, CTA_Y + 6, r)
        ctx.clip()
        scenes.INTRO.draw(ctx, t - DUR)
        ctx.restore()
