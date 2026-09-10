/* ============================================================
   动动吧 · Motion Kernel
   零依赖的 rAF 动效内核。为像素风界面提供有质量感的运动。

   设计原则：
   - 帧率无关：一律用 1 - exp(-k·dt)，而非 x += d * 0.1
   - 有重量：欠阻尼弹簧，落点带轻微过冲
   - 力度与静音：prefers-reduced-motion 时全部退化为直接赋值
   ============================================================ */

(function (global) {
  'use strict';

  const reducedMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* ---------- 工具 ---------- */

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* 帧率无关指数滤波系数：k 越大越快。
     x += (target - x) * k 是错的（帧率一变手感就变）；
     x += (target - x) * (1 - exp(-k*dt)) 才是唯一的正确写法。 */
  const expFilter = (k, dt) => 1 - Math.exp(-k * dt);

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t, s) { s = s || 1.70158; const p = t - 1; return p * p * ((s + 1) * p + s) + 1; }

  /* ---------- 弹簧 ---------- */

  /* 欠阻尼弹簧。返回一个 stepper(dt)，每帧推进一次并写回 {x, vel}。
     stiffness 60–90，damping 0.86(弹) / 0.90(果冻) / 0.93(克制) */
  function createSpring(state, opts) {
    const o = opts || {};
    const stiffness = o.stiffness != null ? o.stiffness : 78;
    const damping = o.damping != null ? o.damping : 0.88;
    return function step(target, dt) {
      state.vel = (state.vel || 0) + (target - state.x) * stiffness * dt;
      state.vel *= Math.pow(damping, dt * 60 / Math.min(dt * 60, 3) * 1);
      state.x += state.vel * dt;
      return state.x;
    };
  }

  /* ---------- 数值滚动 ---------- */

  /* 数字翻滚：从 from 滚到 to，easeOutCubic 收尾。
     回调每帧拿到当前值，由调用方决定怎么渲染（保留千分位）。 */
  function rollNumber(from, to, opts) {
    const o = opts || {};
    const duration = o.duration != null ? o.duration : 520;
    const onUpdate = o.onUpdate || function () {};
    const onDone = o.onDone;
    if (reducedMotion.matches || duration <= 0) { onUpdate(to); if (onDone) onDone(); return function () {}; }
    if (from === to) { onUpdate(to); if (onDone) onDone(); return function () {}; }

    let raf = 0;
    const start = performance.now();
    const delta = to - from;
    const tick = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      onUpdate(Math.round(from + delta * easeOutCubic(t)));
      if (t < 1) { raf = requestAnimationFrame(tick); }
      else if (onDone) { onDone(); }
    };
    raf = requestAnimationFrame(tick);
    return function cancel() { cancelAnimationFrame(raf); };
  }

  /* ---------- 按压回弹 ---------- */

  /* 像素按键的按下/松手：按下立刻沉下去，松手用 easeOutBack 弹回。
     不回弹的按键是"死"的——这是手感最容易补上的一环。 */
  function pressFeedback(el, opts) {
    if (!el) return function () {};
    const o = opts || {};
    const depth = o.depth != null ? o.depth : 2;
    let raf = 0;

    function animateTo(from, to, duration, easing) {
      cancelAnimationFrame(raf);
      if (reducedMotion.matches || duration <= 0) {
        el.style.transform = 'translate(' + to + 'px,' + to + 'px)';
        return;
      }
      const t0 = performance.now();
      const span = to - from;
      const tick = (now) => {
        const t = clamp((now - t0) / duration, 0, 1);
        const v = from + span * easing(t);
        el.style.transform = 'translate(' + v.toFixed(2) + 'px,' + v.toFixed(2) + 'px)';
        if (t < 1) raf = requestAnimationFrame(tick);
        else el.style.transform = '';
      };
      raf = requestAnimationFrame(tick);
    }

    const down = () => animateTo(0, depth, 70, easeOutCubic);
    const up = () => animateTo(depth, 0, 260, (t) => easeOutBack(t, 2.4));

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return function destroy() {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
      el.style.transform = '';
    };
  }/* ---------- 速度耦合 ---------- */

  /* 元素对"自己动得多快"作出反应——不是只对"动到哪里"。
     典型用法：滑块拖动时轻微侧倾；数值变化时轻微拉伸。 */
  function velocityCouple(el, opts) {
    if (!el) return { update: function () {}, destroy: function () {} };
    const o = opts || {};
    const gain = o.gain != null ? o.gain : 0.55;
    const max = o.max != null ? o.max : 12;
    let lastValue = null;
    let raf = 0;
    let tilt = 0;
    let vel = 0;

    function frame() {
      vel *= 0.82;
      tilt += (clamp(vel * gain, -max, max) - tilt) * 0.35;
      if (Math.abs(tilt) < 0.01 && Math.abs(vel) < 0.01) { el.style.transform = ''; raf = 0; return; }
      el.style.transform = 'rotateZ(' + tilt.toFixed(2) + 'deg)';
      raf = requestAnimationFrame(frame);
    }

    return {
      nudge: function (value) {
        if (reducedMotion.matches) return;
        if (lastValue != null) vel = value - lastValue;
        lastValue = value;
        if (!raf) raf = requestAnimationFrame(frame);
      },
      destroy: function () { cancelAnimationFrame(raf); el.style.transform = ''; raf = 0; }
    };
  }

  /* ---------- 彩带（物理化） ---------- */

  /* 线性下落 = 像贴纸掉下来。加重力加速 + 横向摆动 + 自转才像撒出去的纸片。 */
  function spawnConfetti(opts) {
    const o = opts || {};
    const count = o.count != null ? o.count : 42;
    const colors = o.colors || ['#1FA89A', '#4A9FE8', '#F26D5B', '#F2B83C', '#2F9E6E', '#20303C'];
    if (reducedMotion.matches) return;

    const container = document.createElement('div');
    container.className = 'confetti-container';
    const pieces = [];
    const W = global.innerWidth;

    for (let i = 0; i < count; i += 1) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      const size = Math.random() * 8 + 5;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      container.appendChild(el);
      pieces.push({
        el: el,
        x: Math.random() * W,
        y: -20 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 90,
        vy: 120 + Math.random() * 160,
        rot: Math.random() * 360,
        vrot: (Math.random() - 0.5) * 420,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 2 + Math.random() * 2.4,
        swayAmp: 8 + Math.random() * 22
      });
    }
    document.body.appendChild(container);

    let raf = 0;
    let last = performance.now();
    const gravity = 980;
    const life = 3200;
    const t0 = last;

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const age = now - t0;
      const fade = age > life - 700 ? clamp((life - age) / 700, 0, 1) : 1;for (var i = 0; i < pieces.length; i += 1) {
        var p = pieces[i];
        p.vy += gravity * dt;
        p.y += p.vy * dt;
        p.sway += p.swaySpeed * dt;
        p.x += (p.vx + Math.sin(p.sway) * p.swayAmp) * dt;
        p.rot += p.vrot * dt;
        p.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px,0) rotate(' + p.rot.toFixed(1) + 'deg)';
        p.el.style.opacity = fade;
      }
      if (age < life) { raf = requestAnimationFrame(frame); }
      else { container.remove(); }
    }
    raf = requestAnimationFrame(frame);
    return function destroy() { cancelAnimationFrame(raf); container.remove(); };
  }

  /* ---------- tab 切换方向感 ---------- */

  /* 三个 tab 用同一个 fadeUp = 没有空间连续性。
     按索引差决定从哪一侧滑入，用户才知道"我往哪个方向去了"。 */
  function panelEnter(panel, direction) {
    if (!panel) return;
    panel.classList.remove('slide-left', 'slide-right');
    if (reducedMotion.matches) return;
    void panel.offsetWidth;
    panel.classList.add(direction >= 0 ? 'slide-left' : 'slide-right');
  }

  global.MotionKit = {
    reducedMotion: reducedMotion,
    clamp: clamp,
    expFilter: expFilter,
    easeOutCubic: easeOutCubic,
    easeOutBack: easeOutBack,
    createSpring: createSpring,
    rollNumber: rollNumber,
    pressFeedback: pressFeedback,
    velocityCouple: velocityCouple,
    spawnConfetti: spawnConfetti,
    panelEnter: panelEnter
  };
})(window);
