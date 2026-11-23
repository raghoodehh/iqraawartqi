/* وضع العرض على شاشات الصف + أدوات التعليم على الكلمات (تظليل، خط تحت، دائرة).
   وضع العرض هو نفس صفحة المصحف بعد إخفاء ما حولها، فتبقى الألوان والتلاوة والعلامات كما هي. */

/* ---------- marks: tied to the words (data-t), never to screen positions ---------- */
// L.hl[page] = [{ id, tool: 'hl'|'ul'|'ring', color: 'y'|'g'|'p', t: [token indexes] }]
const MARK_INK = { y: '#c99400', g: '#1d8a4a', p: '#d6337a' };
const TOOL_NAMES = { hl: 'تظليل', ul: 'خط تحت', ring: 'دائرة' };
function pageMarks(create) { const L = S.lesson; const pg = L.pages[L.pi]; if (create && !L.hl[pg]) L.hl[pg] = []; return L.hl[pg] || []; }
function renderMarks() {
  const L = S.lesson; if (!L || !L.page) return;
  const el = L.page.el;
  el.querySelectorAll('.mk').forEach(x => x.remove());
  L.page.tokens.forEach(t => t.el.classList.remove('hl-y', 'hl-g', 'hl-p'));
  const marks = Array.isArray(L.hl[L.pages[L.pi]]) ? L.hl[L.pages[L.pi]] : [];
  const base = el.getBoundingClientRect();
  marks.forEach(m => {
    const els = m.t.map(i => L.page.tokens[i]?.el).filter(Boolean);
    if (m.tool === 'hl') { els.forEach(e => e.classList.add('hl-' + m.color)); return; }
    // one shape per line: a range over two lines gets two pieces
    const byLine = new Map();
    els.forEach(e => { const ln = e.parentElement; if (!byLine.has(ln)) byLine.set(ln, []); byLine.get(ln).push(e); });
    byLine.forEach((ws, ln) => {
      const fs = parseFloat(getComputedStyle(ln).fontSize) || 24;
      const rs = ws.map(w => w.getBoundingClientRect());
      const box = { l: Math.min(...rs.map(r => r.left)), r: Math.max(...rs.map(r => r.right)), t: Math.min(...rs.map(r => r.top)), b: Math.max(...rs.map(r => r.bottom)) };
      const d = document.createElement('div');
      d.className = 'mk mk-' + m.tool; d.dataset.mid = m.id;
      d.style.setProperty('--ink', MARK_INK[m.color]);
      const bw = Math.max(2, fs * .045);
      if (m.tool === 'ring') {
        // an oval around the words with room to spare, so it never covers the letters
        // horizontal room stays inside the (narrow) gap to the next word, so the neighbours are not touched either
        const pad = fs * .035;
        Object.assign(d.style, { left: (box.l - base.left - pad - bw) + 'px', top: (box.t - base.top - fs * .02) + 'px', width: (box.r - box.l + 2 * (pad + bw)) + 'px', height: (box.b - box.t + fs * .04) + 'px', borderWidth: bw + 'px' });
      } else {
        // a thick line a little below the words, clear of the dots and vowels underneath
        Object.assign(d.style, { left: (box.l - base.left - fs * .04) + 'px', top: (box.b - base.top + fs * .04) + 'px', width: (box.r - box.l + fs * .08) + 'px', height: Math.max(3, fs * .075) + 'px' });
      }
      el.appendChild(d);
    });
  });
}
// tap or drag across words while a tool is on
function wireMarking(pageEl) {
  let start = null, cur = null, pid = null;
  const tokAt = (x, y) => { const e = document.elementFromPoint(x, y)?.closest('.w'); return e && pageEl.contains(e) ? +e.dataset.t : null; };
  const range = () => { const L = S.lesson; const [a, b] = [Math.min(start, cur), Math.max(start, cur)]; return L.page.tokens.slice(a, b + 1).map((t, k) => ({ t, i: a + k })).filter(o => o.t.kind === 'w').map(o => o.i); };
  const preview = on => { const L = S.lesson; L.page.tokens.forEach(t => t.el.classList.remove('mk-pre')); if (on) range().forEach(i => L.page.tokens[i].el.classList.add('mk-pre')); };
  pageEl.addEventListener('pointerdown', e => {
    const L = S.lesson; if (!L.pen) return;
    const t = tokAt(e.clientX, e.clientY); if (t == null) return;
    start = cur = t; pid = e.pointerId; e.preventDefault(); preview(true);
  });
  pageEl.addEventListener('pointermove', e => {
    if (start == null || e.pointerId !== pid) return;
    const t = tokAt(e.clientX, e.clientY); if (t != null && t !== cur) { cur = t; preview(true); }
  });
  const end = e => {
    if (start == null || (e && e.pointerId !== pid)) return;
    const L = S.lesson; const ids = range(); start = cur = null; preview(false);
    if (!ids.length) return;
    const marks = pageMarks(true);
    const same = m => m.tool === L.tool && m.color === L.pen;
    const key = ids.join(',');
    const exact = marks.findIndex(m => same(m) && m.t.join(',') === key);
    const holder = ids.length === 1 ? marks.findIndex(m => same(m) && m.t.includes(ids[0])) : -1;
    if (exact >= 0) marks.splice(exact, 1);            // the same mark again: remove it
    else if (holder >= 0) marks.splice(holder, 1);      // tap a marked word with the same tool & colour: remove its mark
    else marks.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tool: L.tool, color: L.pen, t: ids });
    renderMarks();
  };
  pageEl.addEventListener('pointerup', end);
  pageEl.addEventListener('pointercancel', () => { start = cur = null; preview(false); });
}
function clearMarks() { const L = S.lesson; delete L.hl[L.pages[L.pi]]; renderMarks(); }
// keep every tool/colour button (lesson toolbar and display-mode bar) in step
function syncTools() {
  const L = S.lesson; if (!L) return;
  document.querySelectorAll('[data-pen]').forEach(x => x.classList.toggle('on', x.dataset.pen === L.pen));
  document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', !!L.pen && x.dataset.tool === L.tool));
  L.page && L.page.el.classList.toggle('pen-mode', !!L.pen);
  const ed = document.getElementById('pc-edit'); if (ed) ed.classList.toggle('on', !!L.pen);
  const te = document.getElementById('tl-edit'); if (te) { te.classList.toggle('on', !!L.pen); te.setAttribute('aria-pressed', !!L.pen); }
  const tt = document.getElementById('tl-tray'); if (tt) tt.hidden = !L.pen;
}

