/* بوابة الشعبة: الرئيسية (Hub) + المصحف + الصلاة + الأذكار، والروابط المباشرة، وحساب الترتيب الشهري الجديد. */

/* ---------- direct links: #/7/b/quran ---------- */
const LAT = ['a', 'b', 'c', 'd', 'e'];
const PARTS = ['quran', 'prayer', 'adhkar'];
function routeOf(id, part = '') { const [g, l] = id.split('-'); return `#/${g}/${LAT[LETTERS.indexOf(l)]}${part ? '/' + part : ''}`; }
function parseRoute() {
  const m = location.hash.match(/^#\/([^/]+)\/([a-e])(?:\/(quran|prayer|adhkar))?\/?$/);
  if (!m) return null;
  const id = m[1] + '-' + LETTERS[LAT.indexOf(m[2])];
  return SECTIONS.some(s => s.id === id) ? { id, part: m[3] || '' } : null;
}
function go(id, part = '') { const h = routeOf(id, part); if (location.hash === h) router(); else location.hash = h; }
function router() {
  const r = parseRoute();
  if (!r) { home(); return; }
  store.set('iqra-last', r.id);
  document.querySelectorAll('.picker-ov, .qm-review, .qm-frame').forEach(x => x.remove());
  if (r.part === 'quran') openLesson(r.id);
  else if (r.part === 'prayer') prayerScreen(r.id);
  else if (r.part === 'adhkar') adhkarScreen(r.id);
  else hub(r.id);
}
addEventListener('hashchange', () => { if (S.seed && Object.keys(S.seed).length) router(); });
// navigation shown in every section of the portal
function portalNav(id, active) {
  const it = [['', '🏠', 'الرئيسية'], ['quran', '📖', 'المصحف'], ['prayer', '🕌', 'الصلاة'], ['adhkar', '📿', 'الأذكار']];
  return `<nav class="pnav" aria-label="أقسام الشعبة">${it.map(([p, i, n]) => `<a class="btn ${p === active ? 'on' : ''}" href="${routeOf(id, p)}" ${p === active ? 'aria-current="page"' : ''}>${i} ${n}</a>`).join('')}</nav>`;
}

/* ---------- school days, counts, records ---------- */
function isSchoolDay(grade, iso) {
  const d = parseISO(iso); if (!d) return false;
  if (d.getDay() === 5 || d.getDay() === 6) return false; // الجمعة والسبت
  return !entries(grade).some(e => e.date === iso && e.type === 'holiday');
}
function countsMap() { try { return JSON.parse(S.settings.counts || '{}') || {}; } catch (e) { return {}; } }
function countOf(id) { const n = (typeof cachedNames === 'function' && cachedNames(id)) || null; return (n && n.length) || +countsMap()[id] || 0; }
const prayerOf = (id, date) => (S.prayer || []).find(r => r.section === id && r.date === date);
const adhkarOf = (id, date, group = 'morning') => (S.adhkar || []).find(r => r.section === id && r.date === date && r.group === group);
const pct = r => r && r.present ? Math.round(r.prayed / r.present * 100) : 0;
function schoolDaysOfMonth(grade, mk, upto = todayISO()) {
  const [y, m] = mk.split('-').map(Number); const out = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(y, m - 1, d); if (dt.getMonth() !== m - 1) break;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso > upto) break;
    if (isSchoolDay(grade, iso)) out.push(iso);
  }
  return out;
}
function credFor(id) { return S.admin || S.sec[id] || null; }
// asks for the section password once (same mechanism as recording errors)
function pwField(id) { return credFor(id) ? '' : `<div class="field"><label for="pp-pw">كلمة مرور شعبة ${esc(sectionName(id))}</label><input id="pp-pw" type="password" inputmode="numeric" autocomplete="off">${API.demo ? '<span class="muted">في وضع التجربة: 1111</span>' : ''}</div>`; }
function credFrom(id, root) { return credFor(id) || { role: 'section', id, pw: $('#pp-pw', root)?.value || '' }; }
function rememberCred(id, c) { if (c.role === 'section') { S.sec[id] = c; store.sset('iqra-sec', S.sec); } }

