/* أسماء الطالبات: الإدخال في لوحة الإدارة (لصق، Excel، PDF، صور) وعجلة «مَن تقرأ؟» على شاشة الصف.
   الخصوصية: الأسماء في Google Sheet فقط، ولا تُعاد إلا بكلمة مرور (getStudents)،
   وتُحفظ على جهاز الصف بعد أول إدخال لكلمة مرور الشعبة. */

const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
};
const _libs = {};
function loadLib(name) {
  if (!_libs[name]) _libs[name] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = LIBS[name]; s.onload = res;
    s.onerror = () => { delete _libs[name]; rej(Object.assign(new Error('lib'), { userMessage: 'تعذّر تحميل أداة القراءة. تأكدي من الإنترنت ثم حاولي مرة أخرى.' })); };
    document.head.appendChild(s);
  });
  return _libs[name];
}

/* ---------- cleaning ---------- */
const AR = /[ء-ي]/g;
const NAME_JUNK = /(^|\s)(الاسم|اسم الطالبة|اسم الطالب|الأسماء|الصف|الشعبة|قائمة|الرقم|المجموع|ملاحظات|التوقيع|العلامة|م\.)(\s|$)/;
function cleanName(s) {
  return String(s || '')
    .replace(/[ً-ْٰـ]/g, '')       // تشكيل وتطويل
    .replace(/[0-9٠-٩۰-۹]+/g, ' ')  // أرقام
    .replace(/[^ء-ي\sA-Za-z'-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[-'\s]+|[-'\s]+$/g, '');
}
const namesCount = n => n === 1 ? 'اسم واحد' : n === 2 ? 'اسمان' : n >= 3 && n <= 10 ? `${toAr(n)} أسماء` : `${toAr(n)} اسماً`;
const looksLikeName = s => (s.match(AR) || []).length >= 3 && s.split(' ').length <= 6 && !NAME_JUNK.test(s);
function namesFromText(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    // a table row: keep the cell with the most Arabic letters
    const cells = line.split(/\t|\s{3,}|\|/).map(cleanName).filter(Boolean);
    if (!cells.length) return;
    const best = cells.sort((a, b) => (b.match(AR) || []).length - (a.match(AR) || []).length)[0];
    if (looksLikeName(best)) out.push(best);
  });
  return dedupe(out);
}
function dedupe(list) { const seen = new Set(); return list.filter(n => { const k = n.replace(/\s/g, ''); if (seen.has(k)) return false; seen.add(k); return true; }); }

/* ---------- readers ---------- */
async function readExcel(file) {
  await loadLib('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const width = Math.max(0, ...rows.map(r => r.length));
  // guess the names column: the most cells that look like names, plus a bonus for a "الاسم" header
  const score = c => rows.reduce((a, r) => a + (looksLikeName(cleanName(r[c])) ? 1 : 0), 0) + (rows.slice(0, 5).some(r => /اسم/.test(String(r[c]))) ? 3 : 0);
  let best = 0; for (let c = 1; c < width; c++) if (score(c) > score(best)) best = c;
  const cols = [...Array(width).keys()].map(c => ({ c, label: String(rows.slice(0, 5).map(r => r[c]).find(v => String(v).trim()) || '').slice(0, 30) || 'عمود ' + toAr(c + 1) }));
  return { rows, cols, best, pick: c => dedupe(rows.map(r => cleanName(r[c])).filter(looksLikeName)) };
}
async function pdfDoc(file) {
  await loadLib('pdf');
  pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  return pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
}
async function readPdfText(doc) {
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    // group text items into lines by their y position
    const lines = {};
    tc.items.forEach(it => { const y = Math.round(it.transform[5] / 4); (lines[y] = lines[y] || []).push(it); });
    Object.keys(lines).sort((a, b) => b - a).forEach(y => {
      text += lines[y].sort((a, b) => b.transform[4] - a.transform[4]).map(i => i.str).join('   ') + '\n';
    });
  }
  return text;
}
async function ocrImages(images, onProgress) {
  await loadLib('ocr');
  const worker = await Tesseract.createWorker('ara', 1, { logger: m => { if (m.status === 'recognizing text') onProgress && onProgress(m.progress); } });
  let text = '';
  try {
    for (let i = 0; i < images.length; i++) {
      onProgress && onProgress(0, i + 1, images.length);
      const { data } = await worker.recognize(images[i]);
      text += data.text + '\n';
    }
  } finally { await worker.terminate(); }
  return text;
}
async function pdfPagesAsImages(doc) {
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 2.2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    out.push(cv);
  }
  return out;
}

