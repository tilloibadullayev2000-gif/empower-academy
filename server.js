const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'empower_academy_secret_key_2026';
const CLOSE_MONTH_DELETE_PASSWORD = process.env.CLOSE_MONTH_DELETE_PASSWORD || '972400660';

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Papkalarni avtomatik aniqlash (frontend va uploads)
const FRONTEND_DIR = __dirname;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(FRONTEND_DIR));

// Mobil ilova (APK) uchun alohida sahifa
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'mobile.html'));
});

const dbPath = path.join(__dirname, 'empower.db');
const db = new sqlite3.Database(dbPath);

const SKILL_KEYS = ['grammar', 'listening', 'reading', 'vocabulary', 'writing', 'speaking'];
const SKILL_LABELS = {
  grammar: 'Grammar',
  listening: 'Listening',
  reading: 'Reading',
  vocabulary: 'Vocabulary',
  writing: 'Writing',
  speaking: 'Speaking'
};

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'mp3', 'mp4'
]);

function saveBase64File(base64Str, prefix = 'file', originalName = '') {
  if (!base64Str || typeof base64Str !== 'string') return null;
  const trimmed = base64Str.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('http')) return trimmed;

  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
  let ext = path.extname(originalName || '').replace('.', '').toLowerCase() || 'jpg';
  let dataPart = trimmed;

  if (match) {
    const mime = match[1].toLowerCase();
    dataPart = match[2];
    if (!originalName) {
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('pdf')) ext = 'pdf';
      else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
      else if (mime.includes('mp4')) ext = 'mp4';
      else ext = 'jpg';
    }
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    ext = 'bin';
  }

  const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
  const fullPath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(fullPath, Buffer.from(dataPart, 'base64'));
  return `/uploads/${fileName}`;
}

function calcSkillsAvg(user) {
  const skills = SKILL_KEYS.map((k) => Number(user[k]) || 0);
  return Math.round(skills.reduce((a, b) => a + b, 0) / skills.length);
}

// 50% ko'nikmalar o'rtachasi + 50% baholangan uyga vazifalar o'rtachasi
function calcStudentOverallScore(user, gradedSubmissions = []) {
  const skillsAvg = calcSkillsAvg(user);
  const validGrades = (gradedSubmissions || [])
    .map((s) => Number(s.grade))
    .filter((g) => Number.isFinite(g));

  if (validGrades.length === 0) {
    return {
      overallScore: skillsAvg,
      skillsAvg,
      homeworkAvg: null,
      gradedHomeworkCount: 0
    };
  }

  const homeworkAvg = Math.round(
    validGrades.reduce((acc, g) => acc + g, 0) / validGrades.length
  );
  const overallScore = Math.round(skillsAvg * 0.5 + homeworkAvg * 0.5);

  return {
    overallScore,
    skillsAvg,
    homeworkAvg,
    gradedHomeworkCount: validGrades.length
  };
}

async function getGradedSubmissionsByStudentMap() {
  const rows = await dbAll(
    `SELECT student_id, grade FROM assignment_submissions WHERE grade IS NOT NULL`
  );
  const map = new Map();
  for (const r of rows) {
    const num = Number(r.grade);
    if (!Number.isFinite(num)) continue;
    if (!map.has(r.student_id)) map.set(r.student_id, []);
    map.get(r.student_id).push({ grade: num });
  }
  return map;
}

