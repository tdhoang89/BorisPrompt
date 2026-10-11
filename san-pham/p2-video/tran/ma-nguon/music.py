"""
Nhạc nền 20s cho showreel — tổng hợp hoàn toàn bằng code (numpy + scipy).
120 BPM, 1 ô nhịp = 2s, giọng La thứ. Timeline được dùng chung với reel.py
để hình ảnh khớp từng nhịp kick / clap / impact.

    python music.py            -> music.wav
"""
import wave
import numpy as np
from scipy import signal

SR = 48000
BPM = 120
BEAT = 60 / BPM          # 0.5s
DUR = 20.0
N = int(SR * DUR)

# ---------------------------------------------------------------- timeline
HITS = [4.0, 8.0, 12.0, 16.0, 18.0]          # impact lớn (drop / chuyển cảnh)
TRANSITIONS = [8.0, 12.0]                    # whoosh


def kick_times():
    ks = [0.0, 1.0, 2.0, 3.0]                                  # intro "nhịp tim"
    ks += [4.0 + i * BEAT for i in range(23)]                  # 4.0 .. 15.0
    ks += [16.0 + i * BEAT for i in range(4)]                  # 16.0 .. 17.5
    ks += [18.0]
    return ks


def clap_times():
    return [4.5 + k for k in range(11)] + [16.5, 17.5]


def roll_times(a, b):
    d = b - a
    ts = list(np.arange(a, a + d / 2 - 1e-6, BEAT / 2))
    ts += list(np.arange(a + d / 2, a + 3 * d / 4 - 1e-6, BEAT / 4))
    ts += list(np.arange(a + 3 * d / 4, b - 1e-6, BEAT / 8))
    return ts


ROLLS = [(3.0, 4.0), (15.0, 16.0)]

CHORDS = {'Am': [57, 60, 64, 69], 'F': [57, 60, 65, 69],
          'C': [55, 60, 64, 67], 'G': [55, 59, 62, 67]}
ROOT = {'Am': 33, 'F': 29, 'C': 36, 'G': 31}
SEQ = [(0, 2, 'F'), (2, 4, 'G'), (4, 6, 'Am'), (6, 8, 'F'), (8, 10, 'C'),
       (10, 12, 'G'), (12, 14, 'Am'), (14, 16, 'G'), (16, 17, 'F'),
       (17, 18, 'G'), (18, 20, 'Am')]


def chord_at(t):
    for a, b, c in SEQ:
        if a <= t < b:
            return c
    return 'Am'


# ---------------------------------------------------------------- dsp utils
RNG = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n):
    return np.arange(n) / SR


def noise(n):
    return RNG.standard_normal(n)


