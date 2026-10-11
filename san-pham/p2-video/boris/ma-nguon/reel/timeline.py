"""Single source of truth for timing. Music and picture both read from here,
so every hit, whoosh and cut stays locked to the same grid."""
import json
import os

FPS = 60
DUR = 20.0
BPM = 120
BEAT = 60.0 / BPM          # 0.5 s
BAR = BEAT * 4             # 2.0 s
STEP = BEAT / 4            # 16th note

_here = os.path.dirname(os.path.abspath(__file__))
with open(os.environ.get('REEL_CONFIG') or os.path.join(_here, 'config.json'), encoding='utf-8') as f:
    CFG = json.load(f)

# scene boundaries (seconds)
S1, S2, S3, S4, S5, S6, S7, S8, END = 0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 16.0, 18.0, 20.0

# intro: ball impacts (each spawns a word / the final period)
BOUNCES = [0.0, 0.5, 1.0, 1.5]
BALL_ZOOM = (1.72, 2.0)
# end of reel: cursor clicks the CTA at 19.0, ball launches from it at 19.3
CTA_Y = 1390
LAUNCH = (540 + 210, CTA_Y + 6)
LAUNCH_T = 19.3

# shape morph beats
MORPHS = [2.0, 2.5, 3.0, 3.5, 3.85]

# type: rows slam in at 4.0, invert wave 4.75, accordion 5.0, zoom-through 5.45-6.0
TYPE_ZOOM = (5.45, 6.0)

# depth: tunnel 6.0-7.15, exit disc, dot sphere 7.3-8.1
TUNNEL_EXIT = 7.15

# build: countdown numbers
COUNTDOWN = [(8.5, '3'), (9.0, '2'), (9.5, '1')]
IMPLODE = (9.78, 9.97)

# drop shots: (start, end, key, label)
SHOTS = [
    (10.0, 11.0, 'burst', 'PARTICLES'),
    (11.0, 11.5, 'grid', 'GRID WAVE'),
    (11.5, 12.0, 'flip', 'CARD FLIP'),
    (12.0, 13.0, 'iso', 'ISOMETRIC'),
    (13.0, 13.5, 'terrain', 'LINE TERRAIN'),
    (13.5, 14.0, 'eq', 'AUDIO REACTIVE'),
    (14.0, 15.0, 'trace', 'LOGO TRACE'),
    (15.0, 15.5, 'slice', 'GLITCH SLICE'),
    (15.5, 16.0, 'warp', 'SPEED WARP'),
]

CHAPTERS = [
    (0.0, '01', 'SQUASH & STRETCH'),
    (2.0, '02', 'SHAPE MORPH'),
    (4.0, '03', 'KINETIC TYPE'),
    (6.0, '04', 'DEPTH / 3D'),
    (8.0, '05', 'LIQUID SIM'),
] + [(s[0], '06', s[3]) for s in SHOTS] + [
    (16.0, '07', 'TITLE DESIGN'),
    (18.0, '08', 'LOOP IT'),
]

# moments with big impacts (camera shake + chroma split)
IMPACTS = [(0.0, 0.5), (2.0, 0.35), (4.0, 0.5), (10.0, 1.0), (12.0, 0.45), (14.0, 0.4), (16.0, 1.0)]


def chapter_at(t):
    cur = CHAPTERS[0]
    for c in CHAPTERS:
        if t >= c[0]:
            cur = c
    return cur
