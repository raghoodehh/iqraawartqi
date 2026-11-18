/* Backend adapter: Google Apps Script web app, or a local demo store when no URL is configured. */
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ'];
const GRADES = [
  { id: 'KG', name: 'الروضة', dept: 'basic' },
  { id: '1', name: 'الأول', dept: 'basic' },
  { id: '2', name: 'الثاني', dept: 'basic' },
  { id: '3', name: 'الثالث', dept: 'basic' },
  { id: '4', name: 'الرابع', dept: 'basic' },
  { id: '5', name: 'الخامس', dept: 'basic' },
  { id: '6', name: 'السادس', dept: 'sec' },
  { id: '7', name: 'السابع', dept: 'sec' },
  { id: '8', name: 'الثامن', dept: 'sec' },
  { id: '9', name: 'التاسع', dept: 'sec' },
  { id: '10', name: 'العاشر', dept: 'sec' },
  { id: '11', name: 'الأول الثانوي', dept: 'sec' },
  { id: '12', name: 'التوجيهي', dept: 'sec', free: true, noCompetition: true },
];
const SECTIONS = GRADES.flatMap(g => LETTERS.map(l => ({ id: g.id + '-' + l, grade: g.id, letter: l })));

const API = (() => {
  const url = ((window.IQRA_CONFIG || {}).apiUrl || '').trim();
  const demo = !url;
  const KEY = 'iqra-demo-v1';
  let mem = null;

  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem) {
      mem = { plans: {}, errors: [], notes: {}, settings: {}, pw: { admin: '1234' } };
      SECTIONS.forEach(s => { mem.pw[s.id] = '1111'; });
    }
    // fields added later: keep older demo stores working
    mem.progress = mem.progress || [];
    mem.students = mem.students || {};
    mem.tq = mem.tq || [];
    mem.prayer = mem.prayer || [];
    mem.adhkar = mem.adhkar || [];
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* in-memory only */ } }
  function fail(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

  function checkCred(db, cred, sectionId) {
    if (!cred) fail('يلزم تسجيل الدخول');
    if (cred.role === 'admin') { if (cred.pw !== db.pw.admin) fail('كلمة مرور المديرة غير صحيحة'); return 'admin'; }
    if (cred.role === 'section') {
      if (db.pw[cred.id] !== cred.pw) fail('كلمة مرور الشعبة غير صحيحة');
      if (sectionId && sectionId !== cred.id) fail('هذا الحساب لا يملك صلاحية هذه الشعبة');
      return 'section';
    }
    fail('يلزم تسجيل الدخول');
  }
  function adminOnly(db, cred) { if (checkCred(db, cred) !== 'admin') fail('هذه العملية للمديرة فقط'); }
  // admin: any grade; section: its own grade only
  function gradeCheck(db, cred, grade) {
    const role = checkCred(db, cred);
    if (role === 'section' && String(cred.id).split('-')[0] !== String(grade)) fail('هذا الحساب لا يملك صلاحية هذا الصف');
    return role;
  }
  const MAX_NAMES = 80;
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // the section records only today (and may correct it today); the principal can correct any day
  function dayCheck(db, cred, section, date) {
    const role = checkCred(db, cred, section);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) fail('التاريخ غير صالح');
    if (role === 'section' && date !== localToday()) fail('يمكن للشعبة التسجيل والتعديل في اليوم نفسه فقط');
    return role;
  }

  const local = {
    bootstrap() {
      const db = load();
      // students are never returned here (bootstrap is public)
      return { plans: db.plans, errors: db.errors, notes: db.notes, settings: db.settings, progress: db.progress, prayer: db.prayer, adhkar: db.adhkar };
    },
    login({ cred }) { const db = load(); return { role: checkCred(db, cred) }; },
    saveError({ cred, rec }) {
      const db = load(); checkCred(db, cred, rec.section);
      const n = Math.max(0, Math.min(999, parseInt(rec.count, 10) || 0));
      let r = db.errors.find(x => x.section === rec.section && x.entryId === rec.entryId);
      if (!r) { r = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; db.errors.push(r); }
      Object.assign(r, { section: rec.section, grade: rec.grade, entryId: rec.entryId, date: rec.date, type: rec.type, count: n, at: new Date().toISOString(), by: cred.role });
      save(); return { rec: r };
    },
    deleteError({ cred, id }) { const db = load(); adminOnly(db, cred); db.errors = db.errors.filter(x => x.id !== id); save(); return { ok: true }; },
    savePlan({ cred, grade, entries }) { const db = load(); adminOnly(db, cred); db.plans[grade] = entries; save(); return { ok: true }; },
    saveNote({ cred, key, text }) { const db = load(); adminOnly(db, cred); if (text) db.notes[key] = text; else delete db.notes[key]; save(); return { ok: true }; },
    saveSetting({ cred, key, value }) {
      const db = load(); adminOnly(db, cred);
      if (['tajweed', 'counts', 'adhkar', 'weights'].includes(key) && value) { try { JSON.parse(value); } catch (e) { fail('الإعدادات غير صالحة'); } }
      if (value) db.settings[key] = value; else delete db.settings[key];
      save(); return { ok: true };
    },
    // progress of each section through the plan
    saveProgress({ cred, rec }) {
      const db = load(); checkCred(db, cred, rec.section);
      if (!rec.section || !rec.entryId) fail('بيانات التقدّم ناقصة');
      const status = rec.status === 'partial' ? 'partial' : 'done';
      const upto = status === 'partial' ? String(rec.upto || '') : '';
      if (status === 'partial' && !/^\d{1,3}:\d{1,3}$/.test(upto)) fail('حدّدي الآية التي وصلتِ إليها');
      let r = db.progress.find(x => x.section === rec.section && x.entryId === String(rec.entryId));
      if (!r) { r = {}; db.progress.push(r); }
      Object.assign(r, { section: rec.section, entryId: String(rec.entryId), status, upto, at: new Date().toISOString(), by: cred.role });
      save(); return { rec: { ...r } };
    },
    deleteProgress({ cred, section, entryId }) {
      const db = load(); checkCred(db, cred, section);
      db.progress = db.progress.filter(x => !(x.section === section && x.entryId === String(entryId)));
      save(); return { ok: true };
    },
    // student names (password-protected; never in bootstrap)
    getStudents({ cred, section }) {
      const db = load(); const role = checkCred(db, cred);
      if (role === 'admin') return { students: section ? { [section]: db.students[section] || [] } : { ...db.students } };
      return { students: { [cred.id]: db.students[cred.id] || [] } };
    },
    saveStudents({ cred, section, names }) {
      const db = load(); adminOnly(db, cred);
      if (!SECTIONS.some(s => s.id === section)) fail('شعبة غير معروفة');
      const clean = (Array.isArray(names) ? names : []).map(n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
      if (clean.length > MAX_NAMES) fail('عدد الأسماء أكبر من المسموح (' + MAX_NAMES + ')');
      if (clean.length) db.students[section] = clean; else delete db.students[section];
      let counts = {}; try { counts = JSON.parse(db.settings.counts || '{}'); } catch (e) { counts = {}; }
      if (clean.length) counts[section] = clean.length;
      db.settings.counts = JSON.stringify(counts);
      save(); return { names: clean, counts };
    },
    // Dhuhr prayer in congregation (numbers only) and morning adhkar
    savePrayer({ cred, rec }) {
      const db = load(); dayCheck(db, cred, rec.section, rec.date);
      const present = Math.max(0, Math.min(200, parseInt(rec.present, 10) || 0));
      const prayed = Math.max(0, Math.min(present, parseInt(rec.prayed, 10) || 0));
      if (!present) fail('عدد الحاضرات يجب أن يكون أكبر من صفر');
      let r = db.prayer.find(x => x.section === rec.section && x.date === rec.date);
      if (!r) { r = {}; db.prayer.push(r); }
      Object.assign(r, { section: rec.section, date: rec.date, prayed, present, at: new Date().toISOString() });
      save(); return { rec: { ...r } };
    },
    saveAdhkar({ cred, rec }) {
      const db = load(); dayCheck(db, cred, rec.section, rec.date);
      const group = rec.group || 'morning';
      let r = db.adhkar.find(x => x.section === rec.section && x.date === rec.date && x.group === group);
      if (!r) { r = {}; db.adhkar.push(r); }
      Object.assign(r, { section: rec.section, date: rec.date, group, at: new Date().toISOString() });
      save(); return { rec: { ...r } };
    },
    deleteAdhkar({ cred, rec }) {
      const db = load(); dayCheck(db, cred, rec.section, rec.date);
      db.adhkar = db.adhkar.filter(x => !(x.section === rec.section && x.date === rec.date && x.group === (rec.group || 'morning')));
      save(); return { ok: true };
    },
    // teacher questions for «تحدّي القمّة»
    getTeacherQuestions({ grade }) { const db = load(); return { questions: db.tq.filter(x => !grade || x.grade === String(grade)) }; },
    saveTeacherQuestion({ cred, rec }) {
      const db = load();
      if (!GRADES.some(g => g.id === String(rec.grade))) fail('صف غير معروف');
      const role = gradeCheck(db, cred, rec.grade);
      if (!rec.entryId && !rec.page) fail('حدّدي اليوم أو الصفحة');
      if (!rec.q) fail('السؤال غير صالح');
      let r = rec.id && db.tq.find(x => x.id === rec.id);
      if (r && r.grade !== String(rec.grade)) gradeCheck(db, cred, r.grade);
      if (!r) { r = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; db.tq.push(r); }
      Object.assign(r, { grade: String(rec.grade), entryId: String(rec.entryId || ''), page: String(rec.page || ''), q: rec.q, at: new Date().toISOString(), by: role });
      save(); return { rec: { ...r } };
    },
    deleteTeacherQuestion({ cred, id }) {
      const db = load(); const r = db.tq.find(x => x.id === id);
      if (!r) return { ok: true };
      gradeCheck(db, cred, r.grade);
      db.tq = db.tq.filter(x => x.id !== id); save(); return { ok: true };
    },
    passwords({ cred }) { const db = load(); adminOnly(db, cred); return { pw: db.pw }; },
    setPassword({ cred, id, pw }) {
      const db = load(); adminOnly(db, cred);
      if (!pw || String(pw).length < 4) fail('كلمة المرور يجب أن تكون 4 خانات على الأقل');
      db.pw[id] = String(pw); save(); return { ok: true };
    },
  };

  async function call(action, payload = {}) {
    if (demo) {
      await new Promise(r => setTimeout(r, 60));
      return local[action](payload);
    }
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, ...payload }) });
    } catch (e) { fail('تعذّر الاتصال بقاعدة البيانات. تأكدي من الإنترنت ثم حاولي مرة أخرى.'); }
    let data;
    try { data = await res.json(); } catch (e) { fail('ردّ غير متوقع من قاعدة البيانات. راجعي رابط Apps Script في ملف config.js.'); }
    if (!data || data.ok === false) fail((data && data.error) || 'حدث خطأ في قاعدة البيانات');
    return data;
  }

  return { demo, call };
})();
