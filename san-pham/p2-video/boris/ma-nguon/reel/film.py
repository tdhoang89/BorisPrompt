"""Master timeline: picks the scene(s) for time t and stitches the transitions."""
import math

from engine import *
from timeline import *
import scenes
from scenes import INTRO, MORPH, draw_hud, shake, impact_amount
from scene_type import TYPE
import scene_depth as depth
import scene_liquid as liquid
import scene_drop as drop
import scene_title as title


def _find_wall():
    lo, hi = depth.TUNNEL_EXIT, depth.TUNNEL_EXIT + 0.6
    for _ in range(40):
        m = (lo + hi) / 2
        zw = depth.D_EXIT - depth.travel(m)
        r = depth.FOCAL * 2.6 / max(zw, 1e-3)
        if r >= 1500:
            hi = m
        else:
            lo = m
    return hi


T_WALL = _find_wall()


def tunnel_portal(ctx, t, u):
    ctx.save()
    k = lerp(0.55, 1.0, ease_out(u, 2))
    ctx.translate(CX, CY)
    ctx.scale(k, k)
    ctx.translate(-CX, -CY)
    depth.draw_tunnel(ctx, t)
    ctx.restore()


def extra_chroma(t):
    a = 0.0
    if 15.0 <= t < 15.3:
        a = 0.6
    u = remap(t, *TYPE_ZOOM)
    if 0 < u < 1:
        a = max(a, 0.5 * u ** 3)
    return a


def drift(ctx, t):
    """slow camera push-ins so no shot ever sits dead still."""
    z, r = 1.0, 0.0
    if S2 <= t < S3:
        u = (t - S2) / 2
        z, r = 1 + 0.06 * ease_io(u, 2), 0.02 * math.sin(u * math.pi)
    if z != 1.0 or r:
        ctx.translate(CX, CY)
        ctx.rotate(r)
        ctx.scale(z, z)
        ctx.translate(-CX, -CY)


def draw(ctx, t):
    t = t % DUR
    ctx.save()
    shake(ctx, t, impact_amount(t))
    drift(ctx, t)
    if t < S2:
        INTRO.draw(ctx, t)
    elif t < S3:
        MORPH.draw(ctx, t)
    elif t < 4.62:
        MORPH.draw(ctx, t)
        TYPE.draw(ctx, t)
    elif t < TYPE_ZOOM[0]:
        TYPE.draw(ctx, t)
    elif t < S4:
        TYPE.draw(ctx, t, portal=tunnel_portal)
    elif t < T_WALL:
        depth.draw_tunnel(ctx, t)
    elif t < S6:
        liquid.draw_liquid(ctx, t)
    elif t < S7:
        drop.draw_drop(ctx, t)
    else:
        title.draw_title(ctx, t)
    ctx.restore()
    draw_hud(ctx, t)
