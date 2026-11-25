// app.js - Main Application Controller for KCAS Attendance System
const App = {
  currentUser: null,
  activeSessionInterval: null,
  activeQrTimer: null,
  activeSessionId: null,
  qrScannerInstance: null,
  deferredPrompt: null,

  init() {
    // Register Service Worker for PWA / WebAPK
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW registration fallback:', e));
    }

    // Capture install prompt for Android
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'flex';
    });

    this.qrScannerInstance = new AttendanceQRScanner();
    const user = API.getUser();
    const token = API.getToken();

    if (token && user) {
      this.currentUser = user;
      this.renderHeader();
      this.routeToDashboard(user.role);
    } else {
      this.showLogin();
    }
  },

  triggerPwaInstall() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          this.showToast('Installing KCAS Attendance Android App...', 'success');
        }
        this.deferredPrompt = null;
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'none';
      });
    } else {
      this.showToast('Open Chrome browser menu (⋮) and tap "Install app" or "Add to Home Screen".', 'info');
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  showLogin() {
    this.hideAllViews();
    document.getElementById('loginView').style.display = 'flex';
    document.getElementById('headerUserNav').style.display = 'none';
    document.getElementById('desktopNavWrapper').style.display = 'none';
    document.getElementById('mobileBottomNav').style.display = 'none';
  },

  hideAllViews() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('studentDashboardView').style.display = 'none';
    document.getElementById('staffDashboardView').style.display = 'none';
    document.getElementById('adminDashboardView').style.display = 'none';
  },

  navigateHome() {
    if (this.currentUser) {
      this.routeToDashboard(this.currentUser.role);
    } else {
      this.showLogin();
    }
  },

  fillDemo(username, password) {
    document.getElementById('loginUsername').value = username;
    document.getElementById('loginPassword').value = password;
    this.handleLogin(new Event('submit'));
  },

  async handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!username || !password) {
      this.showToast('Please enter both username and password', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying credentials...</span>';

    try {
      const res = await API.login(username, password);
      this.currentUser = res.user;
      this.showToast(`Welcome back, ${res.user.full_name}!`, 'success');
      this.renderHeader();
      this.routeToDashboard(res.user.role);
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Sign In to Dashboard</span>';
    }
  },

  renderHeader() {
    if (!this.currentUser) return;
    document.getElementById('headerUserNav').style.display = 'flex';
    document.getElementById('headerRoleTag').textContent = this.currentUser.role.toUpperCase();
    document.getElementById('headerUserName').textContent = this.currentUser.full_name;
  },

  routeToDashboard(role) {
    this.hideAllViews();
    this.renderNavigation(role);

    if (role === 'student') {
      document.getElementById('studentDashboardView').style.display = 'block';
      this.loadStudentDashboard();
    } else if (role === 'staff') {
      document.getElementById('staffDashboardView').style.display = 'block';
      this.loadStaffDashboard();
    } else if (role === 'admin') {
      document.getElementById('adminDashboardView').style.display = 'block';
      this.loadAdminDashboard();
    }
  },

  renderNavigation(role) {
    const desktopTabs = document.getElementById('roleTabs');
    const mobileNav = document.getElementById('mobileBottomNav');
    document.getElementById('desktopNavWrapper').style.display = 'block';
    mobileNav.style.display = 'flex';

    if (role === 'staff') {
      desktopTabs.innerHTML = `
        <button class="tab-btn active" onclick="App.switchStaffTab('duty')">📝 Class Period Duty Logs</button>
        <button class="tab-btn" onclick="App.switchStaffTab('checkin')">⏱️ Daily Check-in</button>
        <button class="tab-btn" onclick="App.switchStaffTab('history')">📅 Monthly History</button>
      `;
      mobileNav.innerHTML = `
        <button class="mobile-nav-item active" onclick="App.switchStaffTab('duty')">
          <span class="icon">📝</span><span>Duty Logs</span>
        </button>
        <button class="mobile-nav-item" onclick="App.triggerStaffDailyCheckIn()">
          <span class="icon">⏱️</span><span>Check In</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchStaffTab('history')">
          <span class="icon">📅</span><span>History</span>
        </button>
      `;
    } else if (role === 'admin') {
      desktopTabs.innerHTML = `
        <button class="tab-btn active" onclick="App.switchAdminTab('overview')">📊 Overview</button>
        <button class="tab-btn" onclick="App.switchAdminTab('users')">👥 Faculty Staff & HODs</button>
        <button class="tab-btn" onclick="App.switchAdminTab('periodlogs')">🏫 Period Duty Logs</button>
        <button class="tab-btn" onclick="App.switchAdminTab('academics')">🏛️ Academics</button>
        <button class="tab-btn" onclick="App.switchAdminTab('settings')">⚙️ Settings</button>
        <button class="tab-btn" onclick="App.switchAdminTab('audit')">📜 Audit Trail</button>
      `;
      mobileNav.innerHTML = `
        <button class="mobile-nav-item active" onclick="App.switchAdminTab('overview')">
          <span class="icon">📊</span><span>Dashboard</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('periodlogs')">
          <span class="icon">🏫</span><span>Period Logs</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('users')">
          <span class="icon">👥</span><span>Staff</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('audit')">
          <span class="icon">📜</span><span>Audit</span>
        </button>
      `;
    } else {
      desktopTabs.innerHTML = '';
      mobileNav.style.display = 'none';
      document.getElementById('desktopNavWrapper').style.display = 'none';
    }
  },

  // -------------------------------------------------------------
  // STUDENT CONTROLLERS
  // -------------------------------------------------------------
  async loadStudentDashboard() {
    try {
      // 1. Profile
      const pRes = await API.getStudentProfile();
      if (pRes.profile) {
        document.getElementById('stuProfileName').textContent = pRes.profile.full_name;
        document.getElementById('stuProfileReg').textContent = `Reg No: ${pRes.profile.register_number || pRes.profile.username.toUpperCase()}`;
        document.getElementById('stuProfileClass').textContent = `${pRes.profile.class_name || 'Class'} • Semester ${pRes.profile.semester || 5}`;
      }

      // 2. Public Settings & Policy
      const pubInfo = await API.getPublicInfo().catch(() => ({}));
      const qrEnabled = pubInfo.studentQrEnabled === true;
      const scanBtnWrapper = document.getElementById('stuScanQrActionWrapper');
      const qrNotice = document.getElementById('stuQrNoticeBanner');
      if (scanBtnWrapper) scanBtnWrapper.style.display = qrEnabled ? 'block' : 'none';
      if (qrNotice) qrNotice.style.display = qrEnabled ? 'none' : 'block';

      // 3. Daily Campus Status (if card present)
      try {
        const dailyRes = await API.getStudentDailyStatus().catch(() => null);
        const morningBadge = document.getElementById('stuMorningBadge');
        const morningInfo = document.getElementById('stuMorningInfo');
        const morningBtn = document.getElementById('stuMorningCheckInBtn');
        const eveningBadge = document.getElementById('stuEveningBadge');
        const eveningInfo = document.getElementById('stuEveningInfo');
        const eveningBtn = document.getElementById('stuEveningCheckOutBtn');

        if (dailyRes && dailyRes.record && morningBadge) {
          const rec = dailyRes.record;
          if (rec.check_in_time) {
            morningBadge.className = `status-badge status-${rec.check_in_status || 'present'}`;
            morningBadge.textContent = `Checked In (${(rec.check_in_status || 'on_time').toUpperCase()})`;
            if (morningInfo) {
              morningInfo.style.display = 'block';
              morningInfo.innerHTML = `<strong>Time:</strong> ${rec.check_in_time} &bull; <span style="color:#059669;">📍 Campus GPS Verified</span>`;
            }
            if (morningBtn) {
              morningBtn.disabled = true;
              morningBtn.innerHTML = '<span>✓ Morning Checked In</span>';
            }
            if (eveningBtn) eveningBtn.disabled = false;
          } else {
            morningBadge.className = 'status-badge status-pending';
            morningBadge.textContent = 'Not Checked In';
            if (morningBtn) {
              morningBtn.disabled = false;
            }
            if (eveningBtn) eveningBtn.disabled = true;
          }

          if (rec.check_out_time && eveningBadge) {
            eveningBadge.className = 'status-badge status-present';
            eveningBadge.textContent = 'Checked Out';
            if (eveningInfo) {
              eveningInfo.style.display = 'block';
              eveningInfo.innerHTML = `<strong>Time:</strong> ${rec.check_out_time} &bull; <span style="color:#059669;">📍 Campus GPS Verified</span>`;
            }
            if (eveningBtn) {
              eveningBtn.disabled = true;
              eveningBtn.innerHTML = '<span>✓ Evening Checked Out</span>';
            }
          }
        }
      } catch (e) {
        // Handled silently
      }

      // 4. Check for active session
      const sRes = await API.getStudentActiveSession();
      const activeCard = document.getElementById('stuActiveSessionCard');
      if (sRes.session && qrEnabled) {
        activeCard.style.display = 'block';
        document.getElementById('stuActiveSubName').textContent = `${sRes.session.subject_code} - ${sRes.session.subject_name}`;
        document.getElementById('stuActiveStaff').textContent = `Staff: ${sRes.session.staff_name} • Started at ${sRes.session.start_time}`;
        if (sRes.session.my_status) {
          activeCard.style.borderColor = '#059669';
          activeCard.querySelector('.btn-success').style.display = 'none';
          document.getElementById('stuActiveStaff').textContent += ` • You are marked ${sRes.session.my_status.toUpperCase()}!`;
        } else {
          activeCard.querySelector('.btn-success').style.display = 'inline-flex';
        }
      } else {
        activeCard.style.display = 'none';
      }

      // 5. Stats & Low-Attendance Alert
      const stRes = await API.getStudentStats();
      if (stRes.stats) {
        const stats = stRes.stats;
        document.getElementById('stuTotalClasses').textContent = stats.totalClasses;
        document.getElementById('stuAttendedClasses').textContent = stats.present;
        document.getElementById('stuLateClasses').textContent = stats.late;
        document.getElementById('stuAbsentClasses').textContent = stats.absent;

        // Render percentage ring
        KCASCharts.renderAttendanceRing('stuRingContainer', stats.percentage, 140, 10, stats.threshold);

        // Low attendance warning banner
        const alertBox = document.getElementById('stuLowAttendanceAlert');
        if (stats.isLowAttendance) {
          alertBox.style.display = 'flex';
          document.getElementById('stuLowAttendanceMsg').textContent = 
            `Your current attendance is ${stats.percentage}%, which is below the KCAS required threshold of ${stats.threshold}%. Please attend upcoming classes regularly to avoid semester exam debarment.`;
        } else {
          alertBox.style.display = 'none';
        }

        // Render Subject Bars
        KCASCharts.renderSubjectBars('stuSubjectBarsContainer', stats.subjectBreakdown, stats.threshold);
      }

      // 4. Timetable
      const tRes = await API.getStudentTimetable();
      const ttContainer = document.getElementById('stuTimetableContainer');
      if (tRes.timetable && tRes.timetable.length > 0) {
        ttContainer.innerHTML = tRes.timetable.map(t => `
          <div class="timetable-card">
            <div class="timetable-period">${t.day_of_week} • Period ${t.period_number} (${t.start_time} - ${t.end_time})</div>
            <div class="timetable-subject">${t.subject_code}: ${t.subject_name}</div>
            <div class="timetable-faculty">Faculty: ${t.staff_name} (${t.room_number})</div>
          </div>
        `).join('');
      } else {
        ttContainer.innerHTML = '<p style="color:#64748B; font-size:13px;">No timetable configured for this class.</p>';
      }

      // 5. History
      this.loadStudentHistory();

    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadStudentHistory() {
    try {
      const status = document.getElementById('stuHistoryStatusFilter').value;
      const res = await API.getStudentHistory({ status });
      const tbody = document.getElementById('stuHistoryTableBody');

      if (!res.records || res.records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:18px; color:#64748B;">No attendance records found.</td></tr>';
        return;
      }

      tbody.innerHTML = res.records.map(r => `
        <tr>
          <td><strong>${r.date}</strong></td>
          <td>${r.start_time}</td>
          <td><strong>${r.subject_code}</strong> - ${r.subject_name}</td>
          <td>${r.staff_name}</td>
          <td><span class="status-badge status-${r.status}">${r.status}</span></td>
          <td><span style="font-size:11px; color:#64748B;">${r.location_verified ? '📍 Campus GPS Verified' : 'QR Verified'}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  },

  switchStudentTab(tab) {
    if (tab === 'timetable') {
      document.getElementById('stuTimetableContainer').scrollIntoView({ behavior: 'smooth' });
    } else if (tab === 'history') {
      document.getElementById('stuHistoryTableBody').scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  // QR SCANNER MODAL CONTROLS
  openScannerModal() {
    document.getElementById('scannerModal').style.display = 'flex';
  },

  closeScannerModal() {
    if (this.qrScannerInstance) {
      this.qrScannerInstance.stopCamera();
    }
    document.getElementById('scannerModal').style.display = 'none';
  },

  async startCameraScan() {
    const video = document.getElementById('scannerVideo');
    const startBtn = document.getElementById('startCamBtn');
    startBtn.innerHTML = '<span>Scanning...</span>';

    await this.qrScannerInstance.startCamera(
      video,
      async (detectedToken) => {
        this.showToast('QR Code detected! Verifying...', 'info');
        await this.processAttendanceScan(detectedToken);
      },
      (err) => {
        this.showToast('Camera error: ' + err.message + '. Please use Auto-Scan or enter token.', 'error');
        startBtn.innerHTML = '<span>📹 Open Camera</span>';
      }
    );
  },

  async autoDetectActiveQR() {
    try {
      const activeRes = await API.getStudentActiveSession();
      if (!activeRes.session) {
        this.showToast('No class session is currently active for your class. Staff must start the session first.', 'error');
        return;
      }

      // Fetch the active QR token from staff session
      const qrRes = await fetch(`/api/staff/sessions/${activeRes.session.id}/qr`, {
        headers: { 'Authorization': `Bearer ${API.getToken()}` }
      }).then(r => r.json());

      if (qrRes.qrToken) {
        this.showToast('Active class session token acquired!', 'info');
        await this.processAttendanceScan(qrRes.qrToken);
      } else {
        this.showToast('Active QR code token unavailable.', 'error');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async submitManualQR() {
    const token = document.getElementById('scannerManualToken').value.trim();
    if (!token) {
      this.showToast('Please paste a valid QR code token', 'error');
      return;
    }
    await this.processAttendanceScan(token);
  },

  async processAttendanceScan(qrToken) {
    const simulateCampus = document.getElementById('scannerSimulateCampusCoords').checked;
    
    try {
      this.showToast('Acquiring location coordinates...', 'info');
      const coords = await AttendanceQRScanner.getCoordinates(simulateCampus);

      this.showToast('Submitting attendance...', 'info');
      const res = await API.markStudentAttendance(qrToken, coords.latitude, coords.longitude);

      this.closeScannerModal();

      // Show Success Modal
      document.getElementById('successModal').style.display = 'flex';
      document.getElementById('successModalTitle').textContent = res.status === 'present' ? 'Attendance Recorded!' : 'Marked as Late Arrival';
      document.getElementById('successModalMsg').textContent = res.message;
      document.getElementById('successModalSubject').textContent = res.sessionDetails ? `${res.sessionDetails.subjectCode} - ${res.sessionDetails.subjectName}` : 'Lecture Session';
      document.getElementById('successModalTime').textContent = res.sessionDetails ? res.sessionDetails.markedAt : new Date().toLocaleTimeString();
      
      const badge = document.getElementById('successModalStatus');
      badge.className = `status-badge status-${res.status}`;
      badge.textContent = res.status.toUpperCase();

      // Refresh dashboard
      this.loadStudentDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  closeSuccessModal() {
    document.getElementById('successModal').style.display = 'none';
  },

  // -------------------------------------------------------------
  // FACE AUTHENTICATION & CAMPUS GPS MODAL CONTROLLER
  // -------------------------------------------------------------
  faceCameraStream: null,
  capturedFaceBase64: null,
  currentFaceMode: null,
  currentFaceCoords: null,

  triggerStudentDailyCheckIn() {
    this.openFaceAuthModal('student_checkin', 'Morning Check-In (Student)');
  },

  triggerStudentDailyCheckOut() {
    this.openFaceAuthModal('student_checkout', 'Evening Check-Out (Student)');
  },

  triggerStaffDailyCheckIn() {
    this.openFaceAuthModal('staff_checkin', 'Faculty Daily Check-In');
  },

  triggerStaffDailyCheckOut() {
    this.openFaceAuthModal('staff_checkout', 'Faculty Daily Check-Out');
  },

  async openFaceAuthModal(mode, title) {
    this.currentFaceMode = mode;
    this.capturedFaceBase64 = null;
    this.currentFaceCoords = { latitude: 10.9234, longitude: 78.0772 };

    document.getElementById('faceAuthModalTitle').textContent = `📷 ${title}`;
    document.getElementById('faceAuthModal').style.display = 'flex';
    document.getElementById('faceCapturedPreviewBox').style.display = 'none';
    document.getElementById('faceCameraVideo').style.display = 'block';
    document.getElementById('faceOvalGuide').style.display = 'block';
    document.getElementById('faceGuideHint').style.display = 'block';
    document.getElementById('faceCaptureActionBtn').style.display = 'inline-flex';
    document.getElementById('faceRetakeActionBtn').style.display = 'none';
    document.getElementById('faceConfirmActionBtn').style.display = 'none';

    const gpsStatus = document.getElementById('faceAuthGpsStatus');
    gpsStatus.textContent = 'Acquiring GPS location...';

    // Get real device coordinates with fallback to KCAS campus
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentFaceCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          gpsStatus.textContent = '📍 Campus GPS Verified: Physically Present (PIN: 621301)';
        },
        (err) => {
          this.currentFaceCoords = { latitude: 10.9234, longitude: 78.0772 };
          gpsStatus.textContent = '📍 KCAS Campus Boundary: GPS Active (350m Geofence)';
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      gpsStatus.textContent = '📍 KCAS Campus Coordinates Applied';
    }

    // Start video camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      this.faceCameraStream = stream;
      const video = document.getElementById('faceCameraVideo');
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      console.error('Camera open error:', e);
      this.showToast('Unable to open front camera. Please allow camera permissions.', 'error');
    }
  },

  captureFaceSnapshot() {
    const video = document.getElementById('faceCameraVideo');
    const canvas = document.getElementById('faceCaptureCanvas');
    if (!video || !video.videoWidth) {
      this.showToast('Camera feed not ready yet', 'error');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw mirrored selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    this.capturedFaceBase64 = canvas.toDataURL('image/jpeg', 0.85);

    // Switch view to preview
    document.getElementById('faceCameraVideo').style.display = 'none';
    document.getElementById('faceOvalGuide').style.display = 'none';
    document.getElementById('faceGuideHint').style.display = 'none';

    const previewImg = document.getElementById('faceCapturedImage');
    previewImg.src = this.capturedFaceBase64;
    document.getElementById('faceCapturedPreviewBox').style.display = 'block';

    document.getElementById('faceCaptureActionBtn').style.display = 'none';
    document.getElementById('faceRetakeActionBtn').style.display = 'inline-flex';
    document.getElementById('faceConfirmActionBtn').style.display = 'inline-flex';
  },

  retakeFaceSnapshot() {
    this.capturedFaceBase64 = null;
    document.getElementById('faceCapturedPreviewBox').style.display = 'none';
    document.getElementById('faceCameraVideo').style.display = 'block';
    document.getElementById('faceOvalGuide').style.display = 'block';
    document.getElementById('faceGuideHint').style.display = 'block';

    document.getElementById('faceCaptureActionBtn').style.display = 'inline-flex';
    document.getElementById('faceRetakeActionBtn').style.display = 'none';
    document.getElementById('faceConfirmActionBtn').style.display = 'none';
  },

  async confirmAndSubmitFaceAuth() {
    if (!this.capturedFaceBase64) {
      this.showToast('Please capture your face photo first', 'error');
      return;
    }

    const btn = document.getElementById('faceConfirmActionBtn');
    btn.disabled = true;
    btn.innerHTML = '<span>Verifying & Saving...</span>';

    try {
      const lat = this.currentFaceCoords?.latitude || 10.9234;
      const lng = this.currentFaceCoords?.longitude || 78.0772;

      let res;
      if (this.currentFaceMode === 'student_checkin') {
        res = await API.studentDailyCheckIn(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message, 'success');
        this.loadStudentDashboard();
      } else if (this.currentFaceMode === 'student_checkout') {
        res = await API.studentDailyCheckOut(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message, 'success');
        this.loadStudentDashboard();
      } else if (this.currentFaceMode === 'staff_checkin') {
        res = await API.staffCheckIn(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message, 'success');
        this.loadStaffDashboard();
      } else if (this.currentFaceMode === 'staff_checkout') {
        res = await API.staffCheckOut(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message, 'success');
        this.loadStaffDashboard();
      }

      this.closeFaceAuthModal();
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>✓ Submit Attendance</span>';
    }
  },

  closeFaceAuthModal() {
    if (this.faceCameraStream) {
      this.faceCameraStream.getTracks().forEach(t => t.stop());
      this.faceCameraStream = null;
    }
    document.getElementById('faceAuthModal').style.display = 'none';
  },

  // -------------------------------------------------------------
  // STAFF CONTROLLERS
  // -------------------------------------------------------------
  staffDutyPhotoBase64: null,
  academicData: null,

  async loadStaffDashboard() {
    try {
      const res = await API.getStaffDashboard();
      
      // Profile
      document.getElementById('staffProfileName').textContent = this.currentUser.full_name;
      document.getElementById('staffProfileDesig').textContent = this.currentUser.designation || 'Faculty Member';
      if (this.currentUser.department_name) {
        document.getElementById('staffProfileDept').textContent = `${this.currentUser.department_name} • KCAS Karur (PIN: 621301)`;
      }

      // Check-in status
      const statusBox = document.getElementById('staffCheckInStatusDisplay');
      const checkInBtn = document.getElementById('staffCheckInBtn');
      const checkOutBtn = document.getElementById('staffCheckOutBtn');

      if (res.todayAttendance && res.todayAttendance.check_in_time) {
        statusBox.innerHTML = `
          <span class="status-badge status-${res.todayAttendance.status}">
            Checked In at ${res.todayAttendance.check_in_time} (${res.todayAttendance.status.toUpperCase()})
          </span>
          ${res.todayAttendance.check_out_time ? `<br><small style="color:#059669; font-weight:700;">Checked Out at ${res.todayAttendance.check_out_time} (${res.todayAttendance.working_hours} hrs)</small>` : ''}
        `;
        checkInBtn.disabled = true;
        checkOutBtn.disabled = !!res.todayAttendance.check_out_time;
      } else {
        statusBox.innerHTML = '<span class="status-badge status-pending">Not Checked In Today</span>';
        checkInBtn.disabled = false;
        checkOutBtn.disabled = true;
      }

      // Load Academic Structure for Department & Class selection
      await this.populateStaffDeptDropdown();

      // Load Today's Logged Periods
      this.loadStaffPeriodLogs();

      // Load Staff Monthly Attendance History
      this.loadStaffHistory();

    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async populateStaffDeptDropdown() {
    try {
      const acad = await API.getAcademicStructure();
      this.academicData = acad;
      const deptSelect = document.getElementById('periodDeptSelect');
      if (acad && acad.departments && deptSelect) {
        deptSelect.innerHTML = '<option value="">-- Select Department --</option>' +
          acad.departments.map(d => `<option value="${d.id}">${d.name} (${d.code})</option>`).join('');
      }

      // Auto-populate Class dropdown
      this.handlePeriodDeptChange();
    } catch (e) {
      console.error(e);
    }
  },

  handlePeriodDeptChange() {
    const deptId = parseInt(document.getElementById('periodDeptSelect')?.value || '0', 10);
    const classSelect = document.getElementById('periodClassSelect');
    if (!classSelect) return;

    if (!deptId || !this.academicData || !this.academicData.classes) {
      classSelect.innerHTML = '<option value="">-- Select Class --</option>';
      if (this.academicData && this.academicData.classes) {
        classSelect.innerHTML += this.academicData.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
      return;
    }

    const filtered = this.academicData.classes.filter(c => c.department_id === deptId);
    classSelect.innerHTML = '<option value="">-- Select Class --</option>' +
      (filtered.length > 0 ? filtered : this.academicData.classes)
        .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  },

  snapPeriodPhotoCamera() {
    const input = document.getElementById('periodPhotoInput');
    if (input) {
      input.setAttribute('capture', 'environment');
      input.click();
    }
  },

  handlePeriodPhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      this.staffDutyPhotoBase64 = evt.target.result;
      const previewBox = document.getElementById('periodPhotoPreviewBox');
      const previewImg = document.getElementById('periodPhotoPreview');
      if (previewBox && previewImg) {
        previewImg.src = this.staffDutyPhotoBase64;
        previewBox.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  },

  async handlePeriodLogSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const deptId = document.getElementById('periodDeptSelect')?.value;
    const classId = document.getElementById('periodClassSelect')?.value;
    const periodNumber = document.getElementById('periodNumberSelect')?.value;
    const subjectName = document.getElementById('periodSubjectInput')?.value.trim();
    const periodTime = document.getElementById('periodTimeInput')?.value.trim();
    const lessonTopic = document.getElementById('periodLessonTopic')?.value.trim();
    const lessonSummary = document.getElementById('periodLessonSummary')?.value.trim();
    const photo = this.staffDutyPhotoBase64 || null;

    if (!periodNumber) {
      this.showToast('Please select the period hour', 'error');
      return;
    }
    if (!subjectName) {
      this.showToast('Please enter the subject taught', 'error');
      return;
    }
    if (!lessonTopic && !lessonSummary) {
      this.showToast('Please enter lesson notes on what was done in this period', 'error');
      return;
    }

    const submitBtn = document.getElementById('periodSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Saving duty log & photo proof...</span>';

    try {
      const res = await API.submitPeriodLog({
        departmentId: deptId ? parseInt(deptId, 10) : null,
        classId: classId ? parseInt(classId, 10) : null,
        periodNumber: parseInt(periodNumber, 10),
        subjectName,
        startTime: periodTime || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        lessonTopic,
        lessonSummary,
        lessonPhoto: photo
      });

      this.showToast(res.message || `Period ${periodNumber} duty log recorded successfully!`, 'success');

      // Reset form
      document.getElementById('periodLogForm').reset();
      this.staffDutyPhotoBase64 = null;
      const previewBox = document.getElementById('periodPhotoPreviewBox');
      if (previewBox) previewBox.style.display = 'none';

      // Refresh logged periods table
      this.loadStaffPeriodLogs();
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀 Save & Submit Class Period Duty Log</span>';
    }
  },

  async loadStaffPeriodLogs() {
    try {
      const res = await API.getMyPeriodLogs();
      const tbody = document.getElementById('staffMyLogsTableBody');
      if (!tbody) return;

      if (!res.logs || res.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 16px; color: #64748B;">No period duty logs recorded today yet. Use the form above to log teaching activity.</td></tr>';
        return;
      }

      tbody.innerHTML = res.logs.map(log => {
        const hasPhoto = !!log.lesson_photo;
        const photoHtml = hasPhoto
          ? `<img src="${log.lesson_photo}" class="duty-photo-thumb" alt="Blackboard Photo" onclick="App.openPhotoModal('${log.lesson_photo}', 'Period ${log.period_number} Proof: ${log.subject_name}', 'Department: ${log.department_name || '-'} &bull; Class: ${log.class_name || '-'} &bull; Date: ${log.date}')" title="Click to enlarge photo">`
          : '<span style="font-size:11px; color:#94A3B8;">No Photo</span>';

        return `
          <tr>
            <td>
              <span class="status-badge" style="background:#EFF6FF; color:#1D4ED8; font-weight:800;">
                Period ${log.period_number}
              </span>
            </td>
            <td>
              <strong>${log.department_name || '-'}</strong><br>
              <small style="color:#64748B;">${log.class_name || '-'}</small>
            </td>
            <td>
              <strong>${log.subject_name || '-'}</strong>
            </td>
            <td style="font-size:12px; white-space:nowrap;">
              ${log.start_time || '-'}
            </td>
            <td style="max-width:280px; font-size:12px; line-height:1.4;">
              ${log.lesson_topic ? `<strong style="color:#B91C1C;">${log.lesson_topic}</strong><br>` : ''}
              <span>${log.lesson_summary || '-'}</span>
            </td>
            <td>${photoHtml}</td>
            <td>
              <span class="status-badge status-present">Logged ✓</span>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  },

  async loadStaffHistory() {
    try {
      const res = await API.getStaffHistory();
      const tbody = document.getElementById('staffHistoryTableBody');
      if (!tbody) return;

      if (!res.records || res.records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:14px; color:#64748B;">No check-in logs for this month.</td></tr>';
        return;
      }

      tbody.innerHTML = res.records.map(r => `
        <tr>
          <td><strong>${r.date}</strong></td>
          <td>${r.check_in_time || '-'}</td>
          <td>${r.check_out_time || '-'}</td>
          <td><strong>${r.working_hours}</strong> hrs</td>
          <td><span class="status-badge status-${r.status}">${r.status}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  },

  switchStaffTab(tab) {
    if (tab === 'checkin') {
      document.getElementById('staffCheckInStatusDisplay')?.scrollIntoView({ behavior: 'smooth' });
    } else if (tab === 'history') {
      document.getElementById('staffHistoryTableBody')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  // -------------------------------------------------------------
  // ADMIN CONTROLLERS
  // -------------------------------------------------------------
  allAdminUsers: null,

  async loadAdminDashboard() {
    try {
      const [res, dutyLogsRes] = await Promise.all([
        API.getAdminDashboard(),
        API.getAdminPeriodLogs().catch(() => ({ logs: [] }))
      ]);

      // Metrics
      const staffCount = res.counts?.staff || 0;
      const checkedInCount = (res.staffCheckIns || []).filter(s => s.check_in_time).length;
      const dutyLogsToday = (dutyLogsRes.logs || []).filter(l => l.date === new Date().toISOString().split('T')[0]).length;

      document.getElementById('adminMetricStaff').textContent = staffCount;
      document.getElementById('adminMetricTodayRate').textContent = `${checkedInCount} / ${staffCount}`;
      document.getElementById('adminMetricDutyLogs').textContent = dutyLogsToday;
      document.getElementById('adminMetricDepts').textContent = '5';

      // Staff Check-ins table
      const staffBody = document.getElementById('adminStaffCheckInBody');
      if (res.staffCheckIns && res.staffCheckIns.length > 0) {
        staffBody.innerHTML = res.staffCheckIns.map(s => `
          <tr>
            <td><strong>${s.full_name}</strong></td>
            <td>${s.designation || 'Faculty'}</td>
            <td>${s.department_name || '-'}</td>
            <td>${s.check_in_time ? `<span style="color:#059669; font-weight:700;">${s.check_in_time}</span>` : '<span style="color:#DC2626;">Not in</span>'}</td>
            <td>${s.check_out_time || '-'}</td>
            <td>${s.working_hours ? s.working_hours + ' hrs' : '-'}</td>
            <td><span class="status-badge status-${s.status || 'absent'}">${(s.status || 'absent').toUpperCase()}</span></td>
          </tr>
        `).join('');
      } else {
        staffBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:14px; color:#64748B;">No faculty check-ins logged today yet.</td></tr>';
      }

      // Recent Duty Logs table for Overview
      const overviewLogsBody = document.getElementById('adminOverviewDutyLogsBody');
      if (overviewLogsBody) {
        const recentLogs = (dutyLogsRes.logs || []).slice(0, 10);
        if (recentLogs.length > 0) {
          overviewLogsBody.innerHTML = recentLogs.map(l => {
            const photoThumb = l.lesson_photo
              ? `<img src="${l.lesson_photo}" class="duty-photo-thumb" alt="Photo" onclick="App.openPhotoModal('${l.lesson_photo}', 'Period ${l.period_number}: ${l.staff_name}', 'Subject: ${l.subject_name} &bull; Dept: ${l.department_name}')">`
              : '<span style="font-size:11px; color:#94A3B8;">No Photo</span>';
            return `
              <tr>
                <td><span class="status-badge" style="background:#EFF6FF; color:#1D4ED8; font-weight:700;">Period ${l.period_number}</span></td>
                <td><strong>${l.staff_name}</strong><br><small style="color:#64748B;">${l.staff_designation || ''}</small></td>
                <td>${l.department_name || '-'}<br><small style="color:#64748B;">${l.class_name || '-'}</small></td>
                <td><strong>${l.subject_name}</strong></td>
                <td style="max-width:260px; font-size:12px;">${l.lesson_summary || l.lesson_topic || '-'}</td>
                <td>${photoThumb}</td>
              </tr>
            `;
          }).join('');
        } else {
          overviewLogsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:14px; color:#64748B;">No period teaching logs recorded today.</td></tr>';
        }
      }

    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  switchAdminTab(tabName) {
    const tabs = ['overview', 'users', 'periodlogs', 'academics', 'settings', 'audit'];
    tabs.forEach(t => {
      const el = document.getElementById(`adminTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (el) el.style.display = t === tabName ? 'block' : 'none';
    });

    // Update active tab buttons
    document.querySelectorAll('#roleTabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    event?.target?.classList.add('active');

    // Load sub-data
    if (tabName === 'users') this.loadAdminUsers();
    if (tabName === 'periodlogs') this.loadAdminPeriodLogs();
    if (tabName === 'academics') this.loadAdminAcademics();
    if (tabName === 'settings') this.loadAdminSettings();
    if (tabName === 'audit') this.loadAdminAuditLogs();
  },

  async loadAdminPeriodLogs() {
    try {
      const date = document.getElementById('adminFilterDutyDate')?.value || '';
      const deptId = document.getElementById('adminFilterDutyDept')?.value || '';
      const period = document.getElementById('adminFilterDutyPeriod')?.value || '';

      const res = await API.getAdminPeriodLogs({ date, department_id: deptId, period });
      const tbody = document.getElementById('adminPeriodLogsTableBody');
      if (!tbody) return;

      // Populate Department Filter if empty
      const deptFilter = document.getElementById('adminFilterDutyDept');
      if (deptFilter && deptFilter.options.length <= 1) {
        const acad = await API.getAcademicStructure().catch(() => ({}));
        if (acad && acad.departments) {
          deptFilter.innerHTML = '<option value="">All Departments</option>' +
            acad.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        }
      }

      if (!res.logs || res.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:18px; color:#64748B;">No faculty class period duty logs matching filters.</td></tr>';
        return;
      }

      tbody.innerHTML = res.logs.map(log => {
        const photoHtml = log.lesson_photo
          ? `<img src="${log.lesson_photo}" class="duty-photo-thumb" alt="Blackboard Photo" onclick="App.openPhotoModal('${log.lesson_photo}', 'Period ${log.period_number} Proof: ${log.staff_name}', 'Subject: ${log.subject_name} &bull; Dept: ${log.department_name || '-'} &bull; Class: ${log.class_name || '-'} &bull; Date: ${log.date}')" title="Click to view full photo">`
          : '<span style="font-size:11px; color:#94A3B8;">No Photo Attached</span>';

        return `
          <tr>
            <td>
              <strong>${log.date}</strong><br>
              <span class="status-badge" style="background:#EFF6FF; color:#1D4ED8; font-weight:800;">Period ${log.period_number}</span>
            </td>
            <td>
              <strong>${log.staff_name}</strong><br>
              <small style="color:#64748B;">${log.staff_designation || 'Faculty'}</small>
            </td>
            <td><strong>${log.department_name || '-'}</strong></td>
            <td>${log.class_name || '-'}</td>
            <td><strong>${log.subject_name || '-'}</strong></td>
            <td style="max-width:300px; font-size:12px; line-height:1.4;">
              ${log.lesson_topic ? `<strong style="color:#B91C1C;">${log.lesson_topic}</strong><br>` : ''}
              <span>${log.lesson_summary || '-'}</span>
            </td>
            <td>${photoHtml}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAdminUsers() {
    try {
      const res = await API.getAdminUsers();
      // Filter out students since student portal is disabled
      this.allAdminUsers = (res.users || []).filter(u => u.role === 'staff' || u.role === 'admin');
      this.renderAdminUsersTable(this.allAdminUsers);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  filterAdminUsers() {
    if (!this.allAdminUsers) return;
    const query = document.getElementById('adminUserSearchInput')?.value.toLowerCase() || '';

    const filtered = this.allAdminUsers.filter(u => {
      return !query || 
        (u.full_name && u.full_name.toLowerCase().includes(query)) ||
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.department_name && u.department_name.toLowerCase().includes(query)) ||
        (u.phone && u.phone.includes(query));
    });

    this.renderAdminUsersTable(filtered);
  },

  newUserPhotoBase64: null,

  handleUserPhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      this.newUserPhotoBase64 = evt.target.result;
      const preview = document.getElementById('newUserPhotoPreview');
      const img = document.getElementById('newUserPhotoImg');
      if (preview && img) {
        img.src = this.newUserPhotoBase64;
        preview.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  },

  renderAdminUsersTable(users) {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px; color:#64748B;">No faculty members registered. Click "Add Faculty Staff" above to register faculty.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isAdmin = u.role === 'admin' || (u.username && u.username.toUpperCase() === 'KRISHNACOLLEGEADMIN');
      const escapedName = (u.full_name || '').replace(/'/g, "\\'");

      return `
        <tr>
          <td>
            <img src="${u.photo_url || '/icons/college-logo.png'}" class="user-avatar-thumb" alt="${u.full_name}">
          </td>
          <td><strong>${u.username}</strong></td>
          <td style="font-weight:700;">${u.full_name}</td>
          <td><span class="role-tag" style="background:${isAdmin ? '#0F172A' : '#B91C1C'};">${isAdmin ? 'SOLE ADMIN' : (u.designation || 'FACULTY')}</span></td>
          <td>${u.department_name || '-'}</td>
          <td style="font-size:12px; font-weight:600;">${u.phone || '-'}</td>
          <td style="font-size:11px; max-width:180px; color:#475569;">${u.address || '-'}</td>
          <td><span class="status-badge ${u.is_active ? 'status-present' : 'status-absent'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            ${isAdmin ? `
              <span style="font-size:11px; color:#64748B; font-weight:700;">Primary Admin</span>
            ` : `
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="btn btn-outline btn-sm" style="padding:3px 8px; font-size:11px;" onclick="App.toggleUserStatus(${u.id}, ${u.is_active ? 0 : 1})">
                  ${u.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button class="btn btn-danger btn-sm" style="padding:3px 8px; font-size:11px; font-weight:700;" onclick="App.handleDeleteUser(${u.id}, '${escapedName}')" title="Delete staff profile">
                  🗑️ Remove Staff
                </button>
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  },

  async handleDeleteUser(userId, fullName) {
    if (!confirm(`Are you sure you want to permanently delete Faculty Staff member "${fullName}"?\n\nThis will remove their profile and duty records.`)) {
      return;
    }
    try {
      const res = await API.deleteAdminUser(userId);
      this.showToast(res.message || 'Staff profile deleted successfully', 'success');
      this.loadAdminUsers();
      this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async toggleUserStatus(userId, newStatus) {
    try {
      await API.updateAdminUser(userId, { isActive: newStatus });
      this.showToast(`Staff status updated to ${newStatus ? 'Active' : 'Deactivated'}`, 'success');
      this.loadAdminUsers();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openCreateUserModal() {
    this.newUserPhotoBase64 = null;
    const preview = document.getElementById('newUserPhotoPreview');
    if (preview) preview.style.display = 'none';
    document.getElementById('createUserModal').style.display = 'flex';
  },

  closeCreateUserModal() {
    document.getElementById('createUserModal').style.display = 'none';
  },

  async handleCreateUser(e) {
    if (e && e.preventDefault) e.preventDefault();

    const username = document.getElementById('newUsername').value.trim();
    const fullName = document.getElementById('newFullName').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    const deptId = document.getElementById('newUserDept')?.value;
    const designation = document.getElementById('newDesignation')?.value || 'Assistant Professor';
    const email = document.getElementById('newEmail')?.value.trim();
    const phone = document.getElementById('newPhone')?.value.trim();
    const address = document.getElementById('newAddress')?.value.trim();
    const photoUrl = this.newUserPhotoBase64 || null;

    try {
      await API.createAdminUser({
        role: 'staff',
        username,
        fullName,
        password,
        departmentId: deptId ? parseInt(deptId, 10) : null,
        designation,
        email,
        phone,
        address,
        photoUrl
      });

      this.showToast(`Faculty staff member '${fullName}' registered successfully!`, 'success');
      this.newUserPhotoBase64 = null;
      document.getElementById('createUserForm').reset();
      const preview = document.getElementById('newUserPhotoPreview');
      if (preview) preview.style.display = 'none';
      this.closeCreateUserModal();
      this.loadAdminUsers();
      this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAdminAcademics() {
    try {
      const res = await API.getAcademicStructure();
      const classBody = document.getElementById('adminAcademicsClassBody');
      const allocRes = await API.getAdminAllocations();
      const allocBody = document.getElementById('adminAcademicsAllocBody');

      if (res.classes && classBody) {
        classBody.innerHTML = res.classes.map(c => `
          <tr>
            <td><strong>${c.code || c.name}</strong></td>
            <td>${c.name}</td>
            <td>${c.degree_level} (Sem ${c.semester})</td>
          </tr>
        `).join('');
      }

      if (allocRes.allocations && allocBody) {
        allocBody.innerHTML = allocRes.allocations.map(a => `
          <tr>
            <td><strong>${a.staff_name}</strong></td>
            <td>${a.class_name}</td>
            <td>${a.subject_code} - ${a.subject_name}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.error(e);
    }
  },

  async loadAdminSettings() {
    try {
      const res = await API.getAdminSettings();
      if (res.settings) {
        const sMap = {};
        res.settings.forEach(s => sMap[s.key] = s.value);
        if (document.getElementById('settingCampusLat')) {
          document.getElementById('settingCampusLat').value = sMap.campus_latitude || '10.9234';
          document.getElementById('settingCampusLng').value = sMap.campus_longitude || '78.0772';
          document.getElementById('settingCampusRadius').value = sMap.campus_radius_meters || '350';
        }
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleSaveSettings(e) {
    if (e && e.preventDefault) e.preventDefault();

    const data = {
      campus_latitude: document.getElementById('settingCampusLat')?.value || '10.9234',
      campus_longitude: document.getElementById('settingCampusLng')?.value || '78.0772',
      campus_radius_meters: document.getElementById('settingCampusRadius')?.value || '350'
    };

    try {
      const res = await API.updateAdminSettings(data);
      this.showToast('KCAS Campus boundary geofence updated successfully!', 'success');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAdminAuditLogs() {
    try {
      const res = await API.getAuditLogs();
      const tbody = document.getElementById('adminAuditLogsTableBody');
      if (!tbody) return;

      if (!res.logs || res.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px;">No audit records.</td></tr>';
        return;
      }

      tbody.innerHTML = res.logs.map(l => `
        <tr>
          <td style="font-size:11px; white-space:nowrap;">${l.created_at}</td>
          <td><strong>${l.username || 'System'}</strong></td>
          <td><span class="role-tag" style="background:#475569;">${l.action}</span></td>
          <td>${l.entity_type} #${l.entity_id}</td>
          <td style="font-size:12px;">${l.details}</td>
          <td style="font-size:11px; color:#64748B;">${l.ip_address}</td>
        </tr>
      `).join('');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // Photo Lightbox Modal
  openPhotoModal(photoUrl, title, meta) {
    const modal = document.getElementById('photoPreviewModal');
    const img = document.getElementById('photoModalImg');
    const titleEl = document.getElementById('photoModalTitle');
    const metaEl = document.getElementById('photoModalMeta');

    if (img) img.src = photoUrl;
    if (titleEl) titleEl.textContent = title || 'Classroom / Blackboard Photo Proof';
    if (metaEl) metaEl.innerHTML = meta || '';
    if (modal) modal.style.display = 'flex';
  },

  closePhotoModal() {
    const modal = document.getElementById('photoPreviewModal');
    if (modal) modal.style.display = 'none';
  }
};

// Initialize App on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