/* ---------- admin tab ---------- */
function adminNames() {
  const host = $('#adm');
  const st = { grade: store.get('iqra-nm-grade', '7'), letter: store.get('iqra-nm-letter', LETTERS[0]), list: null, busy: '' };
  const sec = () => st.grade + '-' + st.letter;
  const load = async () => {
    st.list = null; draw();
    try { const r = await API.call('getStudents', { cred: S.admin, section: sec() }); st.list = r.students[sec()] || []; }
    catch (e) { st.list = []; toast(e.userMessage || 'تعذّر تحميل الأسماء'); }
    draw();
  };
  const draw = () => {
    store.set('iqra-nm-grade', st.grade); store.set('iqra-nm-letter', st.letter);
    host.innerHTML = `<p class="muted" style="margin:0">الأسماء تُحفظ في قاعدة البيانات فقط، ولا تظهر إلا بكلمة مرور الشعبة أو المديرة. على شاشة الصف تُطلب كلمة مرور الشعبة مرة واحدة، ثم تُحفظ القائمة على ذلك الجهاز.</p>
      <div class="filters"><div class="field"><label for="nm-g">الصف</label><select id="nm-g">${GRADES.map(g => `<option value="${g.id}" ${g.id === st.grade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="nm-l">الشعبة</label><select id="nm-l">${LETTERS.map(l => `<option ${l === st.letter ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="card"><h3 style="margin:0">أسماء ${esc(sectionName(sec()))} ${st.list ? `<span class="muted num">(${toAr(st.list.length)})</span>` : ''}</h3>
        ${st.list == null ? '<p class="muted">جارٍ التحميل…</p>' : st.list.length ? `<div class="nm-chips">${st.list.map(n => `<span>${esc(n)}</span>`).join('')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-edit>تعديل القائمة</button><button class="btn danger" data-clear>حذف القائمة</button></div>` : '<p class="muted" style="margin:0">لا توجد أسماء لهذه الشعبة بعد.</p>'}
        ${st.list && !st.list.length ? `<div class="field" style="max-width:360px"><label for="nm-cnt">عدد الطالبات (لحساب نسبة الصلاة إن لم تُدخلي الأسماء)</label>
          <div style="display:flex;gap:8px"><input id="nm-cnt" type="number" min="0" max="80" value="${+countsMap()[sec()] || ''}" style="width:7em"><button class="btn" data-cnt>حفظ العدد</button></div></div>`
          : st.list ? `<span class="muted">عدد الطالبات: ${toAr(st.list.length)} (يُحسب من القائمة تلقائياً)</span>` : ''}</div>
      <h3 style="margin:4px 0 0">إضافة أسماء</h3>
      <div class="nm-ways">
        <button class="game-card" data-w="paste"><b>لصق نص</b><span>انسخي الأسماء من أي مكان والصقيها، كل اسم في سطر.</span></button>
        <label class="game-card"><b>ملف Excel</b><span>يُكتشف عمود الأسماء تلقائياً، ويمكنكِ تغييره.</span><input type="file" accept=".xlsx,.xls,.csv" data-f="excel" hidden></label>
        <label class="game-card"><b>ملف PDF</b><span>يُقرأ النص مباشرة. وإن كان ممسوحاً ضوئياً يُقرأ كصورة.</span><input type="file" accept="application/pdf" data-f="pdf" hidden></label>
        <label class="game-card"><b>صورة</b><span>صورة لقائمة الأسماء. الدقة أقل، فراجعي الأسماء جيداً.</span><input type="file" accept="image/*" multiple data-f="img" hidden></label>
      </div>
      ${st.busy ? `<div class="warn-box" id="nm-busy">${st.busy}</div>` : ''}`;
    $('#nm-g', host).onchange = e => { st.grade = e.target.value; load(); };
    $('#nm-l', host).onchange = e => { st.letter = e.target.value; load(); };
    host.querySelector('[data-edit]')?.addEventListener('click', () => review(st.list, 'edit'));
    host.querySelector('[data-cnt]')?.addEventListener('click', async () => {
      const n = Math.max(0, Math.min(80, +$('#nm-cnt', host).value || 0)); const m = countsMap();
      if (n) m[sec()] = n; else delete m[sec()];
      const value = JSON.stringify(m);
      try { await API.call('saveSetting', { cred: S.admin, key: 'counts', value }); S.settings.counts = value; toast('تم حفظ عدد الطالبات'); } catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
    });
    host.querySelector('[data-clear]')?.addEventListener('click', () => confirmBox(`حذف كل أسماء ${sectionName(sec())}؟`, () => save([])));
    host.querySelector('[data-w=paste]').onclick = () => {
      const ov = modal(`<header><h2>لصق الأسماء</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
        <textarea id="nm-paste" rows="12" placeholder="كل اسم في سطر" style="width:100%;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)"></textarea>
        <button class="btn primary" data-go>متابعة إلى المراجعة</button>`);
      $('#nm-paste', ov).focus();
      ov.querySelector('[data-go]').onclick = () => { const t = $('#nm-paste', ov).value; closeModal(); review(namesFromText(t)); };
    };
    host.querySelectorAll('input[data-f]').forEach(inp => inp.onchange = () => { const files = [...inp.files]; inp.value = ''; if (files.length) readFiles(inp.dataset.f, files); });
  };
  const busy = msg => { st.busy = msg; const b = $('#nm-busy'); if (b && msg) b.innerHTML = msg; else draw(); };
  async function readFiles(kind, files) {
    try {
      if (kind === 'excel') {
        busy('جارٍ قراءة ملف Excel…');
        const x = await readExcel(files[0]); busy('');
        const ov = modal(`<header><h2>عمود الأسماء</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
          <div class="field"><label for="nm-col">اختاري العمود الذي فيه الأسماء</label><select id="nm-col">${x.cols.map(c => `<option value="${c.c}" ${c.c === x.best ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
          <div class="muted" id="nm-prev"></div><button class="btn primary" data-go>متابعة إلى المراجعة</button>`);
        const prev = () => { const l = x.pick(+$('#nm-col', ov).value); $('#nm-prev', ov).textContent = `${namesCount(l.length)}، مثل: ${l.slice(0, 3).join('، ')}`; };
        $('#nm-col', ov).onchange = prev; prev();
        ov.querySelector('[data-go]').onclick = () => { const l = x.pick(+$('#nm-col', ov).value); closeModal(); review(l); };
        return;
      }
      let text = '', ocr = false;
      if (kind === 'pdf') {
        busy('جارٍ قراءة ملف PDF…');
        const doc = await pdfDoc(files[0]);
        text = await readPdfText(doc);
        if (namesFromText(text).length < 3) {
          ocr = true;
          busy('الملف ممسوح ضوئياً، فسيُقرأ كصورة. قد يستغرق ذلك دقيقة…');
          text = await ocrImages(await pdfPagesAsImages(doc), ocrProgress);
        }
      } else {
        ocr = true;
        busy('جارٍ قراءة الصورة… (قد يستغرق ذلك دقيقة في المرة الأولى)');
        text = await ocrImages(files, ocrProgress);
      }
      busy('');
      review(namesFromText(text), ocr ? 'ocr' : '');
    } catch (e) { busy(''); toast(e.userMessage || 'تعذّر قراءة الملف'); }
  }
  function ocrProgress(p, i, n) { const b = $('#nm-busy'); if (b) b.innerHTML = `جارٍ قراءة ${n > 1 ? `الصفحة ${toAr(i || 1)} من ${toAr(n)}` : 'الصورة'}… ${p ? toAr(Math.round(p * 100)) + '٪' : ''}`; }
  // every input method ends here: review and correct before saving
  function review(found, mode = '') {
    const existing = st.list || [];
    const ov = modal(`<header><h2>مراجعة الأسماء قبل الحفظ</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
      ${mode === 'ocr' ? '<div class="warn-box">قُرئت الأسماء من صورة، والدقة فيها أقل. راجعي كل اسم وصحّحيه قبل الحفظ.</div>' : ''}
      ${!found.length && mode !== 'edit' ? '<div class="warn-box">لم يُعثر على أسماء. يمكنكِ كتابتها هنا مباشرة، كل اسم في سطر.</div>' : ''}
      ${existing.length && mode !== 'edit' ? `<div class="field"><label>القائمة الحالية فيها ${namesCount(existing.length)}</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap"><label><input type="radio" name="nm-mode" value="add" checked> إضافة إليها</label><label><input type="radio" name="nm-mode" value="replace"> استبدالها</label></div></div>` : ''}
      <div class="field"><label for="nm-rev">الأسماء (كل اسم في سطر) – <span id="nm-count" class="num"></span></label>
        <textarea id="nm-rev" rows="14" style="width:100%;font:inherit;font-size:1.1rem;line-height:1.8;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)">${esc(found.join('\n'))}</textarea></div>
      <div style="display:flex;gap:8px"><button class="btn primary" data-save>حفظ القائمة</button><button class="btn" data-close>إلغاء</button></div>`, 'wide');
    const ta = $('#nm-rev', ov);
    const lines = () => dedupe(ta.value.split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean));
    const count = () => { $('#nm-count', ov).textContent = namesCount(lines().length); };
    ta.oninput = count; count();
    ov.querySelector('[data-save]').onclick = () => {
      const add = ov.querySelector('input[name=nm-mode]:checked')?.value === 'add';
      const list = dedupe(add ? [...existing, ...lines()] : lines());
      closeModal(); save(list);
    };
  }
  async function save(list) {
    try { const r = await API.call('saveStudents', { cred: S.admin, section: sec(), names: list }); st.list = r.names; if (r.counts) S.settings.counts = JSON.stringify(r.counts); toast(`تم حفظ ${namesCount(r.names.length)} لشعبة ${sectionName(sec())}`); draw(); }
    catch (e) { toast(e.userMessage || 'تعذّر الحفظ'); }
  }
  load();
}

/* ---------- class screen: names on this device ---------- */
const NAMES_KEY = id => 'iqra-names-' + id;
function cachedNames(id) { const v = store.get(NAMES_KEY(id), null); return v && Array.isArray(v.names) ? v.names : null; }
async function fetchNames(id, cred) {
  const r = await API.call('getStudents', { cred, section: id });
  const names = r.students[id] || [];
  store.set(NAMES_KEY(id), { names, at: new Date().toISOString() });
  return names;
}
// get the names (asks for the section password once on this device)
function withNames(id, then, refresh = false) {
  const c = !refresh && cachedNames(id);
  if (c && c.length) { then(c); return; }
  const cred = S.admin || S.sec[id];
  const done = names => {
    if (!names.length) { toast('لم تُدخل أسماء هذه الشعبة بعد. تُضاف من لوحة الإدارة ← أسماء الطالبات'); return; }
    then(names);
  };
  if (cred) { fetchNames(id, cred).then(done).catch(e => toast(e.userMessage || 'تعذّر تحميل الأسماء')); return; }
  const ov = modal(`<header><h2>أسماء ${esc(sectionName(id))}</h2><button class="btn ghost" data-close aria-label="إغلاق">✕</button></header>
    <p class="muted" style="margin:0">تُطلب كلمة مرور الشعبة مرة واحدة فقط على هذا الجهاز.</p>
    <form class="field" id="nm-f"><label for="nm-pw">كلمة مرور شعبة ${esc(sectionName(id))}</label><input id="nm-pw" type="password" inputmode="numeric" autocomplete="off" required>${API.demo ? '<span class="muted">في وضع التجربة: 1111</span>' : ''}
    <div class="err-msg" id="nm-err" hidden></div><button class="btn primary" type="submit">متابعة</button></form>`);
  $('#nm-pw', ov).focus();
  $('#nm-f', ov).onsubmit = async e => {
    e.preventDefault();
    const c2 = { role: 'section', id, pw: $('#nm-pw', ov).value };
    try { const names = await fetchNames(id, c2); S.sec[id] = c2; store.sset('iqra-sec', S.sec); closeModal(); done(names); }
    catch (err) { const m = $('#nm-err', ov); m.hidden = false; m.textContent = err.userMessage || 'تعذّر الدخول'; }
  };
}

/* ---------- «مَن تقرأ؟» picker ---------- */
const WHEEL_MAX = 40;
const shortName = n => n.split(' ').slice(0, 2).join(' ');
function openPicker(id, title = 'مَن تقرأ؟') { withNames(id, names => picker(id, names, title)); }
function picker(id, names, title) {
  const KEY = 'iqra-wheel-' + id;
  const t = todayISO();
  const st = Object.assign({ noRepeat: true, used: [], absent: { date: t, names: [] } }, store.get(KEY, {}));
  if (st.absent.date !== t) st.absent = { date: t, names: [] };   // absence is for today only
  st.used = st.used.filter(n => names.includes(n));
  const persist = () => store.set(KEY, st);
  let current = null, angle = 0, busy = false, showAbsent = false;
  // the wheel shows everyone still waiting, plus the one just chosen (so the pointer stays on her)
  const pool = () => names.filter(n => !st.absent.names.includes(n) && (n === current || !(st.noRepeat && st.used.includes(n))));
  const ov = document.createElement('div');
  ov.className = 'overlay picker-ov';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);

  const draw = () => {
    let p = pool();
    if (!p.length && st.noRepeat && st.used.length) { st.used = []; persist(); p = pool(); toast('جاء دور الجميع، فامتلأت العجلة من جديد'); }
    const cards = p.length > WHEEL_MAX;
    ov.innerHTML = `<div class="picker"><header><h2>${esc(title)} <span class="muted" style="font-size:1rem">${esc(sectionName(id))}</span></h2><button class="btn ghost" data-x aria-label="إغلاق">✕</button></header>
      <div class="pk-stage">${!p.length ? '<p class="muted">كل الطالبات غائبات اليوم.</p>'
        : cards ? `<div class="pk-card" id="pk-card"><span>${esc(current || 'اضغطي «اختاري»')}</span></div>`
        : `<div class="wheel-box"><canvas width="840" height="840" aria-label="عجلة الأسماء"></canvas><div class="wheel-pointer"></div></div>`}
        <div class="pk-result" id="pk-res" aria-live="polite">${current && !cards ? `<b>${esc(current)}</b>` : ''}</div></div>
      <div class="pk-btns">${current
        ? `<button class="btn gold pk-spin" data-spin="next">التالية</button><button class="btn pk-spin" data-spin="other" title="المختارة غير جاهزة: تعود إلى العجلة">اختيار أخرى</button>`
        : `<button class="btn gold pk-spin" data-spin="next" ${p.length ? '' : 'disabled'}>${cards ? 'اختاري' : 'أديري العجلة'}</button>`}</div>
      <div class="pk-opts"><label><input type="checkbox" data-norep ${st.noRepeat ? 'checked' : ''}> بدون تكرار حتى يأتي دور الجميع <span class="muted">(بقي ${toAr(p.length)} من ${toAr(names.length - st.absent.names.length)})</span></label>
        <button class="btn sm ${showAbsent ? 'on' : ''}" data-abs>الغياب اليوم${st.absent.names.length ? ` (${toAr(st.absent.names.length)})` : ''}</button>
        ${st.noRepeat && st.used.length ? '<button class="btn sm ghost" data-reset>بدء دورة جديدة</button>' : ''}
        <button class="btn sm ghost" data-refresh>تحديث الأسماء</button></div>
      ${showAbsent ? `<div class="pk-absent"><div class="muted">اضغطي على أسماء الغائبات لإخراجهن من العجلة اليوم فقط:</div><div class="nm-chips">${names.map(n => `<button class="${st.absent.names.includes(n) ? 'off' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''}</div>`;
    ov.querySelector('[data-x]').onclick = close;
    const cv = ov.querySelector('canvas');
    if (cv) { drawWheel(cv, p.map(n => ({ name: shortName(n) }))); cv.style.transform = `rotate(${angle}deg)`; }
    ov.querySelectorAll('[data-spin]').forEach(b => b.onclick = () => spin(b.dataset.spin));
    ov.querySelector('[data-norep]').onchange = e => { st.noRepeat = e.target.checked; persist(); current = null; draw(); };
    ov.querySelector('[data-abs]').onclick = () => { showAbsent = !showAbsent; draw(); };
    ov.querySelector('[data-reset]')?.addEventListener('click', () => { st.used = []; current = null; persist(); draw(); });
    ov.querySelector('[data-refresh]').onclick = () => withNames(id, fresh => { close(); picker(id, fresh, title); toast('حُدّثت الأسماء'); }, true);
    ov.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const n = b.dataset.n; const a = st.absent.names;
      st.absent.names = a.includes(n) ? a.filter(x => x !== n) : [...a, n];
      if (current === n) current = null;
      persist(); draw();
    });
  };
  // mode 'next': the chosen one has had her turn. mode 'other': she was not ready, so she goes back in.
  const spin = mode => {
    if (busy) return;
    const prev = current;
    if (prev && mode === 'other') st.used = st.used.filter(n => n !== prev);
    let choices = names.filter(n => !st.absent.names.includes(n) && n !== prev && !(st.noRepeat && st.used.includes(n)));
    if (!choices.length && st.noRepeat && st.used.length) { st.used = []; toast('جاء دور الجميع، فامتلأت العجلة من جديد'); choices = names.filter(n => !st.absent.names.includes(n) && n !== prev); }
    if (!choices.length) choices = names.filter(n => !st.absent.names.includes(n));
    if (!choices.length) return;
    const winner = choices[Math.floor(Math.random() * choices.length)];
    // spin on the wheel of everyone still waiting (the one before is no longer on it)
    current = null; persist(); draw();
    const p = pool(); const cards = p.length > WHEEL_MAX;
    busy = true;
    const finish = () => { busy = false; current = winner; if (st.noRepeat) st.used = [...st.used.filter(n => n !== winner), winner]; persist(); draw(); celebrate(); };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (cards) {
      const card = ov.querySelector('#pk-card'); let k = Math.floor(Math.random() * p.length), delay = 50;
      const step = () => {
        if (delay > 320 || reduce) { card.innerHTML = `<span>${esc(winner)}</span>`; setTimeout(finish, reduce ? 0 : 500); return; }
        card.classList.toggle('flip'); card.innerHTML = `<span>${esc(p[k++ % p.length])}</span>`;
        delay *= 1.12; setTimeout(step, delay);
      };
      step(); return;
    }
    // wheel: the drawn pool keeps the current one in it, so aim at the winner's index there
    const idx = p.indexOf(winner); const seg = 360 / p.length;
    const want = 360 - (idx * seg + seg / 2) + (Math.random() - .5) * seg * .6;
    angle = angle - (angle % 360) + 360 * 5 + want;
    const cv = ov.querySelector('canvas');
    ov.querySelector('#pk-res').innerHTML = '';
    void cv.offsetWidth; // the canvas was just redrawn: let it take its start angle before animating
    cv.style.transition = reduce ? 'none' : 'transform 3.6s cubic-bezier(.17,.67,.2,1)';
    cv.style.transform = `rotate(${angle}deg)`;
    setTimeout(finish, reduce ? 50 : 3700);
  };
  const celebrate = () => { const r = ov.querySelector('#pk-res b, #pk-card'); r && r.animate && r.animate([{ transform: 'scale(.85)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 450 }); };
  draw();
}
