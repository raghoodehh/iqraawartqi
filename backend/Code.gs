/**
 * اقرأ وارتقِ — قاعدة البيانات (Google Apps Script + Google Sheets)
 *
 * طريقة الإعداد مختصرة (التفاصيل في ملف دليل-الإعداد):
 * 1) أنشئي Google Sheet جديداً، ثم من القائمة: Extensions > Apps Script.
 * 2) احذفي المحتوى الموجود والصقي هذا الملف كاملاً، ثم احفظي.
 * 3) اختاري الدالة setup من القائمة العلوية واضغطي Run (ووافقي على الصلاحيات).
 *    ستُنشأ الأوراق وكلمات المرور، وتجدينها في ورقة "Sections".
 * 4) Deploy > New deployment > Web app:
 *      Execute as: Me   |   Who has access: Anyone
 *    ثم انسخي الرابط الذي ينتهي بـ /exec وضعيه في ملف js/config.js في الموقع.
 */

const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ'];
const GRADE_IDS = ['KG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const CELL_LIMIT = 45000;
const PROGRESS_COLS = ['section', 'entryId', 'status', 'upto', 'at', 'by'];
const STUDENTS_COLS = ['section', 'names'];
const TQ_COLS = ['id', 'grade', 'entryId', 'page', 'q', 'at', 'by'];
const MAX_NAMES = 80;

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name, header) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    if (header) { sh.appendRow(header); sh.setFrozenRows(1); }
  }
  return sh;
}
function rows_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

/** Run once from the editor. Safe to run again: it never overwrites existing passwords. */
function setup() {
  const sec = sheet_('Sections', ['id', 'password']);
  const existing = {};
  rows_('Sections').forEach(r => { existing[r[0]] = true; });
  const add = [];
  if (!existing.admin) add.push(['admin', randomPw_(6)]);
  GRADE_IDS.forEach(g => LETTERS.forEach(l => { const id = g + '-' + l; if (!existing[id]) add.push([id, randomPw_(4)]); }));
  if (add.length) sec.getRange(sec.getLastRow() + 1, 1, add.length, 2).setValues(add);
  sec.getRange('B:B').setNumberFormat('@');
  sheet_('Plans', ['grade', 'updatedAt', 'json1', 'json2', 'json3', 'json4']);
  sheet_('Errors', ['id', 'section', 'grade', 'entryId', 'date', 'type', 'count', 'at', 'by']);
  sheet_('Notes', ['key', 'text', 'at']);
  sheet_('Settings', ['key', 'value']);
  sheet_('Progress', PROGRESS_COLS);
  sheet_('Students', STUDENTS_COLS);
  sheet_('TeacherQuestions', TQ_COLS);
  const def = ss_().getSheetByName('Sheet1') || ss_().getSheetByName('الورقة1');
  if (def && ss_().getSheets().length > 1 && def.getLastRow() === 0) ss_().deleteSheet(def);
  Logger.log('تم الإعداد. كلمات المرور موجودة في ورقة Sections.');
}
function randomPw_(n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); if (s[0] === '0') s = '1' + s.slice(1); return s; }

