// api.js - Frontend API Service with JWT Token Management and Error Handling
const API = {
  TOKEN_KEY: 'kcas_auth_token',
  USER_KEY: 'kcas_user_data',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    try {
      const data = localStorage.getItem(this.USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  },

  setAuth(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  clearAuth() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : endpoint;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = data.error || data.message || `Request failed (${response.status})`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
        throw new Error('Network connection error: Unable to reach KCAS Attendance Server. Please check your network connection.');
      }
      throw err;
    }
  },

  // Auth Endpoints
  async login(username, password) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (res.token && res.user) {
      this.setAuth(res.token, res.user);
    }
    return res;
  },

  async getMe() {
    return this.request('/api/auth/me');
  },

  logout() {
    this.clearAuth();
    window.location.reload();
  },

  async getPublicInfo() {
    return this.request('/api/public/info');
  },

  // Student Endpoints
  async getStudentProfile() {
    return this.request('/api/student/profile');
  },

  async getStudentDailyStatus() {
    return this.request('/api/student/daily-status');
  },

  async studentDailyCheckIn(photo, latitude, longitude) {
    return this.request('/api/student/daily-checkin', {
      method: 'POST',
      body: JSON.stringify({ photo, latitude, longitude })
    });
  },

  async studentDailyCheckOut(photo, latitude, longitude) {
    return this.request('/api/student/daily-checkout', {
      method: 'POST',
      body: JSON.stringify({ photo, latitude, longitude })
    });
  },

  async getStudentTimetable() {
    return this.request('/api/student/timetable');
  },

  async getStudentActiveSession() {
    return this.request('/api/student/active-session');
  },

  async markStudentAttendance(qrToken, latitude, longitude) {
    return this.request('/api/student/mark-attendance', {
      method: 'POST',
      body: JSON.stringify({ qrToken, latitude, longitude })
    });
  },

  async getStudentStats() {
    return this.request('/api/student/attendance-stats');
  },

  async getStudentHistory(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/student/attendance-history${query ? '?' + query : ''}`);
  },

  // Staff Endpoints
  async getStaffDashboard() {
    return this.request('/api/staff/dashboard');
  },

  async staffCheckIn(photo, latitude, longitude) {
    return this.request('/api/staff/check-in', {
      method: 'POST',
      body: JSON.stringify({ photo, latitude, longitude })
    });
  },

  async staffCheckOut(photo, latitude, longitude) {
    return this.request('/api/staff/check-out', {
      method: 'POST',
      body: JSON.stringify({ photo, latitude, longitude })
    });
  },

  async getStaffHistory(month) {
    return this.request(`/api/staff/attendance-history${month ? '?month=' + month : ''}`);
  },

  async createClassSession(classId, subjectId, topic, periodNumber = 1) {
    return this.request('/api/staff/sessions/create', {
      method: 'POST',
      body: JSON.stringify({ classId, subjectId, topic, periodNumber })
    });
  },

  async getStaffClassStudents(classId) {
    return this.request(`/api/staff/classes/${classId}/students`);
  },

  async batchMarkPeriodAttendance(sessionId, marks) {
    return this.request(`/api/staff/sessions/${sessionId}/batch-mark`, {
      method: 'POST',
      body: JSON.stringify({ marks })
    });
  },

  async getSessionQR(sessionId) {
    return this.request(`/api/staff/sessions/${sessionId}/qr`);
  },

  async getSessionMonitor(sessionId) {
    return this.request(`/api/staff/sessions/${sessionId}/monitor`);
  },

  async manualMarkStudent(sessionId, studentId, status) {
    return this.request(`/api/staff/sessions/${sessionId}/manual-mark`, {
      method: 'POST',
      body: JSON.stringify({ studentId, status })
    });
  },

  async finalizeSession(sessionId, lessonTopic, lessonSummary, lessonPhoto) {
    return this.request(`/api/staff/sessions/${sessionId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ lessonTopic, lessonSummary, lessonPhoto })
    });
  },

  async submitCorrectionRequest(data) {
    return this.request('/api/staff/correction-requests', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getStaffCorrectionRequests() {
    return this.request('/api/staff/correction-requests');
  },

  // Admin Endpoints
  async getAdminDashboard() {
    return this.request('/api/admin/dashboard');
  },

  async getAdminUsers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/admin/users${query ? '?' + query : ''}`);
  },

  async createAdminUser(data) {
    return this.request('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateAdminUser(userId, data) {
    return this.request(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async importUsersCsv(csvData, defaultRole) {
    return this.request('/api/admin/users/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csvData, defaultRole })
    });
  },

  async getAcademicStructure() {
    return this.request('/api/admin/academic');
  },

  async createDepartment(data) {
    return this.request('/api/admin/departments', { method: 'POST', body: JSON.stringify(data) });
  },

  async createClass(data) {
    return this.request('/api/admin/classes', { method: 'POST', body: JSON.stringify(data) });
  },

  async createSubject(data) {
    return this.request('/api/admin/subjects', { method: 'POST', body: JSON.stringify(data) });
  },

  async getAdminAllocations() {
    return this.request('/api/admin/allocations');
  },

  async allocateStaff(data) {
    return this.request('/api/admin/allocations', { method: 'POST', body: JSON.stringify(data) });
  },

  async getAdminTimetables(classId) {
    return this.request(`/api/admin/timetables${classId ? '?class_id=' + classId : ''}`);
  },

  async createTimetable(data) {
    return this.request('/api/admin/timetables', { method: 'POST', body: JSON.stringify(data) });
  },

  async getAdminSettings() {
    return this.request('/api/admin/settings');
  },

  async updateAdminSettings(settings) {
    return this.request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async getAdminAttendanceRecords(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/admin/attendance-records${query ? '?' + query : ''}`);
  },

  async getAdminCorrectionRequests(status) {
    return this.request(`/api/admin/correction-requests${status ? '?status=' + status : ''}`);
  },

  async reviewCorrectionRequest(requestId, action, remarks) {
    return this.request(`/api/admin/correction-requests/${requestId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, remarks })
    });
  },

  async getAuditLogs(action) {
    return this.request(`/api/admin/audit-logs${action ? '?action=' + action : ''}`);
  },

  getExportReportUrl(format = 'csv', filters = {}) {
    const token = this.getToken();
    const query = new URLSearchParams({ format, ...filters }).toString();
    return `/api/admin/reports/export?${query}`;
  }
};

window.API = API;
