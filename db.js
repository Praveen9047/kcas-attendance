// db.js - SQLite database initialization, schemas, migrations, and seed data for KCAS Attendance App
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'data', 'kcas_attendance.db');

// Ensure data folder exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys for performance and integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Helper to hash passwords securely using scrypt
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'));
}

// Initialize tables
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      degree_level TEXT DEFAULT 'UG',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      semester INTEGER NOT NULL,
      section TEXT DEFAULT 'A',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      credits INTEGER DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'student')),
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      department_id INTEGER,
      class_id INTEGER,
      register_number TEXT,
      designation TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS staff_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      UNIQUE(staff_id, class_id, subject_id, academic_year)
    );

    CREATE TABLE IF NOT EXISTS timetables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      day_of_week TEXT NOT NULL,
      period_number INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room_number TEXT DEFAULT 'Lab-1',
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_uuid TEXT UNIQUE NOT NULL,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      qr_secret TEXT NOT NULL,
      topic TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'late', 'absent')),
      marked_at TEXT DEFAULT (datetime('now', 'localtime')),
      marked_by TEXT DEFAULT 'qr_scan' CHECK(marked_by IN ('qr_scan', 'staff_manual', 'admin_override')),
      location_lat REAL,
      location_lng REAL,
      location_verified INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      check_in_time TEXT,
      check_out_time TEXT,
      status TEXT DEFAULT 'on_time' CHECK(status IN ('on_time', 'late', 'half_day', 'absent')),
      working_hours REAL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(staff_id, date)
    );

    CREATE TABLE IF NOT EXISTS correction_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      original_status TEXT NOT NULL,
      requested_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_remarks TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS student_daily_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      check_in_time TEXT,
      check_in_photo TEXT,
      check_in_lat REAL,
      check_in_lng REAL,
      check_in_status TEXT DEFAULT 'on_time' CHECK(check_in_status IN ('on_time', 'late', 'absent')),
      check_out_time TEXT,
      check_out_photo TEXT,
      check_out_lat REAL,
      check_out_lng REAL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(student_id, date)
    );
  `);

  runMigrations();
}

// Automatic migrations for existing databases
function runMigrations() {
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('parent_phone')) db.exec("ALTER TABLE users ADD COLUMN parent_phone TEXT;");
    if (!userCols.includes('address')) db.exec("ALTER TABLE users ADD COLUMN address TEXT;");
    if (!userCols.includes('photo_url')) db.exec("ALTER TABLE users ADD COLUMN photo_url TEXT;");

    const staffCols = db.prepare("PRAGMA table_info(staff_attendance)").all().map(c => c.name);
    if (!staffCols.includes('check_in_photo')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_in_photo TEXT;");
    if (!staffCols.includes('check_in_lat')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_in_lat REAL;");
    if (!staffCols.includes('check_in_lng')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_in_lng REAL;");
    if (!staffCols.includes('check_out_photo')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_out_photo TEXT;");
    if (!staffCols.includes('check_out_lat')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_out_lat REAL;");
    if (!staffCols.includes('check_out_lng')) db.exec("ALTER TABLE staff_attendance ADD COLUMN check_out_lng REAL;");

    const sessCols = db.prepare("PRAGMA table_info(attendance_sessions)").all().map(c => c.name);
    if (!sessCols.includes('department_id')) db.exec("ALTER TABLE attendance_sessions ADD COLUMN department_id INTEGER;");
    if (!sessCols.includes('period_number')) db.exec("ALTER TABLE attendance_sessions ADD COLUMN period_number INTEGER DEFAULT 1;");
    if (!sessCols.includes('lesson_topic')) db.exec("ALTER TABLE attendance_sessions ADD COLUMN lesson_topic TEXT;");
    if (!sessCols.includes('lesson_summary')) db.exec("ALTER TABLE attendance_sessions ADD COLUMN lesson_summary TEXT;");
    if (!sessCols.includes('lesson_photo')) db.exec("ALTER TABLE attendance_sessions ADD COLUMN lesson_photo TEXT;");

    // Enforce official updated pincode 621301 and system controls
    db.prepare("INSERT OR REPLACE INTO settings (key, value, description) VALUES ('college_address', 'Palayam Road, Karur, Tamil Nadu 621301', 'Campus location address')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value, description) VALUES ('college_pincode', '621301', 'Campus postal pincode')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value, description) VALUES ('student_qr_enabled', '0', 'Admin control: Student QR attendance toggle (1=ON, 0=OFF)')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value, description) VALUES ('morning_checkin_start', '08:00', 'Morning check-in start time')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value, description) VALUES ('morning_checkin_end', '10:00', 'Morning check-in cutoff time')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value, description) VALUES ('evening_checkout_start', '15:30', 'Evening check-out start time')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value, description) VALUES ('evening_checkout_end', '17:30', 'Evening check-out cutoff time')").run();
  } catch (err) {
    console.error('Migration error:', err);
  }
}

// Log audit trail
function logAudit(userId, username, action, entityType = '', entityId = '', details = '', ip = '127.0.0.1') {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId || null, username || 'system', action, entityType, String(entityId), details, ip);
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Seed initial database
function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) {
    return; // Already seeded
  }

  console.log('Seeding initial KCAS data...');

  // Default Settings
  const settings = [
    ['college_name', 'Krishna College of Arts and Science (KCAS)', 'Official college name'],
    ['college_address', 'Palayam Road, Karur, Tamil Nadu 621301', 'Campus location address'],
    ['college_pincode', '621301', 'Campus postal pincode'],
    ['student_qr_enabled', '0', 'Admin toggle: Student self QR scan attendance (1=ON, 0=OFF)'],
    ['qr_duration_seconds', '30', 'QR code validity and rotation duration in seconds'],
    ['late_grace_minutes', '10', 'Grace period in minutes before marked Late'],
    ['absent_grace_minutes', '25', 'Cutoff in minutes after which attendance is marked Absent'],
    ['location_verification_enabled', '0', 'Enforce student physical presence within campus coordinates (1=enabled, 0=disabled)'],
    ['campus_latitude', '10.9234', 'KCAS campus latitude'],
    ['campus_longitude', '78.0772', 'KCAS campus longitude'],
    ['campus_radius_meters', '350', 'Allowed geofence radius around campus in meters'],
    ['low_attendance_threshold', '75', 'Attendance percentage threshold requiring warning alert'],
    ['academic_year', '2026-2027', 'Current academic year']
  ];

  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value, description) VALUES (?, ?, ?)');
  for (const s of settings) {
    insertSetting.run(s[0], s[1], s[2]);
  }

  // Departments
  const depts = [
    ['CS', 'Computer Science'],
    ['CA', 'Computer Applications'],
    ['COMM', 'Commerce'],
    ['MATH', 'Mathematics'],
    ['ENG', 'English Literature']
  ];
  const insertDept = db.prepare('INSERT INTO departments (code, name) VALUES (?, ?)');
  const deptIds = {};
  for (const [code, name] of depts) {
    const res = insertDept.run(code, name);
    deptIds[code] = Number(res.lastInsertRowid);
  }

  // Courses
  const courses = [
    [deptIds['CS'], 'B.Sc CS', 'Bachelor of Science in Computer Science', 'UG'],
    [deptIds['CA'], 'BCA', 'Bachelor of Computer Applications', 'UG'],
    [deptIds['COMM'], 'B.Com', 'Bachelor of Commerce', 'UG'],
    [deptIds['MATH'], 'B.Sc MATH', 'Bachelor of Science in Mathematics', 'UG'],
    [deptIds['ENG'], 'B.A. ENG', 'Bachelor of Arts in English', 'UG']
  ];
  const insertCourse = db.prepare('INSERT INTO courses (department_id, code, name, degree_level) VALUES (?, ?, ?, ?)');
  const courseIds = {};
  for (const [dId, code, name, level] of courses) {
    const res = insertCourse.run(dId, code, name, level);
    courseIds[code] = Number(res.lastInsertRowid);
  }

  // Classes
  const classes = [
    [courseIds['B.Sc CS'], 'III B.Sc CS - A', '2026-2027', 5, 'A'],
    [courseIds['B.Sc CS'], 'II B.Sc CS - A', '2026-2027', 3, 'A'],
    [courseIds['BCA'], 'III BCA - A', '2026-2027', 5, 'A'],
    [courseIds['B.Com'], 'III B.Com - A', '2026-2027', 5, 'A']
  ];
  const insertClass = db.prepare('INSERT INTO classes (course_id, name, academic_year, semester, section) VALUES (?, ?, ?, ?, ?)');
  const classIds = {};
  for (const [cId, name, yr, sem, sec] of classes) {
    const res = insertClass.run(cId, name, yr, sem, sec);
    classIds[name] = Number(res.lastInsertRowid);
  }

  // Subjects for III B.Sc CS
  const subjects = [
    ['CS501', 'Web Technology & Full Stack', courseIds['B.Sc CS'], 5, 4],
    ['CS502', 'Database Management Systems', courseIds['B.Sc CS'], 5, 4],
    ['CS503', 'Python & Machine Learning Basics', courseIds['B.Sc CS'], 5, 4],
    ['CS504', 'Computer Networks & Cyber Security', courseIds['B.Sc CS'], 5, 3],
    ['CS505', 'Cloud Computing Architecture', courseIds['B.Sc CS'], 5, 3]
  ];
  const insertSubject = db.prepare('INSERT INTO subjects (code, name, course_id, semester, credits) VALUES (?, ?, ?, ?, ?)');
  const subjectIds = {};
  for (const [code, name, cId, sem, credits] of subjects) {
    const res = insertSubject.run(code, name, cId, sem, credits);
    subjectIds[code] = Number(res.lastInsertRowid);
  }

  // Insert Single Primary Admin User
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, department_id, class_id, register_number, designation, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  // Admin (Sole Administrator)
  const adminAuth = hashPassword('KCASCOLLEGE2027');
  const adminRes = insertUser.run(
    'KRISHNACOLLEGEADMIN',
    adminAuth.hash,
    adminAuth.salt,
    'admin',
    'Principal & Administrator (KCAS)',
    'admin@kcas.edu.in',
    '9842411001',
    deptIds['CS'] || null,
    null,
    null,
    'College Administrator'
  );
  const adminId = Number(adminRes.lastInsertRowid);

  // Initial audit log
  logAudit(adminId, 'KRISHNACOLLEGEADMIN', 'SYSTEM_INIT', 'system', '1', 'Initial database schema initialized with official KCAS administrator and academic departments');

  console.log('Database successfully initialized with official KCAS structure (0 dummy users)!');
}

// Clean up all dummy/test accounts and ensure strictly ONE official admin
function cleanupDummyData() {
  try {
    const dummyUsernames = [
      'dr.anitha', 'prof.ramesh', 'prof.priya', 'prof.suresh',
      'kcas24cs101', 'kcas24cs102', 'kcas24cs103', 'kcas24cs104', 'kcas24cs105',
      'kcas24cs106', 'kcas24cs107', 'kcas24cs108', 'kcas24cs109', 'kcas24cs110',
      'admin'
    ];

    const placeholders = dummyUsernames.map(() => '?').join(',');
    const dummyRows = db.prepare(`
      SELECT id FROM users 
      WHERE lower(username) IN (${placeholders}) 
         OR (role = 'admin' AND upper(username) != 'KRISHNACOLLEGEADMIN')
    `).all(...dummyUsernames);

    const dummyIds = dummyRows.map(r => r.id);

    if (dummyIds.length > 0) {
      const idPlaceholders = dummyIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_attendance WHERE student_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM student_daily_attendance WHERE student_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM staff_attendance WHERE staff_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM correction_requests WHERE staff_id IN (${idPlaceholders}) OR student_id IN (${idPlaceholders})`).run(...dummyIds, ...dummyIds);
      db.prepare(`DELETE FROM staff_allocations WHERE staff_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM timetables WHERE staff_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM attendance_sessions WHERE staff_id IN (${idPlaceholders})`).run(...dummyIds);
      db.prepare(`DELETE FROM users WHERE id IN (${idPlaceholders})`).run(...dummyIds);
      console.log(`Cleaned up ${dummyIds.length} dummy users and test data.`);
    }

    // Strictly ensure no extra admin accounts exist
    db.prepare("DELETE FROM users WHERE role = 'admin' AND upper(username) != 'KRISHNACOLLEGEADMIN'").run();

  } catch (err) {
    console.error('Error in cleanupDummyData:', err);
  }
}