function doGet() { return json_({ ok: true, name: 'اقرأ وارتقِ', status: 'running' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'طلب غير صالح' }); }
  try {
    const out = handle_(req);
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: err.userMessage || ('خطأ في الخادم: ' + err.message) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

function passwords_() { const pw = {}; rows_('Sections').forEach(r => { pw[String(r[0])] = String(r[1]); }); return pw; }
function check_(cred, sectionId) {
  if (!cred) fail_('يلزم تسجيل الدخول');
  const pw = passwords_();
  if (cred.role === 'admin') { if (!pw.admin || String(cred.pw) !== pw.admin) fail_('كلمة مرور المديرة غير صحيحة'); return 'admin'; }
  if (cred.role === 'section') {
    if (!pw[cred.id] || String(cred.pw) !== pw[cred.id]) fail_('كلمة مرور الشعبة غير صحيحة');
    if (sectionId && sectionId !== cred.id) fail_('هذا الحساب لا يملك صلاحية هذه الشعبة');
    return 'section';
  }
  fail_('يلزم تسجيل الدخول');
}
function adminOnly_(cred) { if (check_(cred) !== 'admin') fail_('هذه العملية للمديرة فقط'); }
function withLock_(fn) { const lock = LockService.getScriptLock(); lock.waitLock(20000); try { return fn(); } finally { lock.releaseLock(); } }

function handle_(req) {
  const a = req.action;
  if (a === 'bootstrap') return bootstrap_();
  if (a === 'login') return { role: check_(req.cred) };
  if (a === 'saveError') return withLock_(() => saveError_(req));
  if (a === 'deleteError') return withLock_(() => { adminOnly_(req.cred); deleteRow_('Errors', 0, req.id); return {}; });
  if (a === 'savePlan') return withLock_(() => { adminOnly_(req.cred); savePlan_(req.grade, req.entries); return {}; });
  if (a === 'saveNote') return withLock_(() => { adminOnly_(req.cred); saveKV_('Notes', req.key, req.text, true); return {}; });
  if (a === 'saveSetting') return withLock_(() => {
    adminOnly_(req.cred);
    if (req.key === 'tajweed' && req.value) { try { JSON.parse(req.value); } catch (e) { fail_('إعدادات الأحكام غير صالحة'); } }
    saveKV_('Settings', req.key, req.value, false); return {};
  });
  // تقدّم الشعب في الخطة
  if (a === 'saveProgress') return withLock_(() => saveProgress_(req));
  if (a === 'deleteProgress') return withLock_(() => {
    check_(req.cred, req.section);
    const data = rows_('Progress');
    const i = data.findIndex(r => String(r[0]) === String(req.section) && String(r[1]) === String(req.entryId));
    if (i >= 0) ss_().getSheetByName('Progress').deleteRow(i + 2);
    return {};
  });
  // أسماء الطالبات: لا تُعاد أبداً في bootstrap
  if (a === 'getStudents') {
    const role = check_(req.cred);
    const all = studentsMap_();
    if (role === 'admin') {
      if (req.section) { const one = {}; one[req.section] = all[req.section] || []; return { students: one }; }
      return { students: all };
    }
    const own = {}; own[req.cred.id] = all[req.cred.id] || []; return { students: own };
  }
  if (a === 'saveStudents') return withLock_(() => { adminOnly_(req.cred); return saveStudents_(req.section, req.names); });
  // أسئلة المعلمة لتحدّي القمّة
  if (a === 'getTeacherQuestions') return { questions: teacherQuestions_(req.grade) };
  if (a === 'saveTeacherQuestion') return withLock_(() => saveTeacherQuestion_(req));
  if (a === 'deleteTeacherQuestion') return withLock_(() => {
    const data = rows_('TeacherQuestions');
    const i = data.findIndex(r => String(r[0]) === String(req.id));
    if (i < 0) return {};
    gradeCheck_(req.cred, String(data[i][1]));
    ss_().getSheetByName('TeacherQuestions').deleteRow(i + 2);
    return {};
  });
  if (a === 'passwords') { adminOnly_(req.cred); return { pw: passwords_() }; }
  if (a === 'setPassword') return withLock_(() => {
    adminOnly_(req.cred);
    const v = String(req.pw || '').trim();
    if (v.length < 4) fail_('كلمة المرور يجب أن تكون 4 خانات على الأقل');
    const sh = sheet_('Sections');
    const data = rows_('Sections');
    const i = data.findIndex(r => String(r[0]) === req.id);
    if (i < 0) fail_('الحساب غير موجود');
    sh.getRange(i + 2, 2).setNumberFormat('@').setValue(v);
    return {};
  });
  fail_('عملية غير معروفة');
}

function bootstrap_() {
  const plans = {};
  rows_('Plans').forEach(r => {
    const txt = r.slice(2).join('');
    if (txt) { try { plans[String(r[0])] = JSON.parse(txt); } catch (e) { } }
  });
  const errors = rows_('Errors').filter(r => r[0]).map(r => ({
    id: String(r[0]), section: String(r[1]), grade: String(r[2]), entryId: String(r[3]),
    date: normDate_(r[4]), type: String(r[5]), count: Number(r[6]) || 0, at: r[7] instanceof Date ? r[7].toISOString() : String(r[7] || ''), by: String(r[8] || ''),
  }));
  const notes = {}; rows_('Notes').forEach(r => { if (r[0]) notes[String(r[0])] = String(r[1]); });
  const settings = {}; rows_('Settings').forEach(r => { if (r[0]) settings[String(r[0])] = String(r[1]); });
  const progress = rows_('Progress').filter(r => r[0]).map(r => ({
    section: String(r[0]), entryId: String(r[1]), status: String(r[2]), upto: String(r[3] || ''),
    at: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''), by: String(r[5] || ''),
  }));
  return { plans, errors, notes, settings, progress };
}

