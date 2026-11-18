/* تحدّي القمّة: توليد الأسئلة من صفحات الأسبوع، وشاشة المراجعة، ثم تشغيل اللعبة (qimma.html) داخل الموقع.
   اللعبة نفسها في qimma.html (منقولة من اللعبة الأصلية)، وأجهزة الطالبات تفتحها مباشرة دون تحميل الموقع. */

/* ---------- letters ---------- */
const QM_LETTER = /[ء-يٱ]/;
const HALQI = new Set(['ء', 'أ', 'إ', 'ؤ', 'ئ', 'ه', 'ع', 'ح', 'غ', 'خ']);
const TANWEEN = /[ً-ٍ]/;
const SUKUN = /[ْۡ]/;
// first base letter at or after position `from` in words[wi] (continuing into the following words)
function nextLetter(words, wi, from) {
  for (let w = wi; w < words.length; w++) {
    const t = words[w].t;
    for (let i = w === wi ? from : 0; i < t.length; i++) if (QM_LETTER.test(t[i])) return { ch: t[i], w, i };
  }
  return null;
}
const letterName = ch => ['أ', 'إ', 'ؤ', 'ئ'].includes(ch) ? 'الهمزة' : ch === 'ء' ? 'الهمزة' : `«${ch}»`;
const ayahWithMark = (words, from, to) => words.map((w, i) => (i === from ? '[[' : '') + w.t + (i === to ? ']]' : '')).join(' ');

/* ---------- noon / meem: rule families ---------- */
const NOON_NAMES = { izhar: 'إظهار حلقي', 9: 'إخفاء حقيقي', 11: 'إدغام بغنّة', 12: 'إدغام بلا غنّة', 14: 'إقلاب' };
const MEEM_NAMES = { izhar: 'إظهار شفوي', 10: 'إخفاء شفوي', 13: 'إدغام شفوي (مثلين صغير)' };
const NOON_WHY = {
  izhar: ch => `${ch}، وهو من حروف الحلق (ء هـ ع ح غ خ)، فتُظهَر النون بلا غنّة.`,
  9: ch => `${ch}، وهو من حروف الإخفاء الخمسة عشر، فتُخفى النون مع غنّة.`,
  11: ch => `${ch}، وهو من حروف «يَنمو»، فتُدغَم فيه إدغامًا بغنّة.`,
  12: ch => `${ch}، وهو من حرفَي اللام والراء، فتُدغَم فيه إدغامًا كاملًا بلا غنّة.`,
  14: () => 'الباء، فتُقلَب النون ميمًا مخفاة مع غنّة.',
};
const MEEM_WHY = {
  izhar: ch => `${ch}، وهو ليس باءً ولا ميمًا، فتُظهَر الميم.`,
  10: () => 'الباء، فتُخفى الميم مع غنّة.',
  13: () => 'ميم متحركة، فتُدغَم الميمان ميمًا واحدة مشدّدة مع غنّة.',
};
// where is the noon/tanween/meem for a rule segment, and which letter follows it
function nmSite(words, wi, seg, family) {
  const w = words[wi]; const [s, e] = seg;
  if (s === 0 && wi === 0 && (family === 'meem' ? w.t[0] !== 'م' : w.t[0] !== 'ن')) return null; // its noon/meem ended the previous ayah (waqf)
  if (s === 0 && wi > 0) {
    // coloured on the next word's first letter: the noon/tanween/meem ends the previous word
    const prev = words[wi - 1].t;
    return { from: wi - 1, to: wi, ch: w.t.slice(0, e).match(QM_LETTER)?.[0], tanween: TANWEEN.test(prev.slice(-3)) };
  }
  const part = w.t.slice(s, e);
  const tanween = TANWEEN.test(part);
  const key = family === 'meem' ? 'م' : 'ن';
  let at = tanween ? s + part.search(TANWEEN) : s + Math.max(0, part.indexOf(key));
  const nx = nextLetter(words, wi, at + 1);
  if (!nx) return null;
  return { from: wi, to: nx.w, ch: nx.ch, tanween };
}

