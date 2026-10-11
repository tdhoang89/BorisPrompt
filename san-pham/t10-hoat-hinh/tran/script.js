// Hoạt hình 30 giây: cách tính điểm pickleball (đánh đôi, tính điểm theo lượt giao).
// Mọi thứ được vẽ lại từ thời điểm t, nên tua/phát lại luôn chính xác.

const DURATION = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// ---------- Kịch bản ----------

// Vị trí cầu thủ theo thời gian: [giây, x, y]
const PLAYERS = {
  A1: { team: 'a', dir: 1, keys: [[0, 55, 310], [9.3, 55, 310], [10.2, 120, 290], [11.8, 120, 290], [12.6, 55, 130], [14.5, 55, 130], [15.1, 130, 140], [16.6, 130, 140], [17.4, 90, 130]] },
  A2: { team: 'a', dir: 1, keys: [[0, 90, 130], [11.8, 90, 130], [12.6, 90, 310]] },
  B1: { team: 'b', dir: -1, keys: [[0, 800, 130], [16.6, 800, 130], [17.4, 825, 130], [19.4, 825, 130], [20.0, 790, 135], [21.6, 790, 135], [22.4, 790, 130]] },
  B2: { team: 'b', dir: -1, keys: [[0, 780, 310], [10.5, 780, 310], [11.0, 765, 315], [12.6, 780, 310], [21.6, 780, 310], [22.4, 825, 310]] },
};

// Đường bóng: [bắt đầu, kết thúc, x0, y0, x1, y1, độ cao vòng cung, người đánh]
const RALLIES = [
  { show: [7.9, 12.2], segs: [
    [8.3, 9.0, 60, 305, 720, 120, 70, 'A1'],
    [9.0, 9.3, 720, 120, 795, 135, 14],
    [9.3, 10.0, 795, 135, 200, 260, 55, 'B1'],
    [10.0, 10.3, 200, 260, 125, 285, 12],
    [10.3, 10.9, 125, 285, 680, 320, 50, 'A1'],
    [10.9, 11.2, 680, 320, 760, 312, 12],
    [11.2, 11.6, 760, 312, 446, 282, 26, 'B2'],
    [11.6, 11.85, 446, 282, 472, 288, 0],
  ] },
  { show: [12.8, 16.4], segs: [
    [13.3, 14.0, 60, 135, 720, 320, 70, 'A1'],
    [14.0, 14.3, 720, 320, 776, 308, 14],
    [14.3, 15.0, 776, 308, 230, 150, 55, 'B2'],
    [15.0, 15.25, 230, 150, 135, 142, 12],
    [15.25, 15.7, 135, 142, 434, 170, 22, 'A1'],
    [15.7, 15.95, 434, 170, 410, 176, 0],
  ] },
  { show: [17.6, 21.8], segs: [
    [18.4, 19.1, 820, 135, 170, 320, 70, 'B1'],
    [19.1, 19.4, 170, 320, 96, 308, 14],
    [19.4, 20.1, 96, 308, 700, 140, 55, 'A2'],
    [20.1, 20.4, 700, 140, 786, 134, 14],
    [20.4, 21.0, 786, 134, 22, 250, 75, 'B1'],
    [21.0, 21.3, 22, 250, 4, 256, 8],
  ] },
];

// Tỉ số: serving = đội giao, server = người giao số 1/2, holder = cầu thủ đang giao
const SCORES = [
  { t: 0, serving: 'a', a: 0, b: 0, server: 2, holder: 'A1' },
  { t: 11.85, serving: 'a', a: 1, b: 0, server: 2, holder: 'A1' },
  { t: 16.6, serving: 'b', a: 1, b: 0, server: 1, holder: 'B1' },
  { t: 21.6, serving: 'b', a: 1, b: 0, server: 2, holder: 'B2' },
];

