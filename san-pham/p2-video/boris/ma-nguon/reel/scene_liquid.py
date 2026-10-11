"""S5 — liquid: glossy metaballs orbit, merge and implode (the build-up)."""
import math
import cairo
import cv2
import numpy as np

from engine import *
from timeline import *
import scene_depth as depth

GX = np.arange(W // 2, dtype=np.float32) * 2 + 1
GY = np.arange(H // 2, dtype=np.float32)[:, None] * 2 + 1


def blobs(t):
    tb = t - 8.0
    tp = max(tb, 0.0)
    out = []
    swell = 1 + 0.16 * smooth(remap(t, 9.55, IMPLODE[0]))
    g = 1 - expo_in(remap(t, *IMPLODE)) if t >= IMPLODE[0] else 1.0
    beat = pulse((t - 8.0) % BEAT, 0.005, 0.1) if t >= 8.0 else 0.0
    r0 = (125 + 70 * smooth(remap(t, 8.0, 9.6)) + 14 * beat) * swell
    out.append((CX, CY, r0 * g))
    inward = ease_in(remap(t, 8.05, 9.62), 1.7)
    rho = 400 - 345 * inward
    for k in range(7):
        a = k * TAU / 7 + 1.1 * tb + 1.7 * tp * tp
        wob = 1 + 0.08 * math.sin(t * 5 + k * 1.9)
        x = CX + math.cos(a) * rho * wob
        y = CY + math.sin(a) * rho * 1.3 * wob
        r = (82 - 22 * inward) * (1 + 0.1 * math.sin(t * 7 + k))
        out.append((CX + (x - CX) * g, CY + (y - CY) * g, r * g * swell))
    for k in range(5):
        a = -k * TAU / 5 - 2.2 * tb - 1.2 * tp * tp
        rr = 560 - 470 * ease_in(remap(t, 8.4, 9.7), 2)
        x = CX + math.cos(a) * rr * 0.85
        y = CY + math.sin(a) * rr * 1.25
        out.append((CX + (x - CX) * g, CY + (y - CY) * g, 30 * g))
    return out


def metaball_image(bl, scale_r=1.0, base=CORAL, rim=PINK, shadow=True):
    F = np.zeros((H // 2, W // 2), np.float32)
    for (x, y, r) in bl:
        r = r * scale_r
        if r < 0.5:
            continue
        d2 = (GX - x) ** 2 + (GY - y) ** 2
        F += (r * r) / (d2 + 4.0)
    s = np.clip(1 - 1 / np.maximum(F, 1e-4), 0, 1)
    h = np.sqrt(s) * 60.0
    hy, hx = np.gradient(h)
    nx, ny, nz = -hx, -hy, np.full_like(h, 2.0)
    inv = 1 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx *= inv; ny *= inv; nz *= inv
    L = np.array([-0.45, -0.65, 0.62], np.float32); L /= np.linalg.norm(L)
    Hh = L + np.array([0, 0, 1], np.float32); Hh /= np.linalg.norm(Hh)
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1) ** 60
    fres = (1 - nz) ** 2.5
    b = np.array(base[::-1], np.float32)        # BGR
    rc = np.array(rim[::-1], np.float32)
    dark = b * 0.55
    col = dark[None, None, :] + (b - dark)[None, None, :] * diff[..., None]
    col = col * (1 - fres[..., None] * 0.6) + rc[None, None, :] * fres[..., None] * 0.6
    col += spec[..., None] * 1.1
    # broad soft sheen
    col += (np.clip(diff, 0, 1) ** 8)[..., None] * 0.18
    col = np.clip(col, 0, 1)
    gy, gx = np.gradient(F)
    G = np.sqrt(gx * gx + gy * gy) / 2.0  # per logical pixel
    Ff = cv2.resize(F, (W, H), interpolation=cv2.INTER_LINEAR)
    Gf = cv2.resize(G, (W, H), interpolation=cv2.INTER_LINEAR)
    a = np.clip(0.5 + (Ff - 1) / (Gf * 1.1 + 1e-5), 0, 1)
    colf = cv2.resize(col, (W, H), interpolation=cv2.INTER_LINEAR)
    out = np.empty((H, W, 4), np.float32)
    out[..., :3] = colf * a[..., None]
    out[..., 3] = a
    if shadow:
        ah = np.clip(F - 0.9, 0, 0.2) * 5
        sh = cv2.GaussianBlur(ah, (0, 0), 14)
        M = np.float32([[1, 0, 9], [0, 1, 22]])
        sh = cv2.warpAffine(sh, M, (W // 2, H // 2))
        sh = cv2.resize(sh, (W, H), interpolation=cv2.INTER_LINEAR) * 0.35
        k = sh * (1 - a)
        sc = np.array(shade(BLUE, -0.6)[::-1], np.float32)
        out[..., :3] += sc[None, None, :] * k[..., None]
        out[..., 3] += k
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def paint_rgba(ctx, arr):
    arr = np.ascontiguousarray(arr)
    surf = cairo.ImageSurface.create_for_data(memoryview(arr), cairo.FORMAT_ARGB32, arr.shape[1], arr.shape[0])
    ctx.set_source_surface(surf, 0, 0)
    ctx.paint()
    surf.finish()


def liquid_bg(ctx, t):
    g = cairo.RadialGradient(CX, CY, 100, CX, CY, 1250)
    g.add_color_stop_rgb(0, *shade(BLUE, 0.08))
    g.add_color_stop_rgb(1, *shade(BLUE, -0.35))
    ctx.set_source(g)
    ctx.paint()
    # concentric guide circles
    for k in range(1, 9):
        circle(ctx, CX, CY, k * 140 + ((t * 60) % 140))
    rgb(ctx, PAPER, 0.07)
    ctx.set_line_width(2)
    ctx.stroke()


def draw_countdown(ctx, t):
    for ts, txt in COUNTDOWN:
        d = t - ts
        if 0 <= d < 0.5:
            s = 1.0 + 0.5 * (1 - expo_out(d / 0.25))
            a = 1 - smooth(remap(d, 0.3, 0.5))
            size = 1050
            w = BLACK.width(txt, size)
            ctx.save()
            ctx.translate(CX, CY)
            ctx.scale(s, s)
            BLACK.text_path(ctx, txt, -w / 2, BLACK.cap_px(size) / 2, size)
            ctx.restore()
            rgb(ctx, PAPER, a)
            ctx.set_line_width(7)
            ctx.stroke()


# sphere dot -> blob assignment (computed once)
def _assign():
    sx, sy, s, dep = depth.sphere_points(7.75)
    bl = blobs(8.05)
    bx = np.array([b[0] for b in bl[:8]])
    by = np.array([b[1] for b in bl[:8]])
    d = (sx[:, None] - bx[None]) ** 2 + (sy[:, None] - by[None]) ** 2
    return np.argmin(d, 1)


ASSIGN = _assign()


def draw_sphere_to_blobs(ctx, t):
    sx, sy, s, dep = depth.sphere_points(t)
    e = ease_io(remap(t, 7.7, 8.05), 3)
    shrink = 1 - smooth(remap(t, 7.9, 8.08))
    bl = blobs(t)
    order = np.argsort(-dep)
    ccache = {}
    for i in order:
        if shrink <= 0:
            break
        k = ASSIGN[i]
        tx, ty = bl[k][0], bl[k][1]
        jit = 0.35 * (1 - e)
        x = lerp(sx[i], tx + (sx[i] - CX) * jit * 0.1, e)
        y = lerp(sy[i], ty + (sy[i] - CY) * jit * 0.1, e)
        r = (5 + 9 * s[i] * (1.2 - dep[i])) * shrink
        col = SPH_COLS[depth.SPH_BAND[i]]
        col = mixc(col, CORAL, e)
        col = mixc(col, shade(BLUE, -0.2), dep[i] * 0.55 * (1 - e))
        key = (round(col[0], 2), round(col[1], 2), round(col[2], 2))
        circle(ctx, x, y, r)
        rgb(ctx, col)
        ctx.fill()


SPH_COLS = depth.SPH_COL


def draw_liquid(ctx, t):
    liquid_bg(ctx, t)
    draw_countdown(ctx, t)
    m = smooth(remap(t, 7.86, 8.1))
    if m > 0.01 and t < IMPLODE[1]:
        bl = blobs(t)
        paint_rgba(ctx, metaball_image(bl, scale_r=m))
    if t < 8.1:
        draw_sphere_to_blobs(ctx, t)
    # suction speed lines before the drop
    a = smooth(remap(t, 9.3, 9.75)) * (1 - smooth(remap(t, 9.95, 10.0)))
    if a > 0:
        for j in range(48):
            ang = j / 48 * TAU + hash11(j) * 0.1
            ph = ((t * 2.6 + hash11(j * 3.3)) % 1.0)
            r1 = 1300 * (1 - ph) + 60
            r2 = r1 + 140 + 200 * hash11(j + 5)
            ctx.move_to(CX + math.cos(ang) * r1, CY + math.sin(ang) * r1)
            ctx.line_to(CX + math.cos(ang) * r2, CY + math.sin(ang) * r2)
        rgb(ctx, PAPER, 0.75 * a)
        ctx.set_line_width(5)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    # singularity spark
    if IMPLODE[1] - 0.06 <= t < 10.0:
        u = remap(t, IMPLODE[1] - 0.06, 10.0)
        circle(ctx, CX, CY, 6 + 22 * (1 - u))
        rgb(ctx, PAPER)
        ctx.fill()