/* ---------- the section's home (Hub) ---------- */
function quranStatus(id) {
  const grade = id.split('-')[0]; const g = gradeOf(grade); const list = entries(grade);
  if (g.free) return 'قراءة حرة';
  if (!list.length) return 'لا توجد خطة بعد';
  const st = sectionStatus(id);
  if (st.lag > 0) return `متأخرات ${lagWords(st.lag)} عن الخطة`;
  const e = list[todayIndex(list)]; const t = todayISO();
  if (!e || e.date !== t) return e && e.date > t ? `لا حصة اليوم · القادم ${shortDate(e.date)}` : 'لا حصة اليوم';
  if (isNewDay(e)) return progOf(id, e.id)?.status === 'done' ? `✓ أنهينا مقطع اليوم: ${Q.segLabel(e.segs)}` : `مقطع اليوم: ${Q.segLabel(e.segs)}`;
  return TYPE_NAMES[e.type] + (SCORED.includes(e.type) ? ' لصفحات الأسبوع' : '');
}
function prayerStatus(id) {
  const t = todayISO(); const r = prayerOf(id, t);
  if (r) return { ok: true, text: `صلّت ${toAr(r.prayed)} من ${toAr(r.present)} ✓` };
  if (!isSchoolDay(id.split('-')[0], t)) return { text: 'لا دوام اليوم' };
  return { text: 'لم تُسجَّل صلاة الظهر بعد' };
}
function adhkarStatus(id) {
  const t = todayISO();
  if (adhkarOf(id, t)) return { ok: true, text: 'أذكار الصباح ✓' };
  if (!isSchoolDay(id.split('-')[0], t)) return { text: 'لا دوام اليوم' };
  return { text: 'لم تُقرأ أذكار الصباح بعد' };
}
function hub(id) {
  Player.stop(true); S.lesson = null;
  const g = gradeOf(id.split('-')[0]);
  const q = quranStatus(id), p = prayerStatus(id), a = adhkarStatus(id);
  frame(`<h2>${esc(sectionName(id))}</h2>
    <div class="hub-grid">
      <a class="hub-card" href="${routeOf(id, 'quran')}"><span class="hub-ico">📖</span><b>المصحف</b><span class="hub-st ${/^✓/.test(q) ? 'ok' : /متأخرات/.test(q) ? 'warn' : ''}">${esc(q)}</span></a>
      <a class="hub-card" href="${routeOf(id, 'prayer')}"><span class="hub-ico">🕌</span><b>الصلاة</b><span class="hub-st ${p.ok ? 'ok' : ''}">${esc(p.text)}</span></a>
      <a class="hub-card" href="${routeOf(id, 'adhkar')}"><span class="hub-ico">📿</span><b>الأذكار</b><span class="hub-st ${a.ok ? 'ok' : ''}">${esc(a.text)}</span></a>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-change>تغيير الشعبة</button></div>`,
    `<button data-h>الرئيسية</button> › <button data-d>${g.dept === 'basic' ? 'القسم الأساسي' : 'القسم الثانوي'}</button> › <button data-g>${esc(g.name)}</button> › <span>${esc(sectionName(id))}</span>`);
  app().querySelector('[data-change]').onclick = home;
  app().querySelector('[data-h]').onclick = home;
  app().querySelector('[data-d]').onclick = () => grades(g.dept);
  app().querySelector('[data-g]').onclick = () => sections(g.id);
}
function portalBar(id, active, title) {
  return `<div class="bar"><div class="who">${logoSVG()}<span class="chip">${esc(sectionName(id))}</span></div>${portalNav(id, active)}
    <div class="actions"><button class="btn" data-go-board>${ico('trophy')}الترتيب</button><button class="btn" data-go-home>تغيير الصف</button></div></div>`;
}
function wirePortalBar(id) {
  app().querySelector('[data-go-home]').onclick = home;
  app().querySelector('[data-go-board]').onclick = () => board(id.split('-')[0]);
}

