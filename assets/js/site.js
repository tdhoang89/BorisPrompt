/* Prompt kiểu Boris — hành vi chung. Không thư viện ngoài. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.remove('no-js');

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
  };

  /* ---------- Giao diện sáng / tối ---------- */
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('bp-theme', next);
      b.setAttribute('aria-label', next === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối');
    });
  });

  /* ---------- Thanh trên có viền khi cuộn ---------- */
  var bar = document.querySelector('.topbar');
  if (bar) {
    var onScroll = function () { bar.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---------- Hiện dần khi cuộn tới ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach(function (el) { io.observe(el); });
  } else { reveals.forEach(function (el) { el.classList.add('in'); }); }

  /* ---------- Nút sao chép ---------- */
  function copyText(text, btn) {
    var done = function (ok) {
      if (!btn) return;
      var label = btn.querySelector('[data-label]') || btn;
      var old = btn.getAttribute('data-orig') || label.textContent;
      btn.setAttribute('data-orig', old);
      label.textContent = ok ? 'Đã sao chép' : 'Bôi đen rồi Ctrl+C';
      btn.setAttribute('data-done', ok ? '1' : '0');
      clearTimeout(btn._t);
      btn._t = setTimeout(function () { label.textContent = old; btn.setAttribute('data-done', '0'); }, 1800);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else { fallback(); }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy-from]');
    if (!b) return;
    var src = document.getElementById(b.getAttribute('data-copy-from'));
    if (src) copyText(src.innerText.replace(/\s+\n/g, '\n').trim(), b);
  });

  /* ---------- Hero: giải phẫu prompt ---------- */
  var ana = document.querySelector('.anatomy');
  if (ana) {
    var sents = ana.querySelectorAll('.s[data-k]');
    var notes = ana.querySelectorAll('.notes li[data-k]');
    var light = function (k, on) {
      ana.querySelectorAll('[data-k="' + k + '"]').forEach(function (el) { el.classList.toggle('on', on); });
    };
    [].forEach.call(sents, function (el) {
      el.addEventListener('mouseenter', function () { light(el.dataset.k, true); });
      el.addEventListener('mouseleave', function () { light(el.dataset.k, false); });
    });
    [].forEach.call(notes, function (el) {
      el.addEventListener('mouseenter', function () { light(el.dataset.k, true); });
      el.addEventListener('mouseleave', function () { light(el.dataset.k, false); });
    });
    // Tô lần lượt từng câu Boris thêm vào
    var adds = ana.querySelectorAll('.s.add-s');
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    [].forEach.call(adds, function (el, i) { el.style.transitionDelay = reduce ? '0s' : (0.6 + i * 0.32) + 's'; });
    requestAnimationFrame(function () { setTimeout(function () { ana.classList.add('go'); }, 60); });
  }

  /* ---------- Trình tạo prompt ---------- */
  var B = document.querySelector('[data-builder]');
  if (B) {
    var TPL = {
      vi: {
        boris: [
          ['base', 'Tôi muốn bạn làm {WHAT}.'],
          ['add', ' Làm cho đẹp và dễ dùng, tập trung vào {FOCUS}.'],
          ['add', ' Làm thật tốt vào, dùng nhiều token và lặp lại cho đến khi bạn tự hào về nó.'],
          ['add', ' Thấy gì làm nó hay hơn thì cứ thêm, bạn tự quyết.'],
          ['add', ' Nhắm tới những thứ hay nhất cùng loại mà bạn từng thấy, nhưng tốt hơn.'],
          ['add', ' Trước khi nói xong, tự thử như một người dùng thật, rồi cho tôi biết bạn đã kiểm gì và chưa kiểm được gì.']
        ],
        tran: 'Làm cho tôi {WHAT}.', words: 'từ', ph: '…'
      },
      en: {
        boris: [
          ['base', 'I want you to make {WHAT}.'],
          ['add', ' Make it beautiful and easy to use, and focus on {FOCUS}.'],
          ['add', ' Make it really good, use lots of tokens and iterate till you\'re proud of it.'],
          ['add', ' Add whatever you think makes it better; your call.'],
          ['add', ' Aim for the best examples of this kind of thing you\'ve seen, but better.'],
          ['add', ' Before you say it\'s done, try it yourself the way a real user would, then tell me what you checked and what you couldn\'t.']
        ],
        tran: 'Make me {WHAT}.', words: 'words', ph: '…'
      }
    };
    var EX = JSON.parse(B.getAttribute('data-examples') || '[]');
    var what = B.querySelector('#f-what'), focus = B.querySelector('#f-focus');
    var out = B.querySelector('#b-out'), outTran = B.querySelector('#b-tran');
    var wc = B.querySelector('#b-wc'), wcT = B.querySelector('#b-wc-tran');
    var lang = 'vi';
    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var count = function (s) { return s.trim().split(/\s+/).filter(Boolean).length; };
    var render = function () {
      var w = what.value.trim() || TPL[lang].ph, f = focus.value.trim() || TPL[lang].ph;
      var html = '', text = '';
      TPL[lang].boris.forEach(function (p) {
        var seg = esc(p[1]).replace('{WHAT}', '<span class="fill">' + esc(w) + '</span>').replace('{FOCUS}', '<span class="fill">' + esc(f) + '</span>');
        var plain = p[1].replace('{WHAT}', w).replace('{FOCUS}', f);
        text += plain;
        html += p[0] === 'add' ? ' <span class="add">' + seg.trim() + '</span>' : seg;
      });
      out.innerHTML = html;
      var t = TPL[lang].tran.replace('{WHAT}', w);
      outTran.innerHTML = esc(TPL[lang].tran).replace('{WHAT}', '<span class="fill">' + esc(w) + '</span>');
      wc.textContent = count(text) + ' ' + TPL[lang].words;
      wcT.textContent = count(t) + ' ' + TPL[lang].words;
    };
    var setEx = function (i) {
      var ex = EX[i]; if (!ex) return;
      what.value = ex[lang === 'vi' ? 'what' : 'what_en'] || ex.what;
      focus.value = ex[lang === 'vi' ? 'focus' : 'focus_en'] || ex.focus;
      B.querySelectorAll('.chip[data-ex]').forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.ex === String(i) ? 'true' : 'false'); });
      render();
    };
    B.querySelectorAll('.chip[data-ex]').forEach(function (c) { c.addEventListener('click', function () { setEx(+c.dataset.ex); }); });
    [what, focus].forEach(function (el) {
      el.addEventListener('input', function () {
        B.querySelectorAll('.chip[data-ex]').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        render();
      });
    });
    B.querySelectorAll('[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () {
        lang = b.dataset.lang;
        B.querySelectorAll('[data-lang]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var pressed = B.querySelector('.chip[aria-pressed="true"]');
        if (pressed) setEx(+pressed.dataset.ex); else render();
      });
    });
    setEx(0);
  }

  /* ---------- Biểu đồ quả tạ: dung lượng mã ---------- */
  document.querySelectorAll('[data-dumbbell]').forEach(function (box) {
    var rows = JSON.parse(box.getAttribute('data-dumbbell'));
    var min = 10, max = 1000; // KB, thang log
    var pos = function (v) { return (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * 100; };
    var fmt = function (v) { return v.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' KB'; };
    var tip = document.createElement('div'); tip.className = 'dumb-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
    var html = '';
    rows.forEach(function (r) {
      var a = pos(r.t), b = pos(r.b), lo = Math.min(a, b), hi = Math.max(a, b);
      var ratio = (r.b / r.t);
      html += '<div class="dumb-row"><div class="lab">' + r.name + '<small>' + r.sub + '</small></div>' +
        '<div class="dumb-track"><span class="dumb-bar" style="left:' + lo + '%;width:' + (hi - lo) + '%"></span>' +
        '<span class="dumb-dot t" style="left:' + a + '%" tabindex="0" data-tip="<b>' + r.name + ' · prompt trần</b><br>' + fmt(r.t) + ' · ' + r.tf + '"></span>' +
        '<span class="dumb-dot b" style="left:' + b + '%" tabindex="0" data-tip="<b>' + r.name + ' · prompt Boris</b><br>' + fmt(r.b) + ' · ' + r.bf + '"></span></div>' +
        '<div class="ratio">×' + ratio.toLocaleString('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + '</div></div>';
    });
    var ticks = [10, 30, 100, 300, 1000];
    html += '<div class="dumb-axis"><span></span><div class="ticks">' + ticks.map(function (t) { return '<span' + (t === 30 || t === 300 ? ' class="minor"' : '') + ' style="left:' + pos(t) + '%">' + t + ' KB</span>'; }).join('') + '</div><span></span></div>';
    box.querySelector('.dumb-plot').innerHTML = html;
    var show = function (el, x, y) { tip.innerHTML = el.getAttribute('data-tip'); tip.style.left = Math.min(x + 14, window.innerWidth - 250) + 'px'; tip.style.top = (y + 14) + 'px'; tip.classList.add('show'); };
    box.addEventListener('mousemove', function (e) { var d = e.target.closest('.dumb-dot'); if (d) show(d, e.clientX, e.clientY); else tip.classList.remove('show'); });
    box.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
    box.addEventListener('focusin', function (e) { var d = e.target.closest('.dumb-dot'); if (d) { var r = d.getBoundingClientRect(); show(d, r.right, r.bottom); } });
    box.addEventListener('focusout', function () { tip.classList.remove('show'); });
    var tg = box.querySelector('[data-table-toggle]'), tb = box.querySelector('.data-table');
    if (tg && tb) tg.addEventListener('click', function () { var h = tb.hasAttribute('hidden'); if (h) tb.removeAttribute('hidden'); else tb.setAttribute('hidden', ''); tg.setAttribute('aria-expanded', h ? 'true' : 'false'); tg.querySelector('[data-label]').textContent = h ? 'Ẩn bảng số' : 'Xem bảng số'; });
  });

  /* ---------- Trang so sánh: khung chạy trực tiếp ---------- */
  var stage = document.querySelector('.stage');
  if (stage) {
    var VIEW = { desktop: { w: 1280, h: 800 }, phone: { w: 390, h: 844 } };
    var device = 'desktop';
    var narrow = window.matchMedia('(max-width: 760px)');
    if (narrow.matches) device = 'phone';
    var panes = stage.querySelectorAll('.pane');

    var fit = function (pane) {
      var screen = pane.querySelector('.screen'); var box = screen.querySelector('.frame-box');
      var v = VIEW[device];
      var sw = screen.clientWidth;
      var s;
      if (device === 'desktop') { s = sw / v.w; screen.style.height = ''; }
      else {
        var maxH = Math.min(window.innerHeight * 0.78, 760);
        s = Math.min((sw - 40) / v.w, maxH / v.h, 1.05);
      }
      if (box) {
        box.style.width = v.w + 'px'; box.style.height = v.h + 'px';
        box.style.transform = 'scale(' + s + ')';
        if (device === 'phone') { box.style.marginRight = (v.w * s - v.w) + 'px'; box.style.marginBottom = (v.h * s - v.h) + 'px'; }
        else { box.style.marginRight = ''; box.style.marginBottom = ''; }
      }
      var holder = screen.querySelector('.phone-holder');
      if (holder) { holder.style.width = (v.w * s) + 'px'; holder.style.height = (v.h * s) + 'px'; }
    };
    var build = function (pane) {
      var screen = pane.querySelector('.screen');
      var src = pane.getAttribute('data-src'), title = pane.getAttribute('data-title');
      var poster = pane.getAttribute('data-poster-' + device);
      var started = pane._started;
      screen.setAttribute('data-device', device);
      screen.innerHTML = '';
      var holder = document.createElement('div'); holder.className = 'phone-holder';
      var box = document.createElement('div'); box.className = 'frame-box';
      if (started) {
        var f = document.createElement('iframe');
        f.src = src; f.title = title; f.setAttribute('allow', 'autoplay; fullscreen; clipboard-write; screen-wake-lock');
        f.width = VIEW[device].w; f.height = VIEW[device].h;
        box.appendChild(f);
      } else {
        var p = document.createElement('button'); p.type = 'button'; p.className = 'poster';
        p.setAttribute('aria-label', 'Chạy ' + title + ' ngay trong trang');
        p.innerHTML = '<img src="' + poster + '" alt="" loading="lazy"><span class="play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>Chạy bản này</span>';
        p.addEventListener('click', function () { pane._started = true; build(pane); });
        box.appendChild(p);
      }
      if (device === 'phone') { holder.appendChild(box); screen.appendChild(holder); }
      else screen.appendChild(box);
      fit(pane);
    };
    panes.forEach(function (p) { build(p); });
    var ro = new ResizeObserver(function () { panes.forEach(fit); });
    panes.forEach(function (p) { ro.observe(p.querySelector('.screen')); });
    window.addEventListener('resize', function () { panes.forEach(fit); });

    document.querySelectorAll('[data-device-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.deviceBtn === device ? 'true' : 'false');
      b.addEventListener('click', function () {
        device = b.dataset.deviceBtn;
        document.querySelectorAll('[data-device-btn]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        panes.forEach(build);
      });
    });
    var setMode = function (m) {
      stage.setAttribute('data-mode', m);
      document.querySelectorAll('[data-mode-btn]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.modeBtn === m ? 'true' : 'false'); });
      requestAnimationFrame(function () { panes.forEach(fit); });
    };
    document.querySelectorAll('[data-mode-btn]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.modeBtn); }); });
    if (narrow.matches) setMode('tran');
    var both = document.querySelector('[data-run-both]');
    if (both) both.addEventListener('click', function () { panes.forEach(function (p) { if (!p._started) { p._started = true; build(p); } }); });
    stage.addEventListener('click', function (e) {
      var r = e.target.closest('[data-reload]');
      if (r) { var pane = r.closest('.pane'); pane._started = true; build(pane); }
    });
  }

  /* ---------- Trang video: phát đồng bộ ---------- */
  var vs = document.querySelector('.vstage');
  if (vs) {
    var vids = vs.querySelectorAll('video');
    var hear = 'boris';
    var applyAudio = function () { vids.forEach(function (v) { v.muted = v.dataset.arm !== hear; }); };
    var prog = document.querySelector('.vprogress i');
    document.querySelectorAll('[data-hear]').forEach(function (b) {
      b.addEventListener('click', function () {
        hear = b.dataset.hear; applyAudio();
        document.querySelectorAll('[data-hear]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    var playBoth = document.querySelector('[data-play-both]');
    var ready = function (v) {
      return new Promise(function (res) {
        if (v.readyState >= 3 && !v.seeking) return res();
        var done = function () { if (v.readyState >= 3 && !v.seeking) { v.removeEventListener('canplay', done); v.removeEventListener('seeked', done); res(); } };
        v.addEventListener('canplay', done); v.addEventListener('seeked', done);
        setTimeout(res, 4000);
      });
    };
    var syncing = false;
    if (playBoth) playBoth.addEventListener('click', function () {
      applyAudio(); syncing = true;
      vids.forEach(function (v) { v.pause(); v.preload = 'auto'; v.currentTime = 0; });
      Promise.all([].map.call(vids, ready)).then(function () {
        vids.forEach(function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
      });
    });
    // Giữ hai video cùng nhịp khi phát song song: bản đang nghe tiếng làm chuẩn
    setInterval(function () {
      if (!syncing) return;
      var lead = [].filter.call(vids, function (v) { return v.dataset.arm === hear; })[0];
      var other = [].filter.call(vids, function (v) { return v !== lead; })[0];
      if (!lead || !other || lead.paused || other.paused) return;
      if (Math.abs(lead.currentTime - other.currentTime) > 0.08) other.currentTime = lead.currentTime;
    }, 400);
    vids.forEach(function (v) { v.addEventListener('seeking', function () { if (!v.paused && document.activeElement === v) syncing = false; }); });
    var pauseBoth = document.querySelector('[data-pause-both]');
    if (pauseBoth) pauseBoth.addEventListener('click', function () { syncing = false; vids.forEach(function (v) { v.pause(); }); });
    vids.forEach(function (v) {
      v.addEventListener('play', function () { if (v.muted === false) { vids.forEach(function (o) { if (o !== v && !o.paused) o.muted = true; }); } });
      v.addEventListener('timeupdate', function () { if (prog && v.dataset.arm === 'boris') prog.style.width = (v.currentTime / (v.duration || 20) * 100) + '%'; });
    });
  }
})();
