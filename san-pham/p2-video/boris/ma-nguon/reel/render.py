"""Render the reel.

  python render.py                 full quality MP4 (music + video) -> ../out/
  python render.py --preview       fast half-res draft, no motion blur
  python render.py --stills 0.4 3.1  PNG frames at given seconds
  python render.py --sheet 0 20 0.25 contact sheet of thumbnails
"""
import argparse
import os
import subprocess
import sys
import time
from multiprocessing import Pool

import cairo
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(os.path.dirname(HERE), 'out')

from engine import W, H, surf_array  # noqa: E402
from timeline import FPS, DUR, CFG  # noqa: E402
import film as scenes  # noqa: E402

_state = {}


def _init(scale, mb, shutter):
    _state['scale'] = scale
    _state['mb'] = mb
    _state['shutter'] = shutter
    w, h = int(W * scale), int(H * scale)
    _state['surf'] = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    _state['grain'] = np.random.default_rng(7).normal(0, 1, (8, h, w)).astype(np.float32)


def raw_frame(t):
    surf = _state['surf']
    ctx = cairo.Context(surf)
    s = _state['scale']
    if s != 1:
        ctx.scale(s, s)
    try:
        scenes.draw(ctx, t)
    except cairo.Error:
        # degenerate transform at an exact keyframe instant: nudge time
        ctx = cairo.Context(surf)
        if s != 1:
            ctx.scale(s, s)
        scenes.draw(ctx, t + 1e-4)
    return surf_array(surf)[:, :, :3].astype(np.float32)


def frame(i):
    t = i / FPS
    mb, sh = _state['mb'], _state['shutter']
    if mb <= 1:
        acc = raw_frame(t)
    else:
        acc = None
        for k in range(mb):
            ts = t + ((k + 0.5) / mb - 0.5) * sh / FPS
            f = raw_frame(ts)
            acc = f if acc is None else acc + f
        acc /= mb
    acc = post(acc, t, i)
    return np.ascontiguousarray(acc).tobytes()


def post(img, t, i):
    amt = scenes.impact_amount(t % DUR) + scenes.extra_chroma(t % DUR)
    if amt > 0.02:
        d = int(round(10 * amt * _state['scale']))
        if d > 0:
            img[:, :, 2] = np.roll(img[:, :, 2], d, axis=1)
            img[:, :, 0] = np.roll(img[:, :, 0], -d, axis=1)
    g = _state['grain'][i % 8]
    img += g[:, :, None] * 2.2
    np.clip(img, 0, 255, out=img)
    return img.astype(np.uint8)


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def render_video(args):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, 'music.wav')
    if not args.no_music:
        import music
        music.render(wav)
    scale = 0.5 if args.preview else 1.0
    mb = 1 if args.preview else args.mb
    w, h = int(W * scale), int(H * scale)
    a, b = args.range
    frames = range(int(round(a * FPS)), int(round(b * FPS)))
    name = args.out or ('preview.mp4' if args.preview else 'showreel_1080x1920.mp4')
    dst = os.path.join(OUT, name)
    cmd = [ffmpeg_exe(), '-y', '-loglevel', 'error',
           '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', str(FPS), '-i', '-']
    if os.path.exists(wav):
        cmd += ['-ss', f'{a}', '-t', f'{b - a}', '-i', wav]
    cmd += ['-c:v', 'libx264', '-preset', 'fast' if args.preview else 'medium',
            '-crf', '20' if args.preview else '17', '-pix_fmt', 'yuv420p',
            '-profile:v', 'high', '-g', str(FPS),
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
    if os.path.exists(wav):
        cmd += ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000']
    cmd += ['-movflags', '+faststart', '-shortest', dst]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    n = len(frames)
    with Pool(args.jobs, initializer=_init, initargs=(scale, mb, args.shutter)) as pool:
        for k, data in enumerate(pool.imap(frame, frames, chunksize=2)):
            proc.stdin.write(data)
            if k % 30 == 0 or k == n - 1:
                el = time.time() - t0
                eta = el / (k + 1) * (n - k - 1)
                print(f'\r  frame {k + 1}/{n}  {el:5.0f}s elapsed  ~{eta:4.0f}s left', end='', flush=True)
    proc.stdin.close()
    proc.wait()
    print(f'\nDone -> {dst}')
    if not args.preview and list(args.range) == [0, DUR]:
        from PIL import Image
        _init(1.0, 1, 0.5)
        Image.fromarray(frame_at(17.6)[:, :, ::-1]).save(os.path.join(OUT, 'cover.png'))
    return dst


def render_stills(times, scale=1.0, mb=1, tag='still'):
    from PIL import Image
    _init(scale, mb, 0.5)
    os.makedirs(os.path.join(OUT, 'stills'), exist_ok=True)
    paths = []
    for t in times:
        data = frame_at(t)
        img = Image.fromarray(data[:, :, ::-1])
        p = os.path.join(OUT, 'stills', f'{tag}_{t:06.3f}.png')
        img.save(p)
        paths.append(p)
    return paths


def frame_at(t):
    i = int(round(t * FPS))
    buf = frame_float(t, i)
    return buf


def frame_float(t, i):
    mb, sh = _state['mb'], _state['shutter']
    if mb <= 1:
        acc = raw_frame(t)
    else:
        acc = sum(raw_frame(t + ((k + 0.5) / mb - 0.5) * sh / FPS) for k in range(mb)) / mb
    return post(acc, t, i)


def contact_sheet(a, b, step, cols=8, scale=0.2):
    from PIL import Image
    _init(scale, 1, 0.5)
    times = list(np.arange(a, b - 1e-9, step))
    w, h = int(W * scale), int(H * scale)
    rows = (len(times) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w + 6) + 6, rows * (h + 6) + 6), (40, 40, 40))
    for k, t in enumerate(times):
        img = Image.fromarray(frame_float(t, int(t * FPS))[:, :, ::-1])
        sheet.paste(img, (6 + (k % cols) * (w + 6), 6 + (k // cols) * (h + 6)))
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f'sheet_{a:05.2f}-{b:05.2f}.png')
    sheet.save(p)
    return p


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--stills', nargs='*', type=float)
    ap.add_argument('--sheet', nargs=3, type=float)
    ap.add_argument('--range', nargs=2, type=float, default=[0, DUR])
    ap.add_argument('--mb', type=int, default=6, help='motion blur sub-frames')
    ap.add_argument('--shutter', type=float, default=0.6, help='shutter as fraction of frame')
    ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument('--no-music', action='store_true')
    ap.add_argument('--out')
    ap.add_argument('--still-mb', type=int, default=1)
    ap.add_argument('--cover', action='store_true', help='export out/cover.png')
    args = ap.parse_args()
    if args.cover:
        from PIL import Image
        _init(1.0, 1, 0.5)
        Image.fromarray(frame_at(17.6)[:, :, ::-1]).save(os.path.join(OUT, 'cover.png'))
        print(os.path.join(OUT, 'cover.png'))
    elif args.stills is not None:
        for p in render_stills(args.stills, mb=args.still_mb):
            print(p)
    elif args.sheet:
        print(contact_sheet(*args.sheet))
    else:
        render_video(args)