function clampScore(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

async function ensureUserExtraColumns() {
  const cols = await dbAll(`PRAGMA table_info(users)`);
  const names = cols.map((c) => c.name);
  if (!names.includes('photo_url')) {
    await dbRun(`ALTER TABLE users ADD COLUMN photo_url TEXT`).catch(() => {});
  }
  if (!names.includes('phone')) {
    await dbRun(`ALTER TABLE users ADD COLUMN phone TEXT`).catch(() => {});
  }
}

async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      level TEXT DEFAULT 'B1',
      group_name TEXT DEFAULT 'General English',
      phone TEXT,
      photo_url TEXT,
      balance REAL DEFAULT 0,
      monthly_fee REAL DEFAULT 500000,
      grammar INTEGER DEFAULT 0,
      listening INTEGER DEFAULT 0,
      reading INTEGER DEFAULT 0,
      vocabulary INTEGER DEFAULT 0,
      writing INTEGER DEFAULT 0,
      speaking INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await ensureUserExtraColumns();

  await dbRun(`
    CREATE TABLE IF NOT EXISTS skill_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      grammar INTEGER DEFAULT 0,
      listening INTEGER DEFAULT 0,
      reading INTEGER DEFAULT 0,
      vocabulary INTEGER DEFAULT 0,
      writing INTEGER DEFAULT 0,
      speaking INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      lesson_date TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      level TEXT DEFAULT 'ALL',
      material_url TEXT,
      file_url TEXT,
      file_name TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      level TEXT DEFAULT 'ALL',
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      answer_text TEXT,
      answer_url TEXT,
      grade INTEGER,
      teacher_feedback TEXT,
      submitted_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_level TEXT DEFAULT 'ALL',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      level TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      lesson_time TEXT NOT NULL,
      room_or_teacher TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS monthly_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      full_name TEXT,
      level TEXT,
      group_name TEXT,
      avg_score REAL DEFAULT 0,
      skills_json TEXT,
      attendance_percent REAL DEFAULT 0,
      present_count INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      monthly_fee REAL DEFAULT 0,
      balance_before REAL DEFAULT 0,
      balance_after REAL DEFAULT 0,
      closed_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS history_clear_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_key TEXT NOT NULL,
      cleared_by TEXT NOT NULL,
      cleared_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  const adminExists = await dbGet(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    await dbRun(
      `INSERT INTO users (full_name, username, password, role) VALUES (?, ?, ?, 'admin')`,
      ['Super Admin', 'admin', hash]
    );
  }
}

async function recalculateStudentSkillsFromEvaluations(studentId) {
  const allEvals = await dbAll(
    `SELECT grammar, listening, reading, vocabulary, writing, speaking FROM skill_evaluations WHERE student_id = ?`,
    [studentId]
  );

  const averages = {};
  for (const key of SKILL_KEYS) {
    const sum = allEvals.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
    averages[key] = allEvals.length > 0 ? Math.round(sum / allEvals.length) : 0;
  }

  await dbRun(
    `UPDATE users SET grammar=?, listening=?, reading=?, vocabulary=?, writing=?, speaking=?
     WHERE id=? AND role='student'`,
    [
      averages.grammar,
      averages.listening,
      averages.reading,
      averages.vocabulary,
      averages.writing,
      averages.speaking,
      studentId
    ]
  );

  return averages;
}

async function recordAndRecalculateSkills(studentId, body, actorName = 'system') {
  const existing = await dbGet(
    `SELECT id, grammar, listening, reading, vocabulary, writing, speaking FROM users WHERE id = ? AND role = 'student'`,
    [studentId]
  );
  if (!existing) {
    throw new Error('O‘quvchi topilmadi!');
  }

  const historyRows = await dbAll(
    `SELECT grammar, listening, reading, vocabulary, writing, speaking FROM skill_evaluations WHERE student_id = ?`,
    [studentId]
  );

  const hasAnyNonZero = SKILL_KEYS.some((k) => Number(existing[k]) > 0);
  if (historyRows.length === 0 && hasAnyNonZero) {
    await dbRun(
      `INSERT INTO skill_evaluations (student_id, grammar, listening, reading, vocabulary, writing, speaking, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        clampScore(existing.grammar),
        clampScore(existing.listening),
        clampScore(existing.reading),
        clampScore(existing.vocabulary),
        clampScore(existing.writing),
        clampScore(existing.speaking),
        'initial'
      ]
    );
  }

  const newEntry = {
    grammar: clampScore(body.grammar),
    listening: clampScore(body.listening),
    reading: clampScore(body.reading),
    vocabulary: clampScore(body.vocabulary),
    writing: clampScore(body.writing),
    speaking: clampScore(body.speaking)
  };

  await dbRun(
    `INSERT INTO skill_evaluations (student_id, grammar, listening, reading, vocabulary, writing, speaking, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      studentId,
      newEntry.grammar,
      newEntry.listening,
      newEntry.reading,
      newEntry.vocabulary,
      newEntry.writing,
      newEntry.speaking,
      actorName
    ]
  );

  return await recalculateStudentSkillsFromEvaluations(studentId);
}

// Har bir o'quvchi uchun o'tgan oy davomat, uyga vazifa va pul hisobotini yig'ish
async function buildStudentMonthDetail(student, monthKey, gradedSubmissionsForScore, chargeFee) {
  const attRows = await dbAll(
    `SELECT lesson_date, status FROM attendance
     WHERE student_id = ? AND strftime('%Y-%m', lesson_date) = ?
     ORDER BY lesson_date ASC`,
    [student.id, monthKey]
  );

  const totalClasses = attRows.length;
  const presentCount = attRows.filter((r) =>
    ['present', 'keldi', 'bor', '1', 'true'].includes(String(r.status || '').trim().toLowerCase())
  ).length;
  const absentCount = attRows.filter((r) =>
    ['absent', 'kelmadi', 'yoq'].includes(String(r.status || '').trim().toLowerCase())
  ).length;
  const excusedCount = attRows.filter((r) =>
    ['excused', 'sababli'].includes(String(r.status || '').trim().toLowerCase())
  ).length;
  const attendancePercent = totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0;

  const hwRows = await dbAll(
    `SELECT sub.id, sub.grade, sub.teacher_feedback, sub.submitted_at, a.title
     FROM assignment_submissions sub
     LEFT JOIN assignments a ON a.id = sub.assignment_id
     WHERE sub.student_id = ?
     ORDER BY sub.id DESC`,
    [student.id]
  );

  const gradedHw = hwRows.filter(
    (h) => h.grade !== null && h.grade !== undefined && String(h.grade).trim() !== ''
  );
  const homeworkAvg = gradedHw.length > 0
    ? Math.round(gradedHw.reduce((acc, h) => acc + Number(h.grade), 0) / gradedHw.length)
    : null;

  const scoreInfo = calcStudentOverallScore(student, gradedSubmissionsForScore || []);
  const monthlyFee = Number(student.monthly_fee) || 0;
  const balanceBefore = Number(student.balance) || 0;
  const appliedFee = chargeFee ? monthlyFee : 0;
  const balanceAfter = balanceBefore - appliedFee;

  return {
    student_id: student.id,
    full_name: student.full_name || 'Student',
    level: student.level || '-',
    group_name: student.group_name || '-',
    avg_score: scoreInfo.overallScore,
    skills_avg: scoreInfo.skillsAvg,
    homework_avg: homeworkAvg,
    homework_total_count: hwRows.length,
    homework_graded_count: gradedHw.length,
    homework_items: gradedHw.map((h) => ({
      title: h.title || 'Uyga vazifa',
      grade: Number(h.grade),
      feedback: h.teacher_feedback || '',
      submitted_at: h.submitted_at || ''
    })),
    attendance_percent: attendancePercent,
    present_count: presentCount,
    absent_count: absentCount,
    excused_count: excusedCount,
    total_count: totalClasses,
    monthly_fee: appliedFee,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    debt_amount: balanceAfter < 0 ? Math.abs(balanceAfter) : 0
  };
}

function parseClosingRow(row) {
  let meta = {};
  try {
    meta = row.skills_json ? JSON.parse(row.skills_json) : {};
  } catch (_) {
    meta = {};
  }
  const balanceAfter = Number(row.balance_after) || 0;
  return {
    id: row.id,
    month_key: row.month_key,
    student_id: row.student_id,
    full_name: row.full_name || 'Student',
    level: row.level || '-',
    group_name: row.group_name || '-',
    avg_score: Number(row.avg_score) || 0,
    skills_avg: meta.skills_avg ?? 0,
    homework_avg: meta.homework_avg ?? null,
    homework_total_count: meta.homework_total_count ?? 0,
    homework_graded_count: meta.homework_graded_count ?? 0,
    homework_items: Array.isArray(meta.homework_items) ? meta.homework_items : [],
    attendance_percent: Number(row.attendance_percent) || 0,
    present_count: Number(row.present_count) || 0,
    absent_count: Number(meta.absent_count) || 0,
    excused_count: Number(meta.excused_count) || 0,
    total_count: Number(row.total_count) || 0,
    monthly_fee: Number(row.monthly_fee) || 0,
    balance_before: Number(row.balance_before) || 0,
    balance_after: balanceAfter,
    debt_amount: balanceAfter < 0 ? Math.abs(balanceAfter) : 0,
    closed_at: row.closed_at
  };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token yo‘q' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Faqat admin uchun!' });
  }
  next();
}

function teacherOrAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'Ruxsat yo‘q!' });
  }
  next();
}

async function verifyAdminPassword(userId, password) {
  const admin = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!admin) throw new Error('Admin topilmadi');
  if (String(password || '').trim() === CLOSE_MONTH_DELETE_PASSWORD) return admin;
  if (bcrypt.compareSync(String(password || ''), admin.password)) return admin;
  throw new Error('Parol noto‘g‘ri!');
}

async function insertAttendanceRecords(lesson_date, records) {
  for (const r of records) {
    await dbRun(
      `DELETE FROM attendance WHERE student_id = ? AND lesson_date = ?`,
      [r.student_id, lesson_date]
    );
    await dbRun(
      `INSERT INTO attendance (student_id, lesson_date, status) VALUES (?, ?, ?)`,
      [r.student_id, lesson_date, r.status]
    );
  }
}

async function createLessonRecord(body) {
  const { title, level, material_url, description, file_base64, file_name } = body;
  const savedFileUrl = saveBase64File(file_base64, 'lesson', file_name);
  await dbRun(
    `INSERT INTO lessons (title, level, material_url, file_url, file_name, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, level || 'ALL', material_url || '', savedFileUrl || '', file_name || '', description || '']
  );
}