const CAPTIONS = [
  [3.1, 5.5, 'Trong pickleball đánh đôi, tỉ số được đọc bằng <b>3 con số</b>'],
  [5.5, 8.0, '<b>Điểm đội giao</b> – <b>Điểm đội nhận</b> – <b>Người giao số mấy</b> (1 hoặc 2)',
    'Đầu trận luôn là <b>0 – 0 – 2</b>: đội giao trước chỉ có 1 lượt giao'],
  [8.0, 10.5, '<span class="tag-a">Đội Xanh</span> giao bóng <b>chéo sân</b>',
    'Bóng giao và bóng trả đầu tiên đều phải nảy 1 lần'],
  [10.5, 11.85, 'Pha bóng qua lại… <span class="tag-b">Đội Cam</span> đánh vào lưới!'],
  [11.85, 13.2, 'Đội giao thắng → <b>+1 điểm</b>! Người giao đổi ô với đồng đội',
    'Tỉ số mới: <b>1 – 0 – 2</b>, cùng người tiếp tục giao'],
  [13.2, 15.7, 'Chỉ <b>đội đang giao</b> mới được ghi điểm',
    'Giao lần nữa, lần này từ ô bên trái…'],
  [15.7, 16.6, '<span class="tag-a">Đội Xanh</span> đánh vào lưới → đội giao thua, <b>không ai được điểm</b>'],
  [16.6, 18.4, 'Đội Xanh hết lượt giao → <b>ĐỔI GIAO</b> (side out)',
    '<span class="tag-b">Đội Cam</span> đọc điểm của mình trước: <b>0 – 1 – 1</b>'],
  [18.4, 21.0, 'Người đứng <b>ô bên phải</b> giao trước (người giao 1)',
    'Mỗi đội có 2 lượt giao: người giao 1, rồi người giao 2'],
  [21.0, 23.0, 'Bóng ra ngoài! <span class="tag-b">Đội Cam</span> thua pha bóng nhưng còn <b>người giao 2</b>',
    'Đồng đội giao tiếp, không ai được điểm: <b>0 – 1 – 2</b>'],
  [23.0, 30.01, 'Giờ bạn đã biết cách đọc điểm pickleball! 🎉'],
];

// Chữ bật lên trên sân: [giây, chữ, x, y, màu]
const POPUPS = [
  [11.6, 'LƯỚI!', 446, 250, '#ffffff'],
  [11.9, '+1 ĐỘI XANH', 220, 235, '#64b5f6'],
  [15.7, 'LƯỚI!', 434, 140, '#ffffff'],
  [16.3, 'ĐỔI GIAO!', 440, 228, '#ffb74d'],
  [21.0, 'NGOÀI!', 110, 235, '#ff8a80'],
];

// ---------- Dựng hình ----------

const playersLayer = document.getElementById('players');
const playerEls = {};

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

for (const id in PLAYERS) {
  const p = PLAYERS[id];
  const g = svg('g', { class: `player player-${p.team}` }, playersLayer);
  svg('ellipse', { class: 'player-shadow', cx: 3, cy: 22, rx: 18, ry: 6 }, g);
  const arm = svg('g', { transform: `translate(${10 * p.dir} ${16 * p.dir})` }, g);
  const paddle = svg('g', {}, arm);
  svg('rect', { class: 'paddle-handle', x: -2.5, y: -2, width: 5, height: 10, rx: 2 }, paddle);
  svg('rect', { class: 'paddle-face', x: 6 * p.dir - 8, y: 4, width: 16, height: 16, rx: 6 }, paddle);
  svg('circle', { class: 'player-body', r: 19 }, g);
  for (const ey of [-6, 6]) {
    svg('circle', { class: 'eye', cx: 7 * p.dir, cy: ey, r: 5 }, g);
    svg('circle', { class: 'pupil', cx: 9 * p.dir, cy: ey, r: 2.4 }, g);
  }
  playerEls[id] = { g, paddle };
  p.swings = [];
}
for (const r of RALLIES) for (const s of r.segs) if (s[7]) PLAYERS[s[7]].swings.push(s[0]);

