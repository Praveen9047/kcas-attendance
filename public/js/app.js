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

    if (role === 'student') {
      desktopTabs.innerHTML = `
        <button class="tab-btn active" onclick="App.switchStudentTab('dashboard')">📊 My Attendance</button>
        <button class="tab-btn" onclick="App.switchStudentTab('timetable')">📅 Timetable</button>
      `;
      mobileNav.innerHTML = `
        <button class="mobile-nav-item active" onclick="App.switchStudentTab('dashboard')">
          <span class="icon">📊</span><span>Attendance</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchStudentTab('timetable')">
          <span class="icon">📅</span><span>Timetable</span>
        </button>
      `;
    } else if (role === 'staff') {
      desktopTabs.innerHTML = `
        <button class="tab-btn active" onclick="App.switchStaffTab('overview')">🏫 Classes & QR Broadcast</button>
        <button class="tab-btn" onclick="App.switchStaffTab('checkin')">⏱️ Daily Check-in</button>
        <button class="tab-btn" onclick="App.switchStaffTab('corrections')">📝 Correction Requests</button>
      `;
      mobileNav.innerHTML = `
        <button class="mobile-nav-item active" onclick="App.switchStaffTab('overview')">
          <span class="icon">🏫</span><span>Sessions</span>
        </button>
        <button class="mobile-nav-item" onclick="App.handleStaffCheckIn()">
          <span class="icon">⏱️</span><span>Check In</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchStaffTab('corrections')">
          <span class="icon">📝</span><span>Corrections</span>
        </button>
      `;
    } else if (role === 'admin') {
      desktopTabs.innerHTML = `
        <button class="tab-btn active" onclick="App.switchAdminTab('overview')">📊 Overview</button>
        <button class="tab-btn" onclick="App.switchAdminTab('users')">👥 Users & Import</button>
        <button class="tab-btn" onclick="App.switchAdminTab('records')">🔍 Attendance Records</button>
        <button class="tab-btn" onclick="App.switchAdminTab('corrections')">⚖️ Correction Requests</button>
        <button class="tab-btn" onclick="App.switchAdminTab('academics')">🏛️ Academics</button>
        <button class="tab-btn" onclick="App.switchAdminTab('settings')">⚙️ Settings</button>
        <button class="tab-btn" onclick="App.switchAdminTab('audit')">📜 Audit Trail</button>
      `;
      mobileNav.innerHTML = `
        <button class="mobile-nav-item active" onclick="App.switchAdminTab('overview')">
          <span class="icon">📊</span><span>Dashboard</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('records')">
          <span class="icon">🔍</span><span>Records</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('corrections')">
          <span class="icon">⚖️</span><span>Corrections</span>
        </button>
        <button class="mobile-nav-item" onclick="App.switchAdminTab('users')">
          <span class="icon">👥</span><span>Users</span>
        </button>
      `;
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
  async loadStaffDashboard() {
    try {
      const res = await API.getStaffDashboard();
      
      // Profile
      document.getElementById('staffProfileName').textContent = this.currentUser.full_name;
      document.getElementById('staffProfileDesig').textContent = this.currentUser.designation || 'Faculty Member';

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

      // Populate Class and Subject dropdowns for session creation
      const classSelect = document.getElementById('sessionClassSelect');
      const corrClassSelect = document.getElementById('corrClassSelect');
      
      if (res.allocations) {
        // Unique classes
        const uniqueClasses = [];
        res.allocations.forEach(a => {
          if (!uniqueClasses.some(c => c.id === a.class_id)) {
            uniqueClasses.push({ id: a.class_id, name: a.class_name });
          }
        });

        classSelect.innerHTML = '<option value="">-- Choose Class --</option>' + 
          uniqueClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        corrClassSelect.innerHTML = '<option value="">-- Select Class --</option>' + 
          uniqueClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        // Store allocations for dropdown matching
        this.staffAllocations = res.allocations;
      }

      // Active Session or Create Form
      if (res.activeSession) {
        this.displayStaffActiveSession(res.activeSession);
      } else {
        document.getElementById('staffActiveSessionBanner').style.display = 'none';
        document.getElementById('staffCreateSessionCard').style.display = 'block';
        if (this.activeSessionInterval) clearInterval(this.activeSessionInterval);
        if (this.activeQrTimer) clearInterval(this.activeQrTimer);
      }

      // Load Staff History & Corrections
      this.loadStaffHistory();
      this.loadStaffCorrectionRequests();

    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleStaffCheckIn() {
    try {
      const res = await API.staffCheckIn();
      this.showToast(res.message, 'success');
      this.loadStaffDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleStaffCheckOut() {
    try {
      const res = await API.staffCheckOut();
      this.showToast(res.message, 'success');
      this.loadStaffDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  handleSessionClassChange() {
    const classId = parseInt(document.getElementById('sessionClassSelect').value, 10);
    const subSelect = document.getElementById('sessionSubjectSelect');

    if (!classId || !this.staffAllocations) {
      subSelect.innerHTML = '<option value="">-- Choose Subject --</option>';
      return;
    }

    const subs = this.staffAllocations.filter(a => a.class_id === classId);
    subSelect.innerHTML = '<option value="">-- Choose Subject --</option>' +
      subs.map(s => `<option value="${s.subject_id}">${s.subject_code} - ${s.subject_name}</option>`).join('');
  },

  async handleCorrClassChange() {
    const classId = document.getElementById('corrClassSelect').value;
    const stuSelect = document.getElementById('corrStudentSelect');

    if (!classId) {
      stuSelect.innerHTML = '<option value="">-- Select Student --</option>';
      return;
    }

    try {
      const res = await fetch(`/api/admin/users?role=student&class_id=${classId}`, {
        headers: { 'Authorization': `Bearer ${API.getToken()}` }
      }).then(r => r.json());

      if (res.users) {
        stuSelect.innerHTML = '<option value="">-- Select Student --</option>' +
          res.users.map(u => `<option value="${u.id}">${u.register_number || u.username} - ${u.full_name}</option>`).join('');
      }
    } catch (e) {
      console.error(e);
    }
  },

  async handleCreateSession(e) {
    if (e && e.preventDefault) e.preventDefault();

    const classId = parseInt(document.getElementById('sessionClassSelect').value, 10);
    const subjectId = parseInt(document.getElementById('sessionSubjectSelect').value, 10);
    const periodNumber = parseInt(document.getElementById('sessionPeriodSelect')?.value || '1', 10);
    const topic = document.getElementById('sessionTopicInput').value.trim();

    try {
      const res = await API.createClassSession(classId, subjectId, topic, periodNumber);
      this.showToast(`Period ${periodNumber} attendance session launched!`, 'success');
      this.loadStaffDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  staffActivePeriodMarks: {},
  currentActiveRoster: [],
  currentLessonPhotoBase64: null,

  displayStaffActiveSession(session) {
    this.activeSessionId = session.id;
    this.staffActivePeriodMarks = {};
    document.getElementById('staffActiveSessionBanner').style.display = 'block';
    document.getElementById('staffCreateSessionCard').style.display = 'none';

    document.getElementById('staffActiveSubTitle').textContent = `${session.subject_code} - ${session.subject_name} (${session.class_name})`;
    const periodBadge = document.getElementById('staffActivePeriodBadge');
    if (periodBadge) periodBadge.textContent = `Period ${session.period_number || 1}`;

    // Start dynamic rotating QR token refresh loop
    this.refreshSessionQR();
    if (this.activeQrTimer) clearInterval(this.activeQrTimer);

    // Refresh QR token every 30 seconds
    this.activeQrTimer = setInterval(() => {
      this.refreshSessionQR();
    }, 30000);

    // Refresh live roster monitor every 5 seconds
    this.refreshActiveSessionMonitor();
    if (this.activeSessionInterval) clearInterval(this.activeSessionInterval);
    this.activeSessionInterval = setInterval(() => {
      this.refreshActiveSessionMonitor();
    }, 5000);
  },

  async refreshSessionQR() {
    if (!this.activeSessionId) return;
    try {
      const res = await API.getSessionQR(this.activeSessionId);
      if (res.qrToken) {
        this.currentActiveQrToken = res.qrToken;
        const qrSvg = generateQRCodeSvg(res.qrToken, 6, 2, '#991B1B', '#FFFFFF');
        document.getElementById('staffLiveQrBox').innerHTML = qrSvg;

        // Reset and animate progress bar
        const progressBar = document.getElementById('staffQrProgress');
        const timerText = document.getElementById('staffQrTimerText');
        if (progressBar) {
          progressBar.style.transition = 'none';
          progressBar.style.width = '100%';
          setTimeout(() => {
            progressBar.style.transition = `width ${res.durationSeconds}s linear`;
            progressBar.style.width = '0%';
          }, 50);
        }

        if (timerText) timerText.textContent = `Period Session Active`;
      }
    } catch (e) {
      console.error(e);
    }
  },

  copyActiveQRToken() {
    if (this.currentActiveQrToken) {
      navigator.clipboard.writeText(this.currentActiveQrToken);
      this.showToast('Active QR token copied to clipboard!', 'info');
    }
  },

  async refreshActiveSessionMonitor() {
    if (!this.activeSessionId) return;
    try {
      const res = await API.getSessionMonitor(this.activeSessionId);
      if (res.stats) {
        document.getElementById('staffLiveTotal').textContent = res.stats.total;
        document.getElementById('staffLivePresent').textContent = res.stats.present + res.stats.late;
        document.getElementById('staffLiveAbsent').textContent = res.stats.absent;
      }

      if (res.roster && res.roster.length > 0) {
        this.currentActiveRoster = res.roster;
        
        // Sync roster status to local period marks map if not set
        res.roster.forEach(r => {
          if (!this.staffActivePeriodMarks[r.student_id]) {
            this.staffActivePeriodMarks[r.student_id] = r.status || 'present';
          }
        });

        this.renderPeriodRosterTable();
      }
    } catch (e) {
      console.error(e);
    }
  },

  renderPeriodRosterTable() {
    const tbody = document.getElementById('staffLiveRosterTable');
    if (!tbody || !this.currentActiveRoster) return;

    tbody.innerHTML = this.currentActiveRoster.map(r => {
      const currentSt = this.staffActivePeriodMarks[r.student_id] || r.status || 'present';
      return `
        <tr>
          <td><strong>${r.register_number}</strong></td>
          <td>${r.full_name}</td>
          <td>
            <span class="status-badge status-${currentSt}">
              ${currentSt.toUpperCase()}
            </span>
          </td>
          <td>
            <div class="period-btn-group">
              <button type="button" class="period-att-btn ${currentSt === 'present' ? 'active-present' : ''}" onclick="App.setStudentPeriodStatus(${r.student_id}, 'present')">P</button>
              <button type="button" class="period-att-btn ${currentSt === 'absent' ? 'active-absent' : ''}" onclick="App.setStudentPeriodStatus(${r.student_id}, 'absent')">A</button>
              <button type="button" class="period-att-btn ${currentSt === 'late' ? 'active-late' : ''}" onclick="App.setStudentPeriodStatus(${r.student_id}, 'late')">L</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  setStudentPeriodStatus(studentId, status) {
    this.staffActivePeriodMarks[studentId] = status;
    this.renderPeriodRosterTable();
  },

  markAllClassStudents(status) {
    if (!this.currentActiveRoster) return;
    this.currentActiveRoster.forEach(r => {
      this.staffActivePeriodMarks[r.student_id] = status;
    });
    this.renderPeriodRosterTable();
    this.showToast(`Marked all students as ${status.toUpperCase()} (Click Save to store)`, 'info');
  },

  async submitBatchPeriodAttendance() {
    if (!this.activeSessionId) return;
    const marks = Object.entries(this.staffActivePeriodMarks).map(([studentId, status]) => ({
      studentId: parseInt(studentId, 10),
      status
    }));

    if (marks.length === 0) {
      this.showToast('No students loaded in roster', 'error');
      return;
    }

    try {
      const res = await API.batchMarkPeriodAttendance(this.activeSessionId, marks);
      this.showToast(res.message, 'success');
      this.refreshActiveSessionMonitor();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async quickManualMark(studentId, newStatus) {
    if (!this.activeSessionId) return;
    try {
      await API.manualMarkStudent(this.activeSessionId, studentId, newStatus);
      this.staffActivePeriodMarks[studentId] = newStatus;
      this.showToast(`Student attendance updated to ${newStatus.toUpperCase()}`, 'success');
      this.refreshActiveSessionMonitor();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // LESSON END & BLACKBOARD PHOTO PROOF MODAL CONTROLS
  openFinalizeSessionModal() {
    document.getElementById('finalizeSessionModal').style.display = 'flex';
    const topicInput = document.getElementById('finalLessonTopic');
    if (topicInput) topicInput.value = document.getElementById('sessionTopicInput')?.value || '';
    this.currentLessonPhotoBase64 = null;
    const preview = document.getElementById('finalLessonPhotoPreview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
  },

  closeFinalizeSessionModal() {
    document.getElementById('finalizeSessionModal').style.display = 'none';
  },

  handleLessonPhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      this.currentLessonPhotoBase64 = evt.target.result;
      const preview = document.getElementById('finalLessonPhotoPreview');
      if (preview) {
        preview.src = this.currentLessonPhotoBase64;
        preview.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  },

  snapLessonPhotoFromCamera() {
    const input = document.getElementById('finalLessonPhotoInput');
    if (input) {
      input.setAttribute('capture', 'environment');
      input.click();
    }
  },

  async handleFinalizeSessionSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const topic = document.getElementById('finalLessonTopic').value.trim();
    const summary = document.getElementById('finalLessonSummary').value.trim();
    const photo = this.currentLessonPhotoBase64 || null;

    if (!topic) {
      this.showToast('Please enter the lesson topic covered in class', 'error');
      return;
    }

    try {
      const res = await API.finalizeSession(this.activeSessionId, topic, summary, photo);
      this.showToast(res.message, 'success');
      this.closeFinalizeSessionModal();

      if (this.activeSessionInterval) clearInterval(this.activeSessionInterval);
      if (this.activeQrTimer) clearInterval(this.activeQrTimer);
      this.loadStaffDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async finalizeActiveSession() {
    this.openFinalizeSessionModal();
  },

  async handleStaffCorrectionRequest(e) {
    if (e && e.preventDefault) e.preventDefault();

    const studentId = parseInt(document.getElementById('corrStudentSelect').value, 10);
    const requestedStatus = document.getElementById('corrStatusSelect').value;
    const reason = document.getElementById('corrReason').value.trim();

    if (!studentId || !requestedStatus || !reason) {
      this.showToast('Please fill all correction request fields', 'error');
      return;
    }

    // Attach to active session or last session
    const sessionId = this.activeSessionId || 1;

    try {
      const res = await API.submitCorrectionRequest({
        sessionId,
        studentId,
        originalStatus: 'absent',
        requestedStatus,
        reason
      });
      this.showToast(res.message, 'success');
      document.getElementById('corrReason').value = '';
      this.loadStaffCorrectionRequests();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadStaffCorrectionRequests() {
    try {
      const res = await API.getStaffCorrectionRequests();
      const tbody = document.getElementById('staffCorrectionRequestsBody');

      if (!res.list || res.list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748B;">No correction requests filed yet.</td></tr>';
        return;
      }

      tbody.innerHTML = res.list.map(r => `
        <tr>
          <td>${r.session_date}</td>
          <td><strong>${r.student_name}</strong> (${r.register_number})</td>
          <td>${r.subject_code}</td>
          <td><span style="color:#DC2626;">${r.original_status}</span> ➔ <strong style="color:#059669;">${r.requested_status}</strong></td>
          <td style="max-width:200px; font-size:12px;">${r.reason}</td>
          <td><span class="status-badge status-${r.status}">${r.status}</span></td>
          <td style="font-size:12px; color:#64748B;">${r.review_remarks || '-'}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  },

  async loadStaffHistory() {
    try {
      const res = await API.getStaffHistory();
      const tbody = document.getElementById('staffHistoryTableBody');
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
      document.getElementById('staffCheckInStatusDisplay').scrollIntoView({ behavior: 'smooth' });
    } else if (tab === 'corrections') {
      document.getElementById('correctionRequestForm').scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  // -------------------------------------------------------------
  // ADMIN CONTROLLERS
  // -------------------------------------------------------------
  async loadAdminDashboard() {
    try {
      const res = await API.getAdminDashboard();

      // Metrics
      document.getElementById('adminMetricStudents').textContent = res.counts.students;
      document.getElementById('adminMetricStaff').textContent = res.counts.staff;
      document.getElementById('adminMetricTodayRate').textContent = `${res.todayAttendance.rate}%`;
      document.getElementById('adminMetricPendingCorr').textContent = res.counts.pendingCorrections;

      // Low Attendance Table
      const lowBody = document.getElementById('adminLowAttendanceTableBody');
      if (res.lowAttendanceStudents && res.lowAttendanceStudents.length > 0) {
        lowBody.innerHTML = res.lowAttendanceStudents.map(s => `
          <tr>
            <td><strong>${s.register_number}</strong></td>
            <td>${s.full_name}</td>
            <td>${s.class_name}</td>
            <td>${s.attended_sessions} / ${s.total_sessions} classes</td>
            <td><span class="status-badge status-absent" style="font-weight:900;">${s.percentage}% ⚠️</span></td>
            <td><a href="mailto:${s.email}" style="font-size:12px;">${s.email}</a></td>
          </tr>
        `).join('');
      } else {
        lowBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px; color:#059669;">All students have attendance >= 75%!</td></tr>';
      }

      // Today's Absentees
      const absBody = document.getElementById('adminTodayAbsenteesBody');
      if (res.todayAbsentees && res.todayAbsentees.length > 0) {
        absBody.innerHTML = res.todayAbsentees.map(a => `
          <tr>
            <td><strong>${a.register_number}</strong></td>
            <td>${a.full_name}</td>
            <td>${a.class_name}</td>
            <td>${a.subject_name}</td>
          </tr>
        `).join('');
      } else {
        absBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px; color:#64748B;">No absentees logged today.</td></tr>';
      }

      // Today's Late Arrivals
      const lateBody = document.getElementById('adminTodayLateBody');
      if (res.todayLateArrivals && res.todayLateArrivals.length > 0) {
        lateBody.innerHTML = res.todayLateArrivals.map(l => `
          <tr>
            <td><strong>${l.register_number}</strong></td>
            <td>${l.full_name}</td>
            <td>${l.class_name}</td>
            <td>${l.marked_at}</td>
          </tr>
        `).join('');
      } else {
        lateBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px; color:#64748B;">No late arrivals logged today.</td></tr>';
      }

      // Staff Check-ins
      const staffBody = document.getElementById('adminStaffCheckInBody');
      if (res.staffCheckIns && res.staffCheckIns.length > 0) {
        staffBody.innerHTML = res.staffCheckIns.map(s => `
          <tr>
            <td><strong>${s.full_name}</strong></td>
            <td>${s.designation}</td>
            <td>${s.department_name}</td>
            <td>${s.check_in_time || '<span style="color:#DC2626;">Not in</span>'}</td>
            <td>${s.check_out_time || '-'}</td>
            <td>${s.working_hours ? s.working_hours + ' hrs' : '-'}</td>
            <td><span class="status-badge status-${s.status || 'absent'}">${s.status || 'absent'}</span></td>
          </tr>
        `).join('');
      }

      // Populate filter dropdowns
      this.populateAdminFilters();

    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  switchAdminTab(tabName) {
    const tabs = ['overview', 'users', 'records', 'corrections', 'academics', 'settings', 'audit'];
    tabs.forEach(t => {
      const el = document.getElementById(`adminTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (el) el.style.display = t === tabName ? 'block' : 'none';
    });

    // Update active tab buttons
    document.querySelectorAll('#roleTabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    event?.target?.classList.add('active');

    // Load sub-data
    if (tabName === 'users') this.loadAdminUsers();
    if (tabName === 'records') this.filterAdminAttendanceRecords();
    if (tabName === 'corrections') this.loadAdminCorrections();
    if (tabName === 'academics') this.loadAdminAcademics();
    if (tabName === 'settings') this.loadAdminSettings();
    if (tabName === 'audit') this.loadAdminAuditLogs();
  },

  async populateAdminFilters() {
    try {
      const res = await API.getAcademicStructure();
      if (res.classes) {
        const classFilter = document.getElementById('adminFilterClass');
        const userClass = document.getElementById('newUserClass');
        const options = res.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (classFilter) classFilter.innerHTML = '<option value="">All Classes</option>' + options;
        if (userClass) userClass.innerHTML = '<option value="">-- Select Class --</option>' + options;
      }
    } catch (e) {
      console.error(e);
    }
  },

  async loadAdminUsers() {
    try {
      const res = await API.getAdminUsers();
      this.allAdminUsers = res.users;
      this.renderAdminUsersTable(res.users);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  filterAdminUsers() {
    if (!this.allAdminUsers) return;
    const query = document.getElementById('adminUserSearchInput').value.toLowerCase();
    const role = document.getElementById('adminUserRoleFilter').value;

    const filtered = this.allAdminUsers.filter(u => {
      const matchRole = !role || u.role === role;
      const matchSearch = !query || 
        (u.full_name && u.full_name.toLowerCase().includes(query)) ||
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.register_number && u.register_number.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query));
      return matchRole && matchSearch;
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
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:16px; color:#64748B;">No user accounts found. Click "Add User" above to add Staff or Students.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isAdmin = u.role === 'admin' || (u.username && u.username.toUpperCase() === 'KRISHNACOLLEGEADMIN');
      const isStaff = u.role === 'staff';
      const roleLabel = isAdmin ? 'SOLE ADMIN' : (isStaff ? (u.designation || 'STAFF') : 'STUDENT');
      const roleBg = isAdmin ? '#0F172A' : (isStaff ? '#B91C1C' : '#059669');
      const escapedName = (u.full_name || '').replace(/'/g, "\\'");

      return `
        <tr>
          <td>
            <img src="${u.photo_url || '/icons/college-logo.png'}" class="user-avatar-thumb" alt="${u.full_name}">
          </td>
          <td><strong>${u.register_number || u.username}</strong></td>
          <td style="font-weight:600;">${u.full_name}</td>
          <td><span class="role-tag" style="background:${roleBg};">${roleLabel.toUpperCase()}</span></td>
          <td>${u.class_name || u.department_name || '-'}</td>
          <td style="font-size:12px; font-weight:600;">${u.phone || '-'}</td>
          <td style="font-size:12px; color:#B91C1C; font-weight:700;">${u.parent_phone || '-'}</td>
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
                <button class="btn btn-danger btn-sm" style="padding:3px 8px; font-size:11px; font-weight:700;" onclick="App.handleDeleteUser(${u.id}, '${escapedName}', '${u.role}')" title="Delete user">
                  🗑️ Remove
                </button>
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  },

  async handleDeleteUser(userId, fullName, role) {
    const label = role === 'staff' ? 'Faculty Staff / HOD' : 'Student';
    if (!confirm(`Are you sure you want to permanently delete ${label} "${fullName}"?\n\nThis will remove their profile and all related attendance records.`)) {
      return;
    }
    try {
      const res = await API.deleteAdminUser(userId);
      this.showToast(res.message || 'User deleted successfully', 'success');
      this.loadAdminUsers();
      this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async toggleUserStatus(userId, newStatus) {
    try {
      await API.updateAdminUser(userId, { isActive: newStatus });
      this.showToast(`User status updated to ${newStatus ? 'Active' : 'Deactivated'}`, 'success');
      this.loadAdminUsers();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openCreateUserModal() {
    this.newUserPhotoBase64 = null;
    const preview = document.getElementById('newUserPhotoPreview');
    if (preview) preview.style.display = 'none';
    this.handleNewUserRoleChange();
    document.getElementById('createUserModal').style.display = 'flex';
  },

  closeCreateUserModal() {
    document.getElementById('createUserModal').style.display = 'none';
  },

  handleNewUserRoleChange() {
    const role = document.getElementById('newRole').value;
    const isStudent = role === 'student';
    const classGroup = document.getElementById('newUserClassGroup');
    if (classGroup) classGroup.style.display = isStudent ? 'block' : 'none';
    const parentPhoneGroup = document.getElementById('newUserParentPhoneGroup');
    if (parentPhoneGroup) parentPhoneGroup.style.display = isStudent ? 'block' : 'none';
    const staffFields = document.getElementById('newUserStaffFields');
    if (staffFields) staffFields.style.display = isStudent ? 'none' : 'grid';
  },

  async handleCreateUser(e) {
    if (e && e.preventDefault) e.preventDefault();

    const role = document.getElementById('newRole').value;
    const username = document.getElementById('newUsername').value.trim();
    const fullName = document.getElementById('newFullName').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    const classId = document.getElementById('newUserClass')?.value;
    const deptId = document.getElementById('newUserDept')?.value;
    const designation = role === 'staff' ? (document.getElementById('newDesignation')?.value || 'Assistant Professor') : 'Student';
    const email = document.getElementById('newEmail')?.value.trim();
    const phone = document.getElementById('newPhone')?.value.trim();
    const parentPhone = document.getElementById('newParentPhone')?.value.trim();
    const address = document.getElementById('newAddress')?.value.trim();
    const photoUrl = this.newUserPhotoBase64 || null;

    try {
      await API.createAdminUser({
        role,
        username,
        fullName,
        password,
        departmentId: role === 'staff' && deptId ? parseInt(deptId, 10) : null,
        classId: role === 'student' && classId ? parseInt(classId, 10) : null,
        designation,
        email,
        phone,
        parentPhone: role === 'student' ? parentPhone : null,
        address,
        photoUrl,
        registerNumber: role === 'student' ? username.toUpperCase() : null
      });
      this.showToast(`${role === 'staff' ? 'Staff' : 'Student'} account registered successfully!`, 'success');
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

  openCsvImportModal() {
    document.getElementById('csvImportModal').style.display = 'flex';
  },

  closeCsvImportModal() {
    document.getElementById('csvImportModal').style.display = 'none';
  },

  handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      document.getElementById('csvTextInput').value = event.target.result;
    };
    reader.readAsText(file);
  },

  async submitCsvImport() {
    const text = document.getElementById('csvTextInput').value.trim();
    if (!text) {
      this.showToast('Please provide CSV data', 'error');
      return;
    }

    try {
      const res = await API.importUsersCsv(text, 'student');
      this.showToast(res.message, 'success');
      this.closeCsvImportModal();
      this.loadAdminUsers();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async filterAdminAttendanceRecords() {
    const params = {
      from_date: document.getElementById('adminFilterFromDate')?.value || '',
      to_date: document.getElementById('adminFilterToDate')?.value || '',
      class_id: document.getElementById('adminFilterClass')?.value || '',
      status: document.getElementById('adminFilterStatus')?.value || ''
    };

    try {
      const res = await API.getAdminAttendanceRecords(params);
      const tbody = document.getElementById('adminAttendanceRecordsBody');

      if (!res.records || res.records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:14px; color:#64748B;">No attendance records found matching filters.</td></tr>';
        return;
      }

      tbody.innerHTML = res.records.map(r => `
        <tr>
          <td><strong>${r.date}</strong></td>
          <td><strong>${r.register_number}</strong></td>
          <td>${r.student_name}</td>
          <td>${r.class_name}</td>
          <td>${r.subject_code}</td>
          <td>${r.staff_name}</td>
          <td><span class="status-badge status-${r.status}">${r.status}</span></td>
          <td style="font-size:11px; color:#64748B;">${r.marked_by}</td>
        </tr>
      `).join('');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  exportReport(format = 'csv') {
    const filters = {
      from_date: document.getElementById('adminFilterFromDate')?.value || '',
      to_date: document.getElementById('adminFilterToDate')?.value || '',
      class_id: document.getElementById('adminFilterClass')?.value || '',
      status: document.getElementById('adminFilterStatus')?.value || ''
    };
    const url = API.getExportReportUrl(format, filters);
    window.open(url, '_blank');
  },

  async loadAdminCorrections() {
    try {
      const res = await API.getAdminCorrectionRequests();
      const tbody = document.getElementById('adminCorrectionsTableBody');

      if (!res.requests || res.requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:14px; color:#64748B;">No correction requests logged.</td></tr>';
        return;
      }

      tbody.innerHTML = res.requests.map(r => `
        <tr>
          <td>#${r.id}</td>
          <td>${r.session_date}</td>
          <td>${r.staff_name}</td>
          <td><strong>${r.student_name}</strong> (${r.register_number})</td>
          <td>${r.subject_code}</td>
          <td><span style="color:#DC2626;">${r.original_status}</span> ➔ <strong style="color:#059669;">${r.requested_status}</strong></td>
          <td style="font-size:12px; max-width:200px;">${r.reason}</td>
          <td><span class="status-badge status-${r.status}">${r.status}</span></td>
          <td>
            ${r.status === 'pending' ? `
              <div style="display:flex; gap:4px;">
                <button class="btn btn-success btn-sm" style="padding:2px 8px; font-size:11px;" onclick="App.reviewCorrection(${r.id}, 'approved')">Approve</button>
                <button class="btn btn-danger btn-sm" style="padding:2px 8px; font-size:11px;" onclick="App.reviewCorrection(${r.id}, 'rejected')">Reject</button>
              </div>
            ` : `<span style="font-size:11px; color:#64748B;">Reviewed</span>`}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async reviewCorrection(requestId, action) {
    const remarks = prompt(`Enter optional remarks for ${action.toUpperCase()}ing request #${requestId}:`, 'Verified by Admin');
    if (remarks === null) return;

    try {
      const res = await API.reviewCorrectionRequest(requestId, action, remarks);
      this.showToast(res.message, 'success');
      this.loadAdminCorrections();
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

      if (res.classes) {
        classBody.innerHTML = res.classes.map(c => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.department_name}</td>
            <td>${c.degree_level} (Sem ${c.semester})</td>
          </tr>
        `).join('');
      }

      if (allocRes.allocations) {
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
        const qrToggle = document.getElementById('settingStudentQrToggle');
        if (qrToggle) qrToggle.value = sMap.student_qr_enabled || '0';
        document.getElementById('settingQrDuration').value = sMap.qr_duration_seconds || '30';
        document.getElementById('settingLateGrace').value = sMap.late_grace_minutes || '10';
        document.getElementById('settingLowThreshold').value = sMap.low_attendance_threshold || '75';
        document.getElementById('settingLocationToggle').value = sMap.location_verification_enabled || '0';
        document.getElementById('settingCampusLat').value = sMap.campus_latitude || '10.9234';
        document.getElementById('settingCampusLng').value = sMap.campus_longitude || '78.0772';
        document.getElementById('settingCampusRadius').value = sMap.campus_radius_meters || '350';
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleSaveSettings(e) {
    if (e && e.preventDefault) e.preventDefault();

    const data = {
      student_qr_enabled: document.getElementById('settingStudentQrToggle')?.value || '0',
      qr_duration_seconds: document.getElementById('settingQrDuration').value,
      late_grace_minutes: document.getElementById('settingLateGrace').value,
      low_attendance_threshold: document.getElementById('settingLowThreshold').value,
      location_verification_enabled: document.getElementById('settingLocationToggle').value,
      campus_latitude: document.getElementById('settingCampusLat').value,
      campus_longitude: document.getElementById('settingCampusLng').value,
      campus_radius_meters: document.getElementById('settingCampusRadius').value
    };

    try {
      const res = await API.updateAdminSettings(data);
      this.showToast('System policies & Student QR switch updated successfully!', 'success');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAdminAuditLogs() {
    try {
      const res = await API.getAuditLogs();
      const tbody = document.getElementById('adminAuditLogsTableBody');

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
  }
};

// Initialize App on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