// ==========================================
// LOGIN
// ==========================================

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await dbGet(`SELECT * FROM users WHERE username = ?`, [(username || '').trim()]);
    if (!user || !bcrypt.compareSync(String(password || ''), user.password)) {
      return res.status(401).json({ error: 'Login yoki parol noto‘g‘ri!' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      role: user.role,
      full_name: user.full_name,
      photo_url: user.photo_url || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN: O'QITUVCHILAR (TELEFON + RASM BILAN)
// ==========================================

app.get('/api/admin/teachers', authMiddleware, adminOnly, async (req, res) => {
  try {
    await ensureUserExtraColumns();
    const rows = await dbAll(
      `SELECT id, full_name, username, phone, photo_url
       FROM users WHERE role = 'teacher' ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/teachers', authMiddleware, adminOnly, async (req, res) => {
  try {
    await ensureUserExtraColumns();
    const { full_name, username, password, phone, photo_base64, photo_url, avatar_url, photo_name } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Ism, login va parol majburiy!' });
    }
    const hashed = bcrypt.hashSync(String(password), 10);
    const rawPhoto = photo_base64 || photo_url || avatar_url || '';
    const savedPhotoUrl = saveBase64File(rawPhoto, 'teacher', photo_name);

    const result = await dbRun(
      `INSERT INTO users (full_name, username, password, role, phone, photo_url)
       VALUES (?, ?, ?, 'teacher', ?, ?)`,
      [full_name.trim(), username.trim(), hashed, (phone || '').trim(), savedPhotoUrl]
    );
    res.json({ message: 'O‘qituvchi qo‘shildi!', id: result.lastID, photo_url: savedPhotoUrl });
  } catch (err) {
    res.status(400).json({ error: 'Bu login band yoki ma’lumot xato: ' + err.message });
  }
});

app.delete('/api/admin/teachers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbRun(`DELETE FROM users WHERE id = ? AND role = 'teacher'`, [req.params.id]);
    res.json({ message: 'O‘qituvchi o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// O'QITUVCHI KABINETI API MARSHRUTLARI
// ==========================================

app.get('/api/teacher/dashboard', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    await ensureUserExtraColumns();
    const teacher = await dbGet(
      `SELECT id, full_name, username, phone, photo_url FROM users WHERE id = ?`,
      [req.user.id]
    );
    const students = await dbAll(
      `SELECT id, full_name, username, level, group_name, photo_url,
              grammar, listening, reading, vocabulary, writing, speaking
       FROM users WHERE role = 'student' ORDER BY id DESC`
    );
    const gradedMap = await getGradedSubmissionsByStudentMap();

    const enrichedStudents = students.map((s) => {
      const scoreInfo = calcStudentOverallScore(s, gradedMap.get(s.id) || []);
      return {
        ...s,
        skills_avg: scoreInfo.skillsAvg,
        homework_avg: scoreInfo.homeworkAvg,
        avg_score: scoreInfo.overallScore
      };
    });

    const lessons = await dbAll(`SELECT * FROM lessons ORDER BY id DESC`);
    const assignments = await dbAll(`SELECT * FROM assignments ORDER BY id DESC`);
    const submissions = await dbAll(
      `SELECT sub.*, u.full_name, u.level, a.title as assignment_title
       FROM assignment_submissions sub
       JOIN users u ON u.id = sub.student_id
       JOIN assignments a ON a.id = sub.assignment_id
       ORDER BY sub.id DESC`
    );
    const schedules = await dbAll(`SELECT * FROM schedules ORDER BY id DESC`);

    const groupSummaryMap = new Map();
    for (const s of enrichedStudents) {
      const key = `${s.group_name || 'General'}__${s.level || 'ALL'}`;
      if (!groupSummaryMap.has(key)) {
        groupSummaryMap.set(key, {
          group_name: s.group_name || 'General',
          level: s.level || 'ALL',
          students_count: 0,
          score_sum: 0
        });
      }
      const g = groupSummaryMap.get(key);
      g.students_count += 1;
      g.score_sum += s.avg_score;
    }

    const groupsSummary = Array.from(groupSummaryMap.values()).map((g) => ({
      group_name: g.group_name,
      level: g.level,
      students_count: g.students_count,
      avg_score: g.students_count > 0 ? Math.round(g.score_sum / g.students_count) : 0
    }));

    res.json({
      teacher,
      students: enrichedStudents,
      groupsSummary,
      lessons,
      assignments,
      submissions,
      schedules
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/students', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    await ensureUserExtraColumns();
    const { group, level } = req.query;
    const conditions = [`role = 'student'`];
    const params = [];

    if (group && String(group).trim()) {
      conditions.push(`group_name = ?`);
      params.push(String(group).trim());
    }
    if (level && String(level).trim() && String(level).trim().toUpperCase() !== 'ALL') {
      conditions.push(`level = ?`);
      params.push(String(level).trim());
    }

    const rows = await dbAll(
      `SELECT id, full_name, username, level, group_name, photo_url,
              grammar, listening, reading, vocabulary, writing, speaking
       FROM users WHERE ${conditions.join(' AND ')} ORDER BY id DESC`,
      params
    );
    const gradedMap = await getGradedSubmissionsByStudentMap();

    res.json(
      rows.map((s) => {
        const scoreInfo = calcStudentOverallScore(s, gradedMap.get(s.id) || []);
        return {
          ...s,
          skills_avg: scoreInfo.skillsAvg,
          homework_avg: scoreInfo.homeworkAvg,
          avg_score: scoreInfo.overallScore
        };
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/attendance', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const { date, group } = req.query;
    const conditions = [];
    const params = [];

    if (date && String(date).trim()) {
      conditions.push(`a.lesson_date = ?`);
      params.push(String(date).trim());
    }
    if (group && String(group).trim()) {
      conditions.push(`u.group_name = ?`);
      params.push(String(group).trim());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await dbAll(
      `SELECT a.id, a.lesson_date, a.status, u.full_name, u.group_name, u.level
       FROM attendance a JOIN users u ON u.id = a.student_id
       ${whereClause}
       ORDER BY a.id DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/lessons', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM lessons ORDER BY id DESC`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/assignments', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const assignments = await dbAll(`SELECT * FROM assignments ORDER BY id DESC`);
    const submissions = await dbAll(
      `SELECT sub.*, u.full_name, u.level, a.title as assignment_title
       FROM assignment_submissions sub
       JOIN users u ON u.id = sub.student_id
       JOIN assignments a ON a.id = sub.assignment_id
       ORDER BY sub.id DESC`
    );
    res.json({ assignments, submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/attendance', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const { student_id, lesson_date, status } = req.body;
    await insertAttendanceRecords(lesson_date, [{ student_id, status }]);
    res.json({ message: 'Davomat saqlandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/attendance/bulk', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const { lesson_date, records } = req.body;
    await insertAttendanceRecords(lesson_date, records || []);
    res.json({ message: 'Davomat saqlandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teacher/skills/:id', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const averages = await recordAndRecalculateSkills(
      req.params.id,
      req.body,
      req.user.full_name || req.user.username || 'teacher'
    );
    res.json({ message: 'Yangi baho qo‘shildi va o‘rtacha ball hisoblandi!', averages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/skill-evaluations', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT se.*, u.full_name
       FROM skill_evaluations se
       JOIN users u ON u.id = se.student_id
       ORDER BY se.id DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/lessons', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    await createLessonRecord(req.body);
    res.json({ message: 'Darslik yuklandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teacher/assignments', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const { title, description, level, due_date } = req.body;
    await dbRun(
      `INSERT INTO assignments (title, description, level, due_date) VALUES (?, ?, ?, ?)`,
      [title, description, level || 'ALL', due_date || '']
    );
    res.json({ message: 'Vazifa yaratildi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teacher/submissions/:id/grade', authMiddleware, teacherOrAdmin, async (req, res) => {
  try {
    const { grade, teacher_feedback } = req.body;
    await dbRun(
      `UPDATE assignment_submissions SET grade = ?, teacher_feedback = ? WHERE id = ?`,
      [clampScore(grade), teacher_feedback || '', req.params.id]
    );
    res.json({ message: 'Vazifa baholandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN: OYLIK YAKUN, HISOBOTLAR & STATISTIKA
// ==========================================

app.get('/api/admin/monthly-closings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { month_key, student_id } = req.query;

    const closings = await dbAll(
      `SELECT month_key,
              COUNT(*) as students_count,
              ROUND(AVG(avg_score), 1) as avg_score,
              ROUND(AVG(attendance_percent), 1) as avg_attendance,
              SUM(CASE WHEN balance_after < 0 THEN ABS(balance_after) ELSE 0 END) as total_debt,
              MAX(closed_at) as closed_at
       FROM monthly_closings
       GROUP BY month_key
       ORDER BY month_key DESC`
    );

    const yearlyLeaders = await dbAll(
      `SELECT student_id, full_name, level,
              ROUND(AVG(avg_score), 1) as yearly_avg,
              MAX(avg_score) as best_score
       FROM monthly_closings
       GROUP BY student_id
       ORDER BY yearly_avg DESC, best_score DESC`
    );

    const conditions = [];
    const params = [];
    if (month_key && String(month_key).trim()) {
      conditions.push(`month_key = ?`);
      params.push(String(month_key).trim());
    }
    if (student_id && String(student_id).trim()) {
      conditions.push(`student_id = ?`);
      params.push(Number(student_id));
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const detailRows = await dbAll(
      `SELECT * FROM monthly_closings ${whereSql} ORDER BY month_key DESC, full_name ASC`,
      params
    );
    const studentReports = detailRows.map(parseClosingRow);

    res.json({ closings, yearly_leaders: yearlyLeaders, student_reports: studentReports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/monthly-close/:monthKey', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (String(password || '').trim() !== CLOSE_MONTH_DELETE_PASSWORD) {
      return res.status(403).json({ error: 'Parol noto‘g‘ri!' });
    }

    const cleanMonth = decodeURIComponent(req.params.monthKey || '').trim();
    if (!cleanMonth) return res.status(400).json({ error: 'Oy kaliti topilmadi' });

    const row = await dbGet(`SELECT COUNT(*) as cnt FROM monthly_closings WHERE month_key = ?`, [cleanMonth]);
    if (!row || Number(row.cnt) === 0) {
      return res.status(404).json({ error: `${cleanMonth} oyi arxivi topilmadi` });
    }

    await dbRun('BEGIN TRANSACTION');
    await dbRun(`DELETE FROM monthly_closings WHERE month_key = ?`, [cleanMonth]);
    await dbRun(`DELETE FROM transactions WHERE type = 'charge' AND description LIKE ?`, [`${cleanMonth} oy yakuni%`]);
    await dbRun(
      `INSERT INTO history_clear_logs (section_key, cleared_by) VALUES (?, ?)`,
      [`monthly_close:${cleanMonth}`, req.user.username || 'admin']
    );
    await dbRun('COMMIT');

    res.json({ message: `${cleanMonth} oy yopilishi o‘chirildi!` });
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/close-month', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      month_key,
      reset_skills = true,
      charge_fee = true,
      clear_month_attendance = true,
      clear_lessons = true,
      clear_assignments = true
    } = req.body || {};

    if (!month_key || !/^\d{4}-\d{2}$/.test(String(month_key).trim())) {
      return res.status(400).json({
        error: "Oy formati YYYY-MM ko'rinishida bo'lishi kerak (masalan: 2026-11)"
      });
    }

    const cleanMonth = String(month_key).trim();
    const existing = await dbGet(`SELECT COUNT(*) as cnt FROM monthly_closings WHERE month_key = ?`, [cleanMonth]);
    if (existing && Number(existing.cnt) > 0) {
      return res.status(400).json({ error: `${cleanMonth} oyi allaqachon yopilgan!` });
    }

    const students = await dbAll(
      `SELECT id, full_name, level, group_name, balance, monthly_fee,
              grammar, listening, reading, vocabulary, writing, speaking
       FROM users WHERE role = 'student'`
    );
    const gradedMap = await getGradedSubmissionsByStudentMap();

    const studentReports = [];

    await dbRun('BEGIN TRANSACTION');

    for (const st of students) {
      const grammar = Number(st.grammar) || 0;
      const listening = Number(st.listening) || 0;
      const reading = Number(st.reading) || 0;
      const vocabulary = Number(st.vocabulary) || 0;
      const writing = Number(st.writing) || 0;
      const speaking = Number(st.speaking) || 0;

      const report = await buildStudentMonthDetail(
        st,
        cleanMonth,
        gradedMap.get(st.id) || [],
        Boolean(charge_fee)
      );
      studentReports.push(report);

      await dbRun(
        `INSERT INTO monthly_closings (
          month_key, student_id, full_name, level, group_name,
          avg_score, skills_json, attendance_percent, present_count, total_count,
          monthly_fee, balance_before, balance_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanMonth,
          st.id,
          report.full_name,
          report.level,
          report.group_name,
          report.avg_score,
          JSON.stringify({
            grammar,
            listening,
            reading,
            vocabulary,
            writing,
            speaking,
            skills_avg: report.skills_avg,
            homework_avg: report.homework_avg,
            homework_total_count: report.homework_total_count,
            homework_graded_count: report.homework_graded_count,
            homework_items: report.homework_items,
            absent_count: report.absent_count,
            excused_count: report.excused_count
          }),
          report.attendance_percent,
          report.present_count,
          report.total_count,
          report.monthly_fee,
          report.balance_before,
          report.balance_after
        ]
      );

      if (charge_fee && report.monthly_fee > 0) {
        await dbRun(
          `INSERT INTO transactions (student_id, amount, type, description) VALUES (?, ?, 'charge', ?)`,
          [st.id, report.monthly_fee, `${cleanMonth} oy yakuni — oylik to'lov hisoblandi`]
        );
      }

      await dbRun(
        `UPDATE users
         SET balance = ?, grammar = ?, listening = ?, reading = ?, vocabulary = ?, writing = ?, speaking = ?
         WHERE id = ? AND role = 'student'`,
        [
          report.balance_after,
          reset_skills ? 0 : grammar,
          reset_skills ? 0 : listening,
          reset_skills ? 0 : reading,
          reset_skills ? 0 : vocabulary,
          reset_skills ? 0 : writing,
          reset_skills ? 0 : speaking,
          st.id
        ]
      );
    }

    if (reset_skills) {
      await dbRun(`DELETE FROM skill_evaluations`);
    }

    if (clear_month_attendance) {
      await dbRun(`DELETE FROM attendance WHERE strftime('%Y-%m', lesson_date) = ?`, [cleanMonth]);
    }

    if (clear_lessons) {
      await dbRun(`DELETE FROM lessons`);
    }

    if (clear_assignments) {
      await dbRun(`DELETE FROM assignment_submissions`);
      await dbRun(`DELETE FROM assignments`);
    }

    await dbRun('COMMIT');

    res.json({
      message: `${cleanMonth} oyi yopildi! Har bir o‘quvchi bo‘yicha davomat, pul va uyga vazifa hisoboti tayyorlandi.`,
      month_key: cleanMonth,
      processed_students: students.length,
      student_reports: studentReports
    });
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN: TARIXNI TOZALASH & LOGLAR
// ==========================================

app.get('/api/admin/clear-logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM history_clear_logs ORDER BY id DESC LIMIT 50`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clear-history', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { section, password } = req.body;
    const allowedSections = {
      transactions: `DELETE FROM transactions`,
      attendance: `DELETE FROM attendance`,
      lessons: `DELETE FROM lessons`,
      assignments: `DELETE FROM assignments`,
      submissions: `DELETE FROM assignment_submissions`,
      announcements: `DELETE FROM announcements`,
      schedules: `DELETE FROM schedules`
    };

    if (!allowedSections[section]) {
      return res.status(400).json({ error: 'Noto‘g‘ri bo‘lim tanlandi!' });
    }

    const admin = await verifyAdminPassword(req.user.id, password);
    await dbRun(allowedSections[section]);
    await dbRun(
      `INSERT INTO history_clear_logs (section_key, cleared_by) VALUES (?, ?)`,
      [section, admin.full_name || admin.username]
    );

    res.json({ message: 'Tarix muvaffaqiyatli tozalandi!' });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// ==========================================
// ADMIN: O'QUVCHILAR, BALANS, DAVOMAT, BALLAR, DARSLIK, VAZIFA, E'LON, JADVAL
// ==========================================

app.get('/api/admin/students', authMiddleware, adminOnly, async (req, res) => {
  try {
    await ensureUserExtraColumns();
    const { group, level } = req.query;
    const conditions = [`role = 'student'`];
    const params = [];

    if (group && String(group).trim()) {
      conditions.push(`group_name = ?`);
      params.push(String(group).trim());
    }
    if (level && String(level).trim() && String(level).trim().toUpperCase() !== 'ALL') {
      conditions.push(`level = ?`);
      params.push(String(level).trim());
    }

    const rows = await dbAll(
      `SELECT id, full_name, username, level, group_name, balance, monthly_fee, photo_url,
              grammar, listening, reading, vocabulary, writing, speaking
       FROM users WHERE ${conditions.join(' AND ')} ORDER BY id DESC`,
      params
    );
    const gradedMap = await getGradedSubmissionsByStudentMap();

    res.json(
      rows.map((s) => {
        const scoreInfo = calcStudentOverallScore(s, gradedMap.get(s.id) || []);
        return {
          ...s,
          skills_avg: scoreInfo.skillsAvg,
          homework_avg: scoreInfo.homeworkAvg,
          avg_score: scoreInfo.overallScore
        };
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      full_name, username, password, level, group_name, monthly_fee,
      photo_base64, photo_url, avatar_url, photo_name
    } = req.body;
    await ensureUserExtraColumns();
    const hashed = bcrypt.hashSync(password, 10);
    const savedPhotoUrl = saveBase64File(photo_base64 || photo_url || avatar_url, 'student', photo_name);

    const result = await dbRun(
      `INSERT INTO users (full_name, username, password, role, level, group_name, monthly_fee, photo_url)
       VALUES (?, ?, ?, 'student', ?, ?, ?, ?)`,
      [
        full_name,
        username,
        hashed,
        level || 'B1',
        group_name || 'General',
        monthly_fee || 500000,
        savedPhotoUrl
      ]
    );

    res.json({ message: 'O‘quvchi qo‘shildi', id: result.lastID, photo_url: savedPhotoUrl });
  } catch (err) {
    res.status(400).json({ error: 'Bu login band yoki ma’lumot xato: ' + err.message });
  }
});

app.put('/api/admin/students/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      full_name, level, group_name, monthly_fee, new_password,
      photo_base64, photo_url, avatar_url, photo_name
    } = req.body;
    await ensureUserExtraColumns();

    const savedPhotoUrl = saveBase64File(photo_base64 || photo_url || avatar_url, 'student', photo_name);
    const sets = ['full_name = ?', 'level = ?', 'group_name = ?', 'monthly_fee = ?'];
    const params = [full_name, level, group_name, Number(monthly_fee) || 500000];

    if (savedPhotoUrl) {
      sets.push('photo_url = ?');
      params.push(savedPhotoUrl);
    }
    if (new_password && new_password.trim().length > 0) {
      sets.push('password = ?');
      params.push(bcrypt.hashSync(new_password.trim(), 10));
    }
    params.push(req.params.id);

    await dbRun(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND role = 'student'`, params);
    res.json({ message: 'O‘quvchi ma’lumotlari yangilandi', photo_url: savedPhotoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/students/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = req.params.id;
    await dbRun(`DELETE FROM skill_evaluations WHERE student_id = ?`, [id]);
    await dbRun(`DELETE FROM attendance WHERE student_id = ?`, [id]);
    await dbRun(`DELETE FROM transactions WHERE student_id = ?`, [id]);
    await dbRun(`DELETE FROM assignment_submissions WHERE student_id = ?`, [id]);
    await dbRun(`DELETE FROM users WHERE id = ? AND role = 'student'`, [id]);
    res.json({ message: 'O‘quvchi o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/balance', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { student_id, amount, type, description } = req.body;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Summa 0 dan katta bo‘lishi kerak!' });
    }
    const delta = type === 'deposit' ? numAmount : -numAmount;

    await dbRun(`UPDATE users SET balance = balance + ? WHERE id = ? AND role = 'student'`, [delta, student_id]);
    await dbRun(
      `INSERT INTO transactions (student_id, amount, type, description) VALUES (?, ?, ?, ?)`,
      [student_id, numAmount, type, description || (type === 'deposit' ? 'Hisob to‘ldirildi' : 'Oylik dars to‘lovi yechildi')]
    );
    res.json({ message: 'Balans yangilandi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/transactions', authMiddleware, adminOnly, async (req, res) => {
  try {
    res.json(
      await dbAll(
        `SELECT t.id, t.amount, t.type, t.description, t.created_at, u.full_name, u.group_name
         FROM transactions t JOIN users u ON u.id = t.student_id
         ORDER BY t.id DESC LIMIT 200`
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/attendance', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { student_id, lesson_date, status } = req.body;
    await insertAttendanceRecords(lesson_date, [{ student_id, status }]);
    res.json({ message: 'Davomat saqlandi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/attendance/bulk', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { lesson_date, records } = req.body;
    if (!lesson_date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Davomat ma’lumotlari to‘liq emas' });
    }
    await insertAttendanceRecords(lesson_date, records);
    res.json({ message: 'Barcha davomat yozuvlari saqlandi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/attendance', authMiddleware, adminOnly, async (req, res) => {
  try {
    res.json(
      await dbAll(
        `SELECT a.id, a.lesson_date, a.status, u.full_name, u.group_name
         FROM attendance a JOIN users u ON u.id = a.student_id
         ORDER BY a.id DESC LIMIT 200`
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/skill-evaluations', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT se.*, u.full_name
       FROM skill_evaluations se
       JOIN users u ON u.id = se.student_id
       ORDER BY se.id DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/skill-evaluations/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const ev = await dbGet(`SELECT student_id FROM skill_evaluations WHERE id = ?`, [req.params.id]);
    if (!ev) return res.status(404).json({ error: 'Yozuv topilmadi' });

    await dbRun(`DELETE FROM skill_evaluations WHERE id = ?`, [req.params.id]);
    const averages = await recalculateStudentSkillsFromEvaluations(ev.student_id);

    res.json({ message: 'Baho yozuvi o‘chirildi va o‘rtacha ball qayta hisoblandi!', averages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/skills/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const averages = await recordAndRecalculateSkills(
      req.params.id,
      req.body,
      req.user.full_name || req.user.username || 'admin'
    );
    res.json({ message: 'Yangi baho qo‘shildi va o‘rtacha ball hisoblandi!', averages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/lessons', authMiddleware, adminOnly, async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM lessons ORDER BY id DESC`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/lessons', authMiddleware, adminOnly, async (req, res) => {
  try {
    await createLessonRecord(req.body);
    res.json({ message: 'Darslik qo‘shildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/lessons/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbRun(`DELETE FROM lessons WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Darslik o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/announcements', authMiddleware, async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM announcements ORDER BY id DESC LIMIT 20`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/announcements', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, message, target_level } = req.body;
    await dbRun(
      `INSERT INTO announcements (title, message, target_level) VALUES (?, ?, ?)`,
      [title, message, target_level || 'ALL']
    );
    res.json({ message: 'E’lon joylandi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/announcements/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbRun(`DELETE FROM announcements WHERE id = ?`, [req.params.id]);
    res.json({ message: 'E’lon o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedules', authMiddleware, async (req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM schedules ORDER BY id DESC`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/schedules', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { group_name, level, day_of_week, lesson_time, room_or_teacher } = req.body;
    await dbRun(
      `INSERT INTO schedules (group_name, level, day_of_week, lesson_time, room_or_teacher)
       VALUES (?, ?, ?, ?, ?)`,
      [group_name, level, day_of_week, lesson_time, room_or_teacher]
    );
    res.json({ message: 'Dars jadvali qo‘shildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/schedules/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbRun(`DELETE FROM schedules WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Jadval o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/assignments', authMiddleware, adminOnly, async (req, res) => {
  try {
    const assignments = await dbAll(`SELECT * FROM assignments ORDER BY id DESC`);
    const submissions = await dbAll(
      `SELECT sub.*, u.full_name, u.level, a.title as assignment_title
       FROM assignment_submissions sub
       JOIN users u ON u.id = sub.student_id
       JOIN assignments a ON a.id = sub.assignment_id
       ORDER BY sub.id DESC`
    );
    res.json({ assignments, submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/assignments', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, description, level, due_date } = req.body;
    await dbRun(
      `INSERT INTO assignments (title, description, level, due_date) VALUES (?, ?, ?, ?)`,
      [title, description, level || 'ALL', due_date || '']
    );
    res.json({ message: 'Vazifa yaratildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/assignments/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = req.params.id;
    await dbRun(`DELETE FROM assignment_submissions WHERE assignment_id = ?`, [id]);
    await dbRun(`DELETE FROM assignments WHERE id = ?`, [id]);
    res.json({ message: 'Topshiriq o‘chirildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/submissions/:id/grade', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { grade, teacher_feedback } = req.body;
    await dbRun(
      `UPDATE assignment_submissions SET grade = ?, teacher_feedback = ? WHERE id = ?`,
      [clampScore(grade), teacher_feedback || '', req.params.id]
    );
    res.json({ message: 'Vazifa baholandi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// STUDENT MARSHRUTLARI
// ==========================================

app.post('/api/student/assignments/:id/submit', authMiddleware, async (req, res) => {
  try {
    const { answer_text, answer_url } = req.body;
    const assignmentId = req.params.id;
    const studentId = req.user.id;

    if ((!answer_text || !answer_text.trim()) && (!answer_url || !answer_url.trim())) {
      return res.status(400).json({ error: 'Javob matni yoki havola kiriting!' });
    }

    const existing = await dbGet(
      `SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?`,
      [assignmentId, studentId]
    );
    if (existing) {
      return res.status(400).json({ error: 'Siz bu vazifaga allaqachon javob yuborgansiz!' });
    }

    await dbRun(
      `INSERT INTO assignment_submissions (assignment_id, student_id, answer_text, answer_url)
       VALUES (?, ?, ?, ?)`,
      [assignmentId, studentId, (answer_text || '').trim(), (answer_url || '').trim()]
    );
    res.json({ message: 'Javobingiz qabul qilindi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/student/change-password', authMiddleware, async (req, res) => {
  try {
    const { old_password, current_password, new_password } = req.body;
    const oldPass = old_password || current_password;
    if (!new_password || new_password.length < 4) {
      return res.status(400).json({ error: 'Yangi parol kamida 4 belgidan iborat bo‘lsin' });
    }

    const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (!bcrypt.compareSync(oldPass, user.password)) {
      return res.status(400).json({ error: 'Eski parol noto‘g‘ri' });
    }

    await dbRun(`UPDATE users SET password = ? WHERE id = ?`, [bcrypt.hashSync(new_password, 10), req.user.id]);
    res.json({ message: 'Parol muvaffaqiyatli yangilandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/dashboard', authMiddleware, async (req, res) => {
  try {
    const studentId = req.user.id;
    await ensureUserExtraColumns();

    const student = await dbGet(`SELECT * FROM users WHERE id = ? AND role = 'student'`, [studentId]);
    if (!student) return res.status(404).json({ error: 'O‘quvchi topilmadi' });

    const allStudents = await dbAll(
      `SELECT id, full_name, level, group_name, photo_url,
              grammar, listening, reading, vocabulary, writing, speaking
       FROM users WHERE role = 'student'`
    );
    const gradedMap = await getGradedSubmissionsByStudentMap();

    const myScoreInfo = calcStudentOverallScore(student, gradedMap.get(studentId) || []);
    const myAvg = myScoreInfo.overallScore;

    const rankingList = allStudents
      .map((s) => {
        const info = calcStudentOverallScore(s, gradedMap.get(s.id) || []);
        return {
          ...s,
          skills_avg: info.skillsAvg,
          homework_avg: info.homeworkAvg,
          avg_score: info.overallScore
        };
      })
      .sort((a, b) => b.avg_score - a.avg_score);

    const myRank = rankingList.findIndex((s) => s.id === studentId) + 1;

    const attendanceList = await dbAll(
      `SELECT * FROM attendance WHERE student_id = ? ORDER BY lesson_date DESC`,
      [studentId]
    );
    const totalClasses = attendanceList.length;
    const attendedClasses = attendanceList.filter((a) => a.status === 'present').length;
    const attendanceRate = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 0;

    const [
      transactions,
      lessons,
      announcements,
      schedules,
      assignments,
      submissions,
      skillEvaluations,
      myMonthlyRaw,
      yearlyTopList
    ] = await Promise.all([
      dbAll(`SELECT * FROM transactions WHERE student_id = ? ORDER BY created_at DESC`, [studentId]),
      dbAll(`SELECT * FROM lessons WHERE level = ? OR level = 'ALL' ORDER BY id DESC`, [student.level]),
      dbAll(`SELECT * FROM announcements WHERE target_level = ? OR target_level = 'ALL' ORDER BY id DESC`, [student.level]),
      dbAll(`SELECT * FROM schedules WHERE level = ? OR group_name = ? ORDER BY id DESC`, [student.level, student.group_name]),
      dbAll(`SELECT * FROM assignments WHERE level = ? OR level = 'ALL' ORDER BY id DESC`, [student.level]),
      dbAll(
        `SELECT sub.*, a.title as assignment_title
         FROM assignment_submissions sub
         LEFT JOIN assignments a ON a.id = sub.assignment_id
         WHERE sub.student_id = ? ORDER BY sub.id DESC`,
        [studentId]
      ),
      dbAll(
        `SELECT id, grammar, listening, reading, vocabulary, writing, speaking, created_by, created_at
         FROM skill_evaluations WHERE student_id = ? ORDER BY id DESC`,
        [studentId]
      ),
      dbAll(
        `SELECT * FROM monthly_closings WHERE student_id = ? ORDER BY month_key ASC`,
        [studentId]
      ),
      dbAll(
        `SELECT student_id, full_name, level,
                ROUND(AVG(avg_score), 1) as yearly_avg,
                MAX(avg_score) as best_score
         FROM monthly_closings
         GROUP BY student_id
         ORDER BY yearly_avg DESC, best_score DESC`
      )
    ]);

    const myMonthlyParsed = myMonthlyRaw.map(parseClosingRow);
    const myMonthlyHistory = myMonthlyParsed.map((m) => ({
      month_key: m.month_key,
      avg_score: m.avg_score,
      attendance_percent: m.attendance_percent
    }));
    const lastClosedMonthReport = myMonthlyParsed.length > 0
      ? myMonthlyParsed[myMonthlyParsed.length - 1]
      : null;

    // Baholar tarixi (har bir fan ko'nikmasi va baholangan uyga vazifalar)
    const gradeHistory = [];
    for (const ev of skillEvaluations) {
      for (const key of SKILL_KEYS) {
        if (ev[key] !== null && ev[key] !== undefined && String(ev[key]).trim() !== '') {
          gradeHistory.push({
            date: ev.created_at || '-',
            subject: SKILL_LABELS[key],
            category: 'Ko‘nikma',
            score: Number(ev[key]) || 0,
            by: ev.created_by || 'O‘qituvchi'
          });
        }
      }
    }
    for (const sub of submissions) {
      if (sub.grade !== null && sub.grade !== undefined && String(sub.grade).trim() !== '') {
        gradeHistory.push({
          date: sub.submitted_at || '-',
          subject: sub.assignment_title || 'Uyga vazifa',
          category: 'Uyga vazifa',
          score: Number(sub.grade) || 0,
          by: 'O‘qituvchi / Admin'
        });
      }
    }
    gradeHistory.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const prevMonth = myMonthlyHistory.length > 0 ? myMonthlyHistory[myMonthlyHistory.length - 1] : null;
    const improvement = prevMonth ? Number((myAvg - Number(prevMonth.avg_score || 0)).toFixed(1)) : 0;

    res.json({
      student: {
        id: student.id,
        full_name: student.full_name,
        level: student.level,
        group_name: student.group_name,
        photo_url: student.photo_url || null,
        balance: student.balance,
        monthly_fee: student.monthly_fee,
        grammar: student.grammar,
        listening: student.listening,
        reading: student.reading,
        vocabulary: student.vocabulary,
        writing: student.writing,
        speaking: student.speaking
      },
      attendanceSummary: {
        percent: attendanceRate,
        presentCount: attendedClasses,
        totalCount: totalClasses
      },
      performanceSummary: {
        avgScore: myAvg,
        skillsAvg: myScoreInfo.skillsAvg,
        homeworkAvg: myScoreInfo.homeworkAvg,
        gradedHomeworkCount: myScoreInfo.gradedHomeworkCount,
        improvement,
        skillsTracked: 6
      },
      myRank,
      avgScore: myAvg,
      rankingList,
      attendance: attendanceList,
      transactions,
      lessons,
      announcements,
      schedules,
      assignments,
      submissions,
      gradeHistory,
      myMonthlyHistory,
      lastClosedMonthReport,
      yearlyTopList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server ishga tushdi: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Baza xatoligi:', err);
  });
