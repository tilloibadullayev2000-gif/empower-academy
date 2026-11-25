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
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, 'frontend'))
  ? path.join(__dirname, 'frontend')
  : path.join(__dirname, '..', 'frontend');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(FRONTEND_DIR));

const dbPath = path.join(__dirname, 'empower.db');
const db = new sqlite3.Database(dbPath);

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

function calcAvgScore(user) {
  const skills = [
    Number(user.grammar) || 0,
    Number(user.listening) || 0,
    Number(user.reading) || 0,
    Number(user.vocabulary) || 0,
    Number(user.writing) || 0,
    Number(user.speaking) || 0
  ];
  return Math.round(skills.reduce((a, b) => a + b, 0) / skills.length);
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
    const enrichedStudents = students.map((s) => ({
      ...s,
      avg_score: calcAvgScore(s)
    }));
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
    res.json(rows.map((s) => ({ ...s, avg_score: calcAvgScore(s) })));
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
    const { grammar, listening, reading, vocabulary, writing, speaking } = req.body;
    await dbRun(
      `UPDATE users SET grammar=?, listening=?, reading=?, vocabulary=?, writing=?, speaking=?
       WHERE id=? AND role='student'`,
      [grammar, listening, reading, vocabulary, writing, speaking, req.params.id]
    );
    res.json({ message: 'Ballar yangilandi!' });
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
      [Number(grade), teacher_feedback || '', req.params.id]
    );
    res.json({ message: 'Vazifa baholandi!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN: OYLIK YAKUN & STATISTIKA
// ==========================================

app.get('/api/admin/monthly-closings', authMiddleware, adminOnly, async (req, res) => {
  try {
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

    res.json({ closings, yearly_leaders: yearlyLeaders });
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
      clear_month_attendance = true
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

    const monthAttRows = await dbAll(
      `SELECT student_id, status FROM attendance WHERE strftime('%Y-%m', lesson_date) = ?`,
      [cleanMonth]
    );

    const attByStudent = new Map();
    for (const row of monthAttRows) {
      if (!attByStudent.has(row.student_id)) attByStudent.set(row.student_id, []);
      attByStudent.get(row.student_id).push(row.status);
    }

    await dbRun('BEGIN TRANSACTION');

    for (const st of students) {
      const grammar = Number(st.grammar) || 0;
      const listening = Number(st.listening) || 0;
      const reading = Number(st.reading) || 0;
      const vocabulary = Number(st.vocabulary) || 0;
      const writing = Number(st.writing) || 0;
      const speaking = Number(st.speaking) || 0;

      const avgScore = Math.round(
        (grammar + listening + reading + vocabulary + writing + speaking) / 6
      );

      const stAttList = attByStudent.get(st.id) || [];
      const totalCount = stAttList.length;
      const presentCount = stAttList.filter((statusVal) =>
        ['present', 'keldi', 'bor', '1', 'true'].includes(String(statusVal || '').trim().toLowerCase())
      ).length;
      const attendancePercent = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

      const monthlyFee = Number(st.monthly_fee) || 0;
      const balanceBefore = Number(st.balance) || 0;
      const appliedFee = charge_fee ? monthlyFee : 0;
      const balanceAfter = balanceBefore - appliedFee;

      await dbRun(
        `INSERT INTO monthly_closings (
          month_key, student_id, full_name, level, group_name,
          avg_score, skills_json, attendance_percent, present_count, total_count,
          monthly_fee, balance_before, balance_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanMonth,
          st.id,
          st.full_name || 'Student',
          st.level || '-',
          st.group_name || '-',
          avgScore,
          JSON.stringify({ grammar, listening, reading, vocabulary, writing, speaking }),
          attendancePercent,
          presentCount,
          totalCount,
          appliedFee,
          balanceBefore,
          balanceAfter
        ]
      );

      if (charge_fee && monthlyFee > 0) {
        await dbRun(
          `INSERT INTO transactions (student_id, amount, type, description) VALUES (?, ?, 'charge', ?)`,
          [st.id, monthlyFee, `${cleanMonth} oy yakuni — oylik to'lov hisoblandi`]
        );
      }

      await dbRun(
        `UPDATE users
         SET balance = ?, grammar = ?, listening = ?, reading = ?, vocabulary = ?, writing = ?, speaking = ?
         WHERE id = ? AND role = 'student'`,
        [
          balanceAfter,
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

    if (clear_month_attendance) {
      await dbRun(`DELETE FROM attendance WHERE strftime('%Y-%m', lesson_date) = ?`, [cleanMonth]);
    }

    await dbRun('COMMIT');

    res.json({
      message: `${cleanMonth} oyi yopildi! Qarzdorlik, bilim ballari va davomat yangi oyga yangilandi (yillik statistika saqlab qolindi).`,
      month_key: cleanMonth,
      processed_students: students.length
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
    res.json(rows.map((s) => ({ ...s, avg_score: calcAvgScore(s) })));
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
      [student_id, numAmount, type, description || (type === 'deposit' ? 'Hisob to‘ldirildi' : 'Oylik dars to‘lovi yechildi')],
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

app.put('/api/admin/skills/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { grammar, listening, reading, vocabulary, writing, speaking } = req.body;
    await dbRun(
      `UPDATE users SET grammar=?, listening=?, reading=?, vocabulary=?, writing=?, speaking=?
       WHERE id=? AND role='student'`,
      [grammar, listening, reading, vocabulary, writing, speaking, req.params.id]
    );
    res.json({ message: 'Ballar yangilandi' });
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
      [Number(grade), teacher_feedback || '', req.params.id]
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

    const myAvg = calcAvgScore(student);

    const rankingList = await dbAll(
      `SELECT id, full_name, level, group_name, photo_url,
              grammar, listening, reading, vocabulary, writing, speaking,
              ROUND((grammar + listening + reading + vocabulary + writing + speaking) / 6.0) as avg_score
       FROM users WHERE role = 'student'
       ORDER BY avg_score DESC`
    );
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
      myMonthlyHistory,
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
        `SELECT month_key, avg_score, attendance_percent
         FROM monthly_closings WHERE student_id = ? ORDER BY month_key ASC`,
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
      myMonthlyHistory,
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