/* ---------- التقدّم ---------- */
function saveProgress_(req) {
  const r = req.rec || {};
  check_(req.cred, r.section);
  if (!r.section || !r.entryId) fail_('بيانات التقدّم ناقصة');
  const status = r.status === 'partial' ? 'partial' : 'done';
  const upto = status === 'partial' ? String(r.upto || '') : '';
  if (status === 'partial' && !/^\d{1,3}:\d{1,3}$/.test(upto)) fail_('حدّدي الآية التي وصلتِ إليها');
  const sh = sheet_('Progress', PROGRESS_COLS);
  const data = rows_('Progress');
  const i = data.findIndex(x => String(x[0]) === String(r.section) && String(x[1]) === String(r.entryId));
  const at = new Date();
  const row = [String(r.section), String(r.entryId), status, upto, at, req.cred.role];
  const rowNo = i >= 0 ? i + 2 : sh.getLastRow() + 1;
  sh.getRange(rowNo, 1, 1, 4).setNumberFormat('@');
  sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
  return { rec: { section: row[0], entryId: row[1], status, upto, at: at.toISOString(), by: req.cred.role } };
}

/* ---------- أسماء الطالبات ---------- */
function studentsMap_() {
  const m = {};
  rows_('Students').forEach(r => { if (r[0]) { try { m[String(r[0])] = JSON.parse(String(r[1] || '[]')); } catch (e) { m[String(r[0])] = []; } } });
  return m;
}
function saveStudents_(section, names) {
  const valid = GRADE_IDS.some(g => LETTERS.some(l => g + '-' + l === String(section)));
  if (!valid) fail_('شعبة غير معروفة');
  const clean = (Array.isArray(names) ? names : []).map(n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
  if (clean.length > MAX_NAMES) fail_('عدد الأسماء أكبر من المسموح (' + MAX_NAMES + ')');
  const sh = sheet_('Students', STUDENTS_COLS);
  const data = rows_('Students');
  const i = data.findIndex(r => String(r[0]) === String(section));
  if (!clean.length) { if (i >= 0) sh.deleteRow(i + 2); return { names: [] }; }
  const row = [String(section), JSON.stringify(clean)];
  const rng = i >= 0 ? sh.getRange(i + 2, 1, 1, 2) : sh.getRange(sh.getLastRow() + 1, 1, 1, 2);
  rng.setNumberFormat('@'); rng.setValues([row]);
  return { names: clean };
}

/* ---------- أسئلة المعلمة ---------- */
// المديرة لكل الصفوف، والشعبة لصفّها فقط
function gradeCheck_(cred, grade) {
  const role = check_(cred);
  if (role === 'section' && String(cred.id).split('-')[0] !== String(grade)) fail_('هذا الحساب لا يملك صلاحية هذا الصف');
  return role;
}
function teacherQuestions_(grade) {
  return rows_('TeacherQuestions').filter(r => r[0] && (!grade || String(r[1]) === String(grade))).map(r => {
    let q = null; try { q = JSON.parse(String(r[4] || 'null')); } catch (e) { }
    return { id: String(r[0]), grade: String(r[1]), entryId: String(r[2] || ''), page: String(r[3] || ''), q,
      at: r[5] instanceof Date ? r[5].toISOString() : String(r[5] || ''), by: String(r[6] || '') };
  }).filter(x => x.q);
}
function saveTeacherQuestion_(req) {
  const r = req.rec || {};
  if (GRADE_IDS.indexOf(String(r.grade)) < 0) fail_('صف غير معروف');
  const role = gradeCheck_(req.cred, r.grade);
  if (!r.entryId && !r.page) fail_('حدّدي اليوم أو الصفحة');
  const txt = JSON.stringify(r.q || null);
  if (!r.q || txt.length > CELL_LIMIT) fail_('السؤال غير صالح');
  const sh = sheet_('TeacherQuestions', TQ_COLS);
  const data = rows_('TeacherQuestions');
  const i = r.id ? data.findIndex(x => String(x[0]) === String(r.id)) : -1;
  if (i >= 0 && String(data[i][1]) !== String(r.grade)) gradeCheck_(req.cred, String(data[i][1]));
  const id = i >= 0 ? String(data[i][0]) : 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const at = new Date();
  const row = [id, String(r.grade), String(r.entryId || ''), String(r.page || ''), txt, at, role];
  const rowNo = i >= 0 ? i + 2 : sh.getLastRow() + 1;
  sh.getRange(rowNo, 1, 1, 5).setNumberFormat('@');
  sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
  return { rec: { id, grade: row[1], entryId: row[2], page: row[3], q: r.q, at: at.toISOString(), by: role } };
}
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function saveError_(req) {
  const r = req.rec || {};
  check_(req.cred, r.section);
  const n = Math.max(0, Math.min(999, parseInt(r.count, 10) || 0));
  const sh = sheet_('Errors', ['id', 'section', 'grade', 'entryId', 'date', 'type', 'count', 'at', 'by']);
  const data = rows_('Errors');
  let i = data.findIndex(x => String(x[1]) === r.section && String(x[3]) === r.entryId);
  const id = i >= 0 ? String(data[i][0]) : 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const at = new Date();
  const row = [id, r.section, r.grade, r.entryId, r.date || '', r.type || '', n, at, req.cred.role];
  const rowNo = i >= 0 ? i + 2 : sh.getLastRow() + 1;
  sh.getRange(rowNo, 1, 1, 6).setNumberFormat('@');
  sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
  return { rec: { id, section: r.section, grade: r.grade, entryId: r.entryId, date: r.date || '', type: r.type || '', count: n, at: at.toISOString(), by: req.cred.role } };
}
function deleteRow_(name, col, key) {
  const data = rows_(name);
  const i = data.findIndex(r => String(r[col]) === String(key));
  if (i >= 0) ss_().getSheetByName(name).deleteRow(i + 2);
}
function saveKV_(name, key, value, stamp) {
  const sh = sheet_(name);
  const data = rows_(name);
  const i = data.findIndex(r => String(r[0]) === String(key));
  if (!value) { if (i >= 0) sh.deleteRow(i + 2); return; }
  const row = stamp ? [key, value, new Date()] : [key, value];
  if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}
function savePlan_(grade, entries) {
  if (GRADE_IDS.indexOf(String(grade)) < 0) fail_('صف غير معروف');
  const txt = JSON.stringify(entries || []);
  const parts = [];
  for (let k = 0; k < txt.length; k += CELL_LIMIT) parts.push(txt.slice(k, k + CELL_LIMIT));
  if (parts.length > 4) fail_('الخطة أكبر من المسموح');
  while (parts.length < 4) parts.push('');
  const sh = sheet_('Plans', ['grade', 'updatedAt', 'json1', 'json2', 'json3', 'json4']);
  const data = rows_('Plans');
  const i = data.findIndex(r => String(r[0]) === String(grade));
  const row = [String(grade), new Date()].concat(parts);
  const rng = i >= 0 ? sh.getRange(i + 2, 1, 1, row.length) : sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
  rng.setNumberFormat('@');
  rng.setValues([row]);
}
