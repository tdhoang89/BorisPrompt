"""S4 — depth: ring tunnel fly-through, exit into a rotating dot sphere."""
import math
import cairo
import numpy as np

from engine import *
from timeline import *

RING_COLS = [CORAL, YELLOW, BLUE, MINT, LILAC, PINK, PAPER]
SPACING = 0.55
FOCAL = 540.0
T_START = TYPE_ZOOM[0] - 0.1


def travel(t):
    """distance travelled down the tunnel (world units)."""
    u = max(t - T_START, 0.0)
    extra = max(t - 6.6, 0.0)
    return 4.6 * u + 3.6 * extra * extra + 0.5 * math.sin(u * 2.0)


D_EXIT = travel(TUNNEL_EXIT + 0.32) + 0.25   # wall at end of tunnel


def vanishing(t):
    return (CX + 70 * math.sin(t * 1.7) * (1 - smooth(remap(t, 7.0, 7.4))),
            CY + 110 * math.cos(t * 1.25) * (1 - smooth(remap(t, 7.0, 7.4))))


def kick_pulse(t):
    return pulse((t + 1e-6) % BEAT, 0.005, 0.12)


def draw_tunnel(ctx, t, intro=1.0):
    fill_bg(ctx, INK)
    D = travel(t)
    vx, vy = vanishing(t)
    roll = 0.35 * math.sin(t * 0.9) + 0.8 * (t - 6.0)
    ctx.save()
    ctx.translate(CX, CY)
    ctx.rotate(roll * 0.25)
    ctx.translate(-CX, -CY)
    zfar = 16.0
    # end wall (light at the end of the tunnel)
    zw = D_EXIT - D
    if zw < zfar:
        fog = clamp(1 - zw / zfar) ** 1.3
        r = FOCAL * 2.6 / max(zw, 0.02)
        circle(ctx, vx, vy, min(r, 4000))
        rgb(ctx, mixc(INK, BLUE, fog))
        ctx.fill()
    first = int(math.floor(D / SPACING)) + 1
    last = int(math.floor((D + zfar) / SPACING))
    kp = kick_pulse(t)
    for rid in range(last, first - 1, -1):
        wz = rid * SPACING
        if wz >= D_EXIT - 0.1:
            continue
        z = wz - D
        if z <= 0.06:
            continue
        r = FOCAL * (1.0 + 0.06 * kp) / z
        if r > 2600:
            continue
        fog = clamp(1 - z / zfar) ** 1.4
        near = smooth(remap(z, 0.12, 0.55))
        col = RING_COLS[rid % len(RING_COLS)]
        col = mixc(INK, col, fog * near)
        lw = 70 / z
        kind = rid % 4
        rot = rid * 0.31 + t * 0.7
        # rings bend toward the moving vanishing point (curved tunnel)
        k = clamp(z / zfar)
        x = lerp(CX, vx, k ** 0.6)
        y = lerp(CY, vy, k ** 0.6)
        if kind == 0:
            circle(ctx, x, y, r)
        elif kind == 1:
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(rot)
            rrect(ctx, -r, -r, 2 * r, 2 * r, r * 0.25)
            ctx.restore()
        elif kind == 2:
            poly(ctx, ngon_pts(x, y, r * 1.12, 6, rot))
        else:
            poly(ctx, ngon_pts(x, y, r * 1.25, 3, rot))
        rgb(ctx, col)
        ctx.set_line_width(lw)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
        # dotted inner ring for detail on every other ring
        if rid % 2 == 0 and r < 1600:
            n = 24
            for j in range(n):
                a = j / n * TAU + rot
                circle(ctx, x + math.cos(a) * r * 0.82, y + math.sin(a) * r * 0.82, 7 / z)
            rgb(ctx, col)
            ctx.fill()
    # speed streaks
    for j in range(140):
        h1, h2, h3 = hash11(j * 1.37), hash11(j * 2.91 + 4), hash11(j * 5.17 + 9)
        ang = h1 * TAU
        rad = 0.25 + 0.65 * h2
        span = 14.0
        wz = (h3 * span - (D * 1.4) % span) % span + 0.15
        z1 = wz
        z2 = wz + 0.35 + 0.25 * clamp(t - 6.5)
        if z1 < 0.1:
            continue
        x1 = vx + math.cos(ang) * rad * FOCAL / z1
        y1 = vy + math.sin(ang) * rad * FOCAL / z1
        x2 = vx + math.cos(ang) * rad * FOCAL / z2
        y2 = vy + math.sin(ang) * rad * FOCAL / z2
        a = clamp(1 - z1 / span) ** 1.5
        ctx.move_to(x1, y1)
        ctx.line_to(x2, y2)
        rgb(ctx, PAPER, a * 0.9)
        ctx.set_line_width(2 + 5 / z1)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    ctx.restore()


# ---------------------------------------------------------------- dot sphere

def fib_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1), phi


SPH, SPH_LAT = fib_sphere(520)
SPH_COL = [PAPER, YELLOW, CORAL, MINT, LILAC]
SPHERE_T0 = 7.38


def sphere_points(t):
    """projected sphere: x, y, r, depth (0 front..1 back), lat band"""
    a = (t - SPHERE_T0) * 1.9 + 0.6
    tilt = 0.45 + 0.15 * math.sin(t * 1.3)
    p = SPH.copy()
    # ripple along latitude
    rip = 1 + 0.09 * np.sin(SPH_LAT * 7 - t * 9) * smooth(remap(t, 7.45, 7.6))
    p = p * rip[:, None]
    ca, sa = math.cos(a), math.sin(a)
    x = p[:, 0] * ca + p[:, 2] * sa
    z = -p[:, 0] * sa + p[:, 2] * ca
    y = p[:, 1]
    ct, st = math.cos(tilt), math.sin(tilt)
    y2 = y * ct - z * st
    z2 = y * st + z * ct
    grow = back_out(remap(t, SPHERE_T0 - 0.05, SPHERE_T0 + 0.4), 1.4)
    R = 330 * grow
    cam = 3.2
    s = cam / (cam + z2)
    sx = CX + x * R * s
    sy = CY + y2 * R * s
    depth = (z2 + 1) / 2
    return sx, sy, s, depth


def sphere_colors():
    band = (SPH_LAT / math.pi * 10).astype(int) % len(SPH_COL)
    return band


SPH_BAND = sphere_colors()