// Ensure the specified Admin credentials are always up to date and strictly single admin
function ensureAdminCredentials() {
  const adminAuth = hashPassword('KCASCOLLEGE2027');

  // Purge any extra admin accounts
  db.prepare("DELETE FROM users WHERE role = 'admin' AND upper(username) != 'KRISHNACOLLEGEADMIN'").run();

  const existing = db.prepare(`
    SELECT id, username FROM users WHERE upper(username) = 'KRISHNACOLLEGEADMIN'
  `).get();
  
  if (existing) {
    db.prepare(`
      UPDATE users 
      SET username = 'KRISHNACOLLEGEADMIN',
          password_hash = ?,
          salt = ?,
          role = 'admin',
          is_active = 1,
          full_name = 'Principal & Administrator (KCAS)',
          email = 'admin@kcas.edu.in',
          phone = '9842411001',
          designation = 'College Administrator'
      WHERE id = ?
    `).run(adminAuth.hash, adminAuth.salt, existing.id);
  } else {
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, designation, is_active)
      VALUES ('KRISHNACOLLEGEADMIN', ?, ?, 'admin', 'Principal & Administrator (KCAS)', 'admin@kcas.edu.in', '9842411001', 'College Administrator', 1)
    `).run(adminAuth.hash, adminAuth.salt);
  }
}

// Ensure all 14 official KCAS Departments, Courses, and Classes
function ensureKCASDepartments() {
  try {
    const officialDepts = [
      { code: 'TAMIL', aliases: ['TAMIL', 'TAM'], name: 'Department of Tamil', courseCode: 'BA_TAM', courseName: 'B.A. Tamil', level: 'UG' },
      { code: 'ENG', aliases: ['ENG', 'ENGLISH'], name: 'Department of English', courseCode: 'BA_ENG', courseName: 'B.A. English', level: 'UG' },
      { code: 'PHY', aliases: ['PHY', 'PHYSICS'], name: 'Department of Physics', courseCode: 'BSC_PHY', courseName: 'B.Sc Physics', level: 'UG' },
      { code: 'MATH', aliases: ['MATH', 'MATHEMATICS'], name: 'Department of Mathematics', courseCode: 'BSC_MATH', courseName: 'B.Sc Mathematics', level: 'UG' },
      { code: 'HIST', aliases: ['HIST', 'HISTORY'], name: 'Department of History', courseCode: 'BA_HIST', courseName: 'B.A. History', level: 'UG' },
      { code: 'CS', aliases: ['CS'], name: 'Department of Computer Science', courseCode: 'BSC_CS', courseName: 'B.Sc Computer Science', level: 'UG' },
      { code: 'BCA', aliases: ['BCA', 'CA'], name: 'Department of Computer Applications (BCA)', courseCode: 'BCA', courseName: 'BCA', level: 'UG' },
      { code: 'AIML', aliases: ['AIML', 'AI_ML', 'AI&ML'], name: 'Department of AI & Machine Learning', courseCode: 'BSC_AIML', courseName: 'B.Sc AI & ML', level: 'UG' },
      { code: 'BBA', aliases: ['BBA'], name: 'Department of Business Administration (BBA)', courseCode: 'BBA', courseName: 'BBA', level: 'UG' },
      { code: 'BCOM', aliases: ['BCOM', 'COMM'], name: 'Department of Commerce (B.Com)', courseCode: 'BCOM', courseName: 'B.Com', level: 'UG' },
      { code: 'BCOMCA', aliases: ['BCOMCA', 'BCOM_CA'], name: 'Department of Commerce (CA)', courseCode: 'BCOM_CA', courseName: 'B.Com (CA)', level: 'UG' },
      { code: 'MCOM', aliases: ['MCOM'], name: 'Department of Commerce (M.Com)', courseCode: 'MCOM', courseName: 'M.Com', level: 'PG' },
      { code: 'MBA', aliases: ['MBA'], name: 'Department of Management Studies (MBA)', courseCode: 'MBA', courseName: 'MBA', level: 'PG' },
      { code: 'MSCCS', aliases: ['MSCCS', 'MSC_CS'], name: 'Department of Computer Science (M.Sc CS)', courseCode: 'MSC_CS', courseName: 'M.Sc Computer Science', level: 'PG' }
    ];

    const findDeptByCode = db.prepare('SELECT id, code, name FROM departments WHERE code = ?');
    const updateDept = db.prepare('UPDATE departments SET code = ?, name = ? WHERE id = ?');
    const insertDept = db.prepare('INSERT INTO departments (code, name) VALUES (?, ?)');

    const findCourseByCode = db.prepare('SELECT id, code, name FROM courses WHERE code = ?');
    const insertCourse = db.prepare('INSERT INTO courses (department_id, code, name, degree_level) VALUES (?, ?, ?, ?)');

    const findClass = db.prepare('SELECT id FROM classes WHERE course_id = ? AND name = ?');
    const insertClass = db.prepare('INSERT INTO classes (course_id, name, academic_year, semester, section) VALUES (?, ?, ?, ?, ?)');

    const currentYear = '2026-2027';

    for (const item of officialDepts) {
      // Find existing by primary code or aliases
      let existingDept = null;
      for (const alias of item.aliases) {
        existingDept = findDeptByCode.get(alias);
        if (existingDept) break;
      }

      let deptId;
      if (existingDept) {
        deptId = existingDept.id;
        updateDept.run(item.code, item.name, deptId);
      } else {
        const ins = insertDept.run(item.code, item.name);
        deptId = Number(ins.lastInsertRowid);
      }

      // Course
      let course = findCourseByCode.get(item.courseCode);
      let courseId;
      if (course) {
        courseId = course.id;
        db.prepare('UPDATE courses SET department_id = ?, name = ?, degree_level = ? WHERE id = ?')
          .run(deptId, item.courseName, item.level, courseId);
      } else {
        const cIns = insertCourse.run(deptId, item.courseCode, item.courseName, item.level);
        courseId = Number(cIns.lastInsertRowid);
      }

      // Academic Year Classes
      if (item.level === 'UG') {
        const ugClasses = [
          { name: `I ${item.courseName} - A`, sem: 1 },
          { name: `II ${item.courseName} - A`, sem: 3 },
          { name: `III ${item.courseName} - A`, sem: 5 }
        ];
        for (const cls of ugClasses) {
          const cRow = findClass.get(courseId, cls.name);
          if (!cRow) {
            insertClass.run(courseId, cls.name, currentYear, cls.sem, 'A');
          }
        }
      } else {
        const pgClasses = [
          { name: `I ${item.courseName} - A`, sem: 1 },
          { name: `II ${item.courseName} - A`, sem: 3 }
        ];
        for (const cls of pgClasses) {
          const cRow = findClass.get(courseId, cls.name);
          if (!cRow) {
            insertClass.run(courseId, cls.name, currentYear, cls.sem, 'A');
          }
        }
      }
    }

    console.log(`Successfully verified and configured ${officialDepts.length} official KCAS departments, courses, and classes!`);
  } catch (err) {
    console.error('Error in ensureKCASDepartments:', err);
  }
}

// Initialize on require
initSchema();
seedDatabase();
cleanupDummyData();
ensureAdminCredentials();
ensureKCASDepartments();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  logAudit
};