/* ---------- small drop-down menus (lesson bars) ---------- */
function closeMenus(except) {
  document.querySelectorAll('.dd-menu').forEach(m => { if (m !== except && !m.hidden) { m.hidden = true; m.parentElement.querySelector('[data-dd]')?.setAttribute('aria-expanded', 'false'); } });
}
function wireMenus(root) {
  root.querySelectorAll('.dd').forEach(dd => {
    const btn = dd.querySelector('[data-dd]'), menu = dd.querySelector('.dd-menu');
    btn.onclick = e => {
      e.stopPropagation(); const open = menu.hidden; closeMenus(menu); menu.hidden = !open; btn.setAttribute('aria-expanded', open);
      if (open) { // keep the menu inside the screen on narrow devices
        menu.style.transform = ''; const r = menu.getBoundingClientRect();
        const dx = r.right > innerWidth - 8 ? innerWidth - 8 - r.right : r.left < 8 ? 8 - r.left : 0;
        if (dx) menu.style.transform = `translateX(${dx}px)`;
      }
    };
    // choosing an item closes the menu, except on/off switches (data-keep) and the reciter form
    menu.addEventListener('click', e => { const it = e.target.closest('button'); if (it && !it.hasAttribute('data-keep')) setTimeout(() => closeMenus(), 0); });
  });
}
document.addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('.dd')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
// toolbar: tapping the active colour again switches the tool off. Display-mode tray: colours only select (✏️ switches off).
function setPen(color, toggle = true) {
  const L = S.lesson; L.pen = toggle && L.pen === color ? null : color; syncTools();
  if (L.pen && !L.present) toast(`${TOOL_NAMES[L.tool]}: اضغطي على كلمة أو اسحبي على عدة كلمات، واضغطي القلم مرة أخرى للإيقاف`);
}
function setTool(tool) { const L = S.lesson; L.tool = tool; if (!L.pen) L.pen = 'y'; syncTools(); }
function toolsHTML() {
  const L = S.lesson;
  return `<span class="tools-g" role="group" aria-label="أدوات التعليم">${[['hl', '🖍️', 'تظليل'], ['ul', '<u>خط</u>', 'خط تحت الكلمة'], ['ring', '⭕', 'دائرة حول الكلمة']].map(([k, i, n]) => `<button class="tool ${L.pen && L.tool === k ? 'on' : ''}" data-tool="${k}" title="${n}" aria-label="${n}">${i}</button>`).join('')}</span>
    <span class="pens" role="group" aria-label="ألوان الأقلام">${['y', 'g', 'p'].map(c => `<button class="pen ${c} ${L.pen === c ? 'on' : ''}" data-pen="${c}" aria-label="${{ y: 'أصفر', g: 'أخضر', p: 'وردي' }[c]}"></button>`).join('')}</span>`;
}
function wireTools(root, toggle = true) {
  root.querySelectorAll('[data-pen]').forEach(b => b.onclick = () => setPen(b.dataset.pen, toggle));
  root.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
}

