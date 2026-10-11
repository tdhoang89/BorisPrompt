"""Original soundtrack + sound design, synthesised from scratch with numpy.

120 BPM, F minor. Every sound effect is placed from timeline.py so it lands on
the exact frame of the matching visual event. The last 2 s of tails are wrapped
onto the start, so the TikTok auto-loop is seamless.
"""
import math
import os

import numpy as np
from scipy import signal
from scipy.io import wavfile

from timeline import *

SR = 48000
TOTAL = DUR + 2.5
N = int(TOTAL * SR)
RNG = np.random.default_rng(2026)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tarr(dur):
    return np.arange(int(dur * SR)) / SR


# ----------------------------------------------------------------------------
# buses
# ----------------------------------------------------------------------------
BUSES = {k: np.zeros((2, N)) for k in ('kick', 'drums', 'bass', 'music', 'lead', 'fx', 'verb', 'delay')}


def add(bus, t0, x, gain=1.0, pan=0.0, verb=0.0, delay=0.0):
    """mono or stereo signal at time t0 (seconds)."""
    i0 = int(round(t0 * SR))
    if x.ndim == 1:
        lg = math.cos((pan + 1) * math.pi / 4) * math.sqrt(2)
        rg = math.sin((pan + 1) * math.pi / 4) * math.sqrt(2)
        x = np.stack([x * lg, x * rg])
    if i0 < 0:
        x = x[:, -i0:]
        i0 = 0
    n = min(x.shape[1], N - i0)
    if n <= 0:
        return
    seg = x[:, :n] * gain
    BUSES[bus][:, i0:i0 + n] += seg
    if verb > 0:
        BUSES['verb'][:, i0:i0 + n] += seg * verb
    if delay > 0:
        BUSES['delay'][:, i0:i0 + n] += seg * delay


# ----------------------------------------------------------------------------
# oscillators / helpers
# ----------------------------------------------------------------------------