/* ---------- prayer: Dhuhr in congregation, numbers only ---------- */
function prayerScreen(id, date) {
  Player.stop(true); S.lesson = null;
  const grade = id.split('-')[0]; const t = todayISO(); date = date || t;
  const rec = prayerOf(id, date);
  const total = countOf(id);
  let prayed = rec ? rec.prayed : 0, present = rec ? rec.present : (total || 0);
  // last 5 school days up to the chosen day
  const days = []; for (let k = 0; days.length < 5 && k < 30; k++) { const d = addDays(date, -k); if (isSchoolDay(grade, d)) days.unshift(d); }
  app().innerHTML = `<div class="page-screen">${portalBar(id, 'prayer')}
    <div class="content"><div class="card pr-card">
      <h2 style="margin:0">🕌 صلاة الظهر جماعة</h2>
      <div class="pr-date">${S.admin ? `<label class="muted" for="pr-d">اليوم</label><input id="pr-d" type="date" value="${date}" max="${t}">` : ''}<b>${esc(fmtDate(date))}</b>${date === t ? ' · اليوم' : ''}</div>
      ${!isSchoolDay(grade, date) ? '<div class="warn-box">هذا اليوم ليس يوم دوام (عطلة أو جمعة أو سبت)، فلا يُحسب في الترتيب.</div>' : ''}
      ${rec ? `<div class="pr-saved">✓ مسجّل: صلّت ${toAr(rec.prayed)} من ${toAr(rec.present)} (${toAr(pct(rec))}٪). يمكنكِ التعديل${S.admin ? '' : ' اليوم فقط'}.</div>` : ''}
      <div class="pr-grid">
        <div class="pr-box"><label for="pr-p">عدد من صلّين الظهر جماعة</label><div class="pr-step"><button type="button" data-k="p" data-d="-1" aria-label="إنقاص">−</button><input id="pr-p" type="number" inputmode="numeric" min="0" value="${prayed}"><button type="button" data-k="p" data-d="1" aria-label="زيادة">+</button></div></div>
        <div class="pr-box"><label for="pr-n">عدد الحاضرات اليوم</label><div class="pr-step"><button type="button" data-k="n" data-d="-1" aria-label="إنقاص">−</button><input id="pr-n" type="number" inputmode="numeric" min="0" value="${present}"><button type="button" data-k="n" data-d="1" aria-label="زيادة">+</button></div>
          <span class="muted">${total ? `عدد طالبات الشعبة: ${toAr(total)}` : 'لم يُحدَّد عدد طالبات الشعبة بعد (من لوحة الإدارة ← أسماء الطالبات).'}</span></div>
      </div>
      <div class="pr-pct" id="pr-pct"></div>
      ${pwField(id)}
      <div class="err-msg" id="pr-err" hidden></div>
      <button class="btn primary pr-save" data-save>${rec ? 'حفظ التعديل' : 'حفظ'}</button>
    </div>
    <div class="card"><b>آخر ٥ أيام دوام</b><div class="pr-bars">${days.map(d => { const r = prayerOf(id, d); return `<div class="pr-col ${d === date ? 'cur' : ''}"><span class="num">${r ? toAr(pct(r)) + '٪' : '—'}</span><i style="height:${r ? Math.max(4, pct(r)) : 0}%"></i><small>${shortDate(d)}</small></div>`; }).join('')}</div></div>
    </div></div>`;
  wirePortalBar(id);
  const P = $('#pr-p'), N = $('#pr-n');
  const upd = () => { const p = Math.max(0, +P.value || 0), n = Math.max(0, +N.value || 0); $('#pr-pct').innerHTML = n ? `النسبة: <b class="num">${toAr(Math.round(Math.min(p, n) / n * 100))}٪</b>` : ''; };
  app().querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const inp = b.dataset.k === 'p' ? P : N; inp.value = Math.max(0, (+inp.value || 0) + +b.dataset.d); if (+P.value > +N.value) (b.dataset.k === 'p' ? N : P).value = b.dataset.k === 'p' ? P.value : N.value; upd(); });
  P.oninput = N.oninput = upd; upd();
  const dsel = $('#pr-d'); if (dsel) dsel.onchange = () => prayerScreen(id, dsel.value || t);
  app().querySelector('[data-save]').onclick = async e => {
    const btn = e.currentTarget; const c = credFrom(id, app());
    const p = +P.value || 0, n = +N.value || 0;
    const err = m => { const x = $('#pr-err'); x.hidden = false; x.textContent = m; btn.disabled = false; };
    if (p > n) return err('عدد من صلّين أكبر من عدد الحاضرات');
    btn.disabled = true;
    try {
      const r = await API.call('savePrayer', { cred: c, rec: { section: id, date, prayed: p, present: n } });
      rememberCred(id, c);
      S.prayer = (S.prayer || []).filter(x => !(x.section === id && x.date === date)); S.prayer.push(r.rec);
      toast(`تم الحفظ: صلّت ${toAr(r.rec.prayed)} من ${toAr(r.rec.present)}`); prayerScreen(id, date);
    } catch (x) { err(x.userMessage || 'تعذّر الحفظ'); }
  };
}

