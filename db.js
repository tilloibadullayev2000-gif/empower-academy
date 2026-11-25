const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
      level TEXT DEFAULT 'B1',
      group_name TEXT DEFAULT 'General English',
      balance REAL DEFAULT 0,
      monthly_fee REAL DEFAULT 500000,
      grammar INTEGER DEFAULT 0,
      listening INTEGER DEFAULT 0,
      reading INTEGER DEFAULT 0,
      vocabulary INTEGER DEFAULT 0,
      writing INTEGER DEFAULT 0,
      speaking INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      lesson_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'excused')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'charge')),
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      description TEXT,
      material_url TEXT,
      file_path TEXT,
      file_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Eski bazada file_path va file_name ustunlari bo'lmasa qo'shish
  db.run(`ALTER TABLE lessons ADD COLUMN file_path TEXT`, () => {});
  db.run(`ALTER TABLE lessons ADD COLUMN file_name TEXT`, () => {});

  const adminPass = bcrypt.hashSync('admin123', 10);
  const studentPass = bcrypt.hashSync('12345', 10);

  db.run(
    `INSERT OR IGNORE INTO users (id, full_name, username, password, role, level, group_name)
     VALUES (1, 'Asosiy Admin', 'admin', ?, 'admin', 'ALL', 'Administration')`,
    [adminPass]
  );

  db.run(
    `INSERT OR IGNORE INTO users 
     (id, full_name, username, password, role, level, group_name, balance, grammar, listening, reading, vocabulary, writing, speaking)
     VALUES (2, 'Ali Valiyev', 'ali', ?, 'student', 'B2', 'Advanced English', 500000, 88, 92, 85, 90, 84, 95)`,
    [studentPass]
  );

  db.run(
    `INSERT OR IGNORE INTO lessons (id, title, level, description, material_url)
     VALUES (1, '1-dars: Present Perfect vs Past Simple', 'B2', 'Grammatika qoidalari va mashqlar to‘plami', 'https://example.com/lesson1')`
  );
});

module.exports = db;