def phase_of(freq, n, ph0=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    return (ph0 + np.cumsum(f) / SR) % 1.0, f / SR


def _blep(ph, dt):
    out = np.zeros_like(ph)
    m = ph < dt
    t = ph[m] / dt[m]
    out[m] = t + t - t * t - 1
    m2 = ph > 1 - dt
    t = (ph[m2] - 1) / dt[m2]
    out[m2] = t * t + t + t + 1
    return out


def saw(freq, n, ph0=0.0):
    ph, dt = phase_of(freq, n, ph0)
    return 2 * ph - 1 - _blep(ph, dt)


def square(freq, n, ph0=0.0, pw=0.5):
    ph, dt = phase_of(freq, n, ph0)
    s = np.where(ph < pw, 1.0, -1.0)
    s += _blep(ph, dt)
    s -= _blep((ph - pw) % 1.0, dt)
    return s


def sine(freq, n, ph0=0.0):
    ph, _ = phase_of(freq, n, ph0)
    return np.sin(2 * np.pi * ph)


def noise(n):
    return RNG.standard_normal(n)


def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.1, hold=None):
    """hold = seconds before release (default: until n - r)."""
    t = np.arange(n) / SR
    hold = (n / SR - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip(1 - (t - hold) / max(r, 1e-6), 0, 1)
    return e * np.where(t > hold, rel, 1.0)


def env_exp(n, decay, attack=0.002):
    t = np.arange(n) / SR
    return np.minimum(t / attack, 1.0) * np.exp(-t / decay)


def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def bp(x, f1, f2, order=2):
    sos = signal.butter(order, [f1, min(f2, SR * 0.45)], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def sweep_filter(x, fc, kind='low', q=0.9, block=256):
    """time-varying 2-pole filter (fc array per sample), block-wise."""
    out = np.zeros_like(x)
    zi = np.zeros((1, 2))
    for i in range(0, len(x), block):
        f = float(np.clip(fc[min(i + block // 2, len(fc) - 1)], 30, SR * 0.45))
        if kind == 'band':
            bw = f / (q * 2)
            sos = signal.butter(1, [max(f - bw, 20), min(f + bw, SR * 0.46)], 'band', fs=SR, output='sos')
        else:
            sos = signal.butter(2, f, kind, fs=SR, output='sos')
        y, zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
        out[i:i + block] = y
    return out


def sat(x, k=1.5):
    return np.tanh(x * k) / np.tanh(k)


# ----------------------------------------------------------------------------
# instruments
# ----------------------------------------------------------------------------

def kick(t0, gain=1.0, punch=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 130 * np.exp(-t / 0.032) * punch + 40 * np.exp(-t / 0.006)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x *= np.exp(-t / 0.2) * np.minimum(t / 0.0015, 1)
    x += np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.02) * 0.25
    click = hp(noise(n), 2500) * np.exp(-t / 0.004) * 0.35
    add('kick', t0, sat(x * 1.4 + click, 1.8), gain)


def clap(t0, gain=1.0, verb=0.25):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    nz = bp(noise(n), 900, 3800)
    e = np.zeros(n)
    for k, off in enumerate((0.0, 0.009, 0.019, 0.028)):
        tt = t - off
        e += np.where(tt >= 0, np.exp(-np.maximum(tt, 0) / (0.006 if k < 3 else 0.11)), 0)
    body = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.04) * 0.3
    add('drums', t0, (nz * e * 0.55 + body), gain, 0.0, verb)


def snare(t0, gain=1.0, pitch=1.0, verb=0.2, pan=0.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    nz = hp(noise(n), 1800) * np.exp(-t / 0.06)
    tone = np.sin(2 * np.pi * 185 * pitch * t + 3 * np.exp(-t / 0.01)) * np.exp(-t / 0.05)
    add('drums', t0, nz * 0.5 + tone * 0.5, gain, pan, verb)


def hat(t0, gain=1.0, open_=False, pan=0.0):
    n = int((0.35 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    x = hp(noise(n), 7500, 4)
    # metallic partials
    for f in (4170, 6230, 8710, 10350):
        x += 0.25 * square(f, n)
    x = hp(x, 6000)
    e = np.exp(-t / (0.11 if open_ else 0.018))
    add('drums', t0, x * e * 0.22, gain, pan)


def crash(t0, gain=1.0, dur=2.2, reverse=False, verb=0.3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = hp(noise(n), 4000)
    for f in (3150, 4423, 5811, 7333, 9020):
        x += 0.2 * square(f * (1 + 0.002 * RNG.standard_normal()), n)
    x = hp(x, 3000)
    e = np.exp(-t / (dur * 0.33))
    s = np.stack([x * e, np.roll(x, 97) * e])
    if reverse:
        s = s[:, ::-1] * (1 - np.exp(-t[::-1] / 0.01))
        add('fx', t0 - dur, s, gain * 0.35, 0, verb)
    else:
        add('drums', t0, s, gain * 0.3, 0, verb)


def impact(t0, gain=1.0, verb=0.5):
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = 32 + 90 * np.exp(-t / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    body = lp(noise(n), 900) * np.exp(-t / 0.08) * 1.2
    add('fx', t0, sat(sub * 1.2 + body, 1.3), gain, 0, verb)
    crash(t0, gain * 0.9, 2.4)


def boom(t0, gain=1.0, f0=110, verb=0.45):
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    f = f0 * 0.5 + f0 * np.exp(-t / 0.06)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    x += lp(noise(n), 400) * np.exp(-t / 0.03) * 0.5
    add('fx', t0, sat(x, 1.4), gain, 0, verb)


def thud(t0, gain=1.0, f0=90, pan=0.0):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = f0 * 0.6 + f0 * np.exp(-t / 0.025)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.09)
    x += lp(noise(n), 1500) * np.exp(-t / 0.01) * 0.3
    add('fx', t0, x, gain, pan, 0.15)


def blip(t0, midi, gain=1.0, pan=0.0, decay=0.25, verb=0.25, delay=0.15):
    """marimba-ish pluck."""
    n = int((decay * 4) * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / decay)
    x += 0.35 * np.sin(2 * np.pi * f * 4.01 * t) * np.exp(-t / (decay * 0.15))
    x += 0.15 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / (decay * 0.4))
    x *= np.minimum(t / 0.001, 1)
    add('fx', t0, x * 0.5, gain, pan, verb, delay)


def boing(t0, m0, m1, dur=0.3, gain=1.0, pan=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    f = mtof(m0) * (mtof(m1) / mtof(m0)) ** (u ** 0.6)
    f = f * (1 + 0.04 * np.sin(2 * np.pi * 18 * t) * u)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = sat(x * 1.3 + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR), 1.2)
    x *= np.minimum(t / 0.004, 1) * np.exp(-t / (dur * 0.5))
    add('fx', t0, x * 0.4, gain, pan, 0.2)


def bloop(t0, midi, gain=1.0, pan=0.0):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = mtof(midi) * (1 + 1.8 * (t / 0.16) ** 0.7)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) * np.minimum(t / 0.003, 1)
    add('fx', t0, x * 0.45, gain, pan, 0.3)


def click(t0, gain=1.0, pan=0.0, f=2400):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    x = hp(noise(n), 3000) * np.exp(-t / 0.002) + np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006) * 0.6
    add('fx', t0, x * 0.5, gain, pan, 0.05)


def whoosh(t0, dur, f0=300, f1=4000, gain=1.0, pan0=-0.6, pan1=0.6, peak=0.65):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    fc = f0 * (f1 / f0) ** u
    x = sweep_filter(noise(n), fc, 'band', q=1.2)
    e = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.5)
    x = x * e
    pans = np.linspace(pan0, pan1, n)
    l = x * np.cos((pans + 1) * math.pi / 4)
    r = x * np.sin((pans + 1) * math.pi / 4)
    add('fx', t0, np.stack([l, r]) * 1.4, gain, 0, 0.25)


def riser(t0, dur, gain=1.0, m0=48, m1=72):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    nz = sweep_filter(noise(n), 400 * (9000 / 400) ** u, 'high')
    f = mtof(m0) * (mtof(m1) / mtof(m0)) ** (u ** 1.5)
    tone = sum(saw(f * d, n, RNG.random()) for d in (0.995, 1.0, 1.006)) / 3
    tone = sweep_filter(tone, 300 + 6000 * u ** 2, 'low')
    e = u ** 2.2
    x = (nz * 0.5 + tone * 0.35) * e
    add('fx', t0, np.stack([x, np.roll(x, 211)]), gain, 0, 0.3)


# ----------------------------------------------------------------------------
# tonal parts
# ----------------------------------------------------------------------------
CHORDS = {
    'Fm': [53, 56, 60, 63, 65],
    'Db': [49, 53, 56, 60, 63],
    'Ab': [51, 56, 60, 63, 67],
    'Eb': [51, 55, 58, 62, 65],
    'Dbmaj9': [49, 56, 60, 63, 65, 68],
}
ROOT = {'Fm': 29, 'Db': 37, 'Ab': 32, 'Eb': 39, 'Dbmaj9': 37}
ROOT = {k: v + (12 if v < 34 else 0) for k, v in ROOT.items()}   # bass register ~ F2/Db2


def chord_at(t):
    bar = int(t // BAR)
    beat = (t % BAR) / BEAT
    prog = ['Fm', 'Db', 'Ab', 'Eb', 'Db', 'Fm', 'Db', 'Ab', 'Dbmaj9', 'Eb']
    c = prog[bar % 10]
    if bar == 4 and beat >= 2:
        c = 'Eb'
    if bar == 7 and beat >= 2:
        c = 'Eb'
    return c


def supersaw(midi, dur, voices=7, detune=0.18, cutoff=3000, env=None, spread=0.8):
    n = int(dur * SR)
    f = mtof(midi)
    L = np.zeros(n)
    R = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2)
        fr = f * 2 ** (d * detune / 12)
        x = saw(fr, n, RNG.random())
        p = d * spread
        L += x * math.cos((p + 1) * math.pi / 4)
        R += x * math.sin((p + 1) * math.pi / 4)
    st = np.stack([L, R]) / voices
    st = lp(st, cutoff)
    if env is not None:
        st *= env
    return st


def chord_stab(t0, name, dur, gain=1.0, cutoff=2600, verb=0.2, bus='music', octave=0, voices=5):
    n = int(dur * SR)
    e = env_adsr(n, 0.004, dur * 0.4, 0.5, min(0.06, dur * 0.3))
    acc = np.zeros((2, n))
    for m in CHORDS[name]:
        acc += supersaw(m + octave, dur, voices=voices, cutoff=cutoff, env=e)
    add(bus, t0, acc * 0.22, gain, 0, verb)


def pad(t0, name, dur, gain=1.0, c0=400, c1=5000, verb=0.5):
    n = int(dur * SR)
    e = env_adsr(n, dur * 0.25, 1.0, 1.0, min(0.3, dur * 0.3))
    acc = np.zeros((2, n))
    for m in CHORDS[name]:
        acc += supersaw(m, dur, voices=7, detune=0.25, cutoff=20000, env=1.0)
    u = np.arange(n) / n
    fc = c0 * (c1 / c0) ** u
    acc = np.stack([sweep_filter(acc[0], fc), sweep_filter(acc[1], fc)]) * e
    add('music', t0, acc * 0.16, gain, 0, verb)


def pluck(t0, midi, dur=0.18, gain=1.0, pan=0.0, cutoff=3500, delay=0.3, verb=0.2, bus='lead'):
    n = int(max(dur, 0.05) * SR) + int(0.15 * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    x = 0.6 * saw(f, n) + 0.4 * square(f * 1.003, n, pw=0.35)
    fc = 300 + cutoff * np.exp(-t / 0.07)
    x = sweep_filter(x, fc, 'low')
    e = np.minimum(t / 0.002, 1) * np.exp(-t / (dur * 0.7))
    add(bus, t0, x * e * 0.5, gain, pan, verb, delay)


def lead_note(t0, midi, dur, gain=1.0):
    n = int((dur + 0.12) * SR)
    t = np.arange(n) / SR
    f = mtof(midi) * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.12) / 0.2, 0, 1))
    x = 0.55 * saw(f, n) + 0.45 * square(f * 0.999, n, pw=0.5) + 0.3 * saw(f * 2.002, n)
    fc = 1200 + 3500 * np.exp(-t / 0.12)
    x = sweep_filter(x, fc, 'low')
    e = env_adsr(n, 0.004, 0.15, 0.7, 0.1, hold=dur)
    st = np.stack([x, np.roll(x, 240)]) * e
    add('lead', t0, st * 0.34, gain, 0, 0.25, 0.28)


def bass_pluck(t0, midi, dur=0.2, gain=1.0):
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    x = saw(f, n) * 0.7 + np.sin(2 * np.pi * f / 2 * t) * 0.6
    x = sweep_filter(x, 200 + 1600 * np.exp(-t / 0.05), 'low')
    e = env_adsr(n, 0.003, 0.08, 0.6, 0.04, hold=dur)
    add('bass', t0, sat(x * e, 1.3) * 0.55, gain)


def sub(t0, midi, dur, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * mtof(midi - 12) * t)
    e = env_adsr(n, 0.01, 0.2, 0.9, 0.05)
    add('bass', t0, sat(x * e, 1.2) * 0.6, gain)


def reese(t0, midi, dur, gain=1.0, cutoff=900):
    n = int((dur + 0.03) * SR)
    t = np.arange(n) / SR
    f = mtof(midi)
    x = saw(f * 0.996, n) + saw(f * 1.004, n, 0.3)
    x = sweep_filter(x, cutoff * 0.4 + cutoff * np.exp(-t / 0.09), 'low')
    e = env_adsr(n, 0.003, 0.1, 0.7, 0.03, hold=dur)
    add('bass', t0, sat(x * e * 0.5, 1.6) * 0.45, gain)


# ----------------------------------------------------------------------------
# arrangement
# ----------------------------------------------------------------------------
KICKS = []


def K(t, g=1.0, punch=1.0):
    KICKS.append(t)
    kick(t, g, punch)


def arrange():
    # --- groove A/B 0-8 -----------------------------------------------------
    for b in range(16):
        t = b * BEAT
        K(t, 1.0)
        bar_beat = b % 4
        if bar_beat in (1, 3):
            clap(t, 0.85)
        hat(t + BEAT / 2, 0.8, open_=(b >= 8), pan=0.15)
        if b >= 8:
            for s in (1, 3):
                hat(t + s * STEP, 0.45, pan=-0.2)
        c = chord_at(t)
        bass_pluck(t + BEAT / 2, ROOT[c], 0.18, 1.0)
        if bar_beat == 3:
            bass_pluck(t + 0.375, ROOT[c] + 12, 0.1, 0.7)
    for bar in range(4):
        c = chord_at(bar * BAR)
        for st, ln in ((0, 2), (3, 2), (6, 2), (10, 2), (12, 1), (14, 2)):
            chord_stab(bar * BAR + st * STEP, c, ln * STEP * 0.9, 0.55 if bar < 2 else 0.7, cutoff=1800 + 600 * bar)
    # arp section B
    for s in range(64):
        t = 4.0 + s * STEP
        c = chord_at(t)
        notes = CHORDS[c]
        seq = [0, 2, 4, 3, 1, 3, 2, 4]
        m = notes[seq[s % 8] % len(notes)] + 24
        pluck(t, m, 0.12, 0.55, pan=0.5 * math.sin(s * 0.7), cutoff=2500 + 1500 * (s / 64))

    # intro sound design ------------------------------------------------------
    for i, (bt, m) in enumerate(zip(BOUNCES, [72, 75, 77, 84])):
        blip(bt, m, 1.0 if i < 3 else 1.2, pan=-0.3 + 0.2 * i, decay=0.2)
        thud(bt, 0.5, 120 + 20 * i)
    boing(BALL_ZOOM[0] - 0.12, 60, 55, 0.12, 0.6)
    whoosh(BALL_ZOOM[0] - 0.05, 0.36, 200, 6000, 0.9, 0, 0, 0.9)
    for i, mt in enumerate(MORPHS[:4]):
        boing(mt, [60, 63, 67, 70][i], [72, 75, 79, 82][i], 0.28, 0.75, pan=[-0.4, 0.4, -0.2, 0.2][i])
    whoosh(MORPHS[4] - 0.05, 0.3, 500, 7000, 0.8)
    impact(4.0, 0.45, 0.3)
    whoosh(4.0, 0.45, 3000, 400, 0.9, 0.7, -0.7, 0.2)
    for k in range(11):
        click(4.72 + 0.022 * k, 0.5, pan=-0.7 + 0.14 * k, f=2600 + 180 * k)
    boing(5.0, 48, 67, 0.3, 0.7)
    riser(TYPE_ZOOM[0], TYPE_ZOOM[1] - TYPE_ZOOM[0], 0.9, 55, 79)
    whoosh(5.8, 0.9, 6000, 200, 1.0, 0.3, -0.3, 0.15)
    boom(6.0, 0.7, 80)
    # tunnel wind bed
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    wind = sweep_filter(noise(n), 700 + 500 * np.sin(2 * np.pi * 2 * tt) ** 2 + 1500 * tt / 1.6, 'band', q=0.8)
    wind *= np.minimum(tt / 0.2, 1) * np.minimum((1.6 - tt) / 0.2, 1) * 0.25
    add('fx', 6.0, np.stack([wind, np.roll(wind, 400)]), 1.0)
    whoosh(7.15, 0.4, 400, 8000, 1.0, -0.8, 0.8, 0.8)
    for k in range(5):
        blip(7.43 + k * STEP * 0.5, [84, 87, 89, 91, 96][k], 0.45, pan=-0.5 + 0.25 * k, decay=0.12, delay=0.3)

    # --- build 8-10 ---------------------------------------------------------
    K(8.0, 0.9)
    crash(8.0, 0.5)
    pad(8.0, 'Db', 1.0, 0.9, 300, 2500)
    pad(9.0, 'Eb', 0.95, 1.0, 1200, 9000)
    for k in range(12):
        bt = 8.05 + k * 0.13 + 0.03 * math.sin(k * 3)
        bloop(bt, [60, 63, 65, 67, 70, 72][k % 6] + (12 if k % 4 == 3 else 0), 0.55, pan=math.sin(k * 1.7) * 0.6)
    roll = []
    t = 8.0
    while t < 9.0 - 1e-6:
        roll.append(t); t += BEAT / 2
    while t < 9.5 - 1e-6:
        roll.append(t); t += STEP
    while t < 9.78 - 1e-6:
        roll.append(t); t += STEP / 2
    for i, rt in enumerate(roll):
        u = (rt - 8.0) / 1.78
        snare(rt, 0.25 + 0.65 * u, pitch=1 + 0.8 * u, verb=0.3, pan=0.2 * math.sin(i))
    for ts, _ in COUNTDOWN:
        boom(ts, 0.9, 120)
        bass_pluck(ts, ROOT[chord_at(ts)], 0.3, 0.8)
    riser(8.4, 1.38, 1.0, 43, 79)
    crash(10.0, 1.0, 1.0, reverse=True)
    # --- drop 10-16 ----------------------------------------------------------
    impact(10.0, 1.0)
    for b in range(20, 31):  # 10.0 .. 15.5
        t = b * BEAT
        if 15.0 <= t < 15.5:
            continue
        K(t, 1.05)
        if b % 2 == 1:
            clap(t, 1.0, 0.3)
        for s in range(4):
            hat(t + s * STEP, [0.6, 0.35, 0.8, 0.35][s], open_=(s == 2), pan=[0.2, -0.2, 0.1, -0.1][s])
        c = chord_at(t)
        sub(t, ROOT[c], BEAT * 0.98, 1.0)
        reese(t + STEP * 2, ROOT[c] + 12, STEP * 1.6, 0.8)
        reese(t + STEP * 3, ROOT[c] + 12, STEP * 0.8, 0.5)
    for bar in range(5, 8):
        t0 = bar * BAR
        for st, ln in ((0, 3), (3, 3), (6, 2), (8, 3), (11, 2), (14, 2)):
            ts = t0 + st * STEP
            if 15.0 <= ts < 16.0:
                continue
            chord_stab(ts, chord_at(ts), ln * STEP * 0.92, 1.0, cutoff=5200, verb=0.25, voices=7)
    melody = [
        [(0, 72, 2), (3, 75, 1), (4, 77, 2), (6, 75, 2), (8, 72, 3), (11, 70, 1), (12, 68, 2), (14, 70, 2)],
        [(0, 72, 2), (3, 73, 1), (4, 77, 2), (6, 73, 2), (8, 72, 2), (10, 70, 2), (12, 68, 4)],
        [(0, 75, 2), (2, 72, 2), (4, 75, 2), (6, 79, 2)],
    ]
    for k, bar in enumerate(melody):
        for st, m, ln in bar:
            lead_note((5 + k) * BAR + st * STEP, m, ln * STEP * 0.95, 1.0)
    # shot sound design
    for k in range(60):   # split-flap flutter of the card flip
        i, j = k % 6, k // 6
        click(11.5 + 0.016 * (i + j) + 0.1, 0.35, pan=(i - 2.5) / 3, f=1800 + 90 * j)
    whoosh(11.9, 0.3, 300, 5000, 1.0, 0, 0, 0.5)
    for k in range(8):
        thud(12.05 + k * 0.03, 0.35, 140 + 10 * k, pan=(k - 4) / 5)
    whoosh(12.9, 0.25, 500, 6000, 1.0, -0.9, 0.9, 0.5)
    pluck(13.0, 84, 0.3, 0.6, delay=0.5)
    for k in range(4):
        blip(13.5 + k * STEP, 89 + k * 3, 0.35, pan=-0.4 + 0.25 * k, decay=0.1)
    # logo trace: shimmer up, fill hit
    n = int(0.5 * SR)
    tt = np.arange(n) / SR
    sh = sum(np.sin(2 * np.pi * mtof(m) * tt) for m in (89, 92, 96, 101)) * (tt / 0.5) ** 2 * 0.08
    add('fx', 14.0, np.stack([sh, np.roll(sh, 300)]), 1.0, 0, 0.5)
    boom(14.5, 0.7, 140)
    for k, m in enumerate([84, 89, 91, 96]):
        blip(14.5 + k * STEP * 0.5, m, 0.5, pan=-0.5 + k * 0.33, decay=0.15)
    # glitch stutter 15.0-15.3 : 32nd-note repeats of the downbeat
    for k in range(10):
        ts = 15.0 + k * STEP / 2
        kick(ts, 0.35 + 0.05 * k, punch=0.5)
        click(ts, 0.5, pan=0.6 if k % 2 else -0.6, f=1200 + 300 * k)
    chord_stab(15.0, 'Eb', 0.3, 0.6, cutoff=3000)
    riser(15.25, 0.75, 1.1, 50, 86)
    for k in range(12):
        snare(15.25 + k * STEP / 2 + (k > 5) * 0.0, 0.3 + 0.06 * k, 1 + 0.06 * k)
    crash(16.0, 1.0, 0.8, reverse=True)

    # --- title 16-18 ---------------------------------------------------------
    impact(16.0, 1.1, 0.6)
    K(16.0, 1.1)
    sub(16.0, ROOT['Db'], 1.9, 1.0)
    pad(16.0, 'Dbmaj9', 2.0, 1.0, 2500, 6000, 0.6)
    import scene_title as stl
    for k, lt in enumerate(stl.LAND):
        thud(lt, 0.8, 100 - 6 * k, pan=-0.5 + k * 0.25)
    for k in range(6):
        blip(16.45 + 0.0625 * k, [77, 80, 84, 85, 89, 92][k], 0.6, pan=-0.6 + 0.24 * k, decay=0.18, delay=0.25)
    K(16.75, 0.8)
    snare(17.0, 1.0, 1.0, 0.45)
    clap(17.0, 0.7, 0.4)
    K(17.25, 0.85)
    blip(17.0, 96, 0.4, decay=0.3)
    for s in range(8):
        hat(16.0 + s * BEAT / 2 + BEAT / 2 * 0, 0.4, open_=(s % 2 == 1), pan=0.2)
    for k, m in enumerate([80, 84, 87, 89, 92, 96, 92, 89]):
        pluck(16.5 + k * STEP, m, 0.25, 0.35, pan=math.sin(k) * 0.5, delay=0.4, verb=0.4)
    snare(17.75, 0.6, 1.2)
    snare(17.875, 0.7, 1.3)

    # --- outro 18-20 ---------------------------------------------------------
    for b in range(36, 40):
        t = b * BEAT
        if t < 19.5:
            K(t, 1.0)
        if b % 2 == 1:
            clap(t, 0.8)
        hat(t + BEAT / 2, 0.7, open_=True, pan=0.15)
        bass_pluck(t + BEAT / 2, ROOT['Eb'], 0.18, 0.9)
    for st, ln in ((0, 2), (3, 2), (6, 2), (10, 2), (12, 1), (14, 2)):
        chord_stab(18.0 + st * STEP, 'Eb', ln * STEP * 0.9, 0.6, cutoff=2400)
    if CFG.get('handle'):
        h = CFG['handle']
        for k in range(len(h)):
            click(18.15 + 0.35 * (k + 0.5) / len(h), 0.45, pan=(k / len(h) - 0.5) * 0.6, f=2000 + 200 * (k % 3))
    boing(18.45, 67, 79, 0.2, 0.6)
    whoosh(18.55, 0.45, 800, 3000, 0.4, 0.8, 0.2, 0.7)
    click(19.0, 1.4, 0.2, 1500)
    thud(19.0, 0.5, 160)
    whoosh(19.02, 0.5, 300, 6000, 0.9, 0.3, -0.3, 0.6)
    boing(19.3, 55, 79, 0.35, 0.8)
    riser(19.0, 1.0, 0.9, 51, 77)
    for k in range(8):
        snare(19.5 + k * STEP, 0.25 + 0.08 * k, 1 + 0.05 * k)


def sidechain(depth=0.6, release=0.14):
    g = np.ones(N)
    t = np.arange(int(0.45 * SR)) / SR
    shape = 1 - depth * np.where(t < 0.004, t / 0.004, np.exp(-(t - 0.004) / release))
    for kt in KICKS:
        i0 = int(kt * SR)
        n = min(len(shape), N - i0)
        g[i0:i0 + n] = np.minimum(g[i0:i0 + n], shape[:n])
    return g


def reverb_ir(dur=2.4, decay=0.55):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)]) * np.exp(-t / decay)
    ir = np.stack([sweep_filter(ir[0], 9000 * np.exp(-t / 0.8) + 500, 'low', block=1024),
                   sweep_filter(ir[1], 9000 * np.exp(-t / 0.8) + 500, 'low', block=1024)])
    pre = int(0.018 * SR)
    ir = np.concatenate([np.zeros((2, pre)), ir], 1)
    return ir / np.sqrt((ir ** 2).sum() / 2)


