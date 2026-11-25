// server.js - Krishna College of Arts and Science (KCAS) Attendance System
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword, logAudit } = require('./db.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'kcas_karur_secure_jwt_token_key_2026';

// Helper: Sign user token
function signToken(payload, expiresInHours = 24) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
  const data = { ...payload, exp };
  
  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${b64Header}.${b64Payload}`).digest('base64url');
  
  return `${b64Header}.${b64Payload}.${signature}`;
}

// Helper: Verify user token
function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [b64Header, b64Payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${b64Header}.${b64Payload}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Helper: Sign dynamic QR Token
function generateQRToken(sessionId, classId, subjectId, secret, durationSeconds = 30) {
  const expiresAt = Date.now() + (durationSeconds * 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = {
    sid: sessionId,
    cid: classId,
    sub: subjectId,
    exp: expiresAt,
    n: nonce
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

// Helper: Verify QR Token
function verifyQRToken(token, secret) {
  if (!token) return { valid: false, reason: 'Empty token' };
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return { valid: false, reason: 'Malformed QR code token' };
    const expectedSig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return { valid: false, reason: 'Invalid or forged QR signature' };
    }
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      return { valid: false, reason: 'QR code has expired. Please rescan the active screen.' };
    }
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'Failed to parse QR code data' };
  }
}

// Helper: Haversine distance in meters
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Helper: Get system settings as key-value map
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

// Parse request body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({ rawText: body });
      }
    });
    req.on('error', reject);
  });
}

// In-Memory Brute-Force Rate Limiter for Login Security
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSecs = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, remainingSecs };
  }
  if (record.lockedUntil && now >= record.lockedUntil) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = now + (5 * 60 * 1000); // 5-minute lockout
  }
  loginAttempts.set(ip, record);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Send JSON response with production security headers
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(JSON.stringify(data));
}

// Send Error response
function sendError(res, statusCode, message, details = null) {
  sendJson(res, statusCode, { success: false, error: message, details });
}

// Extract authenticated user
function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token);
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Main HTTP request handler
const server = http.createServer(async (req, res) => {
  const clientIp = req.socket.remoteAddress || '127.0.0.1';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // -------------------------------------------------------------
    // API ROUTES
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/')) {

      // PUBLIC / AUTH
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const rateCheck = checkRateLimit(clientIp);
        if (!rateCheck.allowed) {
          return sendError(res, 429, `Too many failed login attempts. Rate limit enforced for security. Please try again in ${rateCheck.remainingSecs} seconds.`);
        }

        const body = await parseJsonBody(req);
        const { username, password } = body;
        if (!username || !password) {
          return sendError(res, 400, 'Please provide both username and password');
        }

        const user = db.prepare(`
          SELECT u.id, u.username, u.password_hash, u.salt, u.role, u.full_name, u.email, u.phone, u.photo_url,
                 u.department_id, u.class_id, u.register_number, u.designation, u.is_active,
                 d.name as department_name, c.name as class_name
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          LEFT JOIN classes c ON u.class_id = c.id
          WHERE lower(u.username) = lower(?)
        `).get(username.trim());

        if (!user) {
          recordFailedLogin(clientIp);
          return sendError(res, 401, 'Invalid username or password');
        }

        if (!user.is_active) {
          return sendError(res, 403, 'Your account has been deactivated. Please contact KCAS Administration.');
        }

        if (user.role === 'student') {
          return sendError(res, 403, 'Student portal is currently disabled. Access is reserved for Faculty Staff, HOD, and Administration.');
        }

        const isValid = verifyPassword(password, user.password_hash, user.salt);
        if (!isValid) {
          recordFailedLogin(clientIp);
          return sendError(res, 401, 'Invalid username or password');
        }

        // Reset rate limiter on successful authentication
        clearLoginAttempts(clientIp);

        // Generate token
        const tokenPayload = {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.full_name,
          classId: user.class_id,
          deptId: user.department_id
        };
        const token = signToken(tokenPayload);

        logAudit(user.id, user.username, 'LOGIN', 'user', user.id, `User logged in from ${clientIp}`, clientIp);

        // Sanitize response
        delete user.password_hash;
        delete user.salt;

        return sendJson(res, 200, {
          success: true,
          token,
          user
        });
      }

      // Check current user profile
      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const auth = getAuthUser(req);
        if (!auth) return sendError(res, 401, 'Unauthorized');

        const user = db.prepare(`
          SELECT u.id, u.username, u.role, u.full_name, u.email, u.phone, u.photo_url,
                 u.department_id, u.class_id, u.register_number, u.designation, u.is_active,
                 d.name as department_name, d.code as department_code,
                 c.name as class_name, c.semester, c.academic_year
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          LEFT JOIN classes c ON u.class_id = c.id
          WHERE u.id = ?
        `).get(auth.id);

        if (!user || !user.is_active) return sendError(res, 401, 'Account inactive or not found');

        return sendJson(res, 200, { success: true, user });
      }

      // Public Settings endpoint (for College info, branding, coordinates)
      if (pathname === '/api/public/info' && req.method === 'GET') {
        const settings = getSettings();
        return sendJson(res, 200, {
          success: true,
          collegeName: settings.college_name || 'Krishna College of Arts and Science (KCAS)',
          collegeAddress: settings.college_address || 'Palayam Road, Karur, Tamil Nadu 621301',
          collegePincode: settings.college_pincode || '621301',
          campusLatitude: parseFloat(settings.campus_latitude || '10.9234'),
          campusLongitude: parseFloat(settings.campus_longitude || '78.0772'),
          campusRadiusMeters: parseInt(settings.campus_radius_meters || '350', 10),
          locationVerificationEnabled: true,
          studentQrEnabled: settings.student_qr_enabled === '1',
          lowAttendanceThreshold: parseInt(settings.low_attendance_threshold || '75', 10)
        });
      }

      // -----------------------------------------------------------
      // STUDENT ROUTES (DISABLED)
      // -----------------------------------------------------------
      if (pathname.startsWith('/api/student/')) {
        return sendError(res, 403, 'Student portal is currently disabled. Access is reserved for Faculty Staff, HOD, and Administration.');
      }

      // -----------------------------------------------------------
      // STAFF ROUTES
      // -----------------------------------------------------------
      if (pathname.startsWith('/api/staff/')) {
        const auth = getAuthUser(req);
        if (!auth || (auth.role !== 'staff' && auth.role !== 'admin')) {
          return sendError(res, 403, 'Forbidden: Staff role required');
        }

        // Staff Dashboard Overview
        if (pathname === '/api/staff/dashboard' && req.method === 'GET') {
          const today = new Date().toISOString().split('T')[0];

          // Today's Check-in Status
          const todayAttendance = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(auth.id, today);

          // Departments, Classes & Subjects available for logging
          const departments = db.prepare('SELECT id, code, name FROM departments ORDER BY name ASC').all();
          const classes = db.prepare('SELECT id, name, section, semester FROM classes ORDER BY name ASC').all();
          const subjects = db.prepare('SELECT id, code, name FROM subjects ORDER BY name ASC').all();

          // Today's Period Logs submitted by this staff member
          const myTodayLogs = db.prepare(`
            SELECT s.id, s.session_uuid, s.date, s.start_time, s.end_time, s.period_number,
                   s.lesson_topic, s.lesson_summary, s.lesson_photo, s.created_at,
                   d.name as department_name, d.code as department_code,
                   c.name as class_name,
                   sub.name as subject_name, sub.code as subject_code
            FROM attendance_sessions s
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.staff_id = ? AND s.date = ?
            ORDER BY s.period_number ASC, s.id DESC
          `).all(auth.id, today);

          return sendJson(res, 200, {
            success: true,
            today,
            todayAttendance: todayAttendance || null,
            departments,
            classes,
            subjects,
            myTodayLogs,
            todayCompletedCount: myTodayLogs.length
          });
        }

        // Staff / HOD Logs Class Period Activity & Lesson Photo Proof
        if (pathname === '/api/staff/period-log' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { departmentId, classId, subjectId, subjectName, periodNumber, startTime, endTime, lessonTopic, lessonSummary, lessonPhoto } = body;

          if (!periodNumber) {
            return sendError(res, 400, 'Period / Hour number is required');
          }
          if (!lessonSummary && !lessonTopic) {
            return sendError(res, 400, 'Please enter lesson topic or activity notes of what was done in this period');
          }

          const sessionUuid = crypto.randomUUID();
          const qrSecret = crypto.randomBytes(16).toString('hex');
          const today = new Date().toISOString().split('T')[0];
          const start = startTime || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
          const end = endTime || '';
          const period = parseInt(periodNumber, 10);

          let resolvedSubjectId = subjectId ? parseInt(subjectId, 10) : null;
          if (!resolvedSubjectId && subjectName && subjectName.trim()) {
            const existingSub = db.prepare('SELECT id FROM subjects WHERE lower(name) = lower(?)').get(subjectName.trim());
            if (existingSub) {
              resolvedSubjectId = existingSub.id;
            } else {
              const defaultCourse = db.prepare('SELECT id FROM courses LIMIT 1').get();
              const insSub = db.prepare('INSERT INTO subjects (code, name, course_id, semester, credits) VALUES (?, ?, ?, 1, 3)').run(
                'SUB' + Math.floor(100 + Math.random() * 900),
                subjectName.trim(),
                defaultCourse ? defaultCourse.id : 1
              );
              resolvedSubjectId = Number(insSub.lastInsertRowid);
            }
          }

          const stmt = db.prepare(`
            INSERT INTO attendance_sessions (
              session_uuid, department_id, class_id, subject_id, staff_id, date, start_time, end_time,
              status, qr_secret, topic, period_number, lesson_topic, lesson_summary, lesson_photo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
          `);

          const resInsert = stmt.run(
            sessionUuid,
            departmentId ? parseInt(departmentId, 10) : null,
            classId ? parseInt(classId, 10) : null,
            resolvedSubjectId,
            auth.id,
            today,
            start,
            end,
            qrSecret,
            lessonTopic || 'Class Period Activity',
            period,
            lessonTopic || null,
            lessonSummary || null,
            lessonPhoto || null
          );

          logAudit(auth.id, auth.username, 'LOG_PERIOD_DUTY', 'attendance_sessions', resInsert.lastInsertRowid, `Logged Period ${period} teaching activity with photo proof`, clientIp);

          return sendJson(res, 201, {
            success: true,
            message: `Period ${period} teaching activity logged successfully with photo proof!`,
            sessionId: resInsert.lastInsertRowid
          });
        }

        // Get My Submitted Period Logs
        if (pathname === '/api/staff/my-period-logs' && req.method === 'GET') {
          const date = parsedUrl.searchParams.get('date') || new Date().toISOString().split('T')[0];
          const logs = db.prepare(`
            SELECT s.id, s.session_uuid, s.date, s.start_time, s.end_time, s.period_number,
                   s.lesson_topic, s.lesson_summary, s.lesson_photo, s.created_at,
                   d.name as department_name, d.code as department_code,
                   c.name as class_name,
                   sub.name as subject_name, sub.code as subject_code
            FROM attendance_sessions s
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.staff_id = ? AND s.date = ?
            ORDER BY s.period_number ASC, s.id DESC
          `).all(auth.id, date);

          return sendJson(res, 200, { success: true, date, logs });
        }

        // Staff Daily Self Check-in with Face Photo & Campus GPS Location Verification
        if (pathname === '/api/staff/check-in' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { photo, latitude, longitude } = body;
          const today = new Date().toISOString().split('T')[0];
          const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

          if (!photo) {
            return sendError(res, 400, 'Face Photo authentication is required for staff check-in.');
          }

          // Enforce Campus Geofence
          const settings = getSettings();
          const campusLat = parseFloat(settings.campus_latitude || '10.9234');
          const campusLng = parseFloat(settings.campus_longitude || '78.0772');
          const maxRadius = parseInt(settings.campus_radius_meters || '350', 10);

          if (latitude == null || longitude == null) {
            return sendError(res, 400, 'GPS Location is required to verify physical presence inside KCAS campus.');
          }

          const dist = getDistanceInMeters(latitude, longitude, campusLat, campusLng);
          if (dist > maxRadius) {
            return sendError(res, 403, `Campus boundary verification failed: You are ${dist}m away from KCAS Palayam Road campus (Allowed: ${maxRadius}m).`);
          }

          // Compare with 09:30 AM cutoff for On-Time vs Late
          const [h, m] = time.split(':').map(Number);
          const status = (h < 9 || (h === 9 && m <= 30)) ? 'on_time' : 'late';

          const existing = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(auth.id, today);
          if (existing && existing.check_in_time) {
            return sendError(res, 400, `You have already checked in today at ${existing.check_in_time}`);
          }

          // Ensure profile photo enrollment if not yet saved
          const staffUser = db.prepare('SELECT id, full_name, photo_url FROM users WHERE id = ?').get(auth.id);
          if (staffUser && !staffUser.photo_url) {
            db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(photo, auth.id);
          }

          if (existing) {
            db.prepare(`
              UPDATE staff_attendance 
              SET check_in_time = ?, check_in_photo = ?, check_in_lat = ?, check_in_lng = ?, status = ? 
              WHERE id = ?
            `).run(time, photo, latitude, longitude, status, existing.id);
          } else {
            db.prepare(`
              INSERT INTO staff_attendance (staff_id, date, check_in_time, check_in_photo, check_in_lat, check_in_lng, status, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'Staff biometric mobile check-in')
            `).run(auth.id, today, time, photo, latitude, longitude, status);
          }

          logAudit(auth.id, auth.username, 'STAFF_CHECK_IN', 'staff_attendance', auth.id, `Staff checked in at ${time} (${status}) from ${dist}m with Face Biometric Verification`, clientIp);

          return sendJson(res, 200, {
            success: true,
            message: `Biometric Face Verified! Check-in recorded at ${time} (${status === 'on_time' ? 'On-Time' : 'Late'})`,
            checkInTime: time,
            status,
            distanceMeters: dist
          });
        }

        // Staff Daily Self Check-out with Face Photo & Campus GPS Verification
        if (pathname === '/api/staff/check-out' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { photo, latitude, longitude } = body;
          const today = new Date().toISOString().split('T')[0];
          const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

          if (!photo) {
            return sendError(res, 400, 'Face Photo authentication is required for staff check-out.');
          }

          const existing = db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(auth.id, today);
          if (!existing || !existing.check_in_time) {
            return sendError(res, 400, 'Please check-in first before checking out');
          }

          if (existing.check_out_time) {
            return sendError(res, 400, `You have already checked out today at ${existing.check_out_time}`);
          }

          // Enforce Campus Geofence
          const settings = getSettings();
          const campusLat = parseFloat(settings.campus_latitude || '10.9234');
          const campusLng = parseFloat(settings.campus_longitude || '78.0772');
          const maxRadius = parseInt(settings.campus_radius_meters || '350', 10);

          if (latitude == null || longitude == null) {
            return sendError(res, 400, 'GPS Location is required to verify physical presence inside KCAS campus.');
          }

          const dist = getDistanceInMeters(latitude, longitude, campusLat, campusLng);
          if (dist > maxRadius) {
            return sendError(res, 403, `Campus boundary verification failed: You are ${dist}m away from KCAS Palayam Road campus (Allowed: ${maxRadius}m).`);
          }

          // Calculate working hours
          let workingHours = 0;
          try {
            const [inH, inM] = existing.check_in_time.split(':').map(Number);
            const [outH, outM] = time.split(':').map(Number);
            const diffMinutes = (outH * 60 + outM) - (inH * 60 + inM);
            workingHours = Math.max(0, Math.round((diffMinutes / 60) * 10) / 10);
          } catch (e) {
            workingHours = 0;
          }

          const staffUser = db.prepare('SELECT id, full_name, photo_url FROM users WHERE id = ?').get(auth.id);
          if (staffUser && !staffUser.photo_url) {
            db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(photo, auth.id);
          }

          db.prepare(`
            UPDATE staff_attendance 
            SET check_out_time = ?, check_out_photo = ?, check_out_lat = ?, check_out_lng = ?, working_hours = ?
            WHERE id = ?
          `).run(time, photo, latitude, longitude, workingHours, existing.id);

          logAudit(auth.id, auth.username, 'STAFF_CHECK_OUT', 'staff_attendance', auth.id, `Staff checked out at ${time} (${workingHours} hrs) from ${dist}m with Face Biometric Verification`, clientIp);

          return sendJson(res, 200, {
            success: true,
            message: `Biometric Face Verified! Check-out recorded at ${time}. Total hours logged: ${workingHours} hrs.`,
            checkOutTime: time,
            workingHours,
            distanceMeters: dist
          });
        }

        // Staff Monthly Attendance History
        if (pathname === '/api/staff/attendance-history' && req.method === 'GET') {
          const month = parsedUrl.searchParams.get('month') || new Date().toISOString().substring(0, 7);
          const records = db.prepare(`
            SELECT * FROM staff_attendance
            WHERE staff_id = ? AND date LIKE ?
            ORDER BY date DESC
          `).all(auth.id, `${month}%`);

          return sendJson(res, 200, { success: true, month, records });
        }

        // Create Attendance Session & Start QR Broadcast (with Period Number)
        if (pathname === '/api/staff/sessions/create' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { classId, subjectId, topic, periodNumber } = body;

          if (!classId || !subjectId) {
            return sendError(res, 400, 'Please select both class and subject');
          }

          // Check if there is already an active session for this class or staff
          const active = db.prepare(`
            SELECT id FROM attendance_sessions WHERE staff_id = ? AND status = 'active'
          `).get(auth.id);

          if (active) {
            return sendError(res, 400, 'You already have an active class session running. Please finalize or end it before starting a new one.');
          }

          const sessionUuid = crypto.randomUUID();
          const qrSecret = crypto.randomBytes(24).toString('hex');
          const today = new Date().toISOString().split('T')[0];
          const startTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
          const period = parseInt(periodNumber || '1', 10);

          const stmt = db.prepare(`
            INSERT INTO attendance_sessions (session_uuid, class_id, subject_id, staff_id, date, start_time, status, qr_secret, topic, period_number)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `);
          const result = stmt.run(sessionUuid, classId, subjectId, auth.id, today, startTime, qrSecret, topic || 'Regular Lecture Session', period);
          const sessionId = Number(result.lastInsertRowid);

          logAudit(auth.id, auth.username, 'CREATE_SESSION', 'attendance_sessions', sessionId, `Created attendance session for Class ${classId}, Subject ${subjectId}, Period ${period}`, clientIp);

          // Generate initial QR token
          const settings = getSettings();
          const duration = parseInt(settings.qr_duration_seconds || '30', 10);
          const qrToken = generateQRToken(sessionId, classId, subjectId, qrSecret, duration);

          return sendJson(res, 201, {
            success: true,
            sessionId,
            sessionUuid,
            qrToken,
            durationSeconds: duration,
            startTime,
            topic,
            periodNumber: period
          });
        }

        // Get Student Roster for a Class (for Staff Period Attendance)
        if (pathname.match(/^\/api\/staff\/classes\/(\d+)\/students$/) && req.method === 'GET') {
          const match = pathname.match(/^\/api\/staff\/classes\/(\d+)\/students$/);
          const classId = parseInt(match[1], 10);

          const students = db.prepare(`
            SELECT id, register_number, full_name, email, phone, parent_phone, photo_url
            FROM users
            WHERE class_id = ? AND role = 'student' AND is_active = 1
            ORDER BY register_number ASC
          `).all(classId);

          return sendJson(res, 200, { success: true, students });
        }

        // Get Dynamic Rotating QR Token for an active session
        if (pathname.match(/^\/api\/staff\/sessions\/(\d+)\/qr$/) && req.method === 'GET') {
          const match = pathname.match(/^\/api\/staff\/sessions\/(\d+)\/qr$/);
          const sessionId = parseInt(match[1], 10);

          const session = db.prepare(`
            SELECT id, class_id, subject_id, staff_id, status, qr_secret FROM attendance_sessions WHERE id = ?
          `).get(sessionId);

          if (!session) return sendError(res, 404, 'Session not found');
          if (session.status !== 'active') return sendError(res, 400, 'Session is not active');
          if (session.staff_id !== auth.id && auth.role !== 'admin') {
            return sendError(res, 403, 'Unauthorized to view QR for this session');
          }

          const settings = getSettings();
          const duration = parseInt(settings.qr_duration_seconds || '30', 10);
          const qrToken = generateQRToken(session.id, session.class_id, session.subject_id, session.qr_secret, duration);

          return sendJson(res, 200, {
            success: true,
            sessionId: session.id,
            qrToken,
            durationSeconds: duration,
            expiresAt: Date.now() + (duration * 1000)
          });
        }

        // Live Session Monitor (Real-time roster & scan status)
        if (pathname.match(/^\/api\/staff\/sessions\/(\d+)\/monitor$/) && req.method === 'GET') {
          const match = pathname.match(/^\/api\/staff\/sessions\/(\d+)\/monitor$/);
          const sessionId = parseInt(match[1], 10);

          const session = db.prepare(`
            SELECT s.id, s.session_uuid, s.class_id, s.subject_id, s.staff_id, s.date, s.start_time, s.end_time, s.status, s.topic,
                   c.name as class_name, sub.code as subject_code, sub.name as subject_name
            FROM attendance_sessions s
            JOIN classes c ON s.class_id = c.id
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.id = ?
          `).get(sessionId);

          if (!session) return sendError(res, 404, 'Session not found');

          // Full student roster of the class with scan status
          const roster = db.prepare(`
            SELECT u.id as student_id, u.register_number, u.full_name, u.email,
                   sa.id as attendance_id, sa.status, sa.marked_at, sa.marked_by, sa.location_verified
            FROM users u
            LEFT JOIN student_attendance sa ON sa.student_id = u.id AND sa.session_id = ?
            WHERE u.class_id = ? AND u.role = 'student' AND u.is_active = 1
            ORDER BY u.register_number ASC
          `).all(sessionId, session.class_id);

          const presentCount = roster.filter(r => r.status === 'present').length;
          const lateCount = roster.filter(r => r.status === 'late').length;
          const absentCount = roster.filter(r => r.status === 'absent' || !r.status).length;

          return sendJson(res, 200, {
            success: true,
            session,
            roster,
            stats: {
              total: roster.length,
              present: presentCount,
              late: lateCount,
              absent: absentCount
            }
          });
        }

        // Staff Manual Attendance Toggle / Override
        if (pathname.match(/^\/api\/staff\/sessions\/(\d+)\/manual-mark$/) && req.method === 'POST') {
          const match = pathname.match(/^\/api\/staff\/sessions\/(\d+)\/manual-mark$/);
          const sessionId = parseInt(match[1], 10);
          const body = await parseJsonBody(req);
          const { studentId, status } = body;

          if (!studentId || !['present', 'late', 'absent'].includes(status)) {
            return sendError(res, 400, 'Invalid student ID or attendance status');
          }

          const session = db.prepare('SELECT id, staff_id, status FROM attendance_sessions WHERE id = ?').get(sessionId);
          if (!session) return sendError(res, 404, 'Session not found');
          if (session.staff_id !== auth.id && auth.role !== 'admin') {
            return sendError(res, 403, 'Unauthorized');
          }

          db.prepare(`
            INSERT INTO student_attendance (session_id, student_id, status, marked_at, marked_by, notes)
            VALUES (?, ?, ?, datetime('now', 'localtime'), 'staff_manual', 'Marked manually by teaching staff')
            ON CONFLICT(session_id, student_id) DO UPDATE SET
              status = excluded.status,
              marked_at = datetime('now', 'localtime'),
              marked_by = 'staff_manual',
              notes = 'Updated manually by teaching staff'
          `).run(sessionId, studentId, status);

          logAudit(auth.id, auth.username, 'MANUAL_ATTENDANCE', 'student_attendance', sessionId, `Staff marked student ${studentId} as ${status}`, clientIp);

          return sendJson(res, 200, { success: true, message: `Student marked as ${status.toUpperCase()}` });
        }

        // Batch Period Attendance Marking by Staff / HOD
        if (pathname.match(/^\/api\/staff\/sessions\/(\d+)\/batch-mark$/) && req.method === 'POST') {
          const match = pathname.match(/^\/api\/staff\/sessions\/(\d+)\/batch-mark$/);
          const sessionId = parseInt(match[1], 10);
          const body = await parseJsonBody(req);
          const { marks } = body;

          if (!Array.isArray(marks) || marks.length === 0) {
            return sendError(res, 400, 'Invalid or empty marks payload');
          }

          const session = db.prepare('SELECT id, staff_id, status FROM attendance_sessions WHERE id = ?').get(sessionId);
          if (!session) return sendError(res, 404, 'Session not found');
          if (session.staff_id !== auth.id && auth.role !== 'admin') {
            return sendError(res, 403, 'Unauthorized');
          }

          const stmt = db.prepare(`
            INSERT INTO student_attendance (session_id, student_id, status, marked_at, marked_by, notes)
            VALUES (?, ?, ?, datetime('now', 'localtime'), 'staff_manual', 'Marked by Staff/HOD in period attendance')
            ON CONFLICT(session_id, student_id) DO UPDATE SET
              status = excluded.status,
              marked_at = datetime('now', 'localtime'),
              marked_by = 'staff_manual',
              notes = 'Updated by Staff/HOD in period attendance'
          `);

          let count = 0;
          for (const item of marks) {
            if (item.studentId && ['present', 'absent', 'late'].includes(item.status)) {
              stmt.run(sessionId, item.studentId, item.status);
              count++;
            }
          }

          logAudit(auth.id, auth.username, 'BATCH_MARK_ATTENDANCE', 'attendance_sessions', sessionId, `Staff marked attendance for ${count} students in Period Session`, clientIp);

          return sendJson(res, 200, {
            success: true,
            message: `Recorded period attendance for ${count} students successfully.`,
            count
          });
        }

        // Finalize / Close Attendance Session (with Lesson Topic, Summary, and Classroom Photo Proof)
        if (pathname.match(/^\/api\/staff\/sessions\/(\d+)\/finalize$/) && req.method === 'POST') {
          const match = pathname.match(/^\/api\/staff\/sessions\/(\d+)\/finalize$/);
          const sessionId = parseInt(match[1], 10);
          const body = await parseJsonBody(req);
          const { lessonTopic, lessonSummary, lessonPhoto } = body;

          const session = db.prepare('SELECT id, class_id, staff_id, status FROM attendance_sessions WHERE id = ?').get(sessionId);
          if (!session) return sendError(res, 404, 'Session not found');
          if (session.staff_id !== auth.id && auth.role !== 'admin') {
            return sendError(res, 403, 'Unauthorized');
          }

          const endTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

          // Auto-mark any remaining unrecorded students as Absent
          const unrecordedStudents = db.prepare(`
            SELECT u.id FROM users u
            WHERE u.class_id = ? AND u.role = 'student' AND u.is_active = 1
            AND u.id NOT IN (SELECT student_id FROM student_attendance WHERE session_id = ?)
          `).all(session.class_id, sessionId);

          const markAbsent = db.prepare(`
            INSERT INTO student_attendance (session_id, student_id, status, marked_at, marked_by, notes)
            VALUES (?, ?, 'absent', datetime('now', 'localtime'), 'staff_manual', 'Auto-marked absent upon session finalization')
          `);

          for (const s of unrecordedStudents) {
            markAbsent.run(sessionId, s.id);
          }

          db.prepare(`
            UPDATE attendance_sessions 
            SET status = 'completed', 
                end_time = ?,
                lesson_topic = COALESCE(?, lesson_topic),
                lesson_summary = COALESCE(?, lesson_summary),
                lesson_photo = COALESCE(?, lesson_photo)
            WHERE id = ?
          `).run(endTime, lessonTopic || null, lessonSummary || null, lessonPhoto || null, sessionId);

          logAudit(auth.id, auth.username, 'FINALIZE_SESSION', 'attendance_sessions', sessionId, `Finalized session ${sessionId} with lesson proof photo. ${unrecordedStudents.length} students auto-marked absent.`, clientIp);

          return sendJson(res, 200, {
            success: true,
            message: `Session finalized successfully at ${endTime}. Lesson summary and photo proof saved.`
          });
        }

        // Submit Attendance Correction Request
        if (pathname === '/api/staff/correction-requests' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { sessionId, studentId, originalStatus, requestedStatus, reason } = body;

          if (!sessionId || !studentId || !requestedStatus || !reason) {
            return sendError(res, 400, 'Please provide session, student, requested status, and a detailed reason.');
          }

          // Check if session exists
          const session = db.prepare('SELECT id, staff_id FROM attendance_sessions WHERE id = ?').get(sessionId);
          if (!session) return sendError(res, 404, 'Session not found');

          // Check existing attendance record
          const att = db.prepare('SELECT id, status FROM student_attendance WHERE session_id = ? AND student_id = ?').get(sessionId, studentId);
          const orig = att ? att.status : (originalStatus || 'absent');

          const stmt = db.prepare(`
            INSERT INTO correction_requests (staff_id, session_id, student_id, original_status, requested_status, reason, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
          `);
          const result = stmt.run(auth.id, sessionId, studentId, orig, requestedStatus, reason.trim());

          logAudit(auth.id, auth.username, 'REQUEST_CORRECTION', 'correction_requests', result.lastInsertRowid, `Requested correction for student ${studentId}: ${orig} -> ${requestedStatus}`, clientIp);

          return sendJson(res, 201, {
            success: true,
            message: 'Correction request submitted for Admin review. Finalized records cannot be altered without approval.'
          });
        }

        // List Correction Requests submitted by this Staff
        if (pathname === '/api/staff/correction-requests' && req.method === 'GET') {
          const list = db.prepare(`
            SELECT cr.*, u.full_name as student_name, u.register_number,
                   sub.name as subject_name, sub.code as subject_code, s.date as session_date,
                   rev.full_name as reviewer_name
            FROM correction_requests cr
            JOIN users u ON cr.student_id = u.id
            JOIN attendance_sessions s ON cr.session_id = s.id
            JOIN subjects sub ON s.subject_id = sub.id
            LEFT JOIN users rev ON cr.reviewed_by = rev.id
            WHERE cr.staff_id = ?
            ORDER BY cr.id DESC
          `).all(auth.id);

          return sendJson(res, 200, { success: true, list });
        }
      }

      // -----------------------------------------------------------
      // ADMIN ROUTES
      // -----------------------------------------------------------
      if (pathname.startsWith('/api/admin/')) {
        const auth = getAuthUser(req);
        if (!auth || auth.role !== 'admin') {
          return sendError(res, 403, 'Forbidden: Administrator privileges required');
        }

        // Admin Dashboard Metrics & Summaries
        if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
          const today = new Date().toISOString().split('T')[0];
          const settings = getSettings();
          const threshold = parseInt(settings.low_attendance_threshold || '75', 10);

          // Total user counts
          const studentCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND is_active = 1").get().count;
          const staffCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'staff' AND is_active = 1").get().count;
          const deptCount = db.prepare("SELECT COUNT(*) as count FROM departments").get().count;
          const classCount = db.prepare("SELECT COUNT(*) as count FROM classes").get().count;

          // Today's session and attendance counts
          const todaySessionsCount = db.prepare("SELECT COUNT(*) as count FROM attendance_sessions WHERE date = ?").get(today).count;
          const activeSessionsCount = db.prepare("SELECT COUNT(*) as count FROM attendance_sessions WHERE status = 'active'").get().count;

          // Today's student attendance statuses
          const todayAttCounts = db.prepare(`
            SELECT sa.status, COUNT(*) as count
            FROM student_attendance sa
            JOIN attendance_sessions s ON sa.session_id = s.id
            WHERE s.date = ?
            GROUP BY sa.status
          `).all(today);

          let todayPresent = 0, todayLate = 0, todayAbsent = 0;
          for (const item of todayAttCounts) {
            if (item.status === 'present') todayPresent = item.count;
            if (item.status === 'late') todayLate = item.count;
            if (item.status === 'absent') todayAbsent = item.count;
          }
          const todayTotalMarked = todayPresent + todayLate + todayAbsent;
          const todayAttendanceRate = todayTotalMarked > 0 ? Math.round(((todayPresent + todayLate) / todayTotalMarked) * 100) : 0;

          // Today's Absentees List
          const todayAbsentees = db.prepare(`
            SELECT u.register_number, u.full_name, c.name as class_name, sub.name as subject_name, s.start_time
            FROM student_attendance sa
            JOIN users u ON sa.student_id = u.id
            JOIN attendance_sessions s ON sa.session_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.date = ? AND sa.status = 'absent'
            ORDER BY u.register_number ASC LIMIT 15
          `).all(today);

          // Today's Late Arrivals List
          const todayLateArrivals = db.prepare(`
            SELECT u.register_number, u.full_name, c.name as class_name, sub.name as subject_name, sa.marked_at
            FROM student_attendance sa
            JOIN users u ON sa.student_id = u.id
            JOIN attendance_sessions s ON sa.session_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.date = ? AND sa.status = 'late'
            ORDER BY sa.marked_at DESC LIMIT 15
          `).all(today);

          // Staff Check-ins today
          const staffCheckIns = db.prepare(`
            SELECT u.full_name, u.designation, d.name as department_name,
                   sa.check_in_time, sa.check_out_time, sa.status, sa.working_hours
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN staff_attendance sa ON sa.staff_id = u.id AND sa.date = ?
            WHERE u.role = 'staff' AND u.is_active = 1
            ORDER BY sa.check_in_time DESC NULLS LAST
          `).all(today);

          // Low-Attendance Alert Students (< threshold)
          const allStudents = db.prepare(`
            SELECT u.id, u.register_number, u.full_name, u.email, u.phone, c.name as class_name, d.name as department_name,
                   (SELECT COUNT(*) FROM attendance_sessions ses WHERE ses.class_id = u.class_id AND ses.status != 'cancelled') as total_sessions,
                   (SELECT COUNT(*) FROM student_attendance sa WHERE sa.student_id = u.id AND sa.status IN ('present', 'late')) as attended_sessions
            FROM users u
            JOIN classes c ON u.class_id = c.id
            JOIN departments d ON u.department_id = d.id
            WHERE u.role = 'student' AND u.is_active = 1
          `).all();

          const lowAttendanceStudents = allStudents.map(stu => {
            const pct = stu.total_sessions > 0 ? Math.round((stu.attended_sessions / stu.total_sessions) * 100) : 100;
            return { ...stu, percentage: pct };
          }).filter(stu => stu.total_sessions > 0 && stu.percentage < threshold)
            .sort((a, b) => a.percentage - b.percentage);

          // Pending correction requests count
          const pendingCorrectionsCount = db.prepare("SELECT COUNT(*) as count FROM correction_requests WHERE status = 'pending'").get().count;

          // Recent Audit Logs
          const recentLogs = db.prepare(`
            SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10
          `).all();

          return sendJson(res, 200, {
            success: true,
            counts: {
              students: studentCount,
              staff: staffCount,
              departments: deptCount,
              classes: classCount,
              activeSessions: activeSessionsCount,
              todaySessions: todaySessionsCount,
              pendingCorrections: pendingCorrectionsCount
            },
            todayAttendance: {
              present: todayPresent,
              late: todayLate,
              absent: todayAbsent,
              rate: todayAttendanceRate
            },
            todayAbsentees,
            todayLateArrivals,
            staffCheckIns,
            lowAttendanceStudents,
            recentLogs
          });
        }

        // Manage Users: List with search & filters
        if (pathname === '/api/admin/users' && req.method === 'GET') {
          const role = parsedUrl.searchParams.get('role');
          const deptId = parsedUrl.searchParams.get('department_id');
          const classId = parsedUrl.searchParams.get('class_id');
          const search = parsedUrl.searchParams.get('search');

          let query = `
            SELECT u.id, u.username, u.role, u.full_name, u.email, u.phone,
                   u.parent_phone, u.address, u.photo_url,
                   u.department_id, u.class_id, u.register_number, u.designation, u.is_active, u.created_at,
                   d.name as department_name, d.code as department_code,
                   c.name as class_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN classes c ON u.class_id = c.id
            WHERE 1=1
          `;
          const params = [];

          if (role) {
            query += ' AND u.role = ?';
            params.push(role);
          }
          if (deptId) {
            query += ' AND u.department_id = ?';
            params.push(deptId);
          }
          if (classId) {
            query += ' AND u.class_id = ?';
            params.push(classId);
          }
          if (search) {
            query += ' AND (u.full_name LIKE ? OR u.username LIKE ? OR u.register_number LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.parent_phone LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s, s, s);
          }

          query += ' ORDER BY u.role, u.full_name ASC';
          const users = db.prepare(query).all(...params);

          return sendJson(res, 200, { success: true, users });
        }

        // Create User (with Student Phone, Parent Phone, Address, Photo)
        if (pathname === '/api/admin/users' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { username, password, role, fullName, email, phone, parentPhone, address, photoUrl, departmentId, classId, registerNumber, designation } = body;

          if (!username || !password || !role || !fullName) {
            return sendError(res, 400, 'Username, password, role, and full name are required');
          }

          if (role === 'admin') {
            return sendError(res, 400, 'Extra admin creation is disabled. Only one official administrator account is allowed.');
          }

          const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username.trim());
          if (existing) {
            return sendError(res, 409, `Username '${username}' is already taken`);
          }

          const auth = hashPassword(password);
          const stmt = db.prepare(`
            INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, parent_phone, address, photo_url, department_id, class_id, register_number, designation, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `);
          const resInsert = stmt.run(
            username.trim(),
            auth.hash,
            auth.salt,
            role,
            fullName.trim(),
            email || null,
            phone || null,
            parentPhone || null,
            address || null,
            photoUrl || null,
            departmentId || null,
            classId || null,
            registerNumber ? registerNumber.trim().toUpperCase() : null,
            designation || (role === 'student' ? 'Student' : 'Staff')
          );

          logAudit(auth.id, auth.username, 'CREATE_USER', 'users', resInsert.lastInsertRowid, `Created ${role} account: ${username}`, clientIp);

          return sendJson(res, 201, { success: true, message: 'User created successfully', userId: resInsert.lastInsertRowid });
        }

        // Update User / Toggle Active Status
        if (pathname.match(/^\/api\/admin\/users\/(\d+)$/) && req.method === 'PUT') {
          const match = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
          const targetUserId = parseInt(match[1], 10);
          const body = await parseJsonBody(req);
          const { fullName, email, phone, parentPhone, address, photoUrl, departmentId, classId, registerNumber, designation, isActive, newPassword } = body;

          const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId);
          if (!user) return sendError(res, 404, 'User not found');

          let updateQuery = `
            UPDATE users SET
              full_name = COALESCE(?, full_name),
              email = ?,
              phone = ?,
              parent_phone = COALESCE(?, parent_phone),
              address = COALESCE(?, address),
              photo_url = COALESCE(?, photo_url),
              department_id = ?,
              class_id = ?,
              register_number = ?,
              designation = ?,
              is_active = COALESCE(?, is_active)
          `;
          const params = [
            fullName,
            email || null,
            phone || null,
            parentPhone !== undefined ? parentPhone : null,
            address !== undefined ? address : null,
            photoUrl !== undefined ? photoUrl : null,
            departmentId || null,
            classId || null,
            registerNumber || null,
            designation || null,
            isActive !== undefined ? isActive : null
          ];

          if (newPassword && newPassword.trim().length >= 4) {
            const newAuth = hashPassword(newPassword.trim());
            updateQuery += ', password_hash = ?, salt = ?';
            params.push(newAuth.hash, newAuth.salt);
          }

          updateQuery += ' WHERE id = ?';
          params.push(targetUserId);

          db.prepare(updateQuery).run(...params);

          logAudit(auth.id, auth.username, 'UPDATE_USER', 'users', targetUserId, `Updated user details for ${user.username}`, clientIp);

          return sendJson(res, 200, { success: true, message: 'User updated successfully' });
        }

        // Delete User (Staff / Student)
        if (pathname.match(/^\/api\/admin\/users\/(\d+)$/) && req.method === 'DELETE') {
          const match = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
          const targetUserId = parseInt(match[1], 10);

          const targetUser = db.prepare('SELECT id, username, role, full_name FROM users WHERE id = ?').get(targetUserId);
          if (!targetUser) return sendError(res, 404, 'User not found');
          if (targetUser.role === 'admin' || targetUser.username.toUpperCase() === 'KRISHNACOLLEGEADMIN') {
            return sendError(res, 400, 'The primary administrator account cannot be deleted');
          }

          // Delete all dependencies
          db.prepare('DELETE FROM staff_attendance WHERE staff_id = ?').run(targetUserId);
          db.prepare('DELETE FROM student_attendance WHERE student_id = ?').run(targetUserId);
          db.prepare('DELETE FROM student_daily_attendance WHERE student_id = ?').run(targetUserId);
          db.prepare('DELETE FROM staff_allocations WHERE staff_id = ?').run(targetUserId);
          db.prepare('DELETE FROM timetables WHERE staff_id = ?').run(targetUserId);
          db.prepare('DELETE FROM correction_requests WHERE staff_id = ? OR student_id = ?').run(targetUserId, targetUserId);
          db.prepare('DELETE FROM attendance_sessions WHERE staff_id = ?').run(targetUserId);
          db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);

          logAudit(auth.id, auth.username, 'DELETE_USER', 'users', targetUserId, `Deleted ${targetUser.role} user: ${targetUser.full_name} (${targetUser.username})`, clientIp);

          return sendJson(res, 200, {
            success: true,
            message: `${targetUser.role === 'staff' ? 'Faculty Staff' : 'Student'} member '${targetUser.full_name}' deleted successfully`
          });
        }

        // Bulk Import Users via CSV Text
        if (pathname === '/api/admin/users/import-csv' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { csvData, defaultRole = 'student' } = body;

          if (!csvData || typeof csvData !== 'string') {
            return sendError(res, 400, 'CSV content is required');
          }

          const lines = csvData.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
          if (lines.length < 2) {
            return sendError(res, 400, 'CSV must contain a header row and at least one data row');
          }

          const header = lines[0].split(',').map(h => h.trim().toLowerCase());
          let imported = 0;
          let errors = [];

          const insertStmt = db.prepare(`
            INSERT INTO users (username, password_hash, salt, role, full_name, email, phone, department_id, class_id, register_number, designation, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `);

          // Preload departments & classes
          const depts = db.prepare('SELECT id, code, name FROM departments').all();
          const classes = db.prepare('SELECT id, name FROM classes').all();

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const row = {};
            header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

            const username = row.username || row.reg_no || row.register_number;
            const fullName = row.full_name || row.name;
            const password = row.password || 'kcas123';
            const role = row.role || defaultRole;

            if (!username || !fullName) {
              errors.push(`Row ${i + 1}: Missing username or name`);
              continue;
            }

            // Check duplicate
            const exist = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
            if (exist) {
              errors.push(`Row ${i + 1}: Username '${username}' already exists`);
              continue;
            }

            // Match department
            let deptId = null;
            if (row.department_code || row.department) {
              const dMatch = depts.find(d => d.code.toLowerCase() === (row.department_code || row.department).toLowerCase() || d.name.toLowerCase() === (row.department_code || row.department).toLowerCase());
              if (dMatch) deptId = dMatch.id;
            }

            // Match class
            let classId = null;
            if (row.class_name || row.class) {
              const cMatch = classes.find(c => c.name.toLowerCase().includes((row.class_name || row.class).toLowerCase()));
              if (cMatch) classId = cMatch.id;
            }

            try {
              const authUser = hashPassword(password);
              insertStmt.run(
                username,
                authUser.hash,
                authUser.salt,
                role,
                fullName,
                row.email || null,
                row.phone || null,
                deptId,
                classId,
                row.register_number || row.reg_no || (role === 'student' ? username.toUpperCase() : null),
                row.designation || (role === 'student' ? 'Student' : 'Staff')
              );
              imported++;
            } catch (err) {
              errors.push(`Row ${i + 1} (${username}): ${err.message}`);
            }
          }

          logAudit(auth.id, auth.username, 'IMPORT_CSV', 'users', imported, `Bulk imported ${imported} users from CSV. Errors: ${errors.length}`, clientIp);

          return sendJson(res, 200, {
            success: true,
            imported,
            errors,
            message: `Successfully imported ${imported} users.${errors.length > 0 ? ` ${errors.length} rows skipped.` : ''}`
          });
        }

        // Academic Structure Lists (Departments, Courses, Classes, Subjects)
        if (pathname === '/api/admin/academic' && req.method === 'GET') {
          const departments = db.prepare('SELECT * FROM departments ORDER BY name ASC').all();
          const courses = db.prepare(`
            SELECT c.*, d.name as department_name, d.code as department_code
            FROM courses c
            JOIN departments d ON c.department_id = d.id
            ORDER BY c.name ASC
          `).all();
          const classes = db.prepare(`
            SELECT cl.*, co.name as course_name, co.degree_level, d.name as department_name
            FROM classes cl
            JOIN courses co ON cl.course_id = co.id
            JOIN departments d ON co.department_id = d.id
            ORDER BY cl.name ASC
          `).all();
          const subjects = db.prepare(`
            SELECT s.*, co.name as course_name
            FROM subjects s
            JOIN courses co ON s.course_id = co.id
            ORDER BY s.semester, s.code ASC
          `).all();
          const staffList = db.prepare("SELECT id, full_name, designation, email FROM users WHERE role = 'staff' AND is_active = 1 ORDER BY full_name ASC").all();

          return sendJson(res, 200, {
            success: true,
            departments,
            courses,
            classes,
            subjects,
            staffList
          });
        }

        // Create Department
        if (pathname === '/api/admin/departments' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { code, name } = body;
          if (!code || !name) return sendError(res, 400, 'Code and Name are required');
          const resIns = db.prepare('INSERT INTO departments (code, name) VALUES (?, ?)').run(code.trim().toUpperCase(), name.trim());
          logAudit(auth.id, auth.username, 'CREATE_DEPT', 'departments', resIns.lastInsertRowid, `Created department ${code}`, clientIp);
          return sendJson(res, 201, { success: true, id: resIns.lastInsertRowid });
        }

        // Create Class
        if (pathname === '/api/admin/classes' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { courseId, name, academicYear, semester, section } = body;
          if (!courseId || !name || !academicYear || !semester) {
            return sendError(res, 400, 'All class fields are required');
          }
          const resIns = db.prepare(`
            INSERT INTO classes (course_id, name, academic_year, semester, section)
            VALUES (?, ?, ?, ?, ?)
          `).run(courseId, name.trim(), academicYear.trim(), semester, section || 'A');
          logAudit(auth.id, auth.username, 'CREATE_CLASS', 'classes', resIns.lastInsertRowid, `Created class ${name}`, clientIp);
          return sendJson(res, 201, { success: true, id: resIns.lastInsertRowid });
        }

        // Create Subject
        if (pathname === '/api/admin/subjects' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { code, name, courseId, semester, credits } = body;
          if (!code || !name || !courseId || !semester) {
            return sendError(res, 400, 'Code, name, course, and semester are required');
          }
          const resIns = db.prepare(`
            INSERT INTO subjects (code, name, course_id, semester, credits)
            VALUES (?, ?, ?, ?, ?)
          `).run(code.trim().toUpperCase(), name.trim(), courseId, semester, credits || 3);
          logAudit(auth.id, auth.username, 'CREATE_SUBJECT', 'subjects', resIns.lastInsertRowid, `Created subject ${code}`, clientIp);
          return sendJson(res, 201, { success: true, id: resIns.lastInsertRowid });
        }

        // Staff Allocations Management
        if (pathname === '/api/admin/allocations' && req.method === 'GET') {
          const allocations = db.prepare(`
            SELECT sa.id, sa.staff_id, sa.class_id, sa.subject_id, sa.academic_year,
                   u.full_name as staff_name, u.designation,
                   c.name as class_name, sub.code as subject_code, sub.name as subject_name
            FROM staff_allocations sa
            JOIN users u ON sa.staff_id = u.id
            JOIN classes c ON sa.class_id = c.id
            JOIN subjects sub ON sa.subject_id = sub.id
            ORDER BY c.name, sub.code ASC
          `).all();

          return sendJson(res, 200, { success: true, allocations });
        }

        if (pathname === '/api/admin/allocations' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { staffId, classId, subjectId, academicYear } = body;
          if (!staffId || !classId || !subjectId) {
            return sendError(res, 400, 'Staff, Class, and Subject must be specified');
          }
          const yr = academicYear || '2026-2027';
          const stmt = db.prepare(`
            INSERT INTO staff_allocations (staff_id, class_id, subject_id, academic_year)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(staff_id, class_id, subject_id, academic_year) DO NOTHING
          `);
          stmt.run(staffId, classId, subjectId, yr);
          logAudit(auth.id, auth.username, 'ALLOCATE_STAFF', 'staff_allocations', staffId, `Assigned staff ${staffId} to class ${classId}, subject ${subjectId}`, clientIp);
          return sendJson(res, 201, { success: true, message: 'Staff allocated successfully' });
        }

        // Timetables Management
        if (pathname === '/api/admin/timetables' && req.method === 'GET') {
          const classId = parsedUrl.searchParams.get('class_id');
          let query = `
            SELECT t.*, c.name as class_name, sub.code as subject_code, sub.name as subject_name,
                   u.full_name as staff_name
            FROM timetables t
            JOIN classes c ON t.class_id = c.id
            JOIN subjects sub ON t.subject_id = sub.id
            JOIN users u ON t.staff_id = u.id
          `;
          const params = [];
          if (classId) {
            query += ' WHERE t.class_id = ?';
            params.push(classId);
          }
          query += ' ORDER BY t.class_id, t.day_of_week, t.period_number ASC';
          const timetables = db.prepare(query).all(...params);
          return sendJson(res, 200, { success: true, timetables });
        }

        if (pathname === '/api/admin/timetables' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const { classId, subjectId, staffId, dayOfWeek, periodNumber, startTime, endTime, roomNumber } = body;
          if (!classId || !subjectId || !staffId || !dayOfWeek || !periodNumber || !startTime || !endTime) {
            return sendError(res, 400, 'All timetable period fields are required');
          }
          const resIns = db.prepare(`
            INSERT INTO timetables (class_id, subject_id, staff_id, day_of_week, period_number, start_time, end_time, room_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(classId, subjectId, staffId, dayOfWeek, periodNumber, startTime, endTime, roomNumber || 'Room 101');
          return sendJson(res, 201, { success: true, id: resIns.lastInsertRowid });
        }

        // System Settings
        if (pathname === '/api/admin/settings' && req.method === 'GET') {
          const settings = db.prepare('SELECT * FROM settings').all();
          const holidays = db.prepare('SELECT * FROM holidays ORDER BY date ASC').all();
          return sendJson(res, 200, { success: true, settings, holidays });
        }

        if (pathname === '/api/admin/settings' && req.method === 'PUT') {
          const body = await parseJsonBody(req);
          const updateStmt = db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, datetime('now', 'localtime'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `);

          for (const [key, value] of Object.entries(body)) {
            if (typeof value === 'string' || typeof value === 'number') {
              updateStmt.run(key, String(value));
            }
          }

          logAudit(auth.id, auth.username, 'UPDATE_SETTINGS', 'settings', 'all', 'Admin updated system configuration settings', clientIp);

          return sendJson(res, 200, { success: true, message: 'Settings saved successfully' });
        }

        // Faculty Class Period Duty Logs & Photo Proofs for Admin Review
        if (pathname === '/api/admin/period-logs' && req.method === 'GET') {
          const date = parsedUrl.searchParams.get('date');
          const deptId = parsedUrl.searchParams.get('department_id');
          const staffId = parsedUrl.searchParams.get('staff_id');
          const period = parsedUrl.searchParams.get('period');

          let query = `
            SELECT s.id, s.session_uuid, s.date, s.start_time, s.end_time, s.period_number,
                   s.lesson_topic, s.lesson_summary, s.lesson_photo, s.created_at,
                   u.id as staff_id, u.full_name as staff_name, u.username as staff_username, u.designation as staff_designation,
                   d.name as department_name, d.code as department_code,
                   c.name as class_name,
                   sub.name as subject_name, sub.code as subject_code
            FROM attendance_sessions s
            JOIN users u ON s.staff_id = u.id
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            WHERE 1=1
          `;
          const params = [];
          if (date) { query += ' AND s.date = ?'; params.push(date); }
          if (deptId) { query += ' AND s.department_id = ?'; params.push(deptId); }
          if (staffId) { query += ' AND s.staff_id = ?'; params.push(staffId); }
          if (period) { query += ' AND s.period_number = ?'; params.push(period); }

          query += ' ORDER BY s.date DESC, s.period_number ASC, s.id DESC LIMIT 300';
          const logs = db.prepare(query).all(...params);

          return sendJson(res, 200, { success: true, count: logs.length, logs });
        }

        // Comprehensive Attendance Records Filter & Search
        if (pathname === '/api/admin/attendance-records' && req.method === 'GET') {
          const fromDate = parsedUrl.searchParams.get('from_date');
          const toDate = parsedUrl.searchParams.get('to_date');
          const deptId = parsedUrl.searchParams.get('department_id');
          const classId = parsedUrl.searchParams.get('class_id');
          const subjectId = parsedUrl.searchParams.get('subject_id');
          const semester = parsedUrl.searchParams.get('semester');
          const status = parsedUrl.searchParams.get('status');

          let query = `
            SELECT sa.id as attendance_id, sa.status, sa.marked_at, sa.marked_by, sa.location_verified,
                   s.date, s.start_time, s.topic,
                   u.id as student_id, u.register_number, u.full_name as student_name,
                   c.name as class_name, c.semester,
                   sub.code as subject_code, sub.name as subject_name,
                   d.name as department_name,
                   t.full_name as staff_name
            FROM student_attendance sa
            JOIN attendance_sessions s ON sa.session_id = s.id
            JOIN users u ON sa.student_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN courses co ON c.course_id = co.id
            JOIN departments d ON co.department_id = d.id
            JOIN subjects sub ON s.subject_id = sub.id
            JOIN users t ON s.staff_id = t.id
            WHERE 1=1
          `;
          const params = [];

          if (fromDate) {
            query += ' AND s.date >= ?';
            params.push(fromDate);
          }
          if (toDate) {
            query += ' AND s.date <= ?';
            params.push(toDate);
          }
          if (deptId) {
            query += ' AND d.id = ?';
            params.push(deptId);
          }
          if (classId) {
            query += ' AND c.id = ?';
            params.push(classId);
          }
          if (subjectId) {
            query += ' AND sub.id = ?';
            params.push(subjectId);
          }
          if (semester) {
            query += ' AND c.semester = ?';
            params.push(semester);
          }
          if (status) {
            query += ' AND sa.status = ?';
            params.push(status);
          }

          query += ' ORDER BY s.date DESC, s.start_time DESC, u.register_number ASC LIMIT 300';
          const records = db.prepare(query).all(...params);

          return sendJson(res, 200, { success: true, count: records.length, records });
        }

        // Attendance Correction Requests (List & Review)
        if (pathname === '/api/admin/correction-requests' && req.method === 'GET') {
          const status = parsedUrl.searchParams.get('status');
          let query = `
            SELECT cr.*, 
                   u.full_name as student_name, u.register_number,
                   staff.full_name as staff_name,
                   sub.name as subject_name, sub.code as subject_code,
                   s.date as session_date, s.start_time as session_time,
                   rev.full_name as reviewer_name
            FROM correction_requests cr
            JOIN users u ON cr.student_id = u.id
            JOIN users staff ON cr.staff_id = staff.id
            JOIN attendance_sessions s ON cr.session_id = s.id
            JOIN subjects sub ON s.subject_id = sub.id
            LEFT JOIN users rev ON cr.reviewed_by = rev.id
          `;
          const params = [];
          if (status) {
            query += ' WHERE cr.status = ?';
            params.push(status);
          }
          query += " ORDER BY CASE cr.status WHEN 'pending' THEN 1 ELSE 2 END, cr.id DESC";
          const requests = db.prepare(query).all(...params);

          return sendJson(res, 200, { success: true, requests });
        }

        // Admin Review: Approve or Reject Correction Request
        if (pathname.match(/^\/api\/admin\/correction-requests\/(\d+)\/review$/) && req.method === 'POST') {
          const match = pathname.match(/^\/api\/admin\/correction-requests\/(\d+)\/review$/);
          const reqId = parseInt(match[1], 10);
          const body = await parseJsonBody(req);
          const { action, remarks } = body; // action: 'approved' | 'rejected'

          if (!['approved', 'rejected'].includes(action)) {
            return sendError(res, 400, "Action must be either 'approved' or 'rejected'");
          }

          const request = db.prepare('SELECT * FROM correction_requests WHERE id = ?').get(reqId);
          if (!request) return sendError(res, 404, 'Correction request not found');
          if (request.status !== 'pending') {
            return sendError(res, 400, `This request has already been ${request.status}`);
          }

          // If approved, update the actual attendance record
          if (action === 'approved') {
            db.prepare(`
              INSERT INTO student_attendance (session_id, student_id, status, marked_at, marked_by, notes)
              VALUES (?, ?, ?, datetime('now', 'localtime'), 'admin_override', ?)
              ON CONFLICT(session_id, student_id) DO UPDATE SET
                status = excluded.status,
                marked_by = 'admin_override',
                notes = excluded.notes
            `).run(
              request.session_id,
              request.student_id,
              request.requested_status,
              `Correction approved by Admin (${remarks || 'Reason accepted: ' + request.reason})`
            );
          }

          // Update request status
          db.prepare(`
            UPDATE correction_requests
            SET status = ?, reviewed_by = ?, reviewed_at = datetime('now', 'localtime'), review_remarks = ?
            WHERE id = ?
          `).run(action, auth.id, remarks || null, reqId);

          logAudit(
            auth.id,
            auth.username,
            `CORRECTION_${action.toUpperCase()}`,
            'correction_requests',
            reqId,
            `Admin ${action} correction for student ${request.student_id} (Reason: ${request.reason}). Remarks: ${remarks || 'None'}`,
            clientIp
          );

          return sendJson(res, 200, {
            success: true,
            message: `Correction request has been ${action}. ${action === 'approved' ? 'Student attendance record updated.' : ''}`
          });
        }

        // Export Reports to CSV / Excel
        if (pathname === '/api/admin/reports/export' && req.method === 'GET') {
          const format = parsedUrl.searchParams.get('format') || 'csv';
          const fromDate = parsedUrl.searchParams.get('from_date');
          const toDate = parsedUrl.searchParams.get('to_date');
          const classId = parsedUrl.searchParams.get('class_id');
          const subjectId = parsedUrl.searchParams.get('subject_id');

          let query = `
            SELECT s.date as Date, s.start_time as Time,
                   u.register_number as "Reg No", u.full_name as "Student Name",
                   c.name as Class, c.semester as Semester,
                   sub.code as "Subject Code", sub.name as "Subject Name",
                   t.full_name as "Faculty Name",
                   upper(sa.status) as Status,
                   sa.marked_at as "Marked At",
                   sa.marked_by as "Marked Mode",
                   CASE WHEN sa.location_verified = 1 THEN 'Yes' ELSE 'No' END as "Location Verified"
            FROM student_attendance sa
            JOIN attendance_sessions s ON sa.session_id = s.id
            JOIN users u ON sa.student_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN subjects sub ON s.subject_id = sub.id
            JOIN users t ON s.staff_id = t.id
            WHERE 1=1
          `;
          const params = [];
          if (fromDate) { query += ' AND s.date >= ?'; params.push(fromDate); }
          if (toDate) { query += ' AND s.date <= ?'; params.push(toDate); }
          if (classId) { query += ' AND c.id = ?'; params.push(classId); }
          if (subjectId) { query += ' AND sub.id = ?'; params.push(subjectId); }

          query += ' ORDER BY s.date DESC, u.register_number ASC';
          const rows = db.prepare(query).all(...params);

          if (rows.length === 0) {
            return sendError(res, 404, 'No attendance records found matching filters');
          }

          const headers = Object.keys(rows[0]);
          let csv = headers.join(',') + '\r\n';
          for (const row of rows) {
            const line = headers.map(h => {
              const val = row[h] == null ? '' : String(row[h]).replace(/"/g, '""');
              return `"${val}"`;
            }).join(',');
            csv += line + '\r\n';
          }

          logAudit(auth.id, auth.username, 'EXPORT_REPORT', 'reports', rows.length, `Exported ${rows.length} attendance records`, clientIp);

          if (format === 'excel') {
            res.writeHead(200, {
              'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
              'Content-Disposition': `attachment; filename="kcas_attendance_report_${Date.now()}.xls"`
            });
            // Excel HTML Table format
            let htmlTable = `<html><head><meta charset="utf-8"></head><body><h2>Krishna College of Arts and Science (KCAS)</h2><h3>Attendance Report Export</h3><table border="1"><tr>`;
            headers.forEach(h => htmlTable += `<th style="background:#B91C1C;color:#fff;">${h}</th>`);
            htmlTable += `</tr>`;
            for (const row of rows) {
              htmlTable += `<tr>`;
              headers.forEach(h => htmlTable += `<td>${row[h] != null ? row[h] : ''}</td>`);
              htmlTable += `</tr>`;
            }
            htmlTable += `</table></body></html>`;
            return res.end(htmlTable);
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="kcas_attendance_report_${Date.now()}.csv"`
            });
            return res.end(csv);
          }
        }

        // Full Audit Logs
        if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
          const action = parsedUrl.searchParams.get('action');
          let query = 'SELECT * FROM audit_logs';
          const params = [];
          if (action) {
            query += ' WHERE action = ?';
            params.push(action);
          }
          query += ' ORDER BY id DESC LIMIT 200';
          const logs = db.prepare(query).all(...params);
          return sendJson(res, 200, { success: true, logs });
        }
      }

      // If no API endpoint matched
      return sendError(res, 404, `API route not found: ${pathname}`);
    }

    // -------------------------------------------------------------
    // STATIC FILE SERVING (PUBLIC FOLDER)
    // -------------------------------------------------------------
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Fallback to index.html for SPA routing if path doesn't have an extension
        if (!path.extname(pathname)) {
          filePath = path.join(__dirname, 'public', 'index.html');
          return serveFile(filePath, res);
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
      }
      serveFile(filePath, res);
    });

  } catch (err) {
    console.error('Server error:', err);
    sendError(res, 500, 'Internal Server Error', err.message);
  }
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error loading file');
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(content);
  });
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(` Krishna College of Arts and Science (KCAS) Attendance System`);
  console.log(` Palayam Road, Karur, Tamil Nadu 621301`);
  console.log(` Running on: http://localhost:${PORT}`);
  console.log(` Network IP: http://0.0.0.0:${PORT}`);
  console.log(`================================================================`);
});