def saw(f, n, ph0=0.0):
    f = np.broadcast_to(np.asarray(f, float), (n,))
    dt = f / SR
    ph = (ph0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def square(f, n, ph0=0.0):
    return 0.5 * (saw(f, n, ph0) - saw(f, n, ph0 + 0.5))


def sine_sweep(f, n):
    f = np.broadcast_to(np.asarray(f, float), (n,))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def filt(x, kind, fc, order=2):
    sos = signal.butter(order, np.asarray(fc) / (SR / 2), btype=kind, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def _rbj(kind, fc, q):
    w0 = 2 * np.pi * fc / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # bp, 0dB peak
        b = [al, 0, -al]
    a0 = 1 + al
    return np.array(b) / a0, np.array([1, -2 * c / a0, (1 - al) / a0])


def tvf(x, fc, kind='lp', q=0.8, block=64):
    """Bộ lọc biến thiên theo thời gian (cutoff là mảng theo mẫu)."""
    fc = np.broadcast_to(np.asarray(fc, float), (x.shape[-1],))
    if x.ndim == 2:
        return np.stack([tvf(ch, fc, kind, q, block) for ch in x])
    y = np.empty_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        f = float(np.clip(fc[min(i + block // 2, len(x) - 1)], 20, SR * 0.45))
        b, a = _rbj(kind, f, q)
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return y


def env(n, att=0.002, dec=8.0):
    e = np.exp(-tt(n) * dec)
    na = max(1, int(att * SR))
    e[:na] *= np.linspace(0, 1, na)
    nf = min(n, int(0.004 * SR))
    e[-nf:] *= np.linspace(1, 0, nf)
    return e


def pan2(x, pan=0.0):
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2)


def bus():
    return np.zeros((2, N))


def place(b, sig, t0, gain=1.0, pan=0.0):
    if sig.ndim == 1:
        sig = pan2(sig, pan)
    i0 = int(round(t0 * SR))
    s0 = 0
    if i0 < 0:
        s0, i0 = -i0, 0
    n = min(sig.shape[1] - s0, N - i0)
    if n > 0:
        b[:, i0:i0 + n] += sig[:, s0:s0 + n] * gain


def peak_norm(x, p=1.0):
    m = np.max(np.abs(x))
    return x * (p / m) if m > 0 else x


def rms(x):
    return np.sqrt(np.mean(x ** 2))


# ---------------------------------------------------------------- instruments
def kick(soft=False):
    n = int(0.45 * SR)
    t = tt(n)
    f = 46 + 190 * np.exp(-t * 32) + 500 * np.exp(-t * 400)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.0)
    y *= np.minimum(1, t / 0.0015)
    y += filt(noise(n), 'highpass', 2500) * np.exp(-t * 300) * 0.2
    y = np.tanh(y * 2.0) / np.tanh(2.0)
    if soft:
        y = filt(y, 'lowpass', 180) * 1.6
    y[-200:] *= np.linspace(1, 0, 200)
    return y


def clap(pitch=1.0):
    n = int(0.4 * SR)
    t = tt(n)
    nz = filt(noise(n), 'bandpass', [900 * pitch, 3200 * pitch])
    e = np.zeros(n)
    for d in (0.0, 0.010, 0.021):
        e += np.where(t >= d, np.exp(-(t - d) * 220), 0)
    e += np.where(t >= 0.03, np.exp(-(t - 0.03) * 14), 0) * 0.55
    body = np.sin(2 * np.pi * 185 * pitch * t) * np.exp(-t * 35) * 0.5
    return (nz * e + body) * np.minimum(1, t / 0.0008)


def hat(open_=False):
    n = int((0.3 if open_ else 0.06) * SR)
    x = filt(noise(n), 'highpass', 7500, 4)
    return x * env(n, 0.0005, 11 if open_ else 70)


def crash(length=2.6):
    n = int(length * SR)
    t = tt(n)
    out = []
    for _ in range(2):
        x = filt(noise(n), 'highpass', 3800) * np.exp(-t * 2.0)
        met = sum(square(f, n, RNG.random()) for f in (587, 845, 1031, 1270, 1517, 1822))
        x += filt(met, 'highpass', 5000) * np.exp(-t * 3.5) * 0.25
        out.append(x * np.minimum(1, t / 0.002))
    return np.stack(out)


def impact(length=2.2):
    n = int(length * SR)
    t = tt(n)
    sub = np.sin(2 * np.pi * np.cumsum(28 + 40 * np.exp(-t * 6)) / SR) * np.exp(-t * 2.2)
    boom = filt(noise(n), 'lowpass', 900) * np.exp(-t * 7) * 0.8
    y = np.tanh((sub + boom) * 1.5)
    y *= np.minimum(1, t / 0.002)
    return y


def riser(dur, f0=350, f1=9000, pitch=True):
    n = int(dur * SR)
    t = tt(n)
    x = t / dur
    fc = f0 * (f1 / f0) ** (x ** 1.5)
    s = np.stack([tvf(noise(n), fc, 'bp', 1.8), tvf(noise(n), fc, 'bp', 1.8)])
    s *= (x ** 2.2) * 1.4
    if pitch:
        f = hz(57) * 2 ** (2 * x ** 2)
        trem = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 28 * x ** 2) / SR)
        tone = saw(f, n) * trem * x ** 2 * 0.25
        s += pan2(filt(tone, 'lowpass', 3000), 0)
    return s


def downlifter(dur=2.0):
    n = int(dur * SR)
    x = tt(n) / dur
    fc = 7000 * (150 / 7000) ** (x ** 0.6)
    s = np.stack([tvf(noise(n), fc, 'bp', 1.5), tvf(noise(n), fc, 'bp', 1.5)])
    return s * (1 - x) ** 2


def whoosh(dur=0.55):
    n = int(dur * SR)
    x = tt(n) / dur
    fc = 400 * (6000 / 400) ** (x ** 2)
    s = tvf(noise(n), fc, 'bp', 2.0) * x ** 3
    s[-300:] *= np.linspace(1, 0, 300)
    pan = -0.9 + 1.8 * x
    a = (pan + 1) * np.pi / 4
    return np.stack([s * np.cos(a), s * np.sin(a)]) * 1.4


def supersaw(f, n, voices=7, cents=16):
    L = np.zeros(n)
    R = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2)
        s = saw(f * 2 ** (d * cents / 1200), n, RNG.random())
        a = (d * 0.85 + 1) * np.pi / 4
        L += s * np.cos(a)
        R += s * np.sin(a)
    return np.stack([L, R]) / np.sqrt(voices)


def pluck(m, dur=0.32):
    n = int(dur * SR)
    t = tt(n)
    f = hz(m)
    x = saw(f, n, RNG.random()) + 0.7 * saw(f * 1.007, n, RNG.random())
    y = tvf(x, 450 + 6000 * np.exp(-t * 24), 'lp', 1.6)
    return y * env(n, 0.001, 10)


def bass_note(m, dur=0.115):
    n = int(dur * SR)
    t = tt(n)
    f = hz(m)
    x = 0.65 * saw(f, n) + 0.35 * square(f * 1.004, n)
    y = tvf(x, 160 + 2600 * np.exp(-t * 34), 'lp', 1.3)
    e = np.minimum(1, t / 0.002) * np.exp(-t * 6)
    e[-240:] *= np.linspace(1, 0, 240)
    return np.tanh(y * e * 1.6)


def stab(chord, dur=0.3, bright=6500):
    n = int(dur * SR)
    t = tt(n)
    s = sum(supersaw(hz(m + 12), n, 5, 22) for m in CHORDS[chord])
    s += sum(supersaw(hz(m), n, 5, 22) for m in CHORDS[chord][:2]) * 0.6
    s = tvf(s, 500 + bright * np.exp(-t * 14), 'lp', 1.0)
    return s * env(n, 0.002, 9)


# ---------------------------------------------------------------- fx racks
def reverb(x, decay=2.4, damp=5500, pre=0.025):
    n = int(decay * SR)
    t = tt(n)
    out = []
    for c in range(2):
        ir = noise(n) * np.exp(-t * 6.9 / decay)
        ir = tvf(ir, damp * np.exp(-t * 1.2) + 300, 'lp', 0.7, 256)
        ir[:int(pre * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out.append(signal.fftconvolve(x[c], ir)[:N])
    return np.stack(out)


def pingpong(x, dt=0.375, fb=0.45, taps=6, mix=0.5):
    out = x.copy()
    d = int(dt * SR)
    mono = filt(x.mean(0), 'bandpass', [400, 4500])
    for k in range(1, taps + 1):
        sh = np.zeros(N)
        sh[k * d:] = mono[:-k * d]
        out[(k + 1) % 2] += sh * mix * fb ** (k - 1)
    return out


def sidechain(depth, rel=0.11, start=0.0):
    t = tt(N)
    ks = np.array(kick_times())
    idx = np.searchsorted(ks, t, side='right') - 1
    dt = t - ks[np.maximum(idx, 0)]
    duck = np.where(idx >= 0, np.exp(-dt / rel) * np.minimum(1, dt / 0.004), 0)
    duck[t < start] *= 0.5
    return 1 - depth * duck


def curve(points):
    """Đường cong tuyến tính từng đoạn [(t, v), ...] -> mảng theo mẫu."""
    ts, vs = zip(*points)
    return np.interp(tt(N), ts, vs)


# ---------------------------------------------------------------- arrangement
def render():
    kicks, claps, hats, rolls, perc = bus(), bus(), bus(), bus(), bus()
    k_hard, k_soft = kick(), kick(soft=True)
    for k in kick_times():
        if k < 4.0:
            place(kicks, k_soft, k, 0.85)
        else:
            place(kicks, k_hard, k, 1.0 if k != 18.0 else 1.1)

    for c in clap_times():
        place(claps, clap(), c, 1.0)

    # hi-hat: offbeat 8ths từ drop, thêm 16ths từ 8s
    t = 4.0
    while t < 18.0 - 1e-6:
        if not (15.5 <= t < 16.0):
            place(hats, hat(open_=True), t + 0.25, 0.55, 0.15)
            if 8.0 <= t < 15.5 or 16.0 <= t:
                for s, v in ((1, 0.35), (3, 0.45)):
                    place(hats, hat(), t + s * BEAT / 4, v, -0.2)
        t += BEAT

    for a, b in ROLLS:
        ts = roll_times(a, b)
        for i, r in enumerate(ts):
            x = (r - a) / (b - a)
            place(rolls, clap(pitch=0.8 + 0.5 * x), r, 0.25 + 0.75 * x ** 1.5,
                  0.3 * np.sin(i * 1.7))

    # ---- bass: rolling 16ths (bỏ phách có kick), sub sine bám hợp âm
    bass = bus()
    beats = [4.0 + i * BEAT for i in range(23)] + [16.0 + i * BEAT for i in range(4)]
    for bt in beats:
        root = ROOT[chord_at(bt)] + 12
        for s in (1, 2, 3):
            m = root + (12 if (12.0 <= bt < 16.0 and s == 2) else 0)
            place(bass, bass_note(m), bt + s * BEAT / 4, 1.0)
    place(bass, bass_note(ROOT['Am'] + 12, 0.9), 18.0, 1.2)

    sub_f = np.array([hz(ROOT[chord_at(x)]) for x in tt(N)[::480]])
    sub_f = np.repeat(sub_f, 480)[:N]
    sub = np.sin(2 * np.pi * np.cumsum(sub_f) / SR)
    sub *= curve([(0, 0), (3.95, 0), (4.0, 1), (15.45, 1), (15.5, 0), (16.0, 0),
                  (16.0, 1), (18.0, 1), (19.6, 0), (20, 0)])
    sub = pan2(sub)

    # ---- pad supersaw
    pad = bus()
    for a, b, c in SEQ:
        n = int((b - a + 0.35) * SR)
        s = sum(supersaw(hz(m), n) for m in CHORDS[c])
        s += supersaw(hz(CHORDS[c][0] - 12), n) * 0.5
        e = np.minimum(1, tt(n) / (0.6 if a < 4 else 0.04))
        e *= np.clip((b - a + 0.35 - tt(n)) / 0.35, 0, 1)
        place(pad, s * e, a)
    pad_fc = curve([(0, 250), (3.9, 2600), (4.0, 3200), (15.0, 3200), (15.9, 900),
                    (16.0, 4200), (18.0, 4200), (19.8, 300), (20, 300)])
    pad = tvf(pad, pad_fc, 'lp', 0.9, 128)
    pad *= curve([(0, 0.4), (3.9, 0.75), (4, 0.9), (18, 0.9), (19.8, 0), (20, 0)])

    # ---- arp pluck 16ths
    arp = bus()
    pattern = [0, 1, 2, 3, 4, 3, 2, 1]
    t, step = 2.0, 0
    while t < 18.0 - 1e-6:
        if not (15.5 <= t < 16.0):
            ns = CHORDS[chord_at(t)]
            ns = [m + 12 for m in ns] + [ns[1] + 24]
            m = ns[pattern[step % 8]]
            acc = 1.0 if step % 2 else 0.7
            place(arp, pluck(m), t, acc, 0.35 if step % 2 else -0.35)
        t += BEAT / 4
        step += 1
    arp *= curve([(0, 0), (2, 0.35), (3.95, 0.7), (4, 1), (20, 1)])
    arp = tvf(arp, curve([(0, 500), (3.9, 4500), (4, 9000), (20, 9000)]), 'lp', 0.7, 128)
    arp = pingpong(arp)

    # ---- stabs (khớp chữ kinetic 10–12s) + hit cuối
    stabs = bus()
    for i, st in enumerate([10.0, 10.5, 11.0, 11.5]):
        place(stabs, stab('G'), st, 0.9 + 0.1 * i)
    for st in (16.0, 18.0):
        place(stabs, stab('F' if st == 16 else 'Am', 1.6, 8000), st, 1.2)

    # ---- fx
    fx = bus()
    place(fx, riser(4.0), 0.0, 0.9)
    place(fx, riser(1.0, 600, 10000, False), 15.0, 0.9)
    for h in HITS:
        place(fx, impact(), h, 1.0 if h in (4.0, 16.0, 18.0) else 0.7)
        place(fx, crash(), h, 0.55)
    place(fx, crash(1.6), 6.0, 0.3)
    place(fx, crash(1.6), 14.0, 0.3)
    place(fx, downlifter(1.8), 4.0, 0.5)
    place(fx, downlifter(1.8), 16.0, 0.5)
    rev = crash(1.2)[:, ::-1]
    place(fx, rev * np.linspace(0, 1, rev.shape[1]) ** 2, 12.0 - rev.shape[1] / SR, 0.6)
    for tr in TRANSITIONS:
        w = whoosh()
        place(fx, w, tr - w.shape[1] / SR, 0.8)
    blip = np.sin(2 * np.pi * 1760 * tt(int(0.12 * SR))) * env(int(0.12 * SR), 0.001, 40)
    place(fx, blip, 19.62, 0.25)

    # ---- level (mix "mù" theo đỉnh/RMS để có cân bằng ổn định)
    kicks = peak_norm(kicks, 1.0)
    claps = peak_norm(claps, 0.55)
    hats = peak_norm(hats, 0.22)
    rolls = peak_norm(rolls, 0.5)
    bass = bass / rms(bass[:, int(4 * SR):int(15 * SR)]) * 0.11
    sub = sub * 0.32
    pad = pad / rms(pad[:, int(4 * SR):int(15 * SR)]) * 0.07
    arp = arp / rms(arp[:, int(4 * SR):int(15 * SR)]) * 0.055
    stabs = peak_norm(stabs, 0.5)
    fx = peak_norm(fx, 0.75)

    sc = sidechain(0.75)
    sc_b = sidechain(0.95, 0.09)
    music = pad * sc + arp * sidechain(0.4) + bass * sc_b + sub * sc_b + stabs * sc
    send = claps * 0.35 + rolls * 0.3 + pad * 0.25 + arp * 0.35 + stabs * 0.45 + fx * 0.25
    wet = reverb(send) * 0.55

    mix = kicks + claps + hats + rolls + music + fx + wet

    # stutter 1/32 trước cú drop 12s
    a, L = int(11.75 * SR), int(BEAT / 8 * SR)
    seg = mix[:, a:a + L].copy()
    for k in range(4):
        mix[:, a + k * L:a + (k + 1) * L] = seg * (1 - 0.15 * k)

    # ---- master
    mix = filt(mix, 'highpass', 28)
    mix = mix / np.max(np.abs(mix)) * 1.6
    mix = np.tanh(mix) / np.tanh(1.6)
    mix[:, :int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    mix[:, -int(0.06 * SR):] *= np.linspace(1, 0, int(0.06 * SR))
    return mix / np.max(np.abs(mix)) * 0.94


def write_wav(path, x):
    pcm = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
    x = render()
    write_wav(out, x)
    print(f'{out}: {DUR}s, peak {np.max(np.abs(x)):.2f}, rms {20*np.log10(rms(x)):.1f} dBFS')