/* ---------- adhkar: morning, text only ---------- */
let ADHKAR_FILE = null;
async function adhkarFile() { if (!ADHKAR_FILE) ADHKAR_FILE = await fetch('data/adhkar.json').then(r => r.json()); return ADHKAR_FILE; }
// the principal's edits (Settings.adhkar) replace the file's list
async function adhkarItems(all = false) {
  const f = await adhkarFile();
  let items = f.items;
  try { const s = JSON.parse(S.settings.adhkar || 'null'); if (s && Array.isArray(s.items)) items = s.items; } catch (e) { /* use the file */ }
  return all ? items : items.filter(x => !x.hidden && x.text);
}
async function adhkarScreen(id) {
  Player.stop(true); S.lesson = null;
  app().innerHTML = `<div class="page-screen adh-screen">${portalBar(id, 'adhkar')}<div class="adh-body"><div class="muted">جارٍ التحميل…</div></div></div>`;
  wirePortalBar(id);
  let items;
  try { items = await adhkarItems(); } catch (e) { app().querySelector('.adh-body').innerHTML = '<div class="card">تعذّر تحميل الأذكار. تأكدي من الاتصال ثم أعيدي المحاولة.</div>'; return; }
  const st = { i: 0, n: 0 };
  const t = todayISO();
  const body = app().querySelector('.adh-body');
  const draw = () => {
    const it = items[st.i]; const last = st.i === items.length - 1; const done = adhkarOf(id, t);
    const finished = last && st.n >= it.count;
    body.innerHTML = `<div class="adh-top"><b>📿 أذكار الصباح</b><span class="num">${toAr(st.i + 1)} من ${toAr(items.length)}</span>${done ? '<span class="st done">قُرئت اليوم ✓</span>' : ''}</div>
      <div class="adh-prog"><i style="width:${(st.i + (st.n >= it.count ? 1 : 0)) / items.length * 100}%"></i></div>
      <div class="adh-main">
        <button class="adh-arrow" data-nav="-1" ${st.i ? '' : 'disabled'} aria-label="الذكر السابق">${arrow('r')}</button>
        <button class="adh-card" data-tap aria-label="اضغطي للعدّ"><span class="adh-text">${esc(it.text)}</span></button>
        <button class="adh-arrow" data-nav="1" ${last ? 'disabled' : ''} aria-label="الذكر التالي">${arrow('l')}</button>
      </div>
      <div class="adh-count">${it.count > 1 ? `<span class="adh-n num">${toAr(Math.min(st.n, it.count))} / ${toAr(it.count)}</span>` : st.n ? '<span class="adh-n">✓</span>' : '<span class="adh-n muted">مرة واحدة</span>'}<span class="muted">اضغطي على الذكر للعدّ</span></div>
      <div class="adh-meta">${it.source ? `<div><b>المصدر:</b> ${esc(it.source)}</div>` : ''}${it.fadl ? `<details><summary>فضل الذكر</summary>${esc(it.fadl)}</details>` : ''}</div>
      ${finished && !done ? `<div class="adh-finish">${pwField(id)}<div class="err-msg" id="ad-err" hidden></div><button class="btn primary" data-finish>أنهينا أذكار الصباح ✓</button></div>` : ''}
      ${finished && done ? '<div class="adh-finish"><div class="pr-saved">✓ سُجّلت أذكار الصباح لهذا اليوم. بارك الله فيكنّ.</div></div>' : ''}`;
    body.querySelector('[data-tap]').onclick = () => {
      if (st.n >= it.count) { if (!last) { st.i++; st.n = 0; draw(); } return; }
      st.n++;
      if (st.n >= it.count && !last) { draw(); setTimeout(() => { if (items[st.i] === it && st.n >= it.count) { st.i++; st.n = 0; draw(); } }, 600); return; }
      draw();
    };
    body.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { st.i = Math.max(0, Math.min(items.length - 1, st.i + +b.dataset.nav)); st.n = 0; draw(); });
    const fin = body.querySelector('[data-finish]');
    if (fin) fin.onclick = async () => {
      const c = credFrom(id, body); fin.disabled = true;
      try { const r = await API.call('saveAdhkar', { cred: c, rec: { section: id, date: t, group: 'morning' } }); rememberCred(id, c); S.adhkar = (S.adhkar || []).filter(x => !(x.section === id && x.date === t && x.group === 'morning')); S.adhkar.push(r.rec); toast('سُجّلت أذكار الصباح ✓'); draw(); }
      catch (x) { const m = $('#ad-err', body); m.hidden = false; m.textContent = x.userMessage || 'تعذّر الحفظ'; fin.disabled = false; }
    };
  };
  document.onkeydown = e => { if (!document.querySelector('.adh-body')) { document.onkeydown = null; return; } if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); body.querySelector('[data-tap]')?.click(); } };
  draw();
}