const popupLayer = document.getElementById('popups');
const popupEls = POPUPS.map(([, text, x, y, color]) => {
  const el = svg('text', { class: 'popup', x: 0, y: 0, fill: color, opacity: 0 }, popupLayer);
  el.textContent = text;
  el.dataset.x = x;
  el.dataset.y = y;
  return el;
});

const $ = id => document.getElementById(id);
const ballGroup = $('ballGroup');
const ball = $('ball');
const ballShadow = $('ballShadow');
const badge = $('serverBadge');
const badgeText = $('serverBadgeText');
const caption = $('caption');
const call = $('call');
const nums = [$('n0'), $('n1'), $('n2')];
const digits = nums.map(n => n.querySelector('.d'));
const titleCard = $('titleCard');
const recap = $('recap');
const recapItems = [...recap.querySelectorAll('[data-at]')];
const endCard = $('endCard');
const playBtn = $('playBtn');
const seek = $('seek');
const timeLabel = $('time');

function track(keys, t) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i][0]) {
      const [t0, x0, y0] = keys[i - 1];
      const [t1, x1, y1] = keys[i];
      const u = ease((t - t0) / (t1 - t0));
      return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    }
  }
  const k = keys[keys.length - 1];
  return [k[1], k[2]];
}

function ballAt(t) {
  const r = RALLIES.find(r => t >= r.show[0] && t < r.show[1]);
  if (!r) return null;
  const first = r.segs[0];
  if (t < first[0]) return [first[2], first[3], 18];
  for (const [t0, t1, x0, y0, x1, y1, peak] of r.segs) {
    if (t < t1) {
      const u = (t - t0) / (t1 - t0);
      return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, peak * 4 * u * (1 - u)];
    }
  }
  const last = r.segs[r.segs.length - 1];
  return [last[4], last[5], 0];
}

const scoreAt = t => SCORES.filter(s => s.t <= t).pop();

function setDigit(i, value) {
  const d = digits[i];
  if (d.textContent !== String(value)) {
    d.textContent = value;
    d.classList.remove('pop');
    void d.offsetWidth;
    d.classList.add('pop');
  }
}

let lastCaption = null;