/* ---------- recitation speed ---------- */
const RATES = [0.75, 0.85, 1];
const rateLabel = r => toAr(String(r).replace(/^0/, '٠')).replace('.', '٫') + '×';
function setRate(r) {
  Player.setRate(r);
  document.querySelectorAll('[data-rate]').forEach(b => { const on = +b.dataset.rate === r; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  document.querySelectorAll('.rate-badge').forEach(x => { x.hidden = r === 1; x.textContent = rateLabel(r); });
  const pr = document.getElementById('pc-rate'); if (pr) pr.textContent = rateLabel(r);
  toast('سرعة التلاوة: ' + rateLabel(r));
}
// one tap moves to the next speed: 1× → 0.85× → 0.75× → 1×
function cycleRate() { const order = [1, 0.85, 0.75]; setRate(order[(order.indexOf(Player.rate) + 1) % order.length]); }

/* ---------- display mode ---------- */
const PRESENT_LINES = [4, 6, 8, 10, 'all'];
function enterPresent() {
  const L = S.lesson; if (!L || !L.page) { toast('لا توجد صفحة لعرضها'); return; }
  closePop();
  L.present = true; L.fsByUs = false;
  document.querySelector('.lesson')?.classList.add('presenting');
  const bar = document.createElement('div'); bar.className = 'pctl'; bar.id = 'pctl';
  document.body.appendChild(bar);
  drawPresentBar();
  const de = document.documentElement;
  if (de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().then(() => { L.fsByUs = true; }).catch(() => { /* works inside the window too */ });
  fit(); centerAyah(L.sel, false);
  $('#page-wrap').focus({ preventScroll: true });
}
function exitPresent() {
  const L = S.lesson; if (!L || !L.present) return;
  L.present = false;
  document.getElementById('pctl')?.remove();
  document.querySelector('.lesson')?.classList.remove('presenting');
  if (document.fullscreenElement && L.fsByUs) document.exitFullscreen().catch(() => {});
  L.fsByUs = false;
  closePop();
  fit(); centerAyah(L.sel, false);
}
// leaving fullscreen with the browser's own Esc also leaves display mode
document.addEventListener('fullscreenchange', () => { const L = S.lesson; if (L && L.present && L.fsByUs && !document.fullscreenElement) { L.fsByUs = false; exitPresent(); } });
function drawPresentBar() {
  const L = S.lesson; const bar = document.getElementById('pctl'); if (!bar) return;
  const n = L.lines === 'all' ? 'كاملة' : toAr(L.lines);
  bar.innerHTML = `<div class="pctl-tray" id="pc-tray" ${L.pen ? '' : 'hidden'}>${toolsHTML()}</div>
    <div class="pctl-menu" id="pc-lines" hidden>${PRESENT_LINES.map(v => `<button class="${v === L.lines ? 'on' : ''}" data-lines="${v}">${v === 'all' ? 'الصفحة كاملة' : toAr(v) + ' أسطر'}</button>`).join('')}</div>
    <div class="pctl-row">
      <button id="pc-play" aria-label="تشغيل أو إيقاف">${Player.playing ? '⏸️' : '▶️'}</button>
      <button id="pc-rate" aria-label="سرعة التلاوة">${rateLabel(Player.rate)}</button>
      <button id="pc-edit" class="${L.pen ? 'on' : ''}" aria-label="أدوات التعليم">✏️</button>
      <button id="pc-clear" aria-label="مسح العلامات في هذه الصفحة">🧽</button>
      <button id="pc-n" aria-label="عدد الأسطر">${n} <small>أسطر</small></button>
      <button id="pc-x" aria-label="خروج من وضع العرض">✕</button>
    </div>`;
  wireTools(bar, false);
  bar.querySelector('#pc-play').onclick = () => togglePlay();
  bar.querySelector('#pc-rate').onclick = cycleRate;
  bar.querySelector('#pc-edit').onclick = () => {
    if (L.pen) { L.pen = null; syncTools(); bar.querySelector('#pc-tray').hidden = true; }
    else { L.pen = 'y'; L.tool = L.tool || 'hl'; syncTools(); bar.querySelector('#pc-tray').hidden = false; }
  };
  bar.querySelector('#pc-clear').onclick = clearMarks;
  bar.querySelector('#pc-n').onclick = () => { const m = bar.querySelector('#pc-lines'); m.hidden = !m.hidden; };
  bar.querySelectorAll('[data-lines]').forEach(b => b.onclick = () => {
    L.lines = b.dataset.lines === 'all' ? 'all' : +b.dataset.lines; store.set('iqra-present-lines', L.lines);
    drawPresentBar(); fit(); centerAyah(L.sel, false);
  });
  bar.querySelector('#pc-x').onclick = exitPresent;
}
// the page fills the screen's width; its size is chosen so that L.lines lines fit in the height
function presentFit() {
  const L = S.lesson; const el = L.page.el; const wrap = $('#page-wrap');
  const barH = (document.getElementById('pctl')?.offsetHeight || 80) + 24;
  wrap.style.paddingBottom = barH + 'px';
  const margin = Math.max(12, wrap.clientWidth * .015);
  const W = Math.max(280, wrap.clientWidth - margin * 2);
  const H = Math.max(200, wrap.clientHeight - barH - 16);
  fitMushaf(el, W);
  const lines = [...el.querySelectorAll('.ln')];
  const lineH = lines.length ? lines.reduce((a, l) => a + l.offsetHeight, 0) / lines.length : 50;
  const n = L.lines === 'all' ? (el.offsetHeight / lineH) : L.lines;
  if (lineH * n > H) fitMushaf(el, Math.max(260, W * H / (lineH * n)));
}
// smooth scroll, with a direct jump if the browser did not animate it (some screens pause animations)
let scrollSeq = 0;
function scrollWrap(top, smooth = true) {
  const wrap = $('#page-wrap'); if (!wrap) return;
  top = Math.max(0, Math.min(top, wrap.scrollHeight - wrap.clientHeight));
  const my = ++scrollSeq;
  wrap.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  if (smooth) setTimeout(() => { if (my === scrollSeq && Math.abs(wrap.scrollTop - top) > 2) wrap.scrollTo({ top, behavior: 'auto' }); }, 700);
}
// scroll so the ayah sits in the middle of the screen
function centerAyah(key, smooth = true) {
  const L = S.lesson; if (!L || !L.page || !key) return;
  const els = L.page.tokens.filter(t => t.key === key && t.kind !== 'hz').map(t => t.el); if (!els.length) return;
  const wrap = $('#page-wrap'); const wr = wrap.getBoundingClientRect();
  const top = Math.min(...els.map(e => e.getBoundingClientRect().top)), bot = Math.max(...els.map(e => e.getBoundingClientRect().bottom));
  const barH = L.present ? (document.getElementById('pctl')?.offsetHeight || 0) : 0;
  const visible = wr.height - barH;
  const target = wrap.scrollTop + (top + bot) / 2 - wr.top - visible / 2;
  scrollWrap(target, smooth);
}
function togglePlay() { app().querySelector('[data-a=play]')?.click(); setTimeout(syncPlay, 60); }
function syncPlay() { const b = document.getElementById('pc-play'); if (b) b.textContent = Player.playing ? '⏸️' : '▶️'; }
// the ayah keys on this page, in order
function pageAyahs() { const L = S.lesson; return [...new Set(L.page.tokens.filter(t => t.kind === 'w' && (!L.portion || L.portion.has(t.key))).map(t => t.key))]; }
async function stepAyah(dir) {
  const L = S.lesson; const ks = pageAyahs(); let i = ks.indexOf(L.sel);
  if (dir > 0 && i >= ks.length - 1) { if (await turnPage(1)) { L.sel = pageAyahs()[0]; markSelected(); centerAyah(L.sel, false); } return; }
  if (dir < 0 && i <= 0) { if (await turnPage(-1)) { const k = pageAyahs(); L.sel = k[k.length - 1]; markSelected(); centerAyah(L.sel, false); } return; }
  L.sel = ks[i + dir]; markSelected(); centerAyah(L.sel);
}
async function turnPage(dir) {
  const L = S.lesson;
  if (L.free) { const p = L.freePage + dir; if (p < 1 || p > 604) return false; L.freePage = p; afterFreePage(); }
  else { const p = L.pi + dir; if (p < 0 || p >= L.pages.length) { toast(dir > 0 ? 'هذه آخر صفحة في المقطع' : 'هذه أول صفحة في المقطع'); return false; } L.pi = p; await showPage(); }
  for (let k = 0; k < 40 && !(L.page && L.page.el.isConnected); k++) await new Promise(r => setTimeout(r, 50));
  return true;
}
function lineStep() { const L = S.lesson; const ln = L.page?.el.querySelector('.ln'); return (ln ? ln.offsetHeight : 60) * 2; }
document.addEventListener('keydown', e => {
  const L = S.lesson; if (!L || !L.present) return;
  if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
  const wrap = $('#page-wrap'); if (!wrap) return;
  const atEnd = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4;
  const k = e.key;
  if (k === 'Escape') { if (document.getElementById('pop')) closePop(); else exitPresent(); e.preventDefault(); return; }
  if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); if (atEnd) turnPage(1).then(ok => ok && scrollWrap(0, false)); else scrollWrap(wrap.scrollTop + lineStep()); }
  else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); scrollWrap(wrap.scrollTop - lineStep()); }
  else if (k === 'ArrowLeft') { e.preventDefault(); stepAyah(1); }   // RTL: left is the next ayah
  else if (k === 'ArrowRight') { e.preventDefault(); stepAyah(-1); }
  else if (k === 'Home') { e.preventDefault(); scrollWrap(0); }
  else if (k === 'End') { e.preventDefault(); scrollWrap(wrap.scrollHeight); }
  else if (k === ' ' || k === 'Spacebar') { e.preventDefault(); togglePlay(); }
}, true);