/* ---------- admin: edit the adhkar ---------- */
async function adminAdhkar() {
  const host = $('#adm');
  host.innerHTML = '<div class="muted">جارٍ التحميل…</div>';
  let items = JSON.parse(JSON.stringify(await adhkarItems(true)));
  const custom = (() => { try { return !!JSON.parse(S.settings.adhkar || 'null'); } catch (e) { return false; } })();
  const draw = () => {
    host.innerHTML = `<div class="warn-box">نصوص الأذكار مأخوذة من «حصن المسلم» عبر مجموعة بيانات مفتوحة. <b>راجعيها أنتِ أو معلمة التربية الإسلامية</b> قبل استخدامها في الصفوف، وصحّحي ما يلزم هنا.</div>
      <div class="filters"><span class="muted">${custom ? 'تُعرض الآن نسختكِ المعدّلة.' : 'تُعرض الآن النسخة الأصلية من الملف.'} ${toAr(items.filter(x => !x.hidden).length)} ذكراً ظاهراً.</span>
        <div style="display:flex;gap:8px;margin-inline-start:auto;flex-wrap:wrap"><button class="btn" data-add>+ إضافة ذكر</button>${custom ? '<button class="btn" data-reset>استرجاع النسخة الأصلية</button>' : ''}<button class="btn primary" data-save>حفظ</button></div></div>
      ${items.map((x, i) => `<div class="card adm-dh ${x.hidden ? 'off' : ''}" data-i="${i}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b class="num">${toAr(i + 1)}</b>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-f="hidden" ${x.hidden ? 'checked' : ''}> إخفاء</label>
          <label style="display:flex;gap:6px;align-items:center">التكرار <input type="number" min="1" max="1000" data-f="count" value="${x.count}" style="width:6em"></label>
          <span style="margin-inline-start:auto;display:flex;gap:4px"><button class="btn sm" data-up ${i ? '' : 'disabled'} aria-label="تقديم">▲</button><button class="btn sm" data-down ${i < items.length - 1 ? '' : 'disabled'} aria-label="تأخير">▼</button></span></div>
        <textarea data-f="text" rows="3" class="adm-dh-text">${esc(x.text)}</textarea>
        <input data-f="source" value="${esc(x.source || '')}" placeholder="المصدر">
        <textarea data-f="fadl" rows="2" placeholder="الفضل (اختياري)">${esc(x.fadl || '')}</textarea></div>`).join('')}`;
    host.querySelectorAll('.adm-dh').forEach(c => {
      const x = items[+c.dataset.i];
      c.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => { const f = inp.dataset.f; x[f] = f === 'hidden' ? inp.checked : f === 'count' ? Math.max(1, +inp.value || 1) : inp.value.trim(); if (f === 'hidden') draw(); });
      c.querySelector('[data-up]').onclick = () => { const i = +c.dataset.i; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); };
      c.querySelector('[data-down]').onclick = () => { const i = +c.dataset.i; [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); };
    });
    host.querySelector('[data-add]').onclick = () => { items.push({ id: 'c' + Date.now().toString(36), text: '', count: 1, source: '' }); draw(); host.querySelector('.adm-dh:last-child textarea')?.focus(); };
    host.querySelector('[data-reset]')?.addEventListener('click', () => confirmBox('استرجاع النسخة الأصلية وحذف كل تعديلاتكِ على الأذكار؟', async () => {
      try { await API.call('saveSetting', { cred: S.admin, key: 'adhkar', value: '' }); delete S.settings.adhkar; toast('استُرجعت النسخة الأصلية'); adminAdhkar(); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
    }));
    host.querySelector('[data-save]').onclick = async () => {
      const value = JSON.stringify({ items: items.filter(x => x.text || !x.id.startsWith('c')) });
      try { await API.call('saveSetting', { cred: S.admin, key: 'adhkar', value }); S.settings.adhkar = value; toast('تم حفظ الأذكار'); adminAdhkar(); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
    };
  };
  draw();
}

