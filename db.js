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

  // Insert Users (Admin, Staff, Students)
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, department_id, class_id, register_number, designation, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  // Admin
  const adminAuth = hashPassword('KCASCOLLEGE2027');
  const adminRes = insertUser.run(
    'KRISHNACOLLEGEADMIN',
    adminAuth.hash,
    adminAuth.salt,
    'admin',
    'Principal & Administrator (KCAS)',
    'admin@kcas.edu.in',
    '9842411001',
    deptIds['CS'],
    null,
    null,
    'College Administrator'
  );
  const adminId = Number(adminRes.lastInsertRowid);

  // Staff
  const staffMembers = [
    {
      username: 'dr.anitha',
      password: 'staff123',
      name: 'Dr. M. Anitha',
      email: 'anitha.cs@kcas.edu.in',
      phone: '9842422001',
      dept: deptIds['CS'],
      designation: 'Associate Professor & HOD'
    },
    {
      username: 'prof.ramesh',
      password: 'staff123',
      name: 'Prof. S. Ramesh',
      email: 'ramesh.cs@kcas.edu.in',
      phone: '9842422002',
      dept: deptIds['CS'],
      designation: 'Assistant Professor'
    },
    {
      username: 'prof.priya',
      password: 'staff123',
      name: 'Prof. K. Priya',
      email: 'priya.cs@kcas.edu.in',
      phone: '9842422003',
      dept: deptIds['CS'],
      designation: 'Assistant Professor'
    },
    {
      username: 'prof.suresh',
      password: 'staff123',
      name: 'Prof. T. Suresh',
      email: 'suresh.math@kcas.edu.in',
      phone: '9842422004',
      dept: deptIds['MATH'],
      designation: 'Assistant Professor'
    }
  ];

  const staffIds = {};
  for (const s of staffMembers) {
    const auth = hashPassword(s.password);
    const res = insertUser.run(
      s.username,
      auth.hash,
      auth.salt,
      'staff',
      s.name,
      s.email,
      s.phone,
      s.dept,
      null,
      null,
      s.designation
    );
    staffIds[s.username] = Number(res.lastInsertRowid);
  }

  // Students (III B.Sc CS - A)
  const students = [
    { username: 'kcas24cs101', name: 'K. Vignesh', reg: 'KCAS24CS101', email: 'vignesh.cs101@kcas.edu.in', phone: '9789123001' },
    { username: 'kcas24cs102', name: 'P. Divya', reg: 'KCAS24CS102', email: 'divya.cs102@kcas.edu.in', phone: '9789123002' },
    { username: 'kcas24cs103', name: 'M. Karthik', reg: 'KCAS24CS103', email: 'karthik.cs103@kcas.edu.in', phone: '9789123003' },
    { username: 'kcas24cs104', name: 'S. Sneha', reg: 'KCAS24CS104', email: 'sneha.cs104@kcas.edu.in', phone: '9789123004' },
    { username: 'kcas24cs105', name: 'R. Aravind', reg: 'KCAS24CS105', email: 'aravind.cs105@kcas.edu.in', phone: '9789123005' },
    { username: 'kcas24cs106', name: 'T. Kavitha', reg: 'KCAS24CS106', email: 'kavitha.cs106@kcas.edu.in', phone: '9789123006' },
    { username: 'kcas24cs107', name: 'B. Praveen', reg: 'KCAS24CS107', email: 'praveen.cs107@kcas.edu.in', phone: '9789123007' },
    { username: 'kcas24cs108', name: 'A. Meena', reg: 'KCAS24CS108', email: 'meena.cs108@kcas.edu.in', phone: '9789123008' },
    { username: 'kcas24cs109', name: 'G. Naveen', reg: 'KCAS24CS109', email: 'naveen.cs109@kcas.edu.in', phone: '9789123009' },
    { username: 'kcas24cs110', name: 'J. Soundarya', reg: 'KCAS24CS110', email: 'soundarya.cs110@kcas.edu.in', phone: '9789123010' }
  ];

  const studentIds = [];
  const targetClassId = classIds['III B.Sc CS - A'];
  for (const stu of students) {
    const auth = hashPassword('student123');
    const res = insertUser.run(
      stu.username,
      auth.hash,
      auth.salt,
      'student',
      stu.name,
      stu.email,
      stu.phone,
      deptIds['CS'],
      targetClassId,
      stu.reg,
      'Student'
    );
    studentIds.push({ id: Number(res.lastInsertRowid), ...stu });
  }

  // Staff Allocations
  const insertAlloc = db.prepare(`
    INSERT INTO staff_allocations (staff_id, class_id, subject_id, academic_year)
    VALUES (?, ?, ?, ?)
  `);
  insertAlloc.run(staffIds['dr.anitha'], targetClassId, subjectIds['CS501'], '2026-2027');
  insertAlloc.run(staffIds['prof.ramesh'], targetClassId, subjectIds['CS502'], '2026-2027');
  insertAlloc.run(staffIds['prof.priya'], targetClassId, subjectIds['CS503'], '2026-2027');
  insertAlloc.run(staffIds['dr.anitha'], targetClassId, subjectIds['CS504'], '2026-2027');
  insertAlloc.run(staffIds['prof.ramesh'], targetClassId, subjectIds['CS505'], '2026-2027');

  // Timetable
  const insertTimetable = db.prepare(`
    INSERT INTO timetables (class_id, subject_id, staff_id, day_of_week, period_number, start_time, end_time, room_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  for (const d of days) {
    insertTimetable.run(targetClassId, subjectIds['CS501'], staffIds['dr.anitha'], d, 1, '09:30', '10:30', 'Lab-1');
    insertTimetable.run(targetClassId, subjectIds['CS502'], staffIds['prof.ramesh'], d, 2, '10:30', '11:30', 'Room 204');
    insertTimetable.run(targetClassId, subjectIds['CS503'], staffIds['prof.priya'], d, 3, '11:45', '12:45', 'Room 204');
    insertTimetable.run(targetClassId, subjectIds['CS504'], staffIds['dr.anitha'], d, 4, '13:30', '14:30', 'Lab-2');
    insertTimetable.run(targetClassId, subjectIds['CS505'], staffIds['prof.ramesh'], d, 5, '14:30', '15:30', 'Room 204');
  }

  // Holidays
  const insertHoliday = db.prepare('INSERT INTO holidays (title, date, description) VALUES (?, ?, ?)');
  insertHoliday.run('Pongal Festival', '2026-01-14', 'State festival holiday');
  insertHoliday.run('Republic Day', '2026-01-26', 'National Holiday');
  insertHoliday.run('Tamil New Year', '2026-04-14', 'Regional celebration');
  insertHoliday.run('College Sports Day', '2026-08-28', 'Annual sports meet');

  // Staff check-ins for Dr. Anitha and Prof. Ramesh for today and past days
  const todayStr = new Date().toISOString().split('T')[0];
  const insertStaffAtt = db.prepare(`
    INSERT INTO staff_attendance (staff_id, date, check_in_time, check_out_time, status, working_hours, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertStaffAtt.run(staffIds['dr.anitha'], todayStr, '09:12', null, 'on_time', 0, 'Morning check-in');
  insertStaffAtt.run(staffIds['prof.ramesh'], todayStr, '09:38', null, 'late', 0, 'Late by 8 mins (traffic on Salem highway)');
  insertStaffAtt.run(staffIds['prof.priya'], todayStr, '09:10', null, 'on_time', 0, 'On-time check-in');

  // Insert Historical Sessions and Student Attendance for the past 2 weeks
  const insertSession = db.prepare(`
    INSERT INTO attendance_sessions (session_uuid, class_id, subject_id, staff_id, date, start_time, end_time, status, qr_secret, topic)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStuAtt = db.prepare(`
    INSERT INTO student_attendance (session_id, student_id, status, marked_at, marked_by, location_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Generate 10 past sessions across subjects
  const sessionList = [
    { daysAgo: 14, sub: 'CS501', staff: staffIds['dr.anitha'], time: '09:30', topic: 'DOM Manipulation & Event Listeners' },
    { daysAgo: 13, sub: 'CS502', staff: staffIds['prof.ramesh'], time: '10:30', topic: 'Relational Algebra & Normalization' },
    { daysAgo: 12, sub: 'CS503', staff: staffIds['prof.priya'], time: '11:45', topic: 'NumPy Arrays & Data Frames' },
    { daysAgo: 11, sub: 'CS501', staff: staffIds['dr.anitha'], time: '09:30', topic: 'RESTful API Design in Node.js' },
    { daysAgo: 10, sub: 'CS504', staff: staffIds['dr.anitha'], time: '13:30', topic: 'TCP/IP Model and Handshake' },
    { daysAgo: 7, sub: 'CS502', staff: staffIds['prof.ramesh'], time: '10:30', topic: 'Indexing and Query Optimization' },
    { daysAgo: 6, sub: 'CS503', staff: staffIds['prof.priya'], time: '11:45', topic: 'Scikit-learn Regressors' },
    { daysAgo: 5, sub: 'CS505', staff: staffIds['prof.ramesh'], time: '14:30', topic: 'Docker Containers & Images' },
    { daysAgo: 2, sub: 'CS501', staff: staffIds['dr.anitha'], time: '09:30', topic: 'Full Stack Frontend Architecture' },
    { daysAgo: 1, sub: 'CS502', staff: staffIds['prof.ramesh'], time: '10:30', topic: 'Transactions and ACID Properties' }
  ];

  let sampleCorrectionSessionId = null;
  let sampleCorrectionStudentId = null;

  for (const s of sessionList) {
    const d = new Date();
    d.setDate(d.getDate() - s.daysAgo);
    const dateStr = d.toISOString().split('T')[0];
    const uuid = crypto.randomUUID();
    const qrSecret = crypto.randomBytes(16).toString('hex');

    const sRes = insertSession.run(
      uuid,
      targetClassId,
      subjectIds[s.sub],
      s.staff,
      dateStr,
      s.time,
      '10:30',
      'completed',
      qrSecret,
      s.topic
    );
    const sessId = Number(sRes.lastInsertRowid);

    // Populate attendance for all 10 students
    studentIds.forEach((stu, idx) => {
      let status = 'present';
      // Make R. Aravind (idx 4) have low attendance (frequent absents)
      if (idx === 4 && (s.daysAgo % 2 === 0)) {
        status = 'absent';
      } else if (idx === 6 && s.daysAgo === 5) {
        status = 'late';
      } else if (idx === 2 && s.daysAgo === 1) {
        status = 'absent';
        sampleCorrectionSessionId = sessId;
        sampleCorrectionStudentId = stu.id;
      }

      insertStuAtt.run(
        sessId,
        stu.id,
        status,
        `${dateStr} ${s.time}:15`,
        'qr_scan',
        1
      );
    });
  }

  // Active Session for Today (Dr. Anitha's CS501 Class)
  const activeUuid = crypto.randomUUID();
  const activeSecret = crypto.randomBytes(16).toString('hex');
  const activeSessRes = insertSession.run(
    activeUuid,
    targetClassId,
    subjectIds['CS501'],
    staffIds['dr.anitha'],
    todayStr,
    '09:30',
    null,
    'active',
    activeSecret,
    'Modern Single Page Application Architecture & QR Attendance'
  );
  const activeSessId = Number(activeSessRes.lastInsertRowid);

  // 3 students already scanned for today's active session
  insertStuAtt.run(activeSessId, studentIds[0].id, 'present', `${todayStr} 09:32:10`, 'qr_scan', 1);
  insertStuAtt.run(activeSessId, studentIds[1].id, 'present', `${todayStr} 09:33:45`, 'qr_scan', 1);
  insertStuAtt.run(activeSessId, studentIds[3].id, 'late', `${todayStr} 09:41:02`, 'qr_scan', 1);

  // Insert a sample pending correction request for Admin to review
  if (sampleCorrectionSessionId && sampleCorrectionStudentId) {
    const insertCorr = db.prepare(`
      INSERT INTO correction_requests (staff_id, session_id, student_id, original_status, requested_status, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    insertCorr.run(
      staffIds['prof.ramesh'],
      sampleCorrectionSessionId,
      sampleCorrectionStudentId,
      'absent',
      'present',
      'Student M. Karthik was present in class but camera lens was damaged, preventing QR scan. Verified physical presence in Lab.'
    );
  }

  // Initial audit log
  logAudit(adminId, 'admin', 'SYSTEM_INIT', 'system', '1', 'Initial database schema initialized and seeded with KCAS college records');

  console.log('Database successfully initialized and seeded!');
}

// Ensure the specified Admin credentials are always up to date
function ensureAdminCredentials() {
  const adminAuth = hashPassword('KCASCOLLEGE2027');
  const existing = db.prepare(`
    SELECT id, username FROM users WHERE role = 'admin' OR lower(username) = lower('KRISHNACOLLEGEADMIN') OR lower(username) = 'admin'
  `).get();
  
  if (existing) {
    db.prepare(`
      UPDATE users 
      SET username = 'KRISHNACOLLEGEADMIN',
          password_hash = ?,
          salt = ?,
          is_active = 1,
          full_name = 'Principal & Administrator (KCAS)'
      WHERE id = ?
    `).run(adminAuth.hash, adminAuth.salt, existing.id);
  } else {
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, designation, is_active)
      VALUES ('KRISHNACOLLEGEADMIN', ?, ?, 'admin', 'Principal & Administrator (KCAS)', 'admin@kcas.edu.in', '9842411001', 'College Administrator', 1)
    `).run(adminAuth.hash, adminAuth.salt);
  }
}

// Initialize on require
initSchema();
seedDatabase();
ensureAdminCredentials();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  logAudit
};
