/* اقرأ وارتقِ — main application */
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const TYPE_NAMES = { new: 'مقطع جديد', group: 'قراءة جماعية', sabr: 'سبر', review: 'مراجعة جماعية', holiday: 'عطلة', other: 'نشاط' };
const SCORED = ['group', 'sabr'];

const S = { plans: {}, seed: {}, errors: [], notes: {}, settings: {}, admin: null, sec: {}, lesson: null };
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app');
const gradeOf = id => GRADES.find(g => g.id === id);
const sectionName = id => { const [g, l] = id.split('-'); return `${gradeOf(g).name} ${l}`; };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  sget(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  sset(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- dates ---------- */
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(iso, withDay = true) {
  const d = parseISO(iso); if (!d) return '';
  return `${withDay ? WEEKDAYS[d.getDay()] + ' ' : ''}${toAr(d.getDate())} ${MONTHS[d.getMonth()]} ${toAr(d.getFullYear())}`;
}
function monthKey(iso) { return iso ? iso.slice(0, 7) : ''; }
function monthName(mk) { const [y, m] = mk.split('-').map(Number); return `${MONTHS[m - 1]} ${toAr(y)}`; }

/* ---------- plans ---------- */
function entries(grade) { const p = S.plans[grade]; return (p && p.length) ? p : (S.seed[grade] || []); }
function planIsSeed(grade) { return !(S.plans[grade] && S.plans[grade].length); }
function todayIndex(list) {
  const t = todayISO();
  let i = list.findIndex(e => e.date === t);
  if (i >= 0) return i;
  i = list.findIndex(e => e.date && e.date > t);
  if (i >= 0) return i;
  return list.length ? list.length - 1 : -1;
}
function weekParts(list, idx) {
  const parts = [];
  let i = idx - 1;
  while (i >= 0 && SCORED.includes(list[i].type)) i--;
  for (; i >= 0; i--) {
    const e = list[i];
    if (e.type === 'new') parts.unshift(e);
    else if (SCORED.includes(e.type) || e.type === 'review') break;
  }
  return parts;
}
function entrySegs(list, idx) {
  const e = list[idx];
  if (!e) return null;
  if (e.segs && e.segs.length) return e.segs;
  if (SCORED.includes(e.type)) { const parts = weekParts(list, idx); return parts.length ? parts.flatMap(p => p.segs) : null; }
  return null;
}
function scoredEntries(grade) { return entries(grade).filter(e => SCORED.includes(e.type)); }
function recOf(section, entryId) { return S.errors.find(r => r.section === section && r.entryId === entryId); }

/* ---------- tajweed rules chosen for each grade (Settings.tajweed) ---------- */
function tajweedMap() { try { return JSON.parse(S.settings.tajweed || '{}') || {}; } catch (e) { return {}; } }
// array of rule indexes for the grade, or null = all rules (the default)
function gradeRules(grade) { const v = tajweedMap()[grade]; return Array.isArray(v) ? v : null; }

/* ---------- section progress through the plan ---------- */
function progOf(section, entryId) { return (S.progress || []).find(r => r.section === section && r.entryId === String(entryId)); }
function localDay(iso) { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const isNewDay = e => e && e.type === 'new' && e.segs && e.segs.length;
// segs up to and including "s:a" / segs after "s:a"
function segsUpto(segs, upto) {
  const [us, ua] = String(upto).split(':').map(Number); const out = [];
  for (const [s, a1, a2] of segs) { if (s === us && ua >= a1 && ua <= a2) { out.push([s, a1, ua]); return out; } out.push([s, a1, a2]); }
  return out;
}
function segsAfter(segs, upto) {
  const [us, ua] = String(upto).split(':').map(Number); const out = []; let found = false;
  for (const [s, a1, a2] of segs) {
    if (found) out.push([s, a1, a2]);
    else if (s === us && ua >= a1 && ua <= a2) { found = true; if (ua < a2) out.push([s, ua + 1, a2]); }
  }
  return found ? out : segs;
}
/* Where a section really is.
   Tracking starts at the first segment the section ever recorded: everything before it counts as done,
   so a section with no records follows the plan exactly as before. */
function sectionStatus(sectionId) {
  const grade = sectionId.split('-')[0];
  const g = gradeOf(grade);
  const list = entries(grade);
  const out = { tracked: false, pos: -1, lag: 0, list };
  if (!g || g.free || !list.length) return out;
  const recs = (S.progress || []).filter(r => r.section === sectionId);
  const idxs = recs.map(r => list.findIndex(e => e.id === r.entryId)).filter(i => i >= 0);
  if (!idxs.length) return out;
  out.tracked = true;
  const base = Math.min(...idxs);
  const t = todayISO();
  const done = i => i < base || progOf(sectionId, list[i].id)?.status === 'done';
  list.forEach((e, i) => {
    if (!isNewDay(e) || done(i)) return;
    if (out.pos < 0) out.pos = i;
    if (e.date && e.date <= t) out.lag++;
  });
  return out;
}
function startIndex(sectionId) {
  const list = entries(sectionId.split('-')[0]);
  const ti = todayIndex(list);
  const st = sectionStatus(sectionId);
  // on group/sabr days the class does today's activity (with what it actually read)
  if (st.lag > 0 && st.pos >= 0 && !SCORED.includes(list[ti]?.type)) return st.pos;
  return ti;
}
/* For a lagging section on a group/sabr day: the segments it actually finished since the previous
   group/sabr day (by date), plus the read part of a partial segment. null -> use the plan's weekParts. */
function actualParts(sectionId, list, idx) {
  if (sectionStatus(sectionId).lag <= 0) return null;
  let a = idx; while (a > 0 && SCORED.includes(list[a - 1].type)) a--;
  let b = idx; while (b < list.length - 1 && SCORED.includes(list[b + 1].type)) b++;
  let j = a - 1; while (j >= 0 && !SCORED.includes(list[j].type)) j--;
  const from = j >= 0 ? (list[j].date || '') : '';
  const to = list[b].date || todayISO();
  const parts = [];
  list.forEach(e => {
    if (!isNewDay(e)) return;
    const r = progOf(sectionId, e.id); if (!r) return;
    const d = localDay(r.at); if (!d || (from && d <= from) || d > to) return;
    const segs = r.status === 'partial' && r.upto ? segsUpto(e.segs, r.upto) : e.segs;
    parts.push({ id: e.id, date: d, day: e.day, segs, partial: r.status === 'partial' });
  });
  return parts.length ? parts : null;
}
function lagWords(n) { return n === 1 ? 'مقطعاً واحداً' : n === 2 ? 'مقطعين' : n <= 10 ? `${toAr(n)} مقاطع` : `${toAr(n)} مقطعاً`; }

/* ---------- boot ---------- */
async function boot() {
  app().innerHTML = `<div class="landing"><div></div><div class="picker" style="justify-items:center"><div class="brand">${logoSVG()}<div><h1>اقرأ وارتقِ</h1><p>جارٍ التحميل…</p></div></div></div><div></div></div>`;
  try {
    const [, seed, boot] = await Promise.all([Q.init(), fetch('data/plans.json').then(r => r.json()), API.call('bootstrap')]);
    S.seed = seed;
    S.plans = boot.plans || {};
    S.errors = boot.errors || [];
    S.notes = boot.notes || {};
    S.settings = boot.settings || {};
    S.progress = boot.progress || [];
    S.prayer = boot.prayer || [];
    S.adhkar = boot.adhkar || [];
  } catch (e) {
    app().innerHTML = `<div class="landing"><div></div><div class="picker"><h2>تعذّر تحميل الموقع</h2><p>${esc(e.userMessage || 'تأكدي من الاتصال بالإنترنت ثم أعيدي تحميل الصفحة.')}</p><button class="btn primary" onclick="location.reload()">إعادة المحاولة</button></div><div></div></div>`;
    return;
  }
  S.admin = store.sget('iqra-admin', null);
  S.sec = store.sget('iqra-sec', {});
  Player.reciter = store.get('iqra-reciter', S.settings.reciter || RECITERS[0].id);
  // a direct link (#/7/b/quran) wins; otherwise this device opens its section's home
  const last = store.get('iqra-last', null);
  if (parseRoute()) router();
  else if (last && SECTIONS.some(s => s.id === last)) { history.replaceState(null, '', routeOf(last)); router(); }
  else home();
}

function logoSVG(cls = 'brand-mark') {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--gold)"><path d="M32 3l7.4 10.7L52 12l-1.7 12.6L61 32l-10.7 7.4L52 52l-12.6-1.7L32 61l-7.4-10.7L12 52l1.7-12.6L3 32l10.7-7.4L12 12l12.6 1.7z"/></g><path d="M20 40c4-3 8-4 12-4s8 1 12 4V24c-4-3-8-4-12-4s-8 1-12 4z" fill="var(--accent)"/><path d="M32 20v16" stroke="var(--surface)" stroke-width="1.6"/><path d="M26 16l6-5 6 5" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ---------- landing & pickers ---------- */
function frame(inner, crumbs) {
  app().innerHTML = `<div class="landing">
    <div class="topline"><div class="brand">${logoSVG()}<div><h1>اقرأ وارتقِ</h1><p>صفحة كل يوم.. وأثرٌ كل عمر</p></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-go="board">لوحة الترتيب</button><button class="btn" data-go="admin">${S.admin ? 'لوحة الإدارة' : 'دخول الإدارة'}</button></div></div>
    <div class="picker">${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}${inner}</div>
    <div class="foot"><span>${toAr(fmtDate(todayISO()))}</span>${API.demo ? '<span class="demo-note">وضع التجربة: البيانات تُحفظ على هذا الجهاز فقط حتى يُربط الموقع بقاعدة البيانات.</span>' : ''}</div></div>`;
  app().querySelector('[data-go=board]').onclick = () => board();
  app().querySelector('[data-go=admin]').onclick = () => admin();
}
function home() {
  if (S.lesson && S.lesson.present) exitPresent();
  Player.stop(true); S.lesson = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const last = store.get('iqra-last', null);
  frame(`<h2>أهلاً بكِ.. اختاري القسم</h2>
    ${last ? `<button class="btn primary" data-last style="justify-self:start;font-size:1.15rem;min-height:54px">متابعة صف ${esc(sectionName(last))}</button>` : ''}
    <div class="choice-grid two">
      <button class="choice big" data-d="basic"><b>القسم الأساسي</b><small>من الروضة إلى الصف الخامس</small></button>
      <button class="choice big" data-d="sec"><b>القسم الثانوي</b><small>من الصف السادس إلى التوجيهي</small></button>
    </div>`);
  app().querySelectorAll('[data-d]').forEach(b => b.onclick = () => grades(b.dataset.d));
  const lb = app().querySelector('[data-last]'); if (lb) lb.onclick = () => go(last);
}
function grades(dept) {
  const gs = GRADES.filter(g => g.dept === dept);
  frame(`<h2>اختاري الصف</h2><div class="choice-grid">${gs.map(g => {
    const has = entries(g.id).length;
    return `<button class="choice" data-g="${g.id}">${g.free ? '<span class="tag">قراءة حرة</span>' : has ? '' : '<span class="tag">لا توجد خطة بعد</span>'}<b>${esc(g.name)}</b><small>${g.id === 'KG' ? '' : 'الصف'}</small></button>`;
  }).join('')}</div>`, `<button data-h>الرئيسية</button> › <span>${dept === 'basic' ? 'القسم الأساسي' : 'القسم الثانوي'}</span>`);
  app().querySelectorAll('[data-g]').forEach(b => b.onclick = () => sections(b.dataset.g));
  app().querySelector('[data-h]').onclick = home;
}
function sections(grade) {
  const g = gradeOf(grade);
  frame(`<h2>${esc(g.name)}.. اختاري الشعبة</h2><div class="choice-grid">${LETTERS.map(l => `<button class="choice section" data-s="${grade}-${l}"><b>${l}</b><small>شعبة ${l}</small></button>`).join('')}</div>`,
    `<button data-h>الرئيسية</button> › <button data-d>${g.dept === 'basic' ? 'القسم الأساسي' : 'القسم الثانوي'}</button> › <span>${esc(g.name)}</span>`);
  app().querySelectorAll('[data-s]').forEach(b => b.onclick = () => go(b.dataset.s));
  app().querySelector('[data-h]').onclick = home;
  app().querySelector('[data-d]').onclick = () => grades(g.dept);
}

/* ---------- lesson ---------- */
function openLesson(sectionId) {
  store.set('iqra-last', sectionId);
  if (S.lesson && S.lesson.present) exitPresent();
  const grade = sectionId.split('-')[0];
  setGradeRules(gradeRules(grade));
  const list = entries(grade);
  const free = !!gradeOf(grade).free || !list.length;
  S.lesson = {
    sectionId, grade, free, idx: free ? -1 : startIndex(sectionId), freePage: store.get('iqra-free-' + grade, 1),
    part: -1, pages: [], pi: 0, portion: null, keys: [],
    tajweed: store.get('iqra-tj', false), gharib: store.get('iqra-gh', true), showAll: false,
    pen: null, tool: 'hl', hl: {}, sel: null, tab: 'tafsir', zoom: 1, seq: 0, page: null,
    present: false, lines: store.get('iqra-present-lines', 6),
  };
  renderLesson();
}
function curEntry() { const L = S.lesson; return L.free ? null : entries(L.grade)[L.idx]; }

function computePortion() {
  const L = S.lesson;
  const list = entries(L.grade);
  L.parts = []; L.actual = false; L.resume = null;
  if (L.free) { L.segs = null; }
  else {
    const e = list[L.idx];
    L.segs = entrySegs(list, L.idx);
    if (e && SCORED.includes(e.type)) {
      const act = !(e.segs && e.segs.length) && actualParts(L.sectionId, list, L.idx);
      if (act) { L.parts = act; L.actual = true; L.segs = act.flatMap(p => p.segs); }
      else L.parts = weekParts(list, L.idx);
    }
    if (L.part >= 0 && L.parts[L.part]) L.segs = L.parts[L.part].segs;
    // a partly-read segment continues from the next ayah
    const pr = isNewDay(e) && progOf(L.sectionId, e.id);
    if (pr && pr.status === 'partial' && pr.upto) {
      const rest = segsAfter(e.segs, pr.upto);
      if (rest.length && rest !== e.segs) { L.segs = rest; L.resume = pr.upto; }
    }
  }
  if (L.segs) {
    L.keys = Q.keysOf(L.segs);
    L.portion = new Set(L.keys);
    L.pages = Q.pagesOf(L.segs);
  } else {
    L.portion = null; L.keys = [];
    L.pages = [L.freePage];
  }
  L.pi = Math.min(L.pi, L.pages.length - 1);
  if (L.pi < 0) L.pi = 0;
}

function renderLesson() {
  const L = S.lesson;
  computePortion();
  const g = gradeOf(L.grade);
  const e = curEntry();
  const list = entries(L.grade);
  const canScore = !g.noCompetition && e && SCORED.includes(e.type);
  const st = L.free ? null : sectionStatus(L.sectionId);
  const pr = !L.free && isNewDay(e) ? progOf(L.sectionId, e.id) : null;
  const doneBtn = !L.free && isNewDay(e)
    ? (pr && pr.status === 'done' ? `<button class="btn prog-done" data-a="prog">✓ أنهينا هذا المقطع</button>`
      : pr ? `<button class="btn prog-part" data-a="prog">وصلنا إلى الآية ${toAr(pr.upto.split(':')[1])}</button>`
      : `<button class="btn primary" data-a="prog">أنهينا مقطع اليوم ✓</button>`) : '';
  const ti = todayIndex(list);
  const lagBar = st && st.lag > 0
    ? `<div class="lagbar" role="status"><b>متأخرات ${lagWords(st.lag)} عن الخطة</b>
        ${st.pos >= 0 && L.idx !== st.pos ? '<button class="btn sm" data-a="pos">الانتقال إلى موضع الشعبة</button>' : ''}
        ${L.idx !== ti ? '<button class="btn sm" data-a="today">الانتقال إلى مقطع اليوم</button>' : ''}</div>` : '';
  const when = L.free
    ? `<div class="daynav"><label class="muted" for="sura-pick">السورة</label><select id="sura-pick" class="btn sm">${Q.meta.suras.map(s => `<option value="${s.n}">${toAr(s.n)}. ${esc(s.name)}</option>`).join('')}</select>
       <label class="muted" for="page-pick">الصفحة</label><input id="page-pick" class="btn sm num" type="number" min="1" max="604" value="${L.freePage}" style="width:6em"></div>`
    : `<div class="daynav"><button class="btn ghost" data-a="prev" aria-label="اليوم السابق" ${L.idx <= 0 ? 'disabled' : ''}>${arrow('r')}</button>
       <div class="when"><b>${e ? `<span class="type-badge t-${e.type}">${TYPE_NAMES[e.type] || ''}</span>${esc(e.segs && e.segs.length ? Q.segLabel(e.segs) : e.label || '')}` : 'لا توجد خطة'}</b>
       <span>${e ? (e.date ? fmtDate(e.date) : esc((e.day || '') + ' ' + (e.dateText || ''))) : ''}${e && e.date === todayISO() ? ' · اليوم' : ''}${L.resume ? ` · نكمل من الآية ${toAr(+L.resume.split(':')[1] + 1)}` : ''}</span></div>
       <button class="btn ghost" data-a="next" aria-label="اليوم التالي" ${L.idx >= list.length - 1 ? 'disabled' : ''}>${arrow('l')}</button>
       <button class="btn sm" data-a="today">اليوم</button></div>`;
  app().innerHTML = `<div class="lesson">
    <div class="bar">
      <div class="who">${logoSVG()}<span class="chip">${esc(sectionName(L.sectionId))}</span></div>
      ${portalNav(L.sectionId, 'quran')}
      ${when}
      <div class="actions">
        ${doneBtn}${canScore ? `<button class="btn gold" data-a="errors">${ico('pen')}تسجيل الأخطاء</button>` : ''}
        <button class="btn" data-a="present" title="المصحف وحده بخط كبير على الشاشة">🖥️ وضع العرض</button>
        <div class="dd end"><button class="btn ${e && SCORED.includes(e.type) ? 'gold' : 'primary'}" data-dd aria-haspopup="true" aria-expanded="false">${ico('spark')}الأنشطة ▾</button>
          <div class="dd-menu" role="menu" hidden>
            <button role="menuitem" data-a="games">${ico('spark')}التحديات</button>
            <button role="menuitem" data-a="strat">${ico('dice')}استراتيجيات الحصة</button>
            <button role="menuitem" data-a="who">${ico('wheel')}مَن تقرأ؟</button>
          </div></div>
        <div class="dd end"><button class="btn" data-dd aria-haspopup="true" aria-expanded="false" aria-label="المزيد">⋯</button>
          <div class="dd-menu" role="menu" hidden>
            ${g.noCompetition ? '' : `<button role="menuitem" data-a="board">${ico('trophy')}الترتيب</button>`}
            <button role="menuitem" data-a="home">تغيير الصف</button>
          </div></div>
      </div>
      ${lagBar}
    </div>
    <div class="stage">
      <div class="reader">
        <div class="tools">
          <div class="dd btn-split"><button class="btn primary" data-a="play" id="play-btn">${ico('play')}استماع</button><button class="btn primary dd-caret" data-dd aria-haspopup="true" aria-expanded="false" aria-label="القارئ والسرعة والتكرار"><span class="rate-badge" ${Player.rate === 1 ? 'hidden' : ''}>${rateLabel(Player.rate)}</span>▾</button>
            <div class="dd-menu dd-form" hidden>
              <label for="reciter">القارئ</label><select id="reciter">${RECITERS.map(r => `<option value="${r.id}" ${r.id === Player.reciter ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
              <span class="dd-lbl">سرعة التلاوة</span><div class="rate-seg" role="group" aria-label="سرعة التلاوة">${RATES.map(r => `<button class="${r === Player.rate ? 'on' : ''}" data-rate="${r}" aria-pressed="${r === Player.rate}">${rateLabel(r)}</button>`).join('')}</div>
              <label for="repeat">تكرار الآية</label><select id="repeat"><option value="1">بدون تكرار</option><option value="2">تكرار الآية ×٢</option><option value="3">تكرار الآية ×٣</option></select>
              <button class="btn" data-a="stop">${ico('stop')}إيقاف التلاوة</button>
            </div></div>
          <div class="dd"><button class="btn" data-dd aria-haspopup="true" aria-expanded="false">👁️ العرض ▾</button>
            <div class="dd-menu" role="menu" hidden>
              <button role="menuitemcheckbox" class="${L.tajweed ? 'on' : ''}" aria-checked="${L.tajweed}" data-a="tj"><span class="chk"></span>ألوان التجويد</button>
              <button role="menuitemcheckbox" class="${L.gharib ? 'on' : ''}" aria-checked="${L.gharib}" data-a="gh" data-keep><span class="chk"></span>الكلمات الصعبة</button>
              ${L.portion ? `<button role="menuitemcheckbox" class="${L.showAll ? 'on' : ''}" aria-checked="${L.showAll}" data-a="all" data-keep><span class="chk"></span>الصفحة كاملة</button>` : ''}
            </div></div>
          <button class="btn ${L.pen ? 'on' : ''}" id="tl-edit" aria-pressed="${!!L.pen}">✏️ أدوات التعليم</button>
          <span class="tl-tray" id="tl-tray" ${L.pen ? '' : 'hidden'}>${toolsHTML()}<button class="btn sm ghost" data-a="clearhl">🧽 مسح</button></span>
        </div>
        <div class="page-wrap" id="page-wrap" tabindex="-1">
          <div class="segtabs" id="segtabs"></div>
          <div id="mushaf-host" style="display:grid;justify-items:center"></div>
          <div class="pagenav" id="pagenav"></div>
        </div>
      </div>
      <aside class="side">
        <div class="tabs" role="tablist">${[['tafsir', 'التفسير'], ['rules', 'الأحكام'], ['meanings', 'معاني الكلمات'], ['lessons', 'دروس وعبر'], ['story', 'قصة وسبب نزول']].map(([k, n]) => `<button class="tab ${L.tab === k ? 'on' : ''}" data-tab="${k}" role="tab">${n}</button>`).join('')}</div>
        <div class="panel" id="panel"></div>
      </aside>
    </div></div>`;
  wireLesson();
  if (L.present) app().querySelector('.lesson').classList.add('presenting');
  if (L.free) { $('#sura-pick').value = String(firstSuraOnPage(L.freePage)); }
  $('#repeat').value = String(Player.repeat);
  renderSegTabs();
  showPage();
}
function firstSuraOnPage(p) { let n = 1; Q.meta.suras.forEach(s => { if (s.page <= p) n = s.n; }); return n; }
function arrow(dir) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${dir === 'r' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function ico(n) {
  const p = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    spark: '<path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7z" fill="currentColor"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="15" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="15" r="1.5" fill="currentColor"/>',
    wheel: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
    trophy: '<path d="M7 4h10v4a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 13v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  }[n];
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}

function wireLesson() {
  const L = S.lesson;
  const act = {
    prev() { if (L.idx > 0) { L.idx--; resetEntry(); } },
    next() { if (L.idx < entries(L.grade).length - 1) { L.idx++; resetEntry(); } },
    today() { L.idx = todayIndex(entries(L.grade)); resetEntry(); },
    pos() { const p = sectionStatus(L.sectionId).pos; if (p >= 0) { L.idx = p; resetEntry(); } },
    prog() { openProgress(); },
    who() { openPicker(L.sectionId); },
    games() { openGames(); },
    strat() { openStrategies(); },
    errors() { openErrors(L.sectionId, curEntry()?.id); },
    board() { board(L.grade); },
    home() { Player.stop(true); home(); },
    play() {
      if (Player.playing) { Player.pause(); setPlayBtn(false); return; }
      if (Player.audio && Player.queue.length && Player.audio.paused && Player.idx >= 0) { Player.resume(); setPlayBtn(true); return; }
      const keys = L.portion ? L.keys : pageKeys();
      const start = L.sel && keys.includes(L.sel) ? L.sel : keys[0];
      Player.play(keys, start); setPlayBtn(true);
    },
    stop() { Player.stop(); },
    tj() { L.tajweed = !L.tajweed; store.set('iqra-tj', L.tajweed); renderLessonKeepPage(); },
    gh() { L.gharib = !L.gharib; store.set('iqra-gh', L.gharib); const b = $('[data-a=gh]'); b.classList.toggle('on', L.gharib); b.setAttribute('aria-checked', L.gharib); L.page && L.page.el.classList.toggle('no-gh', !L.gharib); },
    all() { L.showAll = !L.showAll; const b = $('[data-a=all]'); b.classList.toggle('on', L.showAll); b.setAttribute('aria-checked', L.showAll); L.page && L.page.el.classList.toggle('showall', L.showAll); },
    clearhl() { clearMarks(); },
    present() { enterPresent(); },
    zin() { L.zoom = Math.min(2.2, L.zoom + 0.15); fit(); },
    zout() { L.zoom = Math.max(0.6, L.zoom - 0.15); fit(); },
    fs() { const el = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen && el.requestFullscreen())?.catch?.(() => toast('ملء الشاشة غير متاح هنا')); },
  };
  app().querySelectorAll('[data-a]').forEach(b => { if (act[b.dataset.a]) b.onclick = act[b.dataset.a]; });
  wireTools(app());
  wireMenus(app());
  // ✏️ teaching tools: on with the last tool (highlight by default) in yellow, off again with a second tap
  $('#tl-edit').onclick = () => { L.pen = L.pen ? null : 'y'; syncTools(); };
  app().querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { L.tab = b.dataset.tab; app().querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderPanel(); });
  $('#reciter').onchange = e => { Player.reciter = e.target.value; store.set('iqra-reciter', Player.reciter); if (Player.playing) { const k = Player.queue[Player.idx]?.key; Player.play(Player.queue.filter(x => !x.basmala).map(x => x.key), k); } };
  $('#repeat').onchange = e => { Player.repeat = +e.target.value; };
  app().querySelectorAll('[data-rate]').forEach(b => b.onclick = () => setRate(+b.dataset.rate));
  if (L.free) {
    $('#sura-pick').onchange = e => { const s = Q.sura(+e.target.value); L.freePage = s.page; afterFreePage(); };
    $('#page-pick').onchange = e => { L.freePage = Math.max(1, Math.min(604, +e.target.value || 1)); afterFreePage(); };
  }
  Player.onAyah = key => markPlaying(key);
  Player.onStop = () => { markPlaying(null); setPlayBtn(false); };
  window.onresize = () => fit();
}
function afterFreePage() { const L = S.lesson; store.set('iqra-free-' + L.grade, L.freePage); L.pages = [L.freePage]; L.pi = 0; L.hl = {}; L.sel = null; if ($('#page-pick')) $('#page-pick').value = L.freePage; if ($('#sura-pick')) $('#sura-pick').value = firstSuraOnPage(L.freePage); showPage(); }
function resetEntry() { Player.stop(true); const L = S.lesson; L.part = -1; L.pi = 0; L.hl = {}; L.sel = null; renderLesson(); }
function renderLessonKeepPage() { const L = S.lesson; const pi = L.pi; renderLesson(); L.pi = pi; }
function pageKeys() { const L = S.lesson; return L.page ? [...new Set(L.page.tokens.filter(t => t.kind === 'w').map(t => t.key))] : []; }
function setPlayBtn(on) { const b = $('#play-btn'); if (b) b.innerHTML = on ? ico('pause') + 'إيقاف مؤقت' : ico('play') + 'استماع'; syncPlay(); }

function renderSegTabs() {
  const L = S.lesson;
  const host = $('#segtabs');
  if (!L.parts || !L.parts.length) { host.innerHTML = ''; return; }
  host.innerHTML = (L.actual ? '<span class="chip" title="الشعبة متأخرة عن الخطة، فالصفحات مما قرأته فعلاً هذا الأسبوع">مما قرأته الشعبة فعلاً</span>' : '') +
    `<button class="btn sm ${L.part < 0 ? 'on' : ''}" data-p="-1">صفحات الأسبوع كاملة</button>` +
    L.parts.map((p, i) => `<button class="btn sm ${L.part === i ? 'on' : ''}" data-p="${i}">${esc(WEEKDAYS[parseISO(p.date)?.getDay()] || p.day || '')}: ${esc(Q.segLabel(p.segs))}${p.partial ? ' (جزء)' : ''}</button>`).join('');
  host.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { L.part = +b.dataset.p; L.pi = 0; computePortion(); renderSegTabs(); showPage(); });
}

async function showPage() {
  const L = S.lesson;
  const seq = ++L.seq;
  const host = $('#mushaf-host');
  const pageNo = L.pages[L.pi];
  const nav = $('#pagenav');
  if (!pageNo) {
    const e = curEntry();
    host.innerHTML = `<div class="card" style="max-width:520px;text-align:center"><h3>${esc(e ? (TYPE_NAMES[e.type] || '') : '')}</h3><p>${esc(e ? (e.label || '') : 'لا توجد خطة لهذا الصف بعد.')}</p>
      <p class="muted">لا توجد صفحة محددة لهذا اليوم. يمكنكِ الانتقال إلى يوم آخر من الأسهم في الأعلى.</p></div>`;
    nav.innerHTML = ''; L.page = null; renderPanel(); return;
  }
  host.innerHTML = '<div class="muted" style="padding:40px">جارٍ تحميل الصفحة…</div>';
  let page;
  try { page = await renderMushafPage(document.createElement('div'), pageNo, { portion: L.portion, tajweed: L.tajweed }); }
  catch (e) { host.innerHTML = '<div class="card">تعذّر تحميل صفحة المصحف. تأكدي من الاتصال ثم أعيدي المحاولة.</div>'; return; }
  if (seq !== L.seq || !host.isConnected) return;
  host.replaceChildren(page.el);
  L.page = page;
  page.el.classList.toggle('no-gh', !L.gharib);
  page.el.classList.toggle('showall', L.showAll);
  page.el.classList.toggle('pen-mode', !!L.pen);
  wireMarking(page.el);
  if (!L.sel || !page.tokens.some(t => t.key === L.sel)) L.sel = (L.keys.find(k => page.tokens.some(t => t.key === k))) || page.tokens.find(t => t.kind === 'w')?.key || null;
  markSelected();
  page.el.onclick = ev => onWordClick(ev);
  if (L.pages.length > 1 || L.free) {
    const prevOk = L.free ? L.freePage > 1 : L.pi > 0;
    const nextOk = L.free ? L.freePage < 604 : L.pi < L.pages.length - 1;
    nav.innerHTML = `<button class="btn" data-n="-1" ${prevOk ? '' : 'disabled'}>${arrow('r')}الصفحة السابقة</button><span class="pg num">${L.free ? 'صفحة ' + toAr(L.freePage) : `صفحة ${toAr(L.pi + 1)} من ${toAr(L.pages.length)}`}</span><button class="btn" data-n="1" ${nextOk ? '' : 'disabled'}>الصفحة التالية${arrow('l')}</button>`;
    nav.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      if (L.free) { L.freePage += +b.dataset.n; afterFreePage(); }
      else { L.pi += +b.dataset.n; showPage(); }
    });
  } else nav.innerHTML = '';
  fit();
  renderPanel();
  if (Player.playing) markPlaying(Player.queue[Player.idx]?.key);
}
function fit() {
  const L = S.lesson; if (!L || !L.page) return;
  const wrap = $('#page-wrap');
  if (!wrap || !L.page.el.isConnected) return;
  if (L.present) {
    presentFit(); renderMarks();
    // keep the ayah being read (or the selected one) where the eye is
    centerAyah((Player.playing && Player.queue[Player.idx]?.key) || L.sel, false);
    return;
  }
  wrap.style.paddingBottom = '';
  fitBoard(L, wrap); renderMarks();
}
function fitBoard(L, wrap) {
  const availW = wrap.clientWidth - 40;
  const narrow = window.innerWidth <= 1000;
  const availH = narrow ? 99999 : wrap.clientHeight - ($('#segtabs').offsetHeight + $('#pagenav').offsetHeight + 60);
  let w = Math.max(280, Math.min(availW, availH / 1.62) * L.zoom);
  fitMushaf(L.page.el, w);
  const h = L.page.el.offsetHeight;
  if (L.zoom === 1 && !narrow && h > availH + 4) { w = Math.max(280, w * availH / h); fitMushaf(L.page.el, w); }
}
function markSelected() {
  const L = S.lesson; if (!L.page) return;
  L.page.tokens.forEach(t => t.el.classList.toggle('sel-ayah', t.key === L.sel && t.kind !== 'hz'));
}
function markPlaying(key) {
  const L = S.lesson; if (!L || !L.page) return;
  L.page.tokens.forEach(t => t.el.classList.toggle('playing', !!key && t.key === key));
  // display mode follows the recitation: the ayah being read stays in the middle of the screen
  if (L.present && key && Player.playing && L.page.tokens.some(t => t.key === key)) centerAyah(key);
  syncPlay();
  if (key && !L.page.tokens.some(t => t.key === key) && !L.free) {
    const [s, a] = key.split(':').map(Number); const p = Q.pageOf(s, a); const i = L.pages.indexOf(p);
    if (i >= 0 && i !== L.pi) { L.pi = i; showPage(); }
  }
}
function onWordClick(ev) {
  const L = S.lesson;
  const el = ev.target.closest('.w, .end, .hz');
  if (!el || el.classList.contains('bs')) return;
  const tok = L.page.tokens[+el.dataset.t];
  if (!tok) return;
  if (L.pen) return; // a teaching tool is on: wireMarking() handles taps and drags
  L.sel = tok.key; markSelected(); renderPanel();
  wordPopover(tok, el);
}
async function wordPopover(tok, el) {
  closePop();
  const info = await Q.ayah(tok.key);
  const [s, a] = tok.key.split(':').map(Number);
  let body = '';
  if (tok.kind === 'w') {
    const idx = +tok.el.dataset.i;
    const gs = (info.g || []).filter(g => g.w.includes(idx));
    const rules = wordRules(tok.j).filter(r => r > 2);
    body += `<div class="qw">${tajweedHTML(tok.text, tok.j)}</div>`;
    if (gs.length) body += gs.map(g => `<div><b style="color:var(--gharib)">المعنى:</b> ${esc(cleanMeaning(g.m))}</div>`).join('');
    if (rules.length) body += `<div><b>الأحكام:</b> ${rules.map(r => `<span style="color:${RULES[r].color};font-weight:700">${RULES[r].name}</span>`).join('، ')}</div>`;
    if (!gs.length && !rules.length) body += `<div class="muted">لا يوجد حكم أو معنى خاص لهذه الكلمة.</div>`;
  } else body += `<div><b>سورة ${esc(Q.suraName(s))} – الآية ${toAr(a)}</b></div>`;
  body += `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm primary" data-pa>${ico('play')}استماع للآية</button><button class="btn sm" data-pt>تفسير الآية</button></div>`;
  const pop = document.createElement('div');
  pop.className = 'pop'; pop.id = 'pop';
  // display mode: a bigger window, in proportion to the mushaf's text on the screen
  if (S.lesson.present) { pop.classList.add('big'); pop.style.fontSize = Math.max(18, Math.min(34, parseFloat(S.lesson.page.el.style.fontSize || 24) * .36)) + 'px'; }
  pop.innerHTML = `<button class="btn sm ghost close" aria-label="إغلاق">✕</button>${body}`;
  document.body.appendChild(pop);
  const r = el.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let top = r.bottom + 8; if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 8);
  let left = r.left + r.width / 2 - pr.width / 2; left = Math.max(8, Math.min(innerWidth - pr.width - 8, left));
  pop.style.top = top + 'px'; pop.style.left = left + 'px';
  pop.querySelector('.close').onclick = closePop;
  pop.querySelector('[data-pa]').onclick = () => { Player.play([tok.key], tok.key); setPlayBtn(true); closePop(); };
  pop.querySelector('[data-pt]').onclick = () => { S.lesson.tab = 'tafsir'; app().querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === 'tafsir')); renderPanel(); closePop(); };
  setTimeout(() => document.addEventListener('pointerdown', outsidePop), 0);
}
function outsidePop(e) { const p = document.getElementById('pop'); if (p && !p.contains(e.target)) closePop(); }
function closePop() { document.getElementById('pop')?.remove(); document.removeEventListener('pointerdown', outsidePop); }

/* ---------- side panel ---------- */
async function renderPanel() {
  const L = S.lesson; const panel = $('#panel'); if (!panel) return;
  const tab = L.tab, seq = L.seq, sel = L.sel;
  const keys = L.portion ? L.keys : pageKeys();
  let html = '';
  try {
    if (tab === 'tafsir') html = await panelTafsir(sel, keys);
    else if (tab === 'rules') html = await panelRules(sel);
    else if (tab === 'meanings') html = await panelMeanings(keys);
    else if (tab === 'lessons') html = await panelLessons(keys);
    else if (tab === 'story') html = panelStory();
  } catch (e) { html = '<p class="muted">تعذّر تحميل المحتوى.</p>'; }
  if (seq !== L.seq || tab !== L.tab || sel !== L.sel) return;
  panel.innerHTML = html;
  panel.querySelectorAll('[data-go-ayah]').forEach(b => b.onclick = () => { L.sel = b.dataset.goAyah; gotoAyah(L.sel); });
  panel.querySelectorAll('[data-flash]').forEach(b => b.onclick = () => flashWords(b.dataset.flash));
  const ed = panel.querySelector('[data-edit-note]');
  if (ed) ed.onclick = () => { if (!S.admin) { adminLoginModal(() => renderPanel()); } else editNote(); };
}
function gotoAyah(key) {
  const L = S.lesson; const [s, a] = key.split(':').map(Number); const p = Q.pageOf(s, a);
  if (L.free) { if (p !== L.freePage) { L.freePage = p; afterFreePage(); L.sel = key; return; } }
  else { const i = L.pages.indexOf(p); if (i >= 0 && i !== L.pi) { L.pi = i; L.sel = key; showPage(); return; } }
  markSelected(); renderPanel();
}
async function panelTafsir(sel, keys) {
  if (!sel) return '<p class="muted">اضغطي على أي آية في المصحف لعرض تفسيرها.</p>';
  const [s, a] = sel.split(':').map(Number);
  const info = await Q.ayah(sel);
  const words = await Q.ayahWords(sel);
  const i = keys.indexOf(sel);
  return `<h3>سورة ${esc(Q.suraName(s))} – الآية ${toAr(a)}</h3><div class="qref">${esc(Q.ayahText(words))}</div>
    <p style="margin:0">${esc(info.f || '')}</p><p class="muted" style="margin:0;font-size:.85rem">المصدر: التفسير الميسّر – مجمع الملك فهد لطباعة المصحف الشريف</p>
    <div style="display:flex;justify-content:space-between;gap:8px"><button class="btn sm" ${i > 0 ? `data-go-ayah="${keys[i - 1]}"` : 'disabled'}>${arrow('r')}الآية السابقة</button><button class="btn sm" ${i >= 0 && i < keys.length - 1 ? `data-go-ayah="${keys[i + 1]}"` : 'disabled'}>الآية التالية${arrow('l')}</button></div>`;
}
async function panelRules(sel) {
  const legend = `<div class="legend">${TEACH_RULES.filter(r => r > 2).map(r => `<span><i style="background:${RULES[r].color}"></i>${RULES[r].name}</span>`).join('')}${ruleOn(0) ? '<span><i style="background:#9a9a9a"></i>لا يُنطق</span>' : ''}</div>`;
  if (!sel) return '<p class="muted">اضغطي على أي آية لعرض أحكامها.</p>' + legend;
  const [s, a] = sel.split(':').map(Number);
  const words = await Q.ayahWords(sel);
  const by = {};
  words.forEach(w => wordRules(w.j).forEach(r => { (by[r] = by[r] || []).push(w); }));
  const order = RULE_PRIORITY.filter(r => by[r]);
  const rows = order.map(r => `<div class="rule-row"><span class="rule-dot" style="background:${RULES[r].color}"></span><b>${RULES[r].name}</b>
    <div class="words">${by[r].map(w => `<span>${tajweedHTML(w.t, w.j, r)}</span>`).join('')}</div><p>${esc(RULES[r].desc)}</p></div>`).join('');
  return `<h3>أحكام الآية ${toAr(a)} من سورة ${esc(Q.suraName(s))}</h3>${rows || `<p class="muted">${ALLOWED_RULES ? 'لا توجد في هذه الآية أحكام من الأحكام المقرّرة لهذا الصف.' : 'لا توجد أحكام مميزة في هذه الآية.'}</p>`}
    <p class="muted" style="font-size:.85rem;margin:0">فعّلي «ألوان التجويد» لتلوين الأحكام في الصفحة كلها.</p>${legend}`;
}
async function panelMeanings(keys) {
  const rows = [];
  for (const k of keys) {
    const info = await Q.ayah(k); const words = await Q.ayahWords(k);
    (info.g || []).forEach(g => { if (g.w.length) rows.push({ k, w: g.w.map(i => words[i]?.t).filter(Boolean).join(' '), m: cleanMeaning(g.m), idx: g.w }); });
  }
  if (!rows.length) return '<p class="muted">لا توجد كلمات غريبة في هذا المقطع.</p>';
  return `<h3>ركّزي على هذه الكلمات</h3><p class="muted" style="margin:0">اضغطي على الكلمة لتظهر في المصحف.</p>` + rows.map(r => `<div class="mean-row" data-flash="${r.k}|${r.idx.join(',')}"><span class="qw">${esc(r.w)}</span><span>${esc(r.m)}</span><span class="muted" style="font-size:.8rem">${esc(Q.suraName(+r.k.split(':')[0]))} ${toAr(r.k.split(':')[1])}</span></div>`).join('') +
    `<p class="muted" style="font-size:.85rem;margin:0">المصدر: كتاب «الميسّر في غريب القرآن الكريم»</p>`;
}
function flashWords(spec) {
  const L = S.lesson; const [key, idxs] = spec.split('|'); const set = idxs.split(',');
  const [s, a] = key.split(':').map(Number); const p = Q.pageOf(s, a);
  const run = () => L.page.tokens.forEach(t => { if (t.key === key && t.kind === 'w' && set.includes(t.el.dataset.i)) { t.el.classList.remove('flash'); void t.el.offsetWidth; t.el.classList.add('flash'); t.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
  if (L.pages[L.pi] === p || (L.free && L.freePage === p)) run();
  else { const i = L.pages.indexOf(p); if (i >= 0) { L.pi = i; showPage().then(run); } }
}
async function panelLessons(keys) {
  const seen = new Set(); let tw = [], am = [];
  for (const k of keys) { const info = await Q.ayah(k); if (info.tad && !seen.has(info.d)) { seen.add(info.d); tw = tw.concat(info.tad.tawjihat || []); am = am.concat(info.tad.amal || []); } }
  tw = [...new Set(tw)]; am = [...new Set(am)];
  if (!tw.length && !am.length) return '<p class="muted">لا توجد دروس محفوظة لهذا المقطع.</p>';
  return `${tw.length ? `<h3>دروس وتوجيهات</h3><ol class="lesson-list">${tw.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    ${am.length ? `<h3>كيف نعمل بالآيات؟</h3><ol class="lesson-list">${am.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    <p class="muted" style="font-size:.85rem;margin:0">المصدر: كتاب «تدبّر وعمل» – مركز تدبّر. الدروس مكتوبة لصفحات المصحف كاملة، فقد تشمل آيات قبل مقطع اليوم أو بعده.</p>`;
}
function panelStory() {
  const L = S.lesson; const p = L.pages[L.pi];
  const text = S.notes['p' + p];
  return `<h3>قصة الصفحة ${toAr(p || '')} وسبب النزول</h3>${text ? `<div class="note-box">${esc(text)}</div>` : '<p class="muted">لم تُضف قصة أو سبب نزول لهذه الصفحة بعد.</p>'}
    <button class="btn sm" data-edit-note>${S.admin ? (text ? 'تعديل النص' : 'إضافة قصة أو سبب نزول') : 'إضافة (للمديرة)'}</button>`;
}
function editNote() {
  const L = S.lesson; const p = L.pages[L.pi]; const key = 'p' + p;
  const panel = $('#panel');
  panel.innerHTML = `<h3>قصة الصفحة ${toAr(p)} وسبب النزول</h3><div class="field"><label for="note-ta">اكتبي القصة أو سبب النزول من مصدر موثوق، واذكري المصدر في آخر النص.</label><textarea id="note-ta">${esc(S.notes[key] || '')}</textarea></div>
    <div style="display:flex;gap:8px"><button class="btn primary" data-s>حفظ</button><button class="btn" data-c>إلغاء</button></div>`;
  panel.querySelector('[data-c]').onclick = () => renderPanel();
  panel.querySelector('[data-s]').onclick = async () => {
    const text = $('#note-ta').value.trim();
    try { await API.call('saveNote', { cred: S.admin, key, text }); if (text) S.notes[key] = text; else delete S.notes[key]; toast('تم الحفظ'); renderPanel(); }
    catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
  };
}

/* ---------- games ---------- */
async function openGames() {
  const L = S.lesson;
  const keys = L.portion ? L.keys : pageKeys();
  if (!keys.length) { toast('لا توجد آيات لهذا اليوم'); return; }
  Player.stop();
  const ov = document.createElement('div');
  ov.className = 'games';
  ov.innerHTML = `<div class="bar"><div class="who">${logoSVG()}<span class="chip">تحديات ${esc(sectionName(L.sectionId))}</span></div><div class="daynav"><div class="when"><b>${esc(Q.segLabel(L.segs) || 'صفحة ' + toAr(L.pages[L.pi]))}</b></div></div><div class="actions"><button class="btn" data-x>العودة إلى المصحف</button></div></div><div class="gbody"><div class="muted">جارٍ تجهيز التحديات…</div></div>`;
  app().appendChild(ov);
  ov.querySelector('[data-x]').onclick = () => ov.remove();
  const P = await gatherPortion(keys);
  Games.mount(ov.querySelector('.gbody'), P);
}

async function openStrategies() {
  const L = S.lesson;
  const keys = L.portion ? L.keys : pageKeys();
  if (!keys.length) { toast('لا توجد آيات لهذا اليوم'); return; }
  Player.stop();
  const label = Q.segLabel(L.segs) || 'صفحة ' + toAr(L.pages[L.pi]);
  const ov = document.createElement('div');
  ov.className = 'games';
  ov.innerHTML = `<div class="bar"><div class="who">${logoSVG()}<span class="chip">استراتيجيات ${esc(sectionName(L.sectionId))}</span></div><div class="daynav"><div class="when"><b>${esc(label)}</b></div></div><div class="actions"><button class="btn" data-who>${ico('wheel')}مَن تجيب؟</button><button class="btn" data-x>العودة إلى المصحف</button></div></div><div class="gbody"></div>`;
  app().appendChild(ov);
  ov.querySelector('[data-who]').onclick = () => openPicker(L.sectionId, 'مَن تجيب؟');
  ov.querySelector('[data-x]').onclick = () => { document.querySelectorAll('.qcard-ov').forEach(x => x.remove()); ov.remove(); };
  Strat.mount(ov.querySelector('.gbody'), keys, label);
}

/* ---------- auth ---------- */
function modal(html, cls = '') {
  closeModal();
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'modal';
  ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener('pointerdown', e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  ov.querySelector('[data-close]')?.addEventListener('click', closeModal);
  return ov;
}
function closeModal() { document.getElementById('modal')?.remove(); }
function adminLoginModal(after) {
  const ov = modal(`<header><h2>دخول المديرة</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
    <form id="adm-f" class="field"><label for="adm-pw">كلمة مرور الإدارة</label><input id="adm-pw" type="password" autocomplete="current-password" required>
    <div class="err-msg" id="adm-err" hidden></div><button class="btn primary" type="submit">دخول</button></form>${API.demo ? '<p class="muted" style="margin:0">في وضع التجربة كلمة المرور: 1234</p>' : ''}`);
  $('#adm-pw', ov).focus();
  $('#adm-f', ov).onsubmit = async e => {
    e.preventDefault();
    const cred = { role: 'admin', pw: $('#adm-pw', ov).value };
    try { await API.call('login', { cred }); S.admin = cred; store.sset('iqra-admin', cred); closeModal(); toast('تم تسجيل الدخول'); after && after(); }
    catch (err) { const m = $('#adm-err', ov); m.hidden = false; m.textContent = err.userMessage || 'تعذّر الدخول'; }
  };
}

/* ---------- «أنهينا» progress ---------- */
function openProgress() {
  const L = S.lesson; const e = curEntry();
  if (!isNewDay(e)) return;
  const sectionId = L.sectionId;
  const pr = progOf(sectionId, e.id);
  const keys = Q.keysOf(e.segs);
  const needLogin = !S.admin && !S.sec[sectionId];
  const ov = modal(`<header><h2>${esc(Q.segLabel(e.segs))}</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
    ${pr ? `<p class="muted" style="margin:0">المسجّل الآن: <b>${pr.status === 'done' ? 'أنهينا المقطع كاملاً' : 'وصلنا إلى الآية ' + toAr(pr.upto.split(':')[1])}</b></p>` : ''}
    <button class="btn primary" id="p-done" style="min-height:58px;font-size:1.2rem">أنهينا المقطع كاملاً ✓</button>
    ${keys.length > 1 ? `<div class="field"><label for="p-upto">أو: وصلنا إلى الآية…</label>
      <div style="display:flex;gap:8px"><select id="p-upto" style="flex:1;min-height:50px">${keys.slice(0, -1).map(k => `<option value="${k}" ${pr && pr.upto === k ? 'selected' : ''}>${esc(Q.suraName(+k.split(':')[0]))} ${toAr(k.split(':')[1])}</option>`).join('')}</select>
      <button class="btn gold" id="p-part" style="min-height:50px">حفظ</button></div></div>` : ''}
    ${needLogin ? `<div class="field"><label for="p-pw">كلمة مرور شعبة ${esc(sectionName(sectionId))}</label><input id="p-pw" type="password" inputmode="numeric" autocomplete="off">${API.demo ? '<span class="muted">في وضع التجربة: 1111</span>' : ''}</div>` : ''}
    <div class="err-msg" id="p-err" hidden></div>
    ${pr ? '<button class="btn danger" id="p-undo">إلغاء التسجيل (ضُغط بالخطأ)</button>' : ''}`);
  // show the opening words of each ayah in the list
  const sel = $('#p-upto', ov);
  if (sel) [...sel.options].forEach(async o => {
    try { const w = await Q.ayahWords(o.value); if (w.length) o.textContent += ': ' + Q.ayahText(w.slice(0, 4)) + '…'; } catch (err) { /* label stays short */ }
  });
  const cred = () => S.admin || S.sec[sectionId] || { role: 'section', id: sectionId, pw: $('#p-pw', ov)?.value || '' };
  const run = async (btn, fn) => {
    const c = cred(); btn.disabled = true;
    try {
      await fn(c);
      if (c.role === 'section') { S.sec[sectionId] = c; store.sset('iqra-sec', S.sec); }
      closeModal(); return true;
    } catch (err) { const m = $('#p-err', ov); m.hidden = false; m.textContent = err.userMessage || 'تعذّر الحفظ'; btn.disabled = false; return false; }
  };
  const put = rec => { S.progress = (S.progress || []).filter(r => !(r.section === rec.section && r.entryId === rec.entryId)); S.progress.push(rec); };
  $('#p-done', ov).onclick = async e2 => {
    const ok = await run(e2.currentTarget, async c => { const res = await API.call('saveProgress', { cred: c, rec: { section: sectionId, entryId: e.id, status: 'done' } }); put(res.rec); });
    if (!ok) return;
    const st = sectionStatus(sectionId);
    if (st.lag > 0 && st.pos >= 0 && st.pos !== L.idx) { L.idx = st.pos; toast('أحسنتنّ! هذا المقطع التالي'); }
    else toast('أحسنتنّ! سُجّل إنهاء المقطع');
    resetEntry();
  };
  if (sel) $('#p-part', ov).onclick = async e2 => {
    const ok = await run(e2.currentTarget, async c => { const res = await API.call('saveProgress', { cred: c, rec: { section: sectionId, entryId: e.id, status: 'partial', upto: sel.value } }); put(res.rec); });
    if (ok) { toast('سُجّل: وصلنا إلى الآية ' + toAr(sel.value.split(':')[1])); resetEntry(); }
  };
  if (pr) $('#p-undo', ov).onclick = async e2 => {
    const ok = await run(e2.currentTarget, async c => { await API.call('deleteProgress', { cred: c, section: sectionId, entryId: e.id }); S.progress = S.progress.filter(r => !(r.section === sectionId && r.entryId === e.id)); });
    if (ok) { toast('أُلغي التسجيل'); resetEntry(); }
  };
}

/* ---------- error registration ---------- */
function openErrors(sectionId, entryId) {
  const grade = sectionId.split('-')[0];
  const t = todayISO();
  const list = scoredEntries(grade).filter(e => !e.date || e.date <= t);
  if (!list.length) { toast('لا توجد أيام قراءة جماعية أو سبر حتى الآن'); return; }
  let chosen = list.find(e => e.id === entryId) || list.find(e => !recOf(sectionId, e.id)) || list[list.length - 1];
  const needLogin = !S.admin && !S.sec[sectionId];
  const ov = modal(`<header><h2>تسجيل أخطاء ${esc(sectionName(sectionId))}</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
    <div class="field"><label>اليوم</label><div class="day-list" id="days"></div></div>
    <div class="stepper"><button type="button" data-d="1" aria-label="زيادة">+</button><output id="cnt" class="num">٠</output><button type="button" data-d="-1" aria-label="إنقاص">−</button></div>
    <p class="muted" style="text-align:center;margin:0">عدد أخطاء الشعبة كاملة في هذه القراءة</p>
    ${needLogin ? `<div class="field"><label for="sec-pw">كلمة مرور شعبة ${esc(sectionName(sectionId))}</label><input id="sec-pw" type="password" inputmode="numeric" autocomplete="off">${API.demo ? '<span class="muted">في وضع التجربة: 1111</span>' : ''}</div>` : ''}
    <div class="err-msg" id="e-err" hidden></div>
    <button class="btn primary" id="e-save" style="min-height:54px;font-size:1.15rem">حفظ الأخطاء</button>`);
  let count = 0;
  const cnt = $('#cnt', ov);
  const setCount = n => { count = Math.max(0, Math.min(999, n)); cnt.textContent = toAr(count); };
  const drawDays = () => {
    $('#days', ov).innerHTML = list.slice().reverse().map(e => {
      const r = recOf(sectionId, e.id);
      const st = r ? `<span class="st done">مسجّل: ${toAr(r.count)}</span>` : (e.date && e.date < t ? '<span class="st late">متأخرة</span>' : '<span class="st soon">اليوم</span>');
      return `<button type="button" class="day-opt ${e === chosen ? 'on' : ''}" data-id="${e.id}"><span><b>${TYPE_NAMES[e.type]}</b> · ${esc(e.date ? fmtDate(e.date) : (e.day + ' ' + e.dateText))}</span>${st}</button>`;
    }).join('');
    $('#days', ov).querySelectorAll('[data-id]').forEach(b => b.onclick = () => { chosen = list.find(e => e.id === b.dataset.id); const r = recOf(sectionId, chosen.id); setCount(r ? r.count : 0); drawDays(); });
    $('#days', ov).querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const r0 = recOf(sectionId, chosen.id); setCount(r0 ? r0.count : 0);
  drawDays();
  ov.querySelectorAll('[data-d]').forEach(b => b.onclick = () => setCount(count + +b.dataset.d));
  $('#e-save', ov).onclick = async () => {
    const cred = S.admin || S.sec[sectionId] || { role: 'section', id: sectionId, pw: $('#sec-pw', ov)?.value || '' };
    const btn = $('#e-save', ov); btn.disabled = true;
    try {
      const res = await API.call('saveError', { cred, rec: { section: sectionId, grade, entryId: chosen.id, date: chosen.date || '', type: chosen.type, count } });
      if (cred.role === 'section') { S.sec[sectionId] = cred; store.sset('iqra-sec', S.sec); }
      const i = S.errors.findIndex(x => x.section === sectionId && x.entryId === chosen.id);
      if (i >= 0) S.errors[i] = res.rec; else S.errors.push(res.rec);
      closeModal(); toast(`تم الحفظ: ${toAr(count)} لشعبة ${sectionName(sectionId)}`);
    } catch (e) { const m = $('#e-err', ov); m.hidden = false; m.textContent = e.userMessage || 'تعذّر الحفظ'; btn.disabled = false; }
  };
}

/* ---------- leaderboard ---------- */
function competitionGrades() { return GRADES.filter(g => !g.noCompetition && scoredEntries(g.id).length); }
function monthsOf(grade) { return [...new Set(scoredEntries(grade).map(e => monthKey(e.date)).filter(Boolean))].sort(); }
function standings(grade, mk) {
  const t = todayISO();
  const ents = scoredEntries(grade).filter(e => monthKey(e.date) === mk);
  const due = ents.filter(e => e.date <= t);
  const rows = LETTERS.map(l => {
    const id = grade + '-' + l;
    const recs = ents.map(e => recOf(id, e.id)).filter(Boolean);
    const total = recs.reduce((a, r) => a + (+r.count || 0), 0);
    return { id, letter: l, total, recorded: recs.length, due: due.length, late: due.filter(e => !recOf(id, e.id)).length };
  });
  const active = rows.filter(r => r.recorded > 0);
  const best = active.length ? Math.min(...active.map(r => r.total)) : null;
  rows.forEach(r => { r.winner = r.recorded > 0 && r.total === best; });
  rows.sort((a, b) => (b.recorded > 0) - (a.recorded > 0) || a.total - b.total || a.letter.localeCompare(b.letter));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.recorded === 0) { r.rank = null; return; } if (r.total !== prev) { rank = i + 1; prev = r.total; } r.rank = rank; });
  return { rows, dueCount: due.length, entries: ents };
}
function board(grade) {
  Player.stop(true);
  const cg = competitionGrades();
  if (!cg.length) { frame('<h2>لوحة الترتيب</h2><p class="muted">لا توجد خطط فيها أيام قراءة جماعية أو سبر بعد.</p>'); return; }
  grade = grade && cg.some(g => g.id === grade) ? grade : cg[0].id;
  const months = monthsOf(grade);
  const cur = monthKey(todayISO());
  let mk = months.includes(cur) ? cur : months.filter(m => m <= cur).pop() || months[0];
  // the monthly score out of 100: Quran (sabr errors) + Dhuhr prayer + morning adhkar
  const draw = () => {
    const st = monthScores(grade, mk); const W = st.W;
    const winners = st.rows.filter(r => r.winner);
    const late = st.rows.filter(r => r.late > 0);
    const part = (v, has) => has ? `<span class="num">${toAr(Math.round(v))}</span>` : '<span class="muted">—</span>';
    $('#board-body').innerHTML = `
      <p class="muted" style="margin:0">المجموع من ١٠٠: القرآن ${toAr(W.quran)}٪ (أخطاء السبر) · الصلاة ${toAr(W.prayer)}٪ (صلاة الظهر جماعة) · الأذكار ${toAr(W.adhkar)}٪ (أذكار الصباح)</p>
      ${late.length ? `<div class="warn-box">شعب لم تُسجّل كل أيام الأخطاء بعد: ${late.map(r => `${r.letter} (${toAr(r.late)})`).join('، ')}. الترتيب يُحسب من الأيام المسجّلة.</div>` : ''}
      <div class="bars">${st.rows.map(r => `<div class="barrow ${r.winner ? 'best' : ''}"><b class="rank">${r.letter}</b><div class="track"><div class="fill" style="width:${r.active ? Math.max(3, r.total) : 0}%"></div></div><span class="num">${r.active ? fmt1(r.total) : '—'}</span></div>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>الترتيب</th><th>الشعبة</th><th>المجموع</th><th>📖 القرآن</th><th>🕌 الصلاة</th><th>📿 الأذكار</th><th></th></tr></thead><tbody>
      ${st.rows.map(r => `<tr class="${r.winner ? 'winner' : ''}"><td class="rank">${r.rank ? toAr(r.rank) : '—'}</td><td><b>${esc(gradeOf(grade).name)} ${r.letter}</b></td>
        <td class="num"><b>${r.active ? fmt1(r.total) : '—'}</b></td>
        <td>${part(r.q, r.qAvg != null)} ${r.qAvg != null ? `<span class="muted" style="font-size:.85rem">(متوسط ${fmt1(r.qAvg)} خطأ في ${toAr(r.sabrDays)} سبر)</span>` : ''}</td>
        <td>${part(r.p, r.pAvg != null)} ${r.pAvg != null ? `<span class="muted" style="font-size:.85rem">(${toAr(r.prayerDays)} يوماً)</span>` : ''}</td>
        <td>${part(r.a, r.schoolDays)} ${r.schoolDays ? `<span class="muted" style="font-size:.85rem">(${toAr(r.aDays)} من ${toAr(r.schoolDays)})</span>` : ''}</td>
        <td>${r.winner ? `<button class="btn sm gold" data-cert="${r.letter}">${ico('trophy')}الشهادة</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${winners.length ? `<p class="muted" style="margin:0">الأعلى مجموعاً في ${monthName(mk)}: ${winners.map(w => 'شعبة ' + w.letter).join(' و')} ${winners.length > 1 ? '(تعادل، تُمنح الشهادة للشعبتين)' : ''}</p>` : '<p class="muted" style="margin:0">لا يوجد تسجيل لهذا الشهر بعد.</p>'}`;
    $('#board-body').querySelectorAll('[data-cert]').forEach(b => b.onclick = () => {
      const r = st.rows.find(x => x.letter === b.dataset.cert);
      certificate({ grade, letter: r.letter, mk, row: r });
    });
  };
  const allWinners = () => competitionGrades().map(g => {
    const w = monthScores(g.id, mk).rows.filter(r => r.winner);
    return `<div class="pod"><span class="muted">${esc(g.name)}</span><b>${w.length ? w.map(x => 'شعبة ' + x.letter).join(' و') : '—'}</b><span class="num">${w.length ? fmt1(w[0].total) + ' من ١٠٠' : 'لا تسجيل بعد'}</span></div>`;
  }).join('');
  const lastSec = store.get('iqra-last', null);
  app().innerHTML = `<div class="page-screen"><div class="bar"><div class="who">${logoSVG()}<span class="chip">لوحة الترتيب الشهرية</span></div><div class="actions" style="margin-inline-start:auto">
    ${lastSec ? '<button class="btn" data-back>العودة إلى الشعبة</button>' : ''}<button class="btn" data-home>الرئيسية</button></div></div>
    <div class="content"><div class="filters"><div class="field"><label for="b-grade">الصف</label><select id="b-grade">${cg.map(g => `<option value="${g.id}" ${g.id === grade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="b-month">الشهر</label><select id="b-month">${months.map(m => `<option value="${m}" ${m === mk ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></div></div>
    <h2 id="b-title"></h2><div id="board-body" style="display:grid;gap:16px"></div>
    <h2>الأوائل في كل الصفوف</h2><div class="podium" id="podium"></div></div></div>`;
  const title = () => { $('#b-title').textContent = `شعب ${gradeOf(grade).name} – ${monthName(mk)}`; $('#podium').innerHTML = allWinners(); };
  $('#b-grade').onchange = e => board(e.target.value);
  $('#b-month').onchange = e => { mk = e.target.value; title(); draw(); };
  app().querySelector('[data-home]').onclick = home;
  const bk = app().querySelector('[data-back]'); if (bk) bk.onclick = () => go(lastSec);
  title(); draw();
}

/* ---------- certificate ---------- */
function errWords(n) {
  if (n === 0) return 'دون أي خطأ';
  if (n === 1) return 'بخطأ واحد فقط';
  if (n === 2) return 'بخطأين فقط';
  if (n <= 10) return `بمجموع ${toAr(n)} أخطاء`;
  return `بمجموع ${toAr(n)} خطأً`;
}
async function certificate({ grade, letter, mk, row }) {
  const words = await Q.ayahWords('73:4').catch(() => []);
  const verse = words.slice(-3).map(w => w.t).join(' ');
  const corner = `<svg class="corner CL" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#b58a2e" stroke-width="2"><path d="M5 5h60M5 5v60"/><path d="M14 14h36M14 14v36"/><path d="M30 30l10-10 10 10-10 10z" fill="#0e5a4b" stroke="none"/><circle cx="30" cy="30" r="16"/></g></svg>`;
  const ov = document.createElement('div');
  ov.className = 'cert-screen';
  ov.innerHTML = `<div class="cert-actions"><button class="btn primary" data-print>طباعة الشهادة</button><button class="btn" data-x>إغلاق</button></div>
    <div class="cert">${['tl', 'tr', 'bl', 'br'].map(c => corner.replace('CL', c)).join('')}
      <div class="c-brand">اقرأ وارتقِ</div>
      <div class="c-title">شهادة تكريم</div>
      <div class="c-body">تُمنح هذه الشهادة لطالبات</div>
      <div class="c-name">الصف ${esc(gradeOf(grade).name)} – الشعبة ${letter}</div>
      <div class="c-body">تقديراً لتميّزهنّ خلال شهر ${monthName(mk)} في تلاوة القرآن الكريم وصلاة الظهر جماعة وأذكار الصباح، إذ حصلن على أعلى مجموع بين شعب الصف: ${fmt1(row.total)} من ١٠٠.</div>
      <div class="c-parts">القرآن ${toAr(Math.round(row.q))} · الصلاة ${toAr(Math.round(row.p))} · الأذكار ${toAr(Math.round(row.a))}</div>
      ${verse ? `<div class="c-verse">﴿${esc(verse)}﴾</div>` : ''}
      <div class="c-sign"><div><span>معلمة الشعبة</span><i></i></div><div><span>مديرة المدرسة</span><i></i></div></div>
    </div>`;
  app().appendChild(ov);
  ov.querySelector('[data-x]').onclick = () => ov.remove();
  ov.querySelector('[data-print]').onclick = () => { window.print(); };
}

/* ---------- admin ---------- */
// the admin panel in four sections; each section has its own pages
const ADMIN_GROUPS = [
  { id: 'follow', icon: '📊', name: 'المتابعة', pages: [['track', 'متابعة الصفوف'], ['errors', 'الأخطاء المسجّلة']] },
  { id: 'content', icon: '📚', name: 'المحتوى', pages: [['plans', 'الخطط'], ['tajweed', 'أحكام التجويد'], ['adhkar', 'الأذكار'], ['notes', 'القصص وأسباب النزول']] },
  { id: 'sections', icon: '👥', name: 'الشعب', pages: [['names', 'أسماء الطالبات وعددهن'], ['pw', 'كلمات المرور']] },
  { id: 'settings', icon: '⚙️', name: 'الإعدادات', pages: [['settings', 'الإعدادات']] },
];
function admin(tab) {
  Player.stop(true);
  tab = tab || store.get('iqra-adm-tab', 'track');
  const group = ADMIN_GROUPS.find(g => g.pages.some(([k]) => k === tab)) || ADMIN_GROUPS[0];
  if (!group.pages.some(([k]) => k === tab)) tab = group.pages[0][0];
  if (!S.admin) { home(); adminLoginModal(() => admin(tab)); return; }
  store.set('iqra-adm-tab', tab);
  app().innerHTML = `<div class="page-screen"><div class="bar"><div class="who">${logoSVG()}<span class="chip">لوحة الإدارة</span></div>
    <nav class="adm-groups" aria-label="أقسام لوحة الإدارة">${ADMIN_GROUPS.map(g => `<button class="btn ${g === group ? 'on' : ''}" data-g="${g.id}" ${g === group ? 'aria-current="page"' : ''}>${g.icon} ${g.name}</button>`).join('')}</nav>
    <div class="actions"><button class="btn" data-home>الرئيسية</button><button class="btn danger" data-out>تسجيل الخروج</button></div></div>
    <div class="content">${group.pages.length > 1 ? `<div class="admin-tabs" role="tablist">${group.pages.map(([k, n]) => `<button class="tab ${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}" data-t="${k}">${n}</button>`).join('')}</div>` : ''}<div id="adm"></div></div></div>`;
  app().querySelector('[data-home]').onclick = home;
  app().querySelector('[data-out]').onclick = () => { S.admin = null; store.sset('iqra-admin', null); home(); };
  // a section opens on the page it was last on
  app().querySelectorAll('[data-g]').forEach(b => b.onclick = () => { const g = ADMIN_GROUPS.find(x => x.id === b.dataset.g); admin(store.get('iqra-adm-' + g.id, g.pages[0][0])); });
  app().querySelectorAll('[data-t]').forEach(b => b.onclick = () => admin(b.dataset.t));
  store.set('iqra-adm-' + group.id, tab);
  ({ plans: adminPlans, track: adminTrack, tajweed: adminTajweed, names: adminNames, adhkar: adminAdhkar, errors: adminErrors, pw: adminPw, notes: adminNotes, settings: adminSettings })[tab]();
}

/* ---------- class tracking (principal only) ---------- */
const ayahsOf = segs => Q.keysOf(segs || []).length;
function shortDate(iso) { const d = parseISO(iso); return d ? `${WEEKDAYS[d.getDay()]} ${toAr(d.getDate())}/${toAr(d.getMonth() + 1)}` : ''; }
// the 3rd most recent school day (plan days that are not holidays) up to today
function schoolDaysBack(grade, n = 3) {
  const t = todayISO();
  const days = [...new Set(entries(grade).filter(e => e.date && e.date <= t && e.type !== 'holiday').map(e => e.date))].sort();
  return days.length >= n ? days[days.length - n] : (days[0] || t);
}
function sectionTrack(sectionId, mk) {
  const grade = sectionId.split('-')[0];
  const g = gradeOf(grade);
  const list = entries(grade);
  if (g.free) return { kind: 'free' };
  if (!list.length) return { kind: 'noplan' };
  const t = todayISO();
  const st = sectionStatus(sectionId);
  const recs = (S.progress || []).filter(r => r.section === sectionId);
  const idxs = recs.map(r => list.findIndex(e => e.id === r.entryId)).filter(i => i >= 0);
  const base = idxs.length ? Math.min(...idxs) : Infinity;
  const due = list.map((e, i) => ({ e, i })).filter(({ e }) => isNewDay(e) && e.date && e.date <= t);
  const expected = due.length ? due[due.length - 1].e : null;
  // ayahs read: segments before tracking began count as read
  let read = 0;
  list.forEach((e, i) => {
    if (!isNewDay(e)) return;
    const r = progOf(sectionId, e.id);
    if (i < base || r?.status === 'done') read += ayahsOf(e.segs);
    else if (r?.status === 'partial' && r.upto) read += ayahsOf(segsUpto(e.segs, r.upto));
  });
  const required = due.reduce((a, { e }) => a + ayahsOf(e.segs), 0);
  // sabr errors for the month
  const sabr = scoredEntries(grade).filter(e => e.type === 'sabr' && monthKey(e.date) === mk).map(e => recOf(sectionId, e.id)).filter(Boolean);
  const sabrTotal = sabr.reduce((a, r) => a + (+r.count || 0), 0);
  // today is not counted: the lesson may not have happened yet
  const missing = g.noCompetition ? [] : scoredEntries(grade).filter(e => e.date && e.date < t && monthKey(e.date) === mk && !recOf(sectionId, e.id));
  const acts = [...recs.map(r => r.at), ...S.errors.filter(r => r.section === sectionId).map(r => r.at)].filter(Boolean).sort();
  const lastProg = recs.map(r => localDay(r.at)).filter(Boolean).sort().pop() || '';
  const inactive = !lastProg || lastProg < schoolDaysBack(grade);
  const lag = st.lag;
  const color = inactive ? 'idle' : lag >= 3 ? 'red' : lag >= 1 ? 'yellow' : 'green';
  return {
    kind: 'plan', tracked: st.tracked, lag, pos: st.pos >= 0 ? list[st.pos] : null, expected, color, inactive, lastProg,
    pct: st.tracked && required ? Math.min(100, Math.round(read / required * 100)) : null, read, required,
    sabrAvg: sabr.length ? sabrTotal / sabr.length : null, sabrTotal, sabrDays: sabr.length, missing,
    last: acts.length ? acts[acts.length - 1] : '',
  };
}
const TRACK_COLORS = { green: ['🟢', 'ملتزمة'], yellow: ['🟡', 'متأخرة ١–٢'], red: ['🔴', 'متأخرة ٣+'], idle: ['⚪', 'لا تقدّم منذ ٣ أيام دراسية'] };
function fmtAt(iso) { return iso ? new Date(iso).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

function adminTrack() {
  const host = $('#adm');
  const view = { mode: store.get('iqra-trk-mode', 'school'), grade: store.get('iqra-trk-grade', '7'), section: null, mk: monthKey(todayISO()) };
  const secGrades = GRADES.filter(g => !g.free && entries(g.id).length);
  if (!secGrades.some(g => g.id === view.grade)) view.grade = secGrades[0]?.id || '7';
  const draw = () => {
    store.set('iqra-trk-mode', view.mode === 'section' ? 'grade' : view.mode); store.set('iqra-trk-grade', view.grade);
    const tabs = `<div class="filters"><div class="admin-tabs"><button class="btn sm ${view.mode === 'school' ? 'on' : ''}" data-m="school">نظرة عامة على المدرسة</button><button class="btn sm ${view.mode !== 'school' ? 'on' : ''}" data-m="grade">ملخص صف</button></div>
      ${view.mode !== 'school' ? `<div class="field"><label for="t-grade">الصف</label><select id="t-grade">${secGrades.map(g => `<option value="${g.id}" ${g.id === view.grade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="t-month">شهر السبر</label><select id="t-month">${monthsAll().map(m => `<option value="${m}" ${m === view.mk ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></div></div>`;
    host.innerHTML = tabs + `<div id="t-body"></div>`;
    host.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { view.mode = b.dataset.m; draw(); });
    const gs = $('#t-grade', host); if (gs) gs.onchange = e => { view.grade = e.target.value; view.mode = 'grade'; draw(); };
    $('#t-month', host).onchange = e => { view.mk = e.target.value; draw(); };
    const body = $('#t-body', host);
    if (view.mode === 'school') drawSchool(body); else if (view.mode === 'section') drawSection(body); else drawGrade(body);
  };
  const monthsAll = () => [...new Set([...secGrades.flatMap(g => monthsOf(g.id)), view.mk])].sort();
  const open = (grade, section) => { view.grade = grade; view.section = section; view.mode = section ? 'section' : 'grade'; draw(); };

  function drawSchool(body) {
    const t = todayISO(); const recent = d => d && d <= t && d >= addDays(t, -14);
    const alerts = []; let untracked = 0; const miss = {};
    const noPlan = GRADES.filter(g => !g.free && !entries(g.id).length);
    const cells = (noPlan.length ? `<tr><th scope="row">${esc(noPlan.map(g => g.name).join('، '))}</th><td colspan="${LETTERS.length}" class="trk muted">لا توجد خطة بعد</td></tr>` : '') +
      GRADES.filter(g => !noPlan.includes(g)).map(g => {
      const row = LETTERS.map(l => {
        const id = g.id + '-' + l; const x = sectionTrack(id, view.mk);
        if (x.kind === 'free') return '<td class="trk muted">قراءة حرة</td>';
        if (x.kind === 'noplan') return '<td class="trk muted">لا توجد خطة</td>';
        if (!x.tracked) untracked++;
        if (x.tracked && x.lag >= 3) alerts.push({ w: 3 + x.lag, html: `🔴 <b>${esc(sectionName(id))}</b> متأخرة ${lagWords(x.lag)}`, id, g: g.id });
        else if (x.tracked && x.inactive) alerts.push({ w: 2, html: `⚪ <b>${esc(sectionName(id))}</b> لم تسجّل تقدّماً منذ ${x.lastProg ? shortDate(x.lastProg) : 'مدة'}`, id, g: g.id });
        (miss[g.id] = miss[g.id] || []).push({ id, days: x.missing.filter(e => recent(e.date)) });
        const [dot, tip] = TRACK_COLORS[x.color]; const pa = paStats(id, view.mk);
        return `<td class="trk c-${x.color}"><button data-sec="${id}" title="${tip}">${dot} ${x.tracked ? (x.lag ? toAr(x.lag) : '✓') : '—'}<small class="trk-pa">🕌${pa.pAvg == null ? '—' : toAr(pa.pAvg) + '٪'} 📿${pa.aPct == null ? '—' : toAr(pa.aPct) + '٪'}</small></button></td>`;
      }).join('');
      return `<tr><th scope="row"><button class="link" data-g="${g.id}">${esc(g.name)}</button></th>${row}</tr>`;
    }).join('');
    // missing error records (last two weeks): one line per grade if no section recorded, else one per section
    Object.entries(miss).forEach(([gid, secs]) => {
      if (gradeOf(gid).noCompetition) return;
      const due = secs[0] ? Math.max(...secs.map(s => s.days.length)) : 0;
      if (!due) return;
      if (secs.every(s => s.days.length === due)) { alerts.push({ w: 1.5, html: `✎ <b>${esc(gradeOf(gid).name)}</b>: لم تسجّل أي شعبة أخطاء القراءة الجماعية والسبر في آخر أسبوعين`, id: gid + '-' + LETTERS[0], g: gid }); return; }
      secs.filter(s => s.days.length).forEach(s => { const d = s.days[s.days.length - 1];
        alerts.push({ w: 1, html: `✎ <b>${esc(sectionName(s.id))}</b> لم تسجّل أخطاء ${s.days.length === 2 ? 'يومين، آخرها ' : s.days.length > 2 ? toAr(s.days.length) + ' أيام، آخرها ' : ''}${TYPE_NAMES[d.type]} ${shortDate(d.date)}`, id: s.id, g: gid }); });
    });
    // prayer (no record for 3 school days) and today's morning adhkar, for every section including those without a plan
    GRADES.forEach(g => {
      const ids = LETTERS.map(l => g.id + '-' + l); const st = ids.map(id => ({ id, ...paStats(id, view.mk) }));
      const noP = st.filter(s => s.prayerGap >= 3), noA = st.filter(s => !s.adhkarToday);
      if (noP.length === ids.length) alerts.push({ w: 1.4, html: `🕌 <b>${esc(g.name)}</b>: لم تسجّل أي شعبة صلاة الظهر منذ ٣ أيام دوام أو أكثر`, id: ids[0], g: g.id });
      else noP.forEach(s => alerts.push({ w: 1.3, html: `🕌 <b>${esc(sectionName(s.id))}</b> لم تسجّل صلاة الظهر منذ ${toAr(s.prayerGap)} أيام دوام`, id: s.id, g: g.id }));
      if (noA.length === ids.length) alerts.push({ w: .6, html: `📿 <b>${esc(g.name)}</b>: لم تقرأ أي شعبة أذكار الصباح اليوم`, id: ids[0], g: g.id });
      else noA.forEach(s => alerts.push({ w: .5, html: `📿 <b>${esc(sectionName(s.id))}</b> لم تقرأ أذكار الصباح اليوم`, id: s.id, g: g.id }));
    });
    alerts.sort((a, b) => b.w - a.w);
    body.innerHTML = `<div class="trk-legend">${Object.values(TRACK_COLORS).map(([d, n]) => `<span>${d} ${n}</span>`).join('')}<span class="muted">الرقم = عدد المقاطع المتأخرة، و— = لم تبدأ الشعبة تسجيل «أنهينا»</span></div>
      <div class="table-wrap"><table class="trk-table"><thead><tr><th>الصف</th>${LETTERS.map(l => `<th>${l}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table></div>
      <h3 style="margin:6px 0 0">تنبيهات</h3>
      <div class="card trk-alerts">${untracked ? `<div>⚪ ${toAr(untracked)} شعبة لم تبدأ تسجيل «أنهينا» بعد، فتُعتبر ملتزمة بالخطة حتى تسجّل.</div>` : ''}
        ${alerts.length ? alerts.slice(0, 40).map(a => `<div><button class="link" data-sec="${a.id}">${a.html}</button></div>`).join('') : (untracked ? '' : '<div class="muted">لا توجد تنبيهات. ما شاء الله!</div>')}
        ${alerts.length > 40 ? `<div class="muted">و${toAr(alerts.length - 40)} تنبيهات أخرى، تجدينها في ملخص كل صف.</div>` : ''}</div>`;
    body.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => open(b.dataset.sec.split('-')[0], b.dataset.sec));
    body.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { if (secGrades.some(g => g.id === b.dataset.g)) open(b.dataset.g, null); });
  }

  function drawGrade(body) {
    const g = gradeOf(view.grade);
    const rows = LETTERS.map(l => { const id = view.grade + '-' + l; return { id, x: sectionTrack(id, view.mk) }; });
    body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>الشعبة</th><th>حسب الخطة</th><th>وصلت فعلاً</th><th>الفرق</th><th>نسبة الإنجاز</th><th>أخطاء السبر (${monthName(view.mk)})</th><th>أيام لم تُسجَّل أخطاؤها</th><th>🕌 الصلاة</th><th>📿 الأذكار</th><th>آخر نشاط</th><th></th></tr></thead><tbody>
      ${rows.map(({ id, x }) => `<tr><td><b>${TRACK_COLORS[x.color][0]} ${esc(sectionName(id))}</b></td>
        <td>${x.expected ? esc(Q.segLabel(x.expected.segs)) : '—'}</td>
        <td>${!x.tracked ? '<span class="muted">لم تبدأ التسجيل</span>' : x.pos ? 'تقرأ: ' + esc(Q.segLabel(x.pos.segs)) : 'أنهت كل المقاطع'}${x.pos && progOf(id, x.pos.id)?.status === 'partial' ? ` <span class="muted">(حتى الآية ${toAr(progOf(id, x.pos.id).upto.split(':')[1])})</span>` : ''}</td>
        <td>${x.tracked ? (x.lag ? `<b class="t-${x.color}">${lagWords(x.lag)}</b>` : 'ملتزمة') : '—'}</td>
        <td>${x.pct == null ? '—' : `<div class="pct"><span style="width:${x.pct}%"></span></div><span class="num">${toAr(x.pct)}٪</span>`}</td>
        <td>${x.sabrAvg == null ? '—' : `متوسط <b class="num">${toAr(Math.round(x.sabrAvg * 10) / 10)}</b> · مجموع ${toAr(x.sabrTotal)} <span class="muted">(${toAr(x.sabrDays)} سبر)</span>`}</td>
        <td>${g.noCompetition ? '—' : x.missing.length ? `<div class="trk-miss">${x.missing.map(e => `<span class="st late">${e.type === 'sabr' ? 'سبر' : 'جماعية'} ${shortDate(e.date)}</span>`).join('')}</div>` : '<span class="muted">لا يوجد</span>'}</td>
        ${(() => { const pa = paStats(id, view.mk); return `<td>${pa.pAvg == null ? '—' : `<span class="num">${toAr(pa.pAvg)}٪</span>`}${pa.prayerGap >= 3 ? ` <span class="st late">لا تسجيل منذ ${toAr(pa.prayerGap)} أيام</span>` : ''}</td>
          <td>${pa.aPct == null ? '—' : `<span class="num">${toAr(pa.aPct)}٪</span>`}${pa.adhkarToday ? '' : ' <span class="st late">ليس اليوم</span>'}</td>`; })()}
        <td class="muted num">${fmtAt(x.last)}</td>
        <td><button class="btn sm" data-sec="${id}">التفاصيل</button></td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="margin:0">نسبة الإنجاز = الآيات المقروءة ÷ الآيات المطلوبة حتى اليوم، وتظهر لكِ فقط. المقاطع التي قبل أول تسجيل للشعبة تُحسب مقروءة.</p>`;
    body.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => open(view.grade, b.dataset.sec));
  }

  function drawSection(body) {
    const id = view.section; const grade = id.split('-')[0];
    const list = entries(grade); const t = todayISO(); const x = sectionTrack(id, view.mk);
    const recs = (S.progress || []).filter(r => r.section === id);
    const idxs = recs.map(r => list.findIndex(e => e.id === r.entryId)).filter(i => i >= 0);
    const base = idxs.length ? Math.min(...idxs) : Infinity;
    const last = Math.max(todayIndex(list), ...idxs, x.pos ? list.indexOf(x.pos) : -1);
    const rows = list.slice(0, last + 1).map((e, i) => {
      if (isNewDay(e)) {
        const r = progOf(id, e.id);
        const st = r?.status === 'done' ? `<span class="st done">أنهتها ${shortDate(localDay(r.at))}</span>`
          : r?.status === 'partial' ? `<span class="st soon">وصلت إلى الآية ${toAr(r.upto.split(':')[1])} · ${shortDate(localDay(r.at))}</span>`
          : i < base ? '<span class="muted">قبل بدء التسجيل</span>'
          : e.date && e.date <= t ? '<span class="st late">لم تُقرأ بعد</span>' : '<span class="muted">قادم</span>';
        return `<tr><td class="num">${esc(e.date ? shortDate(e.date) : '')}</td><td>${TYPE_NAMES[e.type]}</td><td>${esc(Q.segLabel(e.segs))}</td><td>${st}</td></tr>`;
      }
      if (SCORED.includes(e.type)) {
        const r = recOf(id, e.id);
        const st = r ? `<span class="st done">الأخطاء: ${toAr(r.count)}</span>` : e.date && e.date <= t ? '<span class="st late">لم تُسجَّل الأخطاء</span>' : '<span class="muted">قادم</span>';
        return `<tr class="trk-scored"><td class="num">${esc(e.date ? shortDate(e.date) : '')}</td><td>${TYPE_NAMES[e.type]}</td><td class="muted">صفحات الأسبوع</td><td>${st}</td></tr>`;
      }
      return '';
    }).reverse().join('');
    const sabr = scoredEntries(grade).filter(e => e.type === 'sabr' && e.date && e.date <= t).map(e => ({ e, r: recOf(id, e.id) })).filter(o => o.r).slice(-12);
    const max = Math.max(1, ...sabr.map(o => +o.r.count || 0));
    body.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-back>→ ملخص ${esc(gradeOf(grade).name)}</button><h3 style="margin:0">${TRACK_COLORS[x.color][0]} ${esc(sectionName(id))}</h3>
      <span class="chip">${x.tracked ? (x.lag ? 'متأخرة ' + lagWords(x.lag) : 'ملتزمة') : 'لم تبدأ تسجيل «أنهينا»'}</span>${x.pct != null ? `<span class="chip">الإنجاز ${toAr(x.pct)}٪</span>` : ''}</div>
      <div class="trk-detail"><div class="card"><h3 style="margin-top:0">أخطاء السبر عبر الأسابيع</h3>
        ${sabr.length ? `<div class="bars">${sabr.map(o => `<div class="barrow"><span class="muted" style="font-size:.85rem">${shortDate(o.e.date)}</span><div class="track"><div class="fill" style="width:${Math.max(3, (+o.r.count || 0) / max * 100)}%"></div></div><b class="num">${toAr(o.r.count)}</b></div>`).join('')}</div>` : '<p class="muted">لا توجد أخطاء سبر مسجّلة بعد.</p>'}</div>
      <div class="table-wrap"><table><thead><tr><th>اليوم</th><th>النوع</th><th>المقطع</th><th>الحالة</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">لا توجد أيام بعد.</td></tr>'}</tbody></table></div></div>`;
    body.querySelector('[data-back]').onclick = () => open(grade, null);
  }
  draw();
}
/* ---------- tajweed rules per grade (principal) ---------- */
function adminTajweed() {
  const host = $('#adm');
  const all = RULE_ITEMS.flatMap(it => it.rules);
  // working copy: grade -> Set of rule indexes (missing = all)
  const sel = {}; GRADES.forEach(g => { const v = gradeRules(g.id); sel[g.id] = new Set(v || all); });
  let dirty = false;
  const has = (g, it) => it.rules.every(r => sel[g].has(r));
  const draw = () => {
    host.innerHTML = `<p class="muted" style="margin:0">اختاري الأحكام التي تدرسها كل مرحلة. الصف الذي يبقى «كل الأحكام» يعمل كما الآن. تؤثّر الاختيارات على «ألوان التجويد» وتبويب «الأحكام» والتحديات واستراتيجيات الحصة.</p>
      <div class="filters"><div class="field"><label for="tj-from">نسخ اختيارات صف</label><select id="tj-from">${GRADES.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tj-to">إلى</label><select id="tj-to"><option value="*">كل الصفوف الأخرى</option>${GRADES.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
        <button class="btn" data-copy style="min-height:46px">نسخ</button>
        <button class="btn primary" data-save style="min-height:46px;margin-inline-start:auto">${dirty ? 'حفظ التغييرات ●' : 'حفظ'}</button></div>
      <div class="table-wrap"><table class="tj-table"><thead><tr><th>الحكم</th>${GRADES.map(g => `<th><div>${esc(g.name)}</div><div class="tj-col">${sel[g.id].size === all.length ? '<span class="muted">كل الأحكام</span>' : `<span class="num">${toAr(RULE_ITEMS.filter(it => has(g.id, it)).length)}</span>`}</div>
          <div class="tj-col"><button class="btn sm ghost" data-allg="${g.id}">الكل</button><button class="btn sm ghost" data-noneg="${g.id}">لا شيء</button></div></th>`).join('')}</tr></thead><tbody>
        ${RULE_ITEMS.map(it => `<tr><th scope="row"><span class="rule-dot" style="background:${it.color}"></span> ${esc(it.name)}</th>${GRADES.map(g => `<td><label class="tj-cell"><input type="checkbox" data-g="${g.id}" data-it="${it.id}" ${has(g.id, it) ? 'checked' : ''} aria-label="${esc(it.name)} – ${esc(g.name)}"></label></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    host.querySelectorAll('input[data-it]').forEach(cb => cb.onchange = () => {
      const it = RULE_ITEMS.find(x => x.id === cb.dataset.it); const s = sel[cb.dataset.g];
      it.rules.forEach(r => cb.checked ? s.add(r) : s.delete(r)); dirty = true; draw();
    });
    host.querySelectorAll('[data-allg]').forEach(b => b.onclick = () => { sel[b.dataset.allg] = new Set(all); dirty = true; draw(); });
    host.querySelectorAll('[data-noneg]').forEach(b => b.onclick = () => { sel[b.dataset.noneg] = new Set(); dirty = true; draw(); });
    host.querySelector('[data-copy]').onclick = () => {
      const from = $('#tj-from', host).value, to = $('#tj-to', host).value;
      GRADES.forEach(g => { if (g.id !== from && (to === '*' || to === g.id)) sel[g.id] = new Set(sel[from]); });
      dirty = true; draw(); toast(`نُسخت اختيارات ${gradeOf(from).name}. اضغطي «حفظ» لاعتمادها.`);
    };
    host.querySelector('[data-save]').onclick = async () => {
      const out = {};
      GRADES.forEach(g => { if (sel[g.id].size !== all.length) out[g.id] = [...sel[g.id]].sort((a, b) => a - b); });
      const value = Object.keys(out).length ? JSON.stringify(out) : '';
      try { await API.call('saveSetting', { cred: S.admin, key: 'tajweed', value }); if (value) S.settings.tajweed = value; else delete S.settings.tajweed; dirty = false; draw(); toast('تم حفظ أحكام الصفوف'); }
      catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
    };
  };
  draw();
}

function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function dayName(iso) { const d = parseISO(iso); return d ? WEEKDAYS[d.getDay()] : ''; }
function validateEntry(e) {
  const issues = [];
  if (!e.date) issues.push('التاريخ غير محدد');
  if (['new', 'review'].includes(e.type)) {
    if (!e.segs || !e.segs.length) issues.push('لم يُحدَّد المقطع');
    else if (!e.segs.every(([s, a1, a2]) => s >= 1 && s <= 114 && a1 >= 1 && a1 <= a2 && a2 <= Q.ayahCount(s))) issues.push('أرقام الآيات تحتاج مراجعة');
  }
  return issues.join('، ');
}
function adminPlans() {
  const host = $('#adm');
  let grade = store.get('iqra-adm-grade', '6');
  let onlyIssues = false;
  let list = JSON.parse(JSON.stringify(entries(grade)));
  let dirty = false;
  const suraOpts = Q.meta.suras.map(s => `<option value="${s.n}">${toAr(s.n)}. ${esc(s.name)}</option>`).join('');
  const draw = () => {
    const g = gradeOf(grade);
    const rows = list.map((e, i) => ({ e, i })).filter(({ e }) => !onlyIssues || e.issue);
    host.innerHTML = `<div class="filters"><div class="field"><label for="p-grade">الصف</label><select id="p-grade">${GRADES.map(x => `<option value="${x.id}" ${x.id === grade ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <label style="display:flex;gap:6px;align-items:center;min-height:46px"><input type="checkbox" id="p-only" ${onlyIssues ? 'checked' : ''}> الأيام التي تحتاج مراجعة فقط (${toAr(list.filter(e => e.issue).length)})</label>
      <div style="display:flex;gap:8px;margin-inline-start:auto;flex-wrap:wrap"><button class="btn" data-add>إضافة يوم في آخر الخطة</button>${S.seed[grade] ? '<button class="btn" data-reset>استرجاع الخطة الأصلية</button>' : ''}<button class="btn primary" data-save>حفظ الخطة</button></div></div>
      ${planIsSeed(grade) && list.length ? '<div class="warn-box">هذه الخطة الأصلية المستوردة من ملفات الخطط. أي تعديل تحفظينه يُخزَّن في قاعدة البيانات ويظهر لكل الشعب.</div>' : ''}
      ${g.free ? '<div class="warn-box">التوجيهي قراءة حرة وخارج المنافسة، ولا يحتاج خطة.</div>' : ''}
      <div class="table-wrap"><table class="plan-table"><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>المقطع أو الوصف</th><th></th></tr></thead><tbody>
      ${rows.map(({ e, i }) => `<tr data-i="${i}"><td class="num">${toAr(i + 1)}</td>
        <td><input type="date" value="${e.date || ''}" data-f="date"><div class="muted" style="font-size:.8rem">${e.date ? dayName(e.date) : esc(e.day + ' ' + e.dateText)}</div></td>
        <td><select data-f="type">${Object.entries(TYPE_NAMES).map(([k, n]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td>${['new', 'review'].includes(e.type) ? `<div class="segs">${(e.segs || []).map((s, j) => `<div class="seg" data-j="${j}"><select data-sf="s">${suraOpts.replace(`value="${s[0]}"`, `value="${s[0]}" selected`)}</select> من <input type="number" min="1" value="${s[1]}" data-sf="a1"> إلى <input type="number" min="1" value="${s[2]}" data-sf="a2"><button class="btn sm ghost danger" data-rmseg="${j}" aria-label="حذف المقطع">✕</button></div>`).join('')}
          <button class="btn sm ghost" data-addseg>+ سورة أخرى</button></div>` : `<input type="text" value="${esc(e.label || '')}" data-f="label" style="width:100%">`}
          ${e.issue ? `<div class="issue">${esc(e.issue)}</div>` : ''}</td>
        <td><button class="btn sm ghost" data-ins aria-label="إضافة يوم بعده">+ يوم</button><button class="btn sm ghost danger" data-del>حذف</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#p-grade', host).onchange = ev => { if (dirty) toast('لم تُحفظ تعديلات الصف السابق'); grade = ev.target.value; store.set('iqra-adm-grade', grade); list = JSON.parse(JSON.stringify(entries(grade))); dirty = false; draw(); };
    $('#p-only', host).onchange = ev => { onlyIssues = ev.target.checked; draw(); };
    host.querySelector('[data-add]').onclick = () => { list.push(newEntry()); dirty = true; draw(); };
    const rs = host.querySelector('[data-reset]'); if (rs) rs.onclick = () => { list = JSON.parse(JSON.stringify(S.seed[grade])); dirty = true; draw(); toast('استُرجعت الخطة الأصلية. اضغطي حفظ لاعتمادها.'); };
    host.querySelector('[data-save]').onclick = save;
    host.querySelectorAll('tr[data-i]').forEach(tr => {
      const e = list[+tr.dataset.i];
      const upd = () => { e.issue = validateEntry(e); if (!e.issue) delete e.issue; dirty = true; };
      tr.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
        const f = inp.dataset.f;
        if (f === 'date') { e.date = inp.value || null; e.day = dayName(e.date); e.dateText = e.date ? e.date.split('-').reverse().join('/') : ''; }
        else if (f === 'type') { e.type = inp.value; if (['new', 'review'].includes(e.type) && !e.segs) e.segs = [[1, 1, 7]]; if (!['new', 'review'].includes(e.type)) { delete e.segs; e.label = e.label || TYPE_NAMES[e.type]; } }
        else e[f] = inp.value;
        if (e.segs && e.segs.length) e.label = Q.segLabel(e.segs);
        upd(); draw();
      });
      tr.querySelectorAll('.seg').forEach(sg => sg.querySelectorAll('[data-sf]').forEach(inp => inp.onchange = () => {
        const s = e.segs[+sg.dataset.j]; const k = { s: 0, a1: 1, a2: 2 }[inp.dataset.sf]; s[k] = parseInt(inp.value, 10) || 1;
        e.label = Q.segLabel(e.segs); upd(); draw();
      }));
      tr.querySelectorAll('[data-rmseg]').forEach(b => b.onclick = () => { e.segs.splice(+b.dataset.rmseg, 1); e.label = Q.segLabel(e.segs); upd(); draw(); });
      const as = tr.querySelector('[data-addseg]'); if (as) as.onclick = () => { const l = e.segs?.[e.segs.length - 1]; (e.segs = e.segs || []).push([l ? Math.min(114, l[0] + 1) : 1, 1, 1]); upd(); draw(); };
      tr.querySelector('[data-del]').onclick = () => { list.splice(+tr.dataset.i, 1); dirty = true; draw(); };
      tr.querySelector('[data-ins]').onclick = () => { list.splice(+tr.dataset.i + 1, 0, newEntry()); dirty = true; draw(); };
    });
  };
  const newEntry = () => ({ id: grade + '-n' + Date.now().toString(36), day: '', dateText: '', date: null, type: 'new', segs: [[1, 1, 7]], label: Q.segLabel([[1, 1, 7]]), issue: 'التاريخ غير محدد' });
  const save = async () => {
    try { await API.call('savePlan', { cred: S.admin, grade, entries: list }); S.plans[grade] = JSON.parse(JSON.stringify(list)); dirty = false; toast('تم حفظ خطة ' + gradeOf(grade).name); draw(); }
    catch (err) { toast(err.userMessage || 'تعذّر الحفظ'); }
  };
  draw();
}

function adminErrors() {
  const host = $('#adm');
  const cg = competitionGrades();
  let grade = cg[0]?.id || '6';
  let mk = monthKey(todayISO());
  const draw = () => {
    const ents = entries(grade);
    const byId = Object.fromEntries(ents.map(e => [e.id, e]));
    const recs = S.errors.filter(r => r.grade === grade && monthKey(r.date || byId[r.entryId]?.date) === mk)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.section.localeCompare(b.section));
    const months = [...new Set([...monthsOf(grade), mk])].sort();
    host.innerHTML = `<div class="filters"><div class="field"><label for="x-grade">الصف</label><select id="x-grade">${cg.map(g => `<option value="${g.id}" ${g.id === grade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="x-month">الشهر</label><select id="x-month">${months.map(m => `<option value="${m}" ${m === mk ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></div></div>
      <div class="table-wrap"><table><thead><tr><th>الشعبة</th><th>اليوم</th><th>النوع</th><th>عدد الأخطاء</th><th>وقت التسجيل</th><th></th></tr></thead><tbody>
      ${recs.length ? recs.map(r => `<tr data-id="${r.id}"><td><b>${esc(sectionName(r.section))}</b></td><td>${esc(r.date ? fmtDate(r.date) : '')}</td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td><input type="number" min="0" value="${r.count}" style="width:6em;min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:var(--surface)"> <button class="btn sm" data-s>حفظ</button></td>
        <td class="muted num">${r.at ? new Date(r.at).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td><td><button class="btn sm ghost danger" data-d>حذف</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">لا توجد أخطاء مسجّلة لهذا الشهر.</td></tr>'}</tbody></table></div>`;
    $('#x-grade', host).onchange = e => { grade = e.target.value; draw(); };
    $('#x-month', host).onchange = e => { mk = e.target.value; draw(); };
    host.querySelectorAll('tr[data-id]').forEach(tr => {
      const r = S.errors.find(x => x.id === tr.dataset.id);
      tr.querySelector('[data-s]').onclick = async () => {
        const n = +tr.querySelector('input').value;
        try { const res = await API.call('saveError', { cred: S.admin, rec: { ...r, count: n } }); Object.assign(r, res.rec); toast('تم التعديل'); draw(); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
      };
      tr.querySelector('[data-d]').onclick = () => confirmBox(`حذف أخطاء ${sectionName(r.section)} ليوم ${fmtDate(r.date)}؟`, async () => {
        try { await API.call('deleteError', { cred: S.admin, id: r.id }); S.errors = S.errors.filter(x => x.id !== r.id); toast('تم الحذف'); draw(); } catch (e) { toast(e.userMessage || 'تعذّر الحذف'); }
      });
    });
  };
  draw();
}
function confirmBox(msg, onYes) {
  const ov = modal(`<header><h2>تأكيد</h2></header><p style="margin:0">${esc(msg)}</p><div style="display:flex;gap:8px"><button class="btn danger" data-y>نعم، احذفي</button><button class="btn" data-close>إلغاء</button></div>`);
  ov.querySelector('[data-y]').onclick = () => { closeModal(); onYes(); };
}

async function adminPw() {
  const host = $('#adm');
  host.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
  let pw;
  try { pw = (await API.call('passwords', { cred: S.admin })).pw; } catch (e) { host.innerHTML = `<p class="err-msg">${esc(e.userMessage || 'تعذّر التحميل')}</p>`; return; }
  host.innerHTML = `<p class="muted" style="margin:0">لكل شعبة حساب واحد تستخدمه معلمتها لتسجيل الأخطاء. إذا تغيّرت المعلمة يكفي إعطاء كلمة المرور للمعلمة الجديدة أو تغييرها.</p>
    <div class="table-wrap"><table><thead><tr><th>الحساب</th><th>كلمة المرور الحالية</th><th>كلمة مرور جديدة</th><th></th></tr></thead><tbody>
    <tr data-id="admin"><td><b>المديرة</b></td><td class="pw">${esc(pw.admin)}</td><td><input type="text" style="min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:var(--surface)"></td><td><button class="btn sm">تغيير</button></td></tr>
    ${SECTIONS.map(s => `<tr data-id="${s.id}"><td>${esc(sectionName(s.id))}</td><td class="pw">${esc(pw[s.id] || '')}</td><td><input type="text" inputmode="numeric" style="min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:var(--surface)"></td><td><button class="btn sm">تغيير</button></td></tr>`).join('')}
    </tbody></table></div>`;
  host.querySelectorAll('tr[data-id]').forEach(tr => tr.querySelector('button').onclick = async () => {
    const v = tr.querySelector('input').value.trim();
    try {
      await API.call('setPassword', { cred: S.admin, id: tr.dataset.id, pw: v });
      if (tr.dataset.id === 'admin') { S.admin = { role: 'admin', pw: v }; store.sset('iqra-admin', S.admin); }
      tr.querySelector('.pw').textContent = v; tr.querySelector('input').value = ''; toast('تم تغيير كلمة المرور');
    } catch (e) { toast(e.userMessage || 'تعذّر التغيير'); }
  });
}
function adminNotes() {
  const host = $('#adm');
  const keys = Object.keys(S.notes).sort((a, b) => +a.slice(1) - +b.slice(1));
  host.innerHTML = `<p class="muted" style="margin:0">تُضاف القصة أو سبب النزول من تبويب «قصة وسبب نزول» بجانب صفحة المصحف، أو من هنا برقم الصفحة.</p>
    <div class="filters"><div class="field"><label for="n-page">رقم الصفحة</label><input id="n-page" type="number" min="1" max="604" value="${S.lesson?.pages?.[S.lesson.pi] || 1}"></div><button class="btn primary" data-open>فتح للكتابة</button></div>
    <div id="n-edit"></div>
    <div class="table-wrap"><table><thead><tr><th>الصفحة</th><th>النص</th><th></th></tr></thead><tbody>${keys.length ? keys.map(k => `<tr><td class="num">${toAr(k.slice(1))}</td><td style="white-space:pre-wrap">${esc(S.notes[k].slice(0, 220))}${S.notes[k].length > 220 ? '…' : ''}</td><td><button class="btn sm" data-e="${k}">تعديل</button></td></tr>`).join('') : '<tr><td colspan="3" class="muted">لا توجد قصص مضافة بعد.</td></tr>'}</tbody></table></div>`;
  const edit = key => {
    const p = key.slice(1);
    $('#n-edit').innerHTML = `<div class="card"><b>صفحة ${toAr(p)}</b><textarea id="n-ta">${esc(S.notes[key] || '')}</textarea><div style="display:flex;gap:8px"><button class="btn primary" data-s>حفظ</button><button class="btn" data-c>إغلاق</button></div></div>`;
    $('#n-edit [data-c]').onclick = () => { $('#n-edit').innerHTML = ''; };
    $('#n-edit [data-s]').onclick = async () => {
      const text = $('#n-ta').value.trim();
      try { await API.call('saveNote', { cred: S.admin, key, text }); if (text) S.notes[key] = text; else delete S.notes[key]; toast('تم الحفظ'); adminNotes(); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
    };
  };
  host.querySelector('[data-open]').onclick = () => edit('p' + Math.max(1, Math.min(604, +$('#n-page').value || 1)));
  host.querySelectorAll('[data-e]').forEach(b => b.onclick = () => edit(b.dataset.e));
}
function adminSettings() {
  const host = $('#adm');
  host.innerHTML = `<div class="card" style="max-width:560px"><div class="field"><label for="st-rec">القارئ الافتراضي لكل الشاشات</label><select id="st-rec">${RECITERS.map(r => `<option value="${r.id}" ${r.id === (S.settings.reciter || RECITERS[0].id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
    <button class="btn primary" data-s style="justify-self:start">حفظ</button></div>
    <div class="card" style="max-width:560px"><b>أوزان الترتيب الشهري (المجموع من ١٠٠)</b>
      <span class="muted">نصيب كل مكوّن من المجموع. القيم المقترحة: القرآن ٥٠، الصلاة ٣٠، الأذكار ٢٠.</span>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${[['quran', '📖 القرآن'], ['prayer', '🕌 الصلاة'], ['adhkar', '📿 الأذكار']].map(([k, n]) => `<div class="field"><label for="w-${k}">${n}</label><input id="w-${k}" type="number" min="0" max="100" value="${weights()[k]}" style="width:7em"></div>`).join('')}</div>
      <div class="muted" id="w-sum"></div>
      <button class="btn primary" data-w style="justify-self:start">حفظ الأوزان</button></div>
    <div class="card" style="max-width:560px"><b>حالة الربط</b><span class="muted">${API.demo ? 'وضع التجربة: البيانات محفوظة على هذا الجهاز فقط. لربط الموقع بقاعدة البيانات المشتركة اتبعي دليل الإعداد وضعي رابط Apps Script في ملف js/config.js.' : 'الموقع مربوط بقاعدة البيانات المشتركة (Google Sheets).'}</span></div>`;
  host.querySelector('[data-s]').onclick = async () => {
    const v = $('#st-rec').value;
    try { await API.call('saveSetting', { cred: S.admin, key: 'reciter', value: v }); S.settings.reciter = v; toast('تم الحفظ'); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
  };
  const wv = () => ({ quran: Math.max(0, +$('#w-quran').value || 0), prayer: Math.max(0, +$('#w-prayer').value || 0), adhkar: Math.max(0, +$('#w-adhkar').value || 0) });
  const sum = () => { const w = wv(); const s = w.quran + w.prayer + w.adhkar; $('#w-sum').textContent = s === 100 ? 'المجموع ١٠٠ ✓' : `المجموع ${toAr(s)} (يُفضَّل أن يكون ١٠٠، وتُحسب النِّسب منه على أي حال)`; };
  ['quran', 'prayer', 'adhkar'].forEach(k => { $('#w-' + k).oninput = sum; }); sum();
  host.querySelector('[data-w]').onclick = async () => {
    const w = wv(); if (!(w.quran + w.prayer + w.adhkar)) { toast('أدخلي وزناً واحداً على الأقل'); return; }
    const value = JSON.stringify(w);
    try { await API.call('saveSetting', { cred: S.admin, key: 'weights', value }); S.settings.weights = value; toast('تم حفظ الأوزان'); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
  };
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeModal(); } });
boot();