/* ---------- prayer & adhkar for the principal's tracking ---------- */
function paStats(id, mk) {
  const grade = id.split('-')[0]; const t = todayISO();
  const school = schoolDaysOfMonth(grade, mk);
  const pr = school.map(d => prayerOf(id, d)).filter(r => r && r.present);
  // consecutive school days (before today) with no prayer record
  let gap = 0; for (let k = 1, seen = 0; seen < 10 && k < 40; k++) { const d = addDays(t, -k); if (!isSchoolDay(grade, d)) continue; seen++; if (prayerOf(id, d)) break; gap++; }
  return {
    pAvg: pr.length ? Math.round(pr.reduce((a, r) => a + r.prayed / r.present, 0) / pr.length * 100) : null,
    aPct: school.length ? Math.round(school.filter(d => adhkarOf(id, d)).length / school.length * 100) : null,
    prayerGap: gap, adhkarToday: !isSchoolDay(grade, t) || !!adhkarOf(id, t),
  };
}

/* ---------- monthly ranking: Quran + prayer + adhkar (out of 100) ---------- */
const DEFAULT_WEIGHTS = { quran: 50, prayer: 30, adhkar: 20 };
function weights() { try { return Object.assign({}, DEFAULT_WEIGHTS, JSON.parse(S.settings.weights || '{}')); } catch (e) { return { ...DEFAULT_WEIGHTS }; } }
function monthScores(grade, mk) {
  const t = todayISO(); const W = weights();
  const sabrDays = scoredEntries(grade).filter(e => e.type === 'sabr' && monthKey(e.date) === mk && e.date <= t);
  const school = schoolDaysOfMonth(grade, mk);
  const scored = scoredEntries(grade).filter(e => monthKey(e.date) === mk && e.date && e.date <= t);
  const rows = LETTERS.map(l => {
    const id = grade + '-' + l;
    const sabr = sabrDays.map(e => recOf(id, e.id)).filter(Boolean);
    const qAvg = sabr.length ? sabr.reduce((a, r) => a + (+r.count || 0), 0) / sabr.length : null;
    const pr = school.map(d => prayerOf(id, d)).filter(r => r && r.present);
    const pAvg = pr.length ? pr.reduce((a, r) => a + r.prayed / r.present, 0) / pr.length * 100 : null;
    const aDays = school.filter(d => adhkarOf(id, d)).length;
    return { id, letter: l, qAvg, sabrDays: sabr.length, sabrTotal: sabr.reduce((a, r) => a + (+r.count || 0), 0), pAvg, prayerDays: pr.length, prayerMissing: school.filter(d => d < t && !prayerOf(id, d)).length,
      aDays, schoolDays: school.length, late: scored.filter(e => e.date < t && !recOf(id, e.id)).length };
  });
  const best = Math.min(...rows.filter(r => r.qAvg != null).map(r => r.qAvg));
  const sumW = (W.quran + W.prayer + W.adhkar) || 1;
  rows.forEach(r => {
    r.q = r.qAvg == null ? 0 : 100 * (best + 1) / (r.qAvg + 1);
    r.p = r.pAvg == null ? 0 : r.pAvg;
    r.a = r.schoolDays ? r.aDays / r.schoolDays * 100 : 0;
    r.total = Math.round((W.quran * r.q + W.prayer * r.p + W.adhkar * r.a) / sumW * 10) / 10;
    r.active = r.qAvg != null || r.pAvg != null || r.aDays > 0;
  });
  const top = Math.max(...rows.filter(r => r.active).map(r => r.total));
  rows.forEach(r => { r.winner = r.active && r.total === top; });
  rows.sort((a, b) => b.active - a.active || b.total - a.total || a.letter.localeCompare(b.letter));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (!r.active) { r.rank = null; return; } if (r.total !== prev) { rank = i + 1; prev = r.total; } r.rank = rank; });
  return { rows, W };
}
const fmt1 = n => toAr(Math.round(n * 10) / 10).replace('.', '٫');