/* ---------- question pool from a set of ayahs ---------- */
async function qimmaAyahs(keys) {
  const out = [];
  for (const key of keys) {
    const [s, a] = key.split(':').map(Number);
    const words = await Q.ayahWords(key);
    const info = await Q.ayah(key);
    out.push({ key, s, a, p: Q.pageOf(s, a), words, info });
  }
  return out;
}
function qimmaPool(ays, multiSura) {
  const pool = [];
  const refOf = x => (multiSura ? Q.suraName(x.s) + ' ' : '') + toAr(x.a);
  const add = (x, o) => pool.push(Object.assign({ key: x.key, page: x.p, ref: refOf(x), src: 'auto', uid: 'a' + pool.length }, o));
  const noonOn = [9, 11, 12, 14].some(ruleOn), meemOn = [10, 13].some(ruleOn);
  const opts4 = (names, right) => { const others = shuffle(Object.values(names).filter(n => n !== right)).slice(0, 3); while (others.length < 3) others.push('إقلاب'); const o = shuffle([right, ...others]); return { opts: o, a: o.indexOf(right) }; };

  ays.forEach(x => {
    const W = x.words;
    // 1) noon sakinah / tanween and meem sakinah (from the tajweed data)
    W.forEach((w, wi) => (w.j || []).forEach(seg => seg[2].forEach(r => {
      const fam = [9, 11, 12, 14].includes(r) ? 'noon' : [10, 13].includes(r) ? 'meem' : null;
      if (!fam || !ruleOn(r)) return;
      const site = nmSite(W, wi, seg, fam); if (!site || !site.ch) return;
      const names = fam === 'noon' ? NOON_NAMES : MEEM_NAMES;
      const who = fam === 'meem' ? 'الميم الساكنة' : site.tanween ? 'التنوين' : 'النون الساكنة';
      const why = (fam === 'noon' ? NOON_WHY : MEEM_WHY)[r](letterName(site.ch));
      add(x, Object.assign({ kind: fam, type: fam === 'noon' ? 'النون الساكنة والتنوين' : 'الميم الساكنة',
        q: `ما حكم ${who} في ${site.from === site.to ? 'الكلمة المظلّلة' : 'الكلمتين المظلّلتين'}؟`,
        ayah: ayahWithMark(W, site.from, site.to), exp: `جاء بعد ${who} ${why}` }, opts4(names, names[r])));
    })));
    // 2) izhar halqi / shafawi, found from the text (not coloured in the tajweed data)
    W.forEach((w, wi) => {
      const t = w.t;
      for (let i = 0; i < t.length; i++) {
        const isNoon = t[i] === 'ن' && SUKUN.test(t[i + 1] || '');
        const isTan = TANWEEN.test(t[i]);
        const isMeem = t[i] === 'م' && SUKUN.test(t[i + 1] || '');
        if (!isNoon && !isTan && !isMeem) continue;
        const nx = nextLetter(W, wi, i + 1);
        if (!nx) continue; // end of the ayah: we stop here (waqf), so no izhar question
        if (nx.w > wi && W[nx.w].t[0] === 'ٱ') continue; // hamzat al-wasl: joined with a vowel
        if ((isNoon || isTan) && noonOn && HALQI.has(nx.ch)) {
          const who = isTan ? 'التنوين' : 'النون الساكنة';
          add(x, Object.assign({ kind: 'izhar', type: 'النون الساكنة والتنوين', q: `ما حكم ${who} في ${nx.w === wi ? 'الكلمة المظلّلة' : 'الكلمتين المظلّلتين'}؟`,
            ayah: ayahWithMark(W, wi, nx.w), exp: `جاء بعد ${who} ${NOON_WHY.izhar(letterName(nx.ch))}` }, opts4(NOON_NAMES, NOON_NAMES.izhar)));
        }
        if (isMeem && meemOn && nx.ch !== 'ب' && nx.ch !== 'م') {
          add(x, Object.assign({ kind: 'izhar', type: 'الميم الساكنة', q: `ما حكم الميم الساكنة في ${nx.w === wi ? 'الكلمة المظلّلة' : 'الكلمتين المظلّلتين'}؟`,
            ayah: ayahWithMark(W, wi, nx.w), exp: `جاء بعد الميم الساكنة ${MEEM_WHY.izhar(letterName(nx.ch))}` }, opts4(MEEM_NAMES, MEEM_NAMES.izhar)));
        }
      }
    });
    // 3) where is the qalqalah?
    if (ruleOn(7) && W.length >= 4) {
      const hits = W.map((w, i) => ({ w, i, seg: (w.j || []).find(s => s[2].includes(7)) })).filter(o => o.seg);
      const letters = w => (w.t.match(/[ء-يٱ]/g) || []);
      // the ayah's last word is read with a stop: if it ends in «قطب جد» it has qalqalah too, so it is not a wrong choice
      const plain = W.filter((w, i) => !wordRules(w.j).includes(7) && letters(w).length >= 3 && !(i === W.length - 1 && 'قطبجد'.includes(letters(w).pop())));
      if (hits.length && plain.length >= 3) {
        const h = pick(hits); const ch = h.w.t.slice(h.seg[0], h.seg[1]).match(QM_LETTER)?.[0] || '';
        const o = shuffle([h.w.t, ...shuffle(plain).slice(0, 3).map(w => w.t)]);
        add(x, { kind: 'qalqalah', type: 'القلقلة', q: 'أين القلقلة في الآية؟', ayah: W.map(w => w.t).join(' '), opts: o, a: o.indexOf(h.w.t),
          exp: `في كلمة «${h.w.t}» حرف ${ch ? `«${ch}»` : 'من حروف القلقلة'} ساكن، وهو من حروف «قطب جد»، فيُقلقَل.` });
      }
    }
    // 4) how many places for a rule in the ayah?
    // places, not words: adjacent coloured pieces of one rule count once
    const by = {};
    W.forEach(w => TEACH_RULES.filter(r => r !== 1).forEach(r => {
      let prevEnd = -1;
      (w.j || []).forEach(([s, e, rs]) => { if (!rs.includes(r)) return; if (s !== prevEnd) (by[r] = by[r] || []).push(w.t); prevEnd = e; });
    }));
    Object.entries(by).forEach(([r, ws]) => {
      if (ws.length < 1 || ws.length > 4) return;
      const opts = ['موضع واحد', 'موضعان', 'ثلاثة مواضع', 'أربعة مواضع'];
      add(x, { kind: 'count', type: 'عدّ الأحكام', q: `كم موضعًا لحكم ${RULES[r].name} في الآية؟`, ayah: W.map(w => w.t).join(' '), opts, a: ws.length - 1, noShuffle: true,
        exp: `${opts[ws.length - 1]}: ${ws.map(t => `«${t}»`).join('، ')}.` });
    });
  });
  // 5) meanings (الميسّر في غريب القرآن): wrong choices are meanings of other words from the same week
  const gh = [];
  ays.forEach(x => (x.info.g || []).forEach(g => { if (!g.w.length) return; const m = cleanMeaning(g.m); if (m.length > 2) gh.push({ x, g, m, words: g.w.map(i => x.words[i]?.t).filter(Boolean).join(' ') }); }));
  const shortM = m => m.length > 70 ? m.slice(0, 68).replace(/\s+\S*$/, '') + '…' : m;
  gh.forEach(o => {
    const others = shuffle(gh.filter(y => y.m !== o.m)).map(y => shortM(y.m)).filter((v, i, a) => a.indexOf(v) === i && v !== shortM(o.m)).slice(0, 3);
    if (others.length < 3) return;
    const opts = shuffle([shortM(o.m), ...others]);
    add(o.x, { kind: 'meaning', type: 'معاني الكلمات', q: `ما معنى «${o.words}»؟`, ayah: ayahWithMark(o.x.words, Math.min(...o.g.w), Math.max(...o.g.w)), opts, a: opts.indexOf(shortM(o.m)),
      exp: `في «الميسّر في غريب القرآن»: ${o.m}` });
  });
  // 6) complete the ayah: wrong choices are endings of other ayahs of similar length
  const long = ays.filter(x => x.words.length >= 6);
  long.forEach(x => {
    const n = x.words.length, cut = Math.ceil(n / 2), m = n - cut;
    const end = x.words.slice(cut).map(w => w.t).join(' ');
    const others = shuffle(long.filter(y => y !== x)).map(y => y.words.slice(-m).map(w => w.t).join(' ')).filter((v, i, a) => v !== end && a.indexOf(v) === i).slice(0, 3);
    if (others.length < 3) return;
    const opts = shuffle([end, ...others]);
    add(x, { kind: 'complete', type: 'أكملي الآية', q: 'أكملي الآية:', ayah: x.words.slice(0, cut).map(w => w.t).join(' ') + ' …', opts, a: opts.indexOf(end),
      exp: `الآية كاملة: ﴿${x.words.map(w => w.t).join(' ')}﴾` });
  });
  // one question per (ayah, highlighted spot, kind)
  const seen = new Set();
  return pool.filter(q => { const k = q.kind + '|' + q.key + '|' + q.ayah; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- stages: the week's days (up to 3, merged if more) ---------- */
const STAGE_NAMES = [['المرحلة الأولى', 'سفح الجبل'], ['المرحلة الثانية', 'منتصف الجبل'], ['المرحلة الثالثة', 'نحو القمّة']];
function qimmaStages(L) {
  let groups = (L.parts && L.parts.length && L.part < 0 ? L.parts.map(p => ({ segs: p.segs, ids: [p.id] })) : [{ segs: L.segs || [], ids: [] }]).filter(g => g.segs.length);
  if (groups.length === 1) {
    // one portion: split by pages into up to 3 stages
    const keys = Q.keysOf(groups[0].segs); const pages = [...new Set(keys.map(k => Q.pageOf(...k.split(':').map(Number))))];
    if (pages.length > 1) groups = chunk(pages, Math.min(3, pages.length)).map(ps => ({ keys: keys.filter(k => ps.includes(Q.pageOf(...k.split(':').map(Number)))), ids: groups[0].ids }));
  }
  if (groups.length > 3) groups = chunk(groups, 3).map(gs => ({ segs: gs.flatMap(g => g.segs), ids: gs.flatMap(g => g.ids) }));
  return groups.map((g, i) => {
    const keys = g.keys || Q.keysOf(g.segs);
    const pages = [...new Set(keys.map(k => Q.pageOf(...k.split(':').map(Number))))].sort((a, b) => a - b);
    const segs = g.segs || keysToSegs(keys);
    return { keys, ids: g.ids, pages, title: STAGE_NAMES[i][0], sub: STAGE_NAMES[i][1], page: pages.length > 1 ? `${toAr(pages[0])}–${toAr(pages[pages.length - 1])}` : toAr(pages[0]), story: Q.segLabel(segs) };
  });
}
function chunk(arr, n) { const out = []; const size = Math.ceil(arr.length / n); for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function keysToSegs(keys) {
  const segs = [];
  keys.forEach(k => { const [s, a] = k.split(':').map(Number); const l = segs[segs.length - 1]; if (l && l[0] === s && l[2] === a - 1) l[2] = a; else segs.push([s, a, a]); });
  return segs;
}
// choose n questions spread over the stages, mixing the kinds
function qimmaSelect(pools, n, keep = []) {
  const total = pools.reduce((a, p) => a + p.length, 0); if (!total) return [];
  const want = pools.map(p => Math.max(p.length ? 1 : 0, Math.round(n * p.length / total)));
  while (want.reduce((a, b) => a + b, 0) > n) { const i = want.indexOf(Math.max(...want)); want[i]--; }
  // rounding can leave a few short: give them to the stages that still have questions to spare
  for (let guard = 0; want.reduce((a, b) => a + b, 0) < n && guard < 100; guard++) {
    const i = pools.map((p, k) => p.length - want[k]).reduce((best, spare, k, arr) => spare > arr[best] ? k : best, 0);
    if (pools[i].length - want[i] <= 0) break; want[i]++;
  }
  const out = [];
  pools.forEach((p, si) => {
    const mine = keep.filter(q => q.stage === si); const chosen = [...mine];
    const byKind = {}; shuffle(p).forEach(q => { if (!chosen.includes(q)) (byKind[q.kind] = byKind[q.kind] || []).push(q); });
    const kinds = shuffle(Object.keys(byKind));
    while (chosen.length < Math.max(want[si], mine.length) && kinds.some(k => byKind[k].length)) kinds.forEach(k => { if (byKind[k].length && chosen.length < want[si]) chosen.push(byKind[k].shift()); });
    out.push(...chosen.map(q => Object.assign(q, { stage: si })));
  });
  return out;
}

/* ---------- the review screen ---------- */
const Qimma = {
  async open() {
    const L = S.lesson; if (!L) return;
    const stages = qimmaStages(L);
    if (!stages.length || !stages[0].keys.length) { toast('لا توجد آيات لهذا اليوم'); return; }
    const ov = document.createElement('div'); ov.className = 'games qm-review';
    ov.innerHTML = `<div class="bar"><div class="who">${logoSVG()}<span class="chip">تحدّي القمّة ⛰️ ${esc(sectionName(L.sectionId))}</span></div><div class="actions" style="margin-inline-start:auto"><button class="btn" data-x>رجوع</button></div></div><div class="gbody"><div class="muted">جارٍ تجهيز الأسئلة من صفحات الأسبوع…</div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-x]').onclick = () => ov.remove();
    const multi = new Set(stages.flatMap(s => s.keys.map(k => k.split(':')[0]))).size > 1;
    const pools = [];
    for (const st of stages) pools.push(qimmaPool(await qimmaAyahs(st.keys), multi));
    // the teacher's own questions for these pages come back automatically
    let teacher = [];
    try {
      const r = await API.call('getTeacherQuestions', { grade: L.grade });
      teacher = (r.questions || []).map(t => {
        const si = stages.findIndex(s => s.pages.includes(+t.page) || (t.entryId && s.ids.includes(t.entryId)));
        return si < 0 ? null : Object.assign({}, t.q, { src: 'teacher', tid: t.id, page: +t.page, stage: si, uid: 't' + t.id });
      }).filter(Boolean);
    } catch (e) { /* offline: auto questions only */ }
    const st = { n: store.get('iqra-qm-n', 20), T: store.get('saffat_T', 20), stages, pools, teacher, list: [] };
    st.list = qimmaSelect(pools, Math.max(0, st.n - teacher.length), []).concat(teacher.map(t => t));
    st.list.sort((a, b) => a.stage - b.stage);
    // about two golden questions (double points)
    shuffle(st.list.filter(q => q.src === 'auto')).slice(0, Math.max(1, Math.round(st.n / 10))).forEach(q => { q.golden = true; });
    this.st = st; this.ov = ov; this.L = L;
    // names: from this device, or fetched now if a password is already known
    if (!cachedNames(L.sectionId) && (S.admin || S.sec[L.sectionId])) { try { await fetchNames(L.sectionId, S.admin || S.sec[L.sectionId]); } catch (e) { /* type names instead */ } }
    this.draw();
  },
  draw() {
    const { st, ov, L } = this;
    const names = cachedNames(L.sectionId) || [];
    const body = ov.querySelector('.gbody');
    const card = (q, i) => `<div class="qm-card ${q.golden ? 'gold' : ''}" data-u="${q.uid}">
      <div class="qm-head"><span class="num qm-n">${toAr(i + 1)}</span><span class="chip">${esc(q.type || 'سؤال')}</span>${q.src === 'teacher' ? '<span class="chip qm-mine">من أسئلتكِ</span>' : ''}${q.golden ? '<span class="chip qm-gold">⭐ ذهبي</span>' : ''}
        <span style="margin-inline-start:auto;display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn sm ${q.golden ? 'on' : ''}" data-act="gold" title="سؤال ذهبي: النقاط مضاعفة">⭐</button>
          ${q.src === 'auto' ? '<button class="btn sm" data-act="swap">🔄 استبدال</button>' : '<button class="btn sm" data-act="edit">✎ تعديل</button>'}
          <button class="btn sm danger" data-act="del">✕ حذف</button></span></div>
      <div class="qm-q">${esc(q.q)}</div>${q.ayah ? `<div class="qm-ayah">﴿${esc(q.ayah).replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>')}﴾ ${q.ref ? `<span class="muted">(${esc(q.ref)})</span>` : ''}</div>` : ''}
      <ol class="qm-opts">${q.opts.map((o, k) => `<li class="${k === q.a ? 'right' : ''}">${['▲', '◆', '●', '■'][k]} ${esc(o)}${k === q.a ? ' ✓' : ''}</li>`).join('')}</ol>
      ${q.exp ? `<div class="muted qm-exp">${esc(q.exp)}</div>` : ''}</div>`;
    let n = 0;
    body.innerHTML = `<div class="qm-top">
        <div class="field"><label for="qm-n">عدد الأسئلة</label><select id="qm-n">${[10, 15, 20, 25, 30].map(v => `<option ${v === st.n ? 'selected' : ''} value="${v}">${toAr(v)}</option>`).join('')}</select></div>
        <div class="field"><label for="qm-t">مدة كل سؤال</label><select id="qm-t">${[15, 20, 25, 30].map(v => `<option ${v === st.T ? 'selected' : ''} value="${v}">${toAr(v)} ثانية</option>`).join('')}</select></div>
        <div class="qm-names">${names.length ? `👥 ${names.length === 1 ? 'طالبة واحدة' : names.length === 2 ? 'طالبتان' : names.length <= 10 ? toAr(names.length) + ' طالبات' : toAr(names.length) + ' طالبة'}: كل طالبة تختار اسمها من القائمة` : '👥 لا توجد أسماء على هذا الجهاز، فستكتب كل طالبة اسمها. <button class="btn sm" data-names>تحميل أسماء الشعبة</button>'}</div>
        <button class="btn" data-add>+ سؤال من عندي</button>
        <button class="btn gold qm-go" data-go ${st.list.length ? '' : 'disabled'}>ابدئي اللعبة ◀</button></div>
      <p class="muted" style="margin:0">راجعي الأسئلة قبل البدء: احذفي أو استبدلي ما لا يناسب، واختاري الأسئلة الذهبية. أسئلتكِ تُحفظ وتُقترح تلقائياً في المرة القادمة لنفس الصفحات.</p>
      ${st.stages.map((s, si) => { const qs = st.list.filter(q => q.stage === si); return `<section class="qm-stage"><h3>${['🏕️', '🧗‍♀️', '🚩'][si]} ${esc(s.title)}: ${esc(s.sub)} <span class="muted" style="font-size:.9rem">الصفحة ${esc(s.page)} · ${esc(s.story)}</span></h3>
        ${qs.length ? qs.map(q => card(q, n++)).join('') : '<p class="muted">لا توجد أسئلة في هذه المرحلة.</p>'}</section>`; }).join('')}`;
    $('#qm-n', body).onchange = e => { st.n = +e.target.value; store.set('iqra-qm-n', st.n); const keep = st.list.filter(q => q.src === 'teacher'); const gold = new Set(st.list.filter(q => q.golden).map(q => q.uid)); st.list = qimmaSelect(st.pools, Math.max(0, st.n - keep.length), []).concat(keep).sort((a, b) => a.stage - b.stage); st.list.forEach(q => { q.golden = gold.has(q.uid); }); this.draw(); };
    $('#qm-t', body).onchange = e => { st.T = +e.target.value; store.set('saffat_T', st.T); };
    body.querySelector('[data-names]')?.addEventListener('click', () => withNames(L.sectionId, () => this.draw()));
    body.querySelector('[data-add]').onclick = () => this.form();
    body.querySelector('[data-go]').onclick = () => this.launch();
    body.querySelectorAll('.qm-card').forEach(c => c.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const q = st.list.find(x => x.uid === c.dataset.u); if (!q) return;
      const act = b.dataset.act;
      if (act === 'gold') q.golden = !q.golden;
      if (act === 'del') st.list = st.list.filter(x => x !== q);
      if (act === 'swap') {
        const used = new Set(st.list.map(x => x.uid));
        const same = st.pools[q.stage].filter(x => !used.has(x.uid));
        const alt = pick(same.filter(x => x.kind !== q.kind).length ? same.filter(x => x.kind !== q.kind) : same);
        if (!alt) { toast('لا توجد أسئلة أخرى في هذه المرحلة'); return; }
        Object.assign(alt, { stage: q.stage, golden: q.golden }); st.list[st.list.indexOf(q)] = alt;
      }
      if (act === 'edit') { this.form(q); return; }
      this.draw();
    }));
  },
  // the teacher's own question (story and understanding questions that are not generated)
  form(old) {
    const { st, L } = this;
    const ayKeys = st.stages.flatMap((s, si) => s.keys.map(k => ({ k, si })));
    const ov = modal(`<header><h2>${old ? 'تعديل سؤالكِ' : 'سؤال من عندكِ'}</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
      <div class="field"><label for="qf-q">السؤال</label><input id="qf-q" value="${esc(old?.q || '')}" placeholder="مثلاً: لماذا كذّب قوم شعيب نبيّهم؟"></div>
      <div class="field"><label for="qf-k">الآية</label><select id="qf-k"><option value="">بدون آية</option>${ayKeys.map(({ k }) => `<option value="${k}" ${old && old.key === k ? 'selected' : ''}>${esc(Q.suraName(+k.split(':')[0]))} ${toAr(k.split(':')[1])}</option>`).join('')}</select>
        <div class="qm-words" id="qf-w"></div><span class="muted" style="font-size:.85rem">اضغطي على الكلمات التي تريدين تظليلها.</span></div>
      ${[0, 1, 2, 3].map(i => `<div class="field qf-opt"><label><input type="radio" name="qf-a" value="${i}" ${(old ? old.a === i : i === 0) ? 'checked' : ''}> ${['▲', '◆', '●', '■'][i]} الخيار ${toAr(i + 1)}${i === 0 ? ' (اختاري الصحيح بالدائرة)' : ''}</label><input id="qf-o${i}" value="${esc(old?.opts?.[i] || '')}"></div>`).join('')}
      <div class="field"><label for="qf-e">شرح الإجابة</label><textarea id="qf-e" rows="2">${esc(old?.exp || '')}</textarea></div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="qf-g" ${old?.golden ? 'checked' : ''}> سؤال ذهبي</label>
      ${!S.admin && !S.sec[L.sectionId] ? `<div class="field"><label for="qf-pw">كلمة مرور شعبة ${esc(sectionName(L.sectionId))}</label><input id="qf-pw" type="password" inputmode="numeric" autocomplete="off">${API.demo ? '<span class="muted">في وضع التجربة: 1111</span>' : ''}</div>` : ''}
      <div class="err-msg" id="qf-err" hidden></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-save>حفظ السؤال</button>${old ? '<button class="btn danger" data-rm>حذف نهائياً</button>' : ''}</div>`, 'wide');
    let marked = new Set();
    if (old && old.ayah && old.key) { const ws = old.ayah.replace(/\]\]|\[\[/g, m => m === '[[' ? '\u0001' : '\u0002').split(' '); let on = false; ws.forEach((w, i) => { if (w.includes('\u0001')) on = true; if (on) marked.add(i); if (w.includes('\u0002')) on = false; }); }
    let words = [];
    const drawWords = async () => {
      const k = $('#qf-k', ov).value; const host = $('#qf-w', ov);
      if (!k) { words = []; host.innerHTML = ''; return; }
      words = (await Q.ayahWords(k)).map(w => w.t);
      host.innerHTML = words.map((w, i) => `<button type="button" class="${marked.has(i) ? 'on' : ''}" data-i="${i}">${esc(w)}</button>`).join(' ');
      host.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const i = +b.dataset.i; marked.has(i) ? marked.delete(i) : marked.add(i); b.classList.toggle('on'); });
    };
    $('#qf-k', ov).onchange = () => { marked = new Set(); drawWords(); };
    drawWords();
    const cred = () => S.admin || S.sec[L.sectionId] || { role: 'section', id: L.sectionId, pw: $('#qf-pw', ov)?.value || '' };
    const err = m => { const e = $('#qf-err', ov); e.hidden = false; e.textContent = m; };
    $('[data-save]', ov).onclick = async () => {
      const q = $('#qf-q', ov).value.trim(); const opts = [0, 1, 2, 3].map(i => $('#qf-o' + i, ov).value.trim());
      if (!q) return err('اكتبي السؤال'); if (opts.some(o => !o)) return err('املئي الخيارات الأربعة');
      const k = $('#qf-k', ov).value;
      const ayah = k ? words.map((w, i) => (marked.has(i) && !marked.has(i - 1) ? '[[' : '') + w + (marked.has(i) && !marked.has(i + 1) ? ']]' : '')).join(' ') : '';
      const [s, a] = k ? k.split(':').map(Number) : [0, 0];
      const si = k ? ayKeys.find(x => x.k === k).si : (old ? old.stage : 0);
      const page = k ? Q.pageOf(s, a) : (old?.page || st.stages[si].pages[0]);
      const qq = { type: 'سؤال المعلمة', q, key: k, ayah, ref: k ? toAr(a) : '', opts, a: +ov.querySelector('input[name=qf-a]:checked').value, exp: $('#qf-e', ov).value.trim(), golden: $('#qf-g', ov).checked };
      const c = cred();
      try {
        const r = await API.call('saveTeacherQuestion', { cred: c, rec: { id: old?.tid, grade: L.grade, page: String(page), entryId: st.stages[si].ids[0] || '', q: qq } });
        if (c.role === 'section') { S.sec[L.sectionId] = c; store.sset('iqra-sec', S.sec); }
        const item = Object.assign({}, qq, { src: 'teacher', tid: r.rec.id, page, stage: si, uid: 't' + r.rec.id });
        if (old) st.list[st.list.indexOf(old)] = item; else st.list.push(item);
        st.list.sort((x, y) => x.stage - y.stage);
        closeModal(); toast('حُفظ سؤالكِ، وسيُقترح تلقائياً في المرة القادمة'); this.draw();
      } catch (e) { err(e.userMessage || 'تعذّر الحفظ'); }
    };
    $('[data-rm]', ov)?.addEventListener('click', async () => {
      try { await API.call('deleteTeacherQuestion', { cred: cred(), id: old.tid }); st.list = st.list.filter(x => x !== old); closeModal(); toast('حُذف السؤال'); this.draw(); }
      catch (e) { err(e.userMessage || 'تعذّر الحذف'); }
    });
  },
  launch() {
    const { st, L } = this;
    const used = st.stages.map((s, i) => i).filter(i => st.list.some(q => q.stage === i));
    const remap = Object.fromEntries(used.map((old, i) => [old, i]));
    const questions = st.list.map(q => ({ stage: remap[q.stage], type: q.type || 'سؤال', q: q.q, ayah: q.ayah || '', ref: q.ref || '', opts: q.opts, a: q.a, exp: q.exp || '', golden: !!q.golden, noShuffle: !!q.noShuffle }));
    const stages = used.map(i => { const s = st.stages[i]; return { title: STAGE_NAMES[remap[i]][0], sub: STAGE_NAMES[remap[i]][1], page: s.page, story: s.story }; });
    const [g, l] = L.sectionId.split('-');
    const game = {
      id: L.sectionId + '|' + todayISO() + '|' + questions.map(q => q.q + q.ayah).join('').length + '|' + questions.length,
      key: 'g' + g + 's' + (LETTERS.indexOf(l) + 1), section: L.sectionId, sectionName: sectionName(L.sectionId),
      label: st.stages.map(s => s.story).join('، '), T: st.T, stages, questions, names: cachedNames(L.sectionId) || [],
    };
    try { localStorage.setItem('iqra-qimma-game', JSON.stringify(game)); } catch (e) { toast('تعذّر تجهيز اللعبة على هذا الجهاز'); return; }
    Player.stop();
    const fr = document.createElement('div'); fr.className = 'qm-frame';
    fr.innerHTML = '<iframe src="qimma.html" title="تحدّي القمّة" allow="fullscreen; autoplay"></iframe>';
    document.body.appendChild(fr);
    const onMsg = e => { if (e.origin === location.origin && e.data && e.data.t === 'qimma-exit') { fr.remove(); removeEventListener('message', onMsg); } };
    addEventListener('message', onMsg);
  },
};