function render(t) {
  // Cầu thủ + vợt
  for (const id in PLAYERS) {
    const p = PLAYERS[id];
    const [x, y] = track(p.keys, t);
    p.pos = [x, y];
    playerEls[id].g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    let ang = 0;
    for (const s of p.swings) {
      const d = t - s + 0.1;
      if (d > 0 && d < 0.4) ang = -75 * Math.sin((d / 0.4) * Math.PI);
    }
    playerEls[id].paddle.setAttribute('transform', `rotate(${(ang * p.dir).toFixed(1)})`);
  }

  // Bóng
  const b = ballAt(t);
  ballGroup.style.display = b ? '' : 'none';
  if (b) {
    const [x, y, h] = b;
    ballShadow.setAttribute('cx', x.toFixed(1));
    ballShadow.setAttribute('cy', (y + 4).toFixed(1));
    const s = 1 + h / 80;
    ball.setAttribute('transform', `translate(${x.toFixed(1)} ${(y - h).toFixed(1)}) scale(${s.toFixed(2)})`);
  }

  // Tỉ số
  const sc = scoreAt(t);
  const servingScore = sc.serving === 'a' ? sc.a : sc.b;
  const receivingScore = sc.serving === 'a' ? sc.b : sc.a;
  setDigit(0, servingScore);
  setDigit(1, receivingScore);
  setDigit(2, sc.server);
  $('totalA').textContent = sc.a;
  $('totalB').textContent = sc.b;
  call.style.setProperty('--serving', `var(--team-${sc.serving})`);
  call.style.setProperty('--receiving', `var(--team-${sc.serving === 'a' ? 'b' : 'a'})`);

  const hlSoft = t >= 3.1 && t < 5.5;
  const hlIndex = t >= 5.5 && t < 8 ? Math.min(2, Math.floor((t - 5.5) / 0.83)) : -1;
  nums.forEach((n, i) => {
    n.classList.toggle('hl-soft', hlSoft);
    n.classList.toggle('hl', i === hlIndex || (hlIndex === -1 && t >= 21.6 && t < 23 && i === 2) ||
      (t >= 16.6 && t < 18.4) || (t >= 11.85 && t < 13.2 && i === 0));
  });

  // Nhãn người giao
  const holder = PLAYERS[sc.holder].pos;
  badge.style.display = t >= 3.1 && t < 23 ? '' : 'none';
  badge.setAttribute('transform', `translate(${holder[0].toFixed(1)} ${(holder[1] - 42).toFixed(1)})`);
  badgeText.textContent = `Người giao ${sc.server}`;

  // Chữ bật lên
  POPUPS.forEach(([t0], i) => {
    const el = popupEls[i];
    const d = t - t0;
    if (d < 0 || d > 1.3) { el.setAttribute('opacity', 0); return; }
    const op = d < 0.15 ? d / 0.15 : d > 1.0 ? (1.3 - d) / 0.3 : 1;
    const sc2 = d < 0.2 ? 0.4 + (d / 0.2) * 0.8 : 1.2 - Math.min(0.2, (d - 0.2));
    el.setAttribute('opacity', op.toFixed(2));
    el.setAttribute('transform', `translate(${el.dataset.x} ${(el.dataset.y - d * 18).toFixed(1)}) scale(${sc2.toFixed(2)})`);
  });

  // Phụ đề
  const cap = CAPTIONS.find(c => t >= c[0] && t < c[1]);
  if (cap !== lastCaption) {
    lastCaption = cap;
    caption.innerHTML = cap ? `<div>${cap[2]}</div>${cap[3] ? `<div class="sub">${cap[3]}</div>` : ''}` : '';
    caption.classList.remove('fade-in');
    void caption.offsetWidth;
    caption.classList.add('fade-in');
  }

  // Màn tiêu đề / tóm tắt / kết thúc
  const titleOp = t < 2.6 ? 1 : 1 - (t - 2.6) / 0.5;
  titleCard.classList.toggle('show', titleOp > 0);
  titleCard.style.opacity = clamp(titleOp, 0, 1);

  const recapOp = clamp((t - 23) / 0.4, 0, 1);
  recap.classList.toggle('show', recapOp > 0);
  recap.style.opacity = recapOp;
  recapItems.forEach(el => el.classList.toggle('on', t >= parseFloat(el.dataset.at)));

  endCard.classList.toggle('show', t >= DURATION);

  // Thanh điều khiển
  seek.value = t;
  timeLabel.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
}

const fmt = s => `0:${String(Math.floor(s)).padStart(2, '0')}`;

// ---------- Phát / tạm dừng / phát lại ----------

let t = 0;
let playing = true;
let lastFrame = null;

function setPlaying(v) {
  playing = v;
  playBtn.textContent = v ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', v ? 'Tạm dừng' : 'Phát');
}

function replay() {
  t = 0;
  lastCaption = undefined;
  setPlaying(true);
}

function frame(now) {
  const dt = lastFrame == null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (playing) {
    t = Math.min(DURATION, t + dt);
    if (t >= DURATION) setPlaying(false);
  }
  render(t);
  requestAnimationFrame(frame);
}

playBtn.addEventListener('click', () => {
  if (t >= DURATION) replay();
  else setPlaying(!playing);
});
$('replayBtn').addEventListener('click', replay);
$('bigReplay').addEventListener('click', replay);
seek.addEventListener('input', () => { t = parseFloat(seek.value); });
document.addEventListener('keydown', e => {
  if (e.target === seek) return;
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  if (e.key === 'r' || e.key === 'R') replay();
});

requestAnimationFrame(frame);