def pingpong(x, dt=0.375, fb=0.42, reps=5):
    out = np.zeros_like(x)
    d = int(dt * SR)
    g = 1.0
    src = lp(x.mean(0), 5000)
    for k in range(1, reps + 1):
        g *= fb
        out[k % 2, k * d:] += src[:N - k * d] * g
    return out


def render(path):
    for b in BUSES.values():
        b[:] = 0
    KICKS.clear()
    arrange()
    sc = sidechain(0.65)
    scb = sidechain(0.85, 0.12)
    mix = np.zeros((2, N))
    mix += BUSES['kick'] * 0.3
    mix += BUSES['drums'] * 0.9
    mix += BUSES['bass'] * scb * 0.5
    mix += BUSES['music'] * sc * 3.2
    mix += BUSES['lead'] * sc ** 0.5 * 1.8
    mix += BUSES['fx'] * 0.45
    dl = pingpong(BUSES['delay'])
    mix += dl * sc * 1.2
    ir = reverb_ir()
    wet = np.stack([signal.fftconvolve(BUSES['verb'][0] + dl[0] * 0.3, ir[0])[:N],
                    signal.fftconvolve(BUSES['verb'][1] + dl[1] * 0.3, ir[1])[:N]])
    wet = hp(wet, 250)
    mix += wet * 0.3 * (0.4 + 0.6 * sc)
    mix = hp(mix, 25)
    # pre-hit gaps: a breath of near-silence right before the big hits
    tt = np.arange(N) / SR
    for hit, depth, w in ((16.0, 0.9, 0.07), (10.0, 0.6, 0.04), (2.0, 0.45, 0.04)):
        g = 1 - depth * np.clip((tt - (hit - w)) / 0.015, 0, 1) * (tt < hit)
        mix *= g
    # wrap the tail past 20 s back onto the start => seamless loop
    n20 = int(DUR * SR)
    tail = mix[:, n20:]
    mix = mix[:, :n20].copy()
    mix[:, :tail.shape[1]] += tail
    # master: glue + soft clip + normalise
    pk = np.abs(mix).max()
    mix = mix / pk * 1.7
    mix = np.tanh(mix * 1.25) / np.tanh(1.25)
    mix = mix / np.abs(mix).max() * 0.93
    # tiny fade at the very edges (inaudible, avoids DC clicks)
    f = int(0.002 * SR)
    mix[:, -f:] *= np.linspace(1, 0.6, f)
    rms = np.sqrt((mix ** 2).mean())
    print(f'  music: peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS, rms {20 * np.log10(rms):.1f} dBFS')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = np.clip(mix.T + RNG.uniform(-1, 1, mix.T.shape) / 32768, -1, 1)
    wavfile.write(path, SR, (pcm * 32767).astype(np.int16))
    save_spectrum(mix, os.path.join(os.path.dirname(path), 'spectrum.npy'))
    return path


def save_spectrum(mix, path, nb=28):
    mono = mix.mean(0)
    nfft = 4096
    win = np.hanning(nfft)
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    edges = np.geomspace(45, 14000, nb + 1)
    nfr = int(DUR * FPS)
    out = np.zeros((nfr, nb), np.float32)
    prev = np.zeros(nb)
    for i in range(nfr):
        c = int(i / FPS * SR)
        seg = mono[max(c - nfft // 2, 0): c + nfft // 2]
        if len(seg) < nfft:
            seg = np.pad(seg, (0, nfft - len(seg)))
        mag = np.abs(np.fft.rfft(seg * win))
        bands = np.array([mag[(freqs >= edges[k]) & (freqs < edges[k + 1])].mean() + 1e-9 for k in range(nb)])
        db = 20 * np.log10(bands)
        v = np.clip((db - 0) / 50, 0, 1) * (0.7 + 0.6 * np.linspace(0, 1, nb))
        v = np.clip(v, 0, 1)
        prev = np.where(v > prev, v, prev * 0.82 + v * 0.18)
        out[i] = prev
    np.save(path, out)


if __name__ == '__main__':
    import sys
    p = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', 'music.wav')
    render(p)
    print(p)
