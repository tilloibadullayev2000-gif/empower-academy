const bcrypt = require('bcryptjs');
const db = require('./db');

const fullName = 'Azizbek Ustoz';
const username = 'ustoz1';
const plainPass = '12345';
const hashedPass = bcrypt.hashSync(plainPass, 10);

db.run(
  `INSERT OR IGNORE INTO users (full_name, username, password, role, level, group_name)
   VALUES (?, ?, ?, 'teacher', 'B1', 'General English')`,
  [fullName, username, hashedPass],
  function (err) {
    if (err) {
      console.error('Xato:', err.message);
    } else if (this.changes === 0) {
      console.log(`"${username}" login bazada allaqachon bor.`);
    } else {
      console.log(`O‘qituvchi yaratildi -> Login: ${username} | Parol: ${plainPass}`);
    }
    process.exit();
  }
);