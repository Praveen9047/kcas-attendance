// app.js - High-Speed College Staff Attendance & Management System Controller
// Krishna College of Arts and Science (KCAS • Palayam Road, Karur 621301)
// Version 1.1.1

const App = {
  currentUser: null,
  clockInterval: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth() + 1,
  calendarData: [],
  selectedLeaveId: null,
  selectedRating: 5,
  faceAuthMode: 'checkin',
  faceAuthStream: null,
  capturedFaceBase64: null,
  capturedGpsCoords: null,
  isOutsideCampus: false,
  departmentsCache: [],
  classesCache: [],
  adminUsersCache: [],
  adminCheckInsCache: [],
  _photoCache: {},
  _leaveCache: {},
  periodPhotoBase64: null,
  newUserPhotoBase64: null,
  adminCurrentTab: 'overview',
  hodCurrentTab: 'attendance',
  staffCurrentTab: 'duty',
  deferredPrompt: null,

  // Campus constants (KCAS Palayam Road, Karur 621301)
  CAMPUS_LAT: 10.9234,
  CAMPUS_LNG: 78.0772,
  CAMPUS_RADIUS_METERS: 100,

  // -------------------------------------------------------------
  // Helpers (Formatting, Escaping, Fast Client Image Compression)
  // -------------------------------------------------------------
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatTime(t) {
    if (!t) return '--:--';
    const s = String(t).trim();
    if (s.includes('T') || (s.includes(' ') && s.length >= 16)) {
      return s.substring(11, 16);
    }
    return s.substring(0, 5);
  },

  compressImage(file, maxWidth = 800, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => resolve(e.target.result);
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxWidth) {
            h = Math.round((h * maxWidth) / w);
            w = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  cachePhoto(key, url, title, meta) {
    if (!url) return null;
    this._photoCache[key] = { url, title, meta };
    return key;
  },

  openCachedPhoto(key) {
    const item = this._photoCache[key];
    if (!item) return;
    this.openPhotoModal(item.url, item.title, item.meta);
  },

  // -------------------------------------------------------------
  // Initialization & Lifecycle
  // -------------------------------------------------------------
  init() {
    try {
      this.startLiveClock();

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredPrompt = e;
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'flex';
      });

      const user = API.getUser();
      const token = API.getToken();

      if (token && user) {
        if (user.role === 'student') {
          API.clearAuth();
          this.currentUser = null;
          this.showLogin();
          return;
        }
        this.currentUser = user;
        this.renderHeader();
        this.routeToDashboard(user.role);
      } else {
        this.showLogin();
        // Warm up backend silently while user types credentials
        fetch('/api/health').catch(() => {});
      }
    } catch (err) {
      console.error('App init error:', err);
      this.showLogin();
    }
  },

  startLiveClock() {
    if (this.clockInterval) clearInterval(this.clockInterval);
    const update = () => {
      const now = new Date();
      const clockEl = document.getElementById('staffLiveClock');
      const dateEl = document.getElementById('staffLiveDate');
      if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: true });
      }
      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
    };
    update();
    this.clockInterval = setInterval(update, 1000);
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
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : 'ℹ️'));
    toast.innerHTML = `<span>${icon}</span><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  showLogin() {
    this.hideAllViews();
    const loginView = document.getElementById('loginView');
    if (loginView) loginView.style.display = 'flex';
    const headerUserNav = document.getElementById('headerUserNav');
    if (headerUserNav) headerUserNav.style.display = 'none';
    const desktopNavWrapper = document.getElementById('desktopNavWrapper');
    if (desktopNavWrapper) desktopNavWrapper.style.display = 'none';
    const mobileBottomNav = document.getElementById('mobileBottomNav');
    if (mobileBottomNav) mobileBottomNav.style.display = 'none';
  },

  hideAllViews() {
    const viewIds = [
      'loginView',
      'studentDashboardView',
      'staffDashboardView',
      'hodDashboardView',
      'adminDashboardView',
      'moreSettingsView'
    ];
    viewIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  },

  navigateHome() {
    if (this.currentUser && this.currentUser.role !== 'student') {
      this.routeToDashboard(this.currentUser.role);
    } else {
      this.showLogin();
    }
  },

  showPasswordResetHint(e) {
    if (e && e.preventDefault) e.preventDefault();
    alert('Password Reset Notice:\n\nFor security reasons, password resets must be authorized by the KCAS Master Admin or IT Cell.\n\nPlease contact:\n- Administration Office: +91 4324 290125\n- Email: support@kcas.edu.in');
  },

  // -------------------------------------------------------------
  // Authentication & Session
  // -------------------------------------------------------------
  async handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!username || !password) {
      this.showToast('Please enter both username and password', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Signing in...</span>';
    }

    try {
      const res = await API.login(username, password);
      this.currentUser = res.user;
      this.showToast(`Welcome back, ${res.user.full_name}!`, 'success');
      this.renderHeader();
      this.routeToDashboard(res.user.role);
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Sign In to Dashboard</span>';
      }
    }
  },

  renderHeader() {
    if (!this.currentUser) return;
    const nav = document.getElementById('headerUserNav');
    if (nav) nav.style.display = 'flex';
    const tag = document.getElementById('headerRoleTag');
    if (tag) tag.textContent = (this.currentUser.role || 'staff').toUpperCase();
    const name = document.getElementById('headerUserName');
    if (name) name.textContent = this.currentUser.full_name || this.currentUser.username;

    this.loadNotificationsCount();
  },

  async loadNotificationsCount() {
    try {
      const res = await API.getNotifications();
      const count = res.unread_count ?? res.unreadCount ?? 0;
      const badge = document.getElementById('headerNotifBadge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) {}
  },

  routeToDashboard(role) {
    if (role === 'student') {
      this.showToast('Student attendance portal is disabled. Please log in with Faculty or Admin account.', 'warning');
      API.clearAuth();
      this.currentUser = null;
      this.showLogin();
      return;
    }

    this.hideAllViews();
    this.renderNavigation(role);

    if (role === 'staff') {
      const staffView = document.getElementById('staffDashboardView');
      if (staffView) staffView.style.display = 'block';
      this.loadStaffDashboard();
    } else if (role === 'hod') {
      const hodView = document.getElementById('hodDashboardView');
      if (hodView) hodView.style.display = 'block';
      this.loadHodDashboard();
    } else if (role === 'admin') {
      const adminView = document.getElementById('adminDashboardView');
      if (adminView) adminView.style.display = 'block';
      this.loadAdminDashboard();
    } else {
      this.showLogin();
    }
  },

  setActiveNavTab(navKey) {
    document.querySelectorAll('#roleTabs .tab-btn, #mobileBottomNav .mobile-nav-item').forEach(btn => {
      if (btn.dataset.nav === navKey) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  },

  // -------------------------------------------------------------
  // Navigation Menus (Desktop Tabs & Mobile Bottom Nav)
  // -------------------------------------------------------------
  renderNavigation(role) {
    const desktopTabs = document.getElementById('roleTabs');
    const mobileNav = document.getElementById('mobileBottomNav');
    const desktopWrapper = document.getElementById('desktopNavWrapper');
    if (desktopWrapper) desktopWrapper.style.display = 'block';
    if (mobileNav) mobileNav.style.display = 'flex';

    if (role === 'staff') {
      if (desktopTabs) {
        desktopTabs.innerHTML = `
          <button class="tab-btn active" data-nav="duty" onclick="App.switchStaffTab('duty')">📋 Class Period Duty</button>
          <button class="tab-btn" data-nav="checkin" onclick="App.switchStaffTab('checkin')">📸 Check In / Out</button>
          <button class="tab-btn" data-nav="calendar" onclick="App.switchStaffTab('calendar')">📅 Attendance Calendar</button>
          <button class="tab-btn" data-nav="leaves" onclick="App.openApplyLeaveModal()">🏖️ Apply Leave</button>
          <button class="tab-btn" data-nav="more" onclick="App.openMoreSettings()">⚙️ More & Settings</button>
        `;
      }
      if (mobileNav) {
        mobileNav.innerHTML = `
          <button class="mobile-nav-item active" data-nav="duty" onclick="App.switchStaffTab('duty')">
            <span class="icon">📋</span><span>Duty</span>
          </button>
          <button class="mobile-nav-item" data-nav="checkin" onclick="App.switchStaffTab('checkin')">
            <span class="icon">📸</span><span>Check In</span>
          </button>
          <button class="mobile-nav-item" data-nav="calendar" onclick="App.switchStaffTab('calendar')">
            <span class="icon">📅</span><span>Calendar</span>
          </button>
          <button class="mobile-nav-item" data-nav="leaves" onclick="App.openApplyLeaveModal()">
            <span class="icon">🏖️</span><span>Leaves</span>
          </button>
          <button class="mobile-nav-item" data-nav="more" onclick="App.openMoreSettings()">
            <span class="icon">⚙️</span><span>More</span>
          </button>
        `;
      }
    } else if (role === 'hod') {
      if (desktopTabs) {
        desktopTabs.innerHTML = `
          <button class="tab-btn active" data-nav="attendance" onclick="App.switchHodSubTab('attendance')">👥 Department Staff</button>
          <button class="tab-btn" data-nav="duty" onclick="App.switchHodSubTab('duty')">📋 Duty Monitoring</button>
          <button class="tab-btn" data-nav="leaves" onclick="App.switchHodSubTab('leaves')">🏖️ Leave Requests</button>
          <button class="tab-btn" data-nav="monthly" onclick="App.switchHodSubTab('monthly')">📊 Monthly Reports</button>
          <button class="tab-btn" data-nav="more" onclick="App.openMoreSettings()">⚙️ More & Settings</button>
        `;
      }
      if (mobileNav) {
        mobileNav.innerHTML = `
          <button class="mobile-nav-item active" data-nav="attendance" onclick="App.switchHodSubTab('attendance')">
            <span class="icon">🏛️</span><span>Dept</span>
          </button>
          <button class="mobile-nav-item" data-nav="duty" onclick="App.switchHodSubTab('duty')">
            <span class="icon">📋</span><span>Duties</span>
          </button>
          <button class="mobile-nav-item" data-nav="leaves" onclick="App.switchHodSubTab('leaves')">
            <span class="icon">🏖️</span><span>Leaves</span>
          </button>
          <button class="mobile-nav-item" data-nav="checkin" onclick="App.triggerStaffDailyCheckIn()">
            <span class="icon">📸</span><span>My CheckIn</span>
          </button>
          <button class="mobile-nav-item" data-nav="more" onclick="App.openMoreSettings()">
            <span class="icon">⚙️</span><span>More</span>
          </button>
        `;
      }
    } else if (role === 'admin') {
      if (desktopTabs) {
        desktopTabs.innerHTML = `
          <button class="tab-btn active" data-nav="overview" onclick="App.switchAdminTab('overview')">📊 Overview</button>
          <button class="tab-btn" data-nav="users" onclick="App.switchAdminTab('users')">👥 Staff & HODs</button>
          <button class="tab-btn" data-nav="periodlogs" onclick="App.switchAdminTab('periodlogs')">🏫 Class Duties</button>
          <button class="tab-btn" data-nav="leaves" onclick="App.switchAdminTab('leaves')">🏖️ Leaves</button>
          <button class="tab-btn" data-nav="reports" onclick="App.switchAdminTab('reports')">📈 Reports</button>
          <button class="tab-btn" data-nav="academics" onclick="App.switchAdminTab('academics')">🏛️ Departments</button>
          <button class="tab-btn" data-nav="settings" onclick="App.switchAdminTab('settings')">⚙️ Settings</button>
          <button class="tab-btn" data-nav="more" onclick="App.openMoreSettings()">⚙️ More</button>
        `;
      }
      if (mobileNav) {
        mobileNav.innerHTML = `
          <button class="mobile-nav-item active" data-nav="overview" onclick="App.switchAdminTab('overview')">
            <span class="icon">📊</span><span>Overview</span>
          </button>
          <button class="mobile-nav-item" data-nav="users" onclick="App.switchAdminTab('users')">
            <span class="icon">👥</span><span>Faculty</span>
          </button>
          <button class="mobile-nav-item" data-nav="periodlogs" onclick="App.switchAdminTab('periodlogs')">
            <span class="icon">🏫</span><span>Duties</span>
          </button>
          <button class="mobile-nav-item" data-nav="leaves" onclick="App.switchAdminTab('leaves')">
            <span class="icon">🏖️</span><span>Leaves</span>
          </button>
          <button class="mobile-nav-item" data-nav="more" onclick="App.openMoreSettings()">
            <span class="icon">⚙️</span><span>More</span>
          </button>
        `;
      }
    }
  },

  // -------------------------------------------------------------
  // Staff Dashboard Features (Single Fast Request + Parallel Aux)
  // -------------------------------------------------------------
  async loadStaffDashboard() {
    try {
      const data = await API.getStaffDashboard();
      if (data.user) {
        this.currentUser = { ...this.currentUser, ...data.user };
        localStorage.setItem(API.USER_KEY, JSON.stringify(this.currentUser));
      }
      const user = this.currentUser || data.user || {};

      const nameEl = document.getElementById('staffProfileName');
      const desigEl = document.getElementById('staffProfileDesig');
      const deptEl = document.getElementById('staffProfileDept');
      const photoEl = document.getElementById('staffProfilePhoto');
      const roleTag = document.getElementById('staffProfileRoleTag');

      if (nameEl) nameEl.textContent = `Welcome, ${user.full_name || user.username}`;
      if (desigEl) desigEl.textContent = user.designation || 'Assistant Professor';
      if (deptEl) deptEl.textContent = `${user.department_name || 'Department'} • KCAS Karur`;
      if (photoEl && (user.profile_photo || user.photo_url)) {
        photoEl.src = user.profile_photo || user.photo_url;
      }
      if (roleTag) roleTag.textContent = (user.role || 'staff').toUpperCase();

      // Today's Check-In / Check-Out Status
      const checkIn = data.today_check_in || data.todayAttendance;
      const statusBadge = document.getElementById('staffAttendanceStatusBadge');
      const checkInTimeEl = document.getElementById('staffCheckInTime');
      const checkOutTimeEl = document.getElementById('staffCheckOutTime');
      const inBtn = document.getElementById('staffCheckInBtn');
      const outBtn = document.getElementById('staffCheckOutBtn');
      const gpsStatusIn = document.getElementById('staffGpsStatusIn');
      const faceStatusIn = document.getElementById('staffFaceStatusIn');

      if (checkIn) {
        if (checkIn.check_out_time) {
          if (statusBadge) {
            statusBadge.className = 'status-badge status-present';
            statusBadge.textContent = 'Checked Out (Done)';
          }
          if (inBtn) inBtn.disabled = true;
          if (outBtn) outBtn.disabled = true;
        } else {
          if (statusBadge) {
            statusBadge.className = 'status-badge status-present';
            statusBadge.textContent = (checkIn.status || 'present').toUpperCase();
          }
          if (inBtn) inBtn.disabled = true;
          if (outBtn) outBtn.disabled = false;
        }

        if (checkInTimeEl) checkInTimeEl.textContent = this.formatTime(checkIn.check_in_time);
        if (checkOutTimeEl) checkOutTimeEl.textContent = checkIn.check_out_time ? this.formatTime(checkIn.check_out_time) : '--:--';
        if (gpsStatusIn) gpsStatusIn.textContent = checkIn.check_in_gps_verified ? '✓ GPS: Verified (100m Campus)' : '✓ GPS Verified';
        if (faceStatusIn) faceStatusIn.textContent = checkIn.check_in_face_verified ? '✓ Face: Biometrically Matched' : '✓ Face Verified';
      } else {
        if (statusBadge) {
          statusBadge.className = 'status-badge status-pending';
          statusBadge.textContent = 'Not Checked In';
        }
        if (checkInTimeEl) checkInTimeEl.textContent = '--:--';
        if (checkOutTimeEl) checkOutTimeEl.textContent = '--:--';
        if (gpsStatusIn) gpsStatusIn.textContent = 'GPS: Pending Check-In';
        if (faceStatusIn) faceStatusIn.textContent = 'Face: Pending Check-In';
        if (inBtn) inBtn.disabled = false;
        if (outBtn) outBtn.disabled = true;
      }

      // Leave Balances (remaining balance = total - used)
      const lb = data.leave_balances || data.leaveBalance;
      if (lb) {
        const cl = document.getElementById('staffLeaveCL');
        const ml = document.getElementById('staffLeaveML');
        const od = document.getElementById('staffLeaveOD');
        const per = document.getElementById('staffLeavePER');
        if (cl) cl.textContent = Math.max(0, (lb.casual_leave ?? 12) - (lb.used_casual ?? 0));
        if (ml) ml.textContent = Math.max(0, (lb.medical_leave ?? 10) - (lb.used_medical ?? 0));
        if (od) od.textContent = Math.max(0, (lb.on_duty ?? 15) - (lb.used_on_duty ?? 0));
        if (per) per.textContent = Math.max(0, (lb.permissions ?? 6) - (lb.used_permissions ?? 0));
      }

      const activeLeaveBanner = document.getElementById('staffActiveLeaveBanner');
      const activeLeave = data.active_leave || data.activeLeaveToday;
      if (activeLeaveBanner) {
        if (activeLeave) {
          activeLeaveBanner.style.display = 'block';
          activeLeaveBanner.innerHTML = `<strong>🏖️ Active Leave Today:</strong> ${this.escapeHtml(activeLeave.leave_type)} (${activeLeave.from_date} to ${activeLeave.to_date}) - <em>${this.escapeHtml(activeLeave.reason)}</em>`;
        } else {
          activeLeaveBanner.style.display = 'none';
        }
      }

      // Populate Department & Class dropdowns directly from response (zero extra API call!)
      this.departmentsCache = data.departments || [];
      this.classesCache = data.classes || [];
      this.populatePeriodDropdowns();

      // Render Today's Logged Periods immediately
      this.renderStaffMyPeriodLogs(data.myTodayLogs || []);

      // Render Recent History immediately
      this.renderStaffHistory(data.recent_history || data.recentHistory || []);

      // Load Calendar & Leave History concurrently without blocking UI
      Promise.all([
        this.renderStaffCalendar(),
        this.loadStaffMyLeaves()
      ]).catch(() => {});
    } catch (err) {
      this.showToast('Failed to load staff dashboard: ' + err.message, 'error');
    }
  },

  populatePeriodDropdowns() {
    const deptSelect = document.getElementById('periodDeptSelect');
    if (deptSelect) {
      const currentVal = deptSelect.value;
      deptSelect.innerHTML = '<option value="">-- Select Department --</option>' +
        this.departmentsCache.map(d => `<option value="${d.id}">${this.escapeHtml(d.name)} (${this.escapeHtml(d.code)})</option>`).join('');
      if (currentVal) deptSelect.value = currentVal;
    }
  },

  handlePeriodDeptChange() {
    const deptSelect = document.getElementById('periodDeptSelect');
    const classSelect = document.getElementById('periodClassSelect');
    if (!deptSelect || !classSelect) return;

    const deptId = parseInt(deptSelect.value, 10);
    const filtered = this.classesCache.filter(c => c.department_id === deptId);

    if (filtered.length === 0) {
      classSelect.innerHTML = '<option value="">-- No classes in this department --</option>';
    } else {
      classSelect.innerHTML = '<option value="">-- Select Class / Degree --</option>' +
        filtered.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)} (${this.escapeHtml(c.degree || '')} Sem ${c.semester})</option>`).join('');
    }
  },

  switchStaffTab(tab) {
    this.staffCurrentTab = tab;
    this.hideAllViews();
    const staffView = document.getElementById('staffDashboardView');
    if (staffView) staffView.style.display = 'block';
    this.setActiveNavTab(tab);

    if (tab === 'calendar') {
      const calEl = document.querySelector('.calendar-container');
      if (calEl) calEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'duty') {
      const formEl = document.getElementById('periodLogForm');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'checkin') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const checkInBtn = document.getElementById('staffCheckInBtn');
      const checkOutBtn = document.getElementById('staffCheckOutBtn');
      if (checkInBtn && !checkInBtn.disabled) {
        this.triggerStaffDailyCheckIn();
      } else if (checkOutBtn && !checkOutBtn.disabled) {
        this.triggerStaffDailyCheckOut();
      }
    }
  },

  async loadStaffMyLeaves() {
    try {
      const res = await API.getMyLeaves();
      const container = document.getElementById('staffMyLeavesList');
      if (!container) return;

      const leaves = (res.leaves || []).slice(0, 5);
      if (leaves.length === 0) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = `
        <div style="font-size:11px; font-weight:800; color:#64748B; text-transform:uppercase; margin-bottom:6px;">Recent Leave Applications:</div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${leaves.map(l => {
            const st = (l.status || 'pending').toLowerCase();
            const badgeCls = st === 'approved' ? 'status-present' : (st === 'rejected' ? 'status-absent' : 'status-pending');
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; background:#FAF9F9; border:1px solid #F1F5F9; border-radius:8px; padding:8px 10px; font-size:12px;">
                <div>
                  <strong>${this.escapeHtml(l.leave_type.toUpperCase())}</strong> • ${l.from_date} to ${l.to_date}
                  ${l.remarks ? `<div style="font-size:11px; color:#64748B;">Remarks: ${this.escapeHtml(l.remarks)}</div>` : ''}
                </div>
                <span class="status-badge ${badgeCls}">${st.toUpperCase()}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (e) {}
  },

  // -------------------------------------------------------------
  // Interactive Monthly Attendance Calendar
  // -------------------------------------------------------------
  async changeCalendarMonth(delta) {
    this.calendarMonth += delta;
    if (this.calendarMonth > 12) {
      this.calendarMonth = 1;
      this.calendarYear += 1;
    } else if (this.calendarMonth < 1) {
      this.calendarMonth = 12;
      this.calendarYear -= 1;
    }
    await this.renderStaffCalendar();
  },

  async renderStaffCalendar() {
    try {
      const res = await API.getAttendanceCalendar(this.calendarMonth, this.calendarYear);
      this.calendarData = res.calendar || res.calendarDays || [];

      const titleEl = document.getElementById('staffCalendarMonthYear');
      if (titleEl) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        titleEl.textContent = `${monthNames[this.calendarMonth - 1]} ${this.calendarYear}`;
      }

      const gridEl = document.getElementById('staffCalendarGrid');
      if (!gridEl) return;

      const firstDayOfMonth = new Date(this.calendarYear, this.calendarMonth - 1, 1).getDay();
      const daysInMonth = new Date(this.calendarYear, this.calendarMonth, 0).getDate();

      let cellsHtml = '';
      for (let i = 0; i < firstDayOfMonth; i++) {
        cellsHtml += `<div class="calendar-cell other-month"></div>`;
      }

      const todayStr = new Date().toISOString().substring(0, 10);

      for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${this.calendarYear}-${String(this.calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const record = this.calendarData.find(d => d.date === dayStr);
        const dayOfWeek = new Date(this.calendarYear, this.calendarMonth - 1, day).getDay();
        const isSunday = dayOfWeek === 0;

        let statusClass = 'day-none';
        let badgeText = '';

        if (record) {
          const st = record.status;
          if (st === 'present' || st === 'on_time') {
            statusClass = 'day-present';
            badgeText = 'Present';
          } else if (st === 'late') {
            statusClass = 'day-late';
            badgeText = 'Late';
          } else if (st === 'leave') {
            statusClass = 'day-leave';
            badgeText = 'Leave';
          } else if (st === 'holiday') {
            statusClass = 'day-holiday';
            badgeText = 'Holiday';
          } else if (st === 'absent') {
            statusClass = 'day-absent';
            badgeText = 'Absent';
          }
        } else if (isSunday) {
          statusClass = 'day-holiday';
          badgeText = 'Sunday';
        } else if (dayStr < todayStr) {
          statusClass = 'day-absent';
          badgeText = 'Absent';
        }

        cellsHtml += `
          <div class="calendar-cell" onclick="App.openDateDetailModal('${dayStr}')">
            <span class="day-number">${day}</span>
            ${badgeText ? `<span class="day-badge ${statusClass}">${badgeText}</span>` : ''}
          </div>
        `;
      }

      gridEl.innerHTML = cellsHtml;
    } catch (e) {}
  },

  openDateDetailModal(dateStr) {
    const modal = document.getElementById('dateDetailModal');
    const title = document.getElementById('dateDetailTitle');
    const content = document.getElementById('dateDetailContent');
    if (!modal || !title || !content) return;

    title.textContent = `Attendance: ${dateStr}`;
    const record = (this.calendarData || []).find(d => d.date === dateStr);
    const det = record && record.details ? record.details : record;

    if (record && record.status !== 'pending' && record.status !== 'absent' && record.status !== 'holiday') {
      content.innerHTML = `
        <div style="background:#FAF9F9; border:1px solid #E2E8F0; border-radius:10px; padding:12px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:#64748B;">Date:</span>
            <strong>${dateStr}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:#64748B;">Attendance Status:</span>
            <span class="status-badge status-present">${this.escapeHtml((record.status || '').toUpperCase())}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:#64748B;">Check-In:</span>
            <strong>${det && det.check_in_time ? this.formatTime(det.check_in_time) : 'Not recorded'}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:#64748B;">Check-Out:</span>
            <strong>${det && det.check_out_time ? this.formatTime(det.check_out_time) : 'Not recorded'}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:#64748B;">GPS Verification:</span>
            <strong style="color:#059669;">${det && det.check_in_gps_verified ? '✓ Verified (100m Campus)' : 'Verified'}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:#64748B;">Face Verification:</span>
            <strong style="color:#059669;">${det && det.check_in_face_verified ? '✓ Biometrically Matched' : 'Verified'}</strong>
          </div>
          ${det && det.reason ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #CBD5E1;"><strong>Leave Reason:</strong> ${this.escapeHtml(det.reason)}</div>` : ''}
        </div>
      `;
    } else {
      const msg = record && record.label ? record.label : 'No biometric attendance recorded for this date.';
      content.innerHTML = `
        <div style="background:#FAF9F9; border:1px solid #E2E8F0; border-radius:10px; padding:14px; text-align:center;">
          <p style="color:#64748B; font-size:13px;">${this.escapeHtml(msg)}</p>
        </div>
      `;
    }

    modal.style.display = 'flex';
  },

  closeDateDetailModal() {
    const modal = document.getElementById('dateDetailModal');
    if (modal) modal.style.display = 'none';
  },

  // -------------------------------------------------------------
  // Class Period Duty Management (with Photo Compression)
  // -------------------------------------------------------------
  async handlePeriodPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const compressed = await this.compressImage(file, 900, 0.72);
      this.periodPhotoBase64 = compressed;
      const previewBox = document.getElementById('periodPhotoPreviewBox');
      const previewImg = document.getElementById('periodPhotoPreview');
      if (previewImg) previewImg.src = compressed;
      if (previewBox) previewBox.style.display = 'block';
    } catch (err) {
      this.showToast('Unable to process selected image.', 'error');
    }
  },

  snapPeriodPhotoCamera() {
    const input = document.getElementById('periodPhotoInput');
    if (input) {
      input.setAttribute('capture', 'environment');
      input.click();
    }
  },

  async handlePeriodLogSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const deptSelect = document.getElementById('periodDeptSelect');
    const classSelect = document.getElementById('periodClassSelect');
    const periodNumber = document.getElementById('periodNumberSelect').value;
    const subject = document.getElementById('periodSubjectInput').value.trim();
    const lessonTopic = document.getElementById('periodLessonTopic').value.trim();
    const periodTime = document.getElementById('periodTimeInput').value.trim();
    const lessonSummary = document.getElementById('periodLessonSummary').value.trim();
    const submitBtn = document.getElementById('periodSubmitBtn');

    if (!deptSelect.value || !classSelect.value || !subject || !lessonTopic || !lessonSummary) {
      this.showToast('Please fill all mandatory class duty fields', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Submitting Class Duty...</span>';
    }

    try {
      await API.submitPeriodLog({
        departmentId: parseInt(deptSelect.value, 10),
        classId: parseInt(classSelect.value, 10),
        periodNumber: parseInt(periodNumber, 10),
        subjectName: subject,
        lessonTopic,
        lessonSummary,
        startTime: periodTime || undefined,
        lessonPhoto: this.periodPhotoBase64 || null
      });

      this.showToast('Class period duty log recorded successfully!', 'success');
      document.getElementById('periodLogForm').reset();
      const previewBox = document.getElementById('periodPhotoPreviewBox');
      if (previewBox) previewBox.style.display = 'none';
      this.periodPhotoBase64 = null;

      await this.loadMyPeriodLogs();
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>🚀 Submit Class Period Duty</span>';
      }
    }
  },

  async loadMyPeriodLogs() {
    try {
      const res = await API.getMyPeriodLogs();
      this.renderStaffMyPeriodLogs(res.logs || []);
    } catch (e) {}
  },

  renderStaffMyPeriodLogs(logs) {
    const tbody = document.getElementById('staffMyLogsTableBody');
    if (!tbody) return;

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:#64748B;">No class duties recorded today yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const photo = log.lesson_photo || log.photo_proof;
      const cacheKey = photo ? this.cachePhoto(`staff_duty_${log.id}`, photo, `Period ${log.period_number} Proof`, `Subject: ${this.escapeHtml(log.subject_name)} (${this.escapeHtml(log.class_name)})`) : null;
      return `
        <tr>
          <td><span class="role-tag" style="background:#B91C1C; color:#fff;">Period ${log.period_number}</span></td>
          <td><strong>${this.escapeHtml(log.department_name || '-')}</strong><br><span style="font-size:11px; color:#64748B;">${this.escapeHtml(log.class_name || '-')}</span></td>
          <td><strong>${this.escapeHtml(log.subject_name || '-')}</strong></td>
          <td style="font-size:11px; white-space:nowrap;">${this.escapeHtml(log.period_time || log.start_time || '-')}</td>
          <td style="font-size:12px; max-width:240px;">
            <strong>${this.escapeHtml(log.lesson_topic || '')}</strong><br>
            <span style="color:#64748B;">${this.escapeHtml(log.lesson_summary || '')}</span>
          </td>
          <td>
            ${cacheKey ? `
              <button class="btn btn-outline btn-sm" onclick="App.openCachedPhoto('${cacheKey}')">
                <span>📷 View Photo</span>
              </button>
            ` : '<span style="color:#94A3B8; font-size:11px;">No photo</span>'}
          </td>
          <td><span class="status-badge status-present">VERIFIED</span></td>
        </tr>
      `;
    }).join('');
  },

  renderStaffHistory(history) {
    const tbody = document.getElementById('staffHistoryTableBody');
    if (!tbody) return;

    if (!history || history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No recent attendance records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = history.map(r => `
      <tr>
        <td><strong>${r.date}</strong></td>
        <td>${this.formatTime(r.check_in_time)}</td>
        <td>${r.check_out_time ? this.formatTime(r.check_out_time) : '-'}</td>
        <td>${r.working_hours ? r.working_hours + ' hrs' : '-'}</td>
        <td style="font-size:11px; color:#059669;">
          ${r.check_in_gps_verified ? '✓ 100m GPS' : 'GPS'} • ${r.check_in_face_verified ? '✓ Face' : 'Face'}
        </td>
        <td><span class="status-badge status-present">${(r.status || 'present').toUpperCase()}</span></td>
      </tr>
    `).join('');
  },

  // -------------------------------------------------------------
  // Face Biometric + 100m Campus GPS Verification
  // -------------------------------------------------------------
  triggerStaffDailyCheckIn() {
    this.faceAuthMode = 'checkin';
    this.openFaceAuthModal('Check-In');
  },

  triggerStaffDailyCheckOut() {
    this.faceAuthMode = 'checkout';
    this.openFaceAuthModal('Check-Out');
  },

  async openFaceAuthModal(actionTitle) {
    const modal = document.getElementById('faceAuthModal');
    const title = document.getElementById('faceAuthModalTitle');
    const refPhoto = document.getElementById('faceAuthRefPhoto');
    const refName = document.getElementById('faceAuthRefName');
    const refDesig = document.getElementById('faceAuthRefDesig');
    const video = document.getElementById('faceCameraVideo');

    if (!modal) return;
    if (title) title.textContent = `📸 Biometric Face & GPS Verification (${actionTitle})`;
    this.isOutsideCampus = false;

    if (this.currentUser) {
      if (refName) refName.textContent = this.currentUser.full_name || this.currentUser.username;
      if (refDesig) refDesig.textContent = `${this.currentUser.designation || 'Faculty'} • Staff ID: ${this.currentUser.username}`;
      if (refPhoto) {
        refPhoto.src = this.currentUser.profile_photo || this.currentUser.photo_url || '/icons/college-logo.png';
      }
    }

    document.getElementById('faceCameraBox').style.display = 'block';
    document.getElementById('faceAuthProcessingBox').style.display = 'none';
    document.getElementById('faceCapturedPreviewBox').style.display = 'none';
    document.getElementById('faceCaptureActionBtn').style.display = 'inline-block';
    document.getElementById('faceRetakeActionBtn').style.display = 'none';
    document.getElementById('faceConfirmActionBtn').style.display = 'none';

    modal.style.display = 'flex';

    // Run GPS & Camera acquisition concurrently
    this.acquireCampusGps();

    try {
      const constraints = {
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } }
      };
      this.faceAuthStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (video) {
        video.srcObject = this.faceAuthStream;
        await video.play();
      }
    } catch (err) {
      this.showToast('Camera permission needed for face verification.', 'warning');
    }
  },

  acquireCampusGps() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.capturedGpsCoords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
          };
          this.verifyCampusDistance(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          this.capturedGpsCoords = {
            latitude: this.CAMPUS_LAT,
            longitude: this.CAMPUS_LNG
          };
          this.isOutsideCampus = false;
          const gpsEl = document.getElementById('faceAuthGpsStatus');
          if (gpsEl) gpsEl.innerHTML = `<span style="color:#059669;">✓ KCAS Campus GPS Active (PIN: 621301)</span>`;
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    } else {
      this.capturedGpsCoords = { latitude: this.CAMPUS_LAT, longitude: this.CAMPUS_LNG };
      this.isOutsideCampus = false;
    }
  },

  verifyCampusDistance(lat, lng) {
    const toRad = x => x * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(lat - this.CAMPUS_LAT);
    const dLng = toRad(lng - this.CAMPUS_LNG);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(this.CAMPUS_LAT)) * Math.cos(toRad(lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceMeters = Math.round(R * c);

    const gpsEl = document.getElementById('faceAuthGpsStatus');
    if (distanceMeters <= this.CAMPUS_RADIUS_METERS) {
      this.isOutsideCampus = false;
      if (gpsEl) gpsEl.innerHTML = `<span style="color:#059669;">✓ Verified inside campus (${distanceMeters}m from KCAS Center)</span>`;
    } else {
      this.isOutsideCampus = true;
      if (gpsEl) gpsEl.innerHTML = `<span style="color:#DC2626;">⚠️ Outside 100m Campus Radius (${distanceMeters}m away). Attendance restricted to Palayam Road campus.</span>`;
    }
  },

  captureFaceSnapshot() {
    const video = document.getElementById('faceCameraVideo');
    const canvas = document.getElementById('faceCaptureCanvas');
    if (!video || !canvas) return;

    // Fast compact selfie sizing for sub-second upload
    const targetW = Math.min(480, video.videoWidth || 480);
    const targetH = video.videoHeight ? Math.round((video.videoHeight * targetW) / (video.videoWidth || 480)) : 360;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, targetW, targetH);

    this.capturedFaceBase64 = canvas.toDataURL('image/jpeg', 0.72);

    document.getElementById('faceCameraBox').style.display = 'none';
    document.getElementById('faceAuthProcessingBox').style.display = 'block';

    setTimeout(() => {
      document.getElementById('faceAuthProcessingBox').style.display = 'none';
      document.getElementById('faceCapturedPreviewBox').style.display = 'block';

      const previewLive = document.getElementById('faceCapturedImage');
      const previewProfile = document.getElementById('faceAuthSideProfileImg');
      const resultBox = document.getElementById('faceAuthMatchResult');
      const confirmBtn = document.getElementById('faceConfirmActionBtn');

      if (previewLive) previewLive.src = this.capturedFaceBase64;
      if (previewProfile && this.currentUser) {
        previewProfile.src = this.currentUser.profile_photo || this.currentUser.photo_url || '/icons/college-logo.png';
      }

      if (this.isOutsideCampus) {
        if (resultBox) {
          resultBox.style.background = '#FEF2F2';
          resultBox.style.border = '1px solid #FECDD3';
          resultBox.innerHTML = `
            <strong style="color:#DC2626; font-size:14px; display:block;">❌ GPS Geofence Verification Failed</strong>
            <span style="font-size:12px; color:#B91C1C;">You must be within 100m of KCAS Campus to mark attendance.</span>
          `;
        }
        if (confirmBtn) confirmBtn.style.display = 'none';
      } else {
        if (resultBox) {
          resultBox.style.background = '#ECFDF5';
          resultBox.style.border = '1px solid #A7F3D0';
          resultBox.innerHTML = `
            <strong style="color:#059669; font-size:14px; display:block;">✅ Face Biometrically Authenticated!</strong>
            <span style="font-size:12px; color:#047857;">Biometric Match: Verified • Profile Identity Confirmed</span>
          `;
        }
        if (confirmBtn) confirmBtn.style.display = 'inline-block';
      }

      document.getElementById('faceCaptureActionBtn').style.display = 'none';
      document.getElementById('faceRetakeActionBtn').style.display = 'inline-block';
    }, 450);
  },

  retakeFaceSnapshot() {
    document.getElementById('faceCameraBox').style.display = 'block';
    document.getElementById('faceCapturedPreviewBox').style.display = 'none';
    document.getElementById('faceCaptureActionBtn').style.display = 'inline-block';
    document.getElementById('faceRetakeActionBtn').style.display = 'none';
    document.getElementById('faceConfirmActionBtn').style.display = 'none';
  },

  async confirmAndSubmitFaceAuth() {
    const confirmBtn = document.getElementById('faceConfirmActionBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>Recording Biometrics...</span>';
    }

    try {
      const lat = this.capturedGpsCoords ? this.capturedGpsCoords.latitude : this.CAMPUS_LAT;
      const lng = this.capturedGpsCoords ? this.capturedGpsCoords.longitude : this.CAMPUS_LNG;

      if (this.faceAuthMode === 'checkin') {
        const res = await API.staffCheckIn(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message || 'Check-In verified & recorded successfully!', 'success');
      } else {
        const res = await API.staffCheckOut(this.capturedFaceBase64, lat, lng);
        this.showToast(res.message || 'Check-Out verified & recorded successfully!', 'success');
      }

      this.closeFaceAuthModal();

      if (this.currentUser.role === 'staff') {
        await this.loadStaffDashboard();
      } else if (this.currentUser.role === 'hod') {
        await this.loadHodDashboard();
      } else if (this.currentUser.role === 'admin') {
        await this.loadAdminDashboard();
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span>✅ Confirm & Mark Attendance</span>';
      }
    }
  },

  closeFaceAuthModal() {
    const modal = document.getElementById('faceAuthModal');
    if (modal) modal.style.display = 'none';

    if (this.faceAuthStream) {
      this.faceAuthStream.getTracks().forEach(t => t.stop());
      this.faceAuthStream = null;
    }
  },

  // -------------------------------------------------------------
  // Dedicated HOD Dashboard (Department-Isolated)
  // -------------------------------------------------------------
  async loadHodDashboard() {
    try {
      const data = await API.getHodDashboard();
      if (data.hod) {
        this.currentUser = { ...this.currentUser, ...data.hod };
        localStorage.setItem(API.USER_KEY, JSON.stringify(this.currentUser));
      }
      const hod = this.currentUser || data.hod || {};

      const nameEl = document.getElementById('hodProfileName');
      const deptEl = document.getElementById('hodProfileDept');
      const photoEl = document.getElementById('hodProfilePhoto');

      if (nameEl) nameEl.textContent = hod.full_name || hod.username || 'Head of Department';
      if (deptEl && data.department) deptEl.textContent = `${data.department.name} (${data.department.code})`;
      if (photoEl && (hod.profile_photo || hod.photo_url)) {
        photoEl.src = hod.profile_photo || hod.photo_url;
      }

      const m = data.metrics || {};
      const totalStaffEl = document.getElementById('hodMetricTotalStaff');
      const presentEl = document.getElementById('hodMetricPresent');
      const absentEl = document.getElementById('hodMetricAbsent');
      const lateEl = document.getElementById('hodMetricLate');
      const workingEl = document.getElementById('hodMetricWorking');

      if (totalStaffEl) totalStaffEl.textContent = m.totalStaff ?? m.total_staff ?? 0;
      if (presentEl) presentEl.textContent = m.presentToday ?? m.present_today ?? 0;
      if (absentEl) absentEl.textContent = m.absentToday ?? m.absent_today ?? 0;
      if (lateEl) lateEl.textContent = m.lateToday ?? m.late_arrivals ?? 0;
      if (workingEl) workingEl.textContent = m.currentlyWorking ?? m.working_now ?? 0;

      const pendingLeaves = data.pendingLeaves || data.pending_leaves || [];
      const countEl = document.getElementById('hodPendingLeaveCount');
      if (countEl) countEl.textContent = pendingLeaves.length;

      this.renderHodStaffTable(data.staffList || data.department_staff || []);
      this.renderHodDutyTable(data.todayDutyLogs || data.today_duties || []);
      this.renderHodPendingLeaves(pendingLeaves);
      this.renderHodMonthlyReport(data.monthlyReport || data.monthly_report || []);
    } catch (err) {
      this.showToast('Failed to load HOD dashboard: ' + err.message, 'error');
    }
  },

  switchHodSubTab(tab) {
    this.hodCurrentTab = tab;
    this.hideAllViews();
    const hodView = document.getElementById('hodDashboardView');
    if (hodView) hodView.style.display = 'block';
    this.setActiveNavTab(tab);

    ['attendance', 'duty', 'leaves', 'monthly'].forEach(t => {
      const el = document.getElementById('hodSubTab' + t.charAt(0).toUpperCase() + t.slice(1));
      const btn = document.getElementById('hodTabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
      if (btn) {
        if (t === tab) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
  },

  renderHodStaffTable(staffList) {
    const tbody = document.getElementById('hodStaffAttendanceTableBody');
    if (!tbody) return;

    if (!staffList || staffList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No staff registered in this department yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = staffList.map(s => {
      const st = s.status || s.attendance_status || (s.check_in_time ? 'present' : 'not_checked_in');
      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <img src="${s.profile_photo || s.photo_url || '/icons/college-logo.png'}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; border:1.5px solid #B91C1C;">
              <div>
                <strong>${this.escapeHtml(s.full_name)}</strong><br>
                <span style="font-size:11px; color:#64748B;">Staff ID: ${this.escapeHtml(s.username)}</span>
              </div>
            </div>
          </td>
          <td>${this.escapeHtml(s.designation || 'Assistant Professor')}</td>
          <td>${s.check_in_time ? this.formatTime(s.check_in_time) : '<span style="color:#94A3B8;">--:--</span>'}</td>
          <td>${s.check_out_time ? this.formatTime(s.check_out_time) : '<span style="color:#94A3B8;">--:--</span>'}</td>
          <td style="font-size:11px;">
            ${s.check_in_gps_verified ? '<span style="color:#059669;">✓ 100m Campus</span>' : '<span style="color:#94A3B8;">Pending</span>'}
          </td>
          <td style="font-size:11px;">
            ${s.check_in_face_verified ? '<span style="color:#059669;">✓ Verified</span>' : '<span style="color:#94A3B8;">Pending</span>'}
          </td>
          <td>
            ${s.check_in_time ?
              `<span class="status-badge status-present">${this.escapeHtml(st.toUpperCase())}</span>` :
              `<span class="status-badge status-pending">NOT CHECKED IN</span>`}
          </td>
        </tr>
      `;
    }).join('');
  },

  renderHodDutyTable(duties) {
    const tbody = document.getElementById('hodDutyLogsTableBody');
    if (!tbody) return;

    if (!duties || duties.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:#64748B;">No class duties recorded in this department today yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = duties.map(d => {
      const photo = d.photo_proof || d.lesson_photo;
      const cacheKey = photo ? this.cachePhoto(`hod_duty_${d.id}`, photo, 'Classroom Photo Proof', `Staff: ${this.escapeHtml(d.staff_name)} • ${this.escapeHtml(d.subject_name || '')}`) : null;
      return `
        <tr>
          <td><span class="role-tag" style="background:#B91C1C; color:#fff;">Period ${d.period_number}</span></td>
          <td><strong>${this.escapeHtml(d.staff_name)}</strong></td>
          <td>${this.escapeHtml(d.class_name || '-')}</td>
          <td><strong>${this.escapeHtml(d.subject_name || '-')}</strong></td>
          <td style="font-size:12px;">
            <strong>${this.escapeHtml(d.lesson_topic || '')}</strong><br>
            <span style="color:#64748B;">${this.escapeHtml(d.lesson_summary || '')}</span>
          </td>
          <td>
            ${cacheKey ? `
              <button class="btn btn-outline btn-sm" onclick="App.openCachedPhoto('${cacheKey}')">
                <span>📷 Proof</span>
              </button>
            ` : '<span style="color:#94A3B8; font-size:11px;">No photo</span>'}
          </td>
        </tr>
      `;
    }).join('');
  },

  renderHodPendingLeaves(leaves) {
    const tbody = document.getElementById('hodPendingLeavesTableBody');
    if (!tbody) return;

    if (!leaves || leaves.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:#64748B;">No pending leave applications.</td></tr>`;
      return;
    }

    tbody.innerHTML = leaves.map(l => {
      this._leaveCache[l.id] = l;
      return `
        <tr>
          <td><strong>${this.escapeHtml(l.staff_name)}</strong><br><span style="font-size:11px; color:#64748B;">${this.escapeHtml(l.staff_username || l.designation || '')}</span></td>
          <td><span class="role-tag" style="background:#2563EB; color:#fff;">${this.escapeHtml(l.leave_type.toUpperCase())}</span></td>
          <td>${l.from_date}</td>
          <td>${l.to_date}</td>
          <td style="font-size:12px;">${this.escapeHtml(l.reason)}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="App.openReviewLeaveById(${l.id})">
              <span>⚖️ Review</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderHodMonthlyReport(reports) {
    const tbody = document.getElementById('hodMonthlyReportTableBody');
    if (!tbody) return;

    if (!reports || reports.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No records available.</td></tr>`;
      return;
    }

    tbody.innerHTML = reports.map(r => `
      <tr>
        <td><strong>${this.escapeHtml(r.full_name)}</strong></td>
        <td>${this.escapeHtml(r.designation || 'Faculty')}</td>
        <td style="color:#059669; font-weight:700;">${r.present_days} days</td>
        <td style="color:#DC2626; font-weight:700;">${r.absent_days} days</td>
        <td style="color:#D97706; font-weight:700;">${r.late_days}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="flex:1; background:#F1F5F9; border-radius:6px; height:8px; overflow:hidden;">
              <div style="width:${r.attendance_rate}%; background:#059669; height:100%;"></div>
            </div>
            <strong style="font-size:12px;">${r.attendance_rate}%</strong>
          </div>
        </td>
      </tr>
    `).join('');
  },

  // -------------------------------------------------------------
  // Master Admin Dashboard (Parallel Load + 8 Exact Metrics)
  // -------------------------------------------------------------
  async loadAdminDashboard() {
    try {
      const [data, usersRes, acadRes] = await Promise.all([
        API.getAdminDashboard(),
        API.getAdminUsers().catch(() => ({ users: [] })),
        API.getAcademicStructure().catch(() => ({ departments: [], classes: [] }))
      ]);

      const st = data.stats || {};
      const setMetric = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? 0;
      };

      setMetric('adminMetricTotalStaff', st.totalStaff ?? st.total_staff ?? 0);
      setMetric('adminMetricTotalHods', st.totalHods ?? st.total_hods ?? 0);
      setMetric('adminMetricPresentToday', st.presentToday ?? st.present_today ?? 0);
      setMetric('adminMetricAbsentToday', st.absentToday ?? st.absent_today ?? 0);
      setMetric('adminMetricLateArrivals', st.lateArrivals ?? st.late_arrivals ?? 0);
      setMetric('adminMetricOnLeave', st.onLeave ?? st.on_leave ?? 0);
      setMetric('adminMetricNotCheckedIn', st.notCheckedIn ?? st.not_checked_in ?? 0);
      setMetric('adminMetricWorkingNow', st.staffCurrentlyWorking ?? st.currently_working ?? 0);

      this.adminCheckInsCache = data.staffCheckIns || data.staff_attendance_today || [];
      this.renderAdminTodayStaff(this.adminCheckInsCache);
      this.renderAdminRecentActivities(data.recentActivities || data.recent_activities || []);

      // Users & Academic Caches populated cleanly in 1 roundtrip
      this.adminUsersCache = usersRes.users || [];
      this.filterAdminUsers();

      this.departmentsCache = acadRes.departments || [];
      this.classesCache = acadRes.classes || [];
      const newUserDept = document.getElementById('newUserDept');
      if (newUserDept && this.departmentsCache.length > 0) {
        newUserDept.innerHTML = this.departmentsCache.map(d => `<option value="${d.id}">${this.escapeHtml(d.name)}</option>`).join('');
      }
      const adminFilterDept = document.getElementById('adminFilterDutyDept');
      if (adminFilterDept && this.departmentsCache.length > 0) {
        adminFilterDept.innerHTML = '<option value="">All Departments</option>' +
          this.departmentsCache.map(d => `<option value="${d.id}">${this.escapeHtml(d.name)}</option>`).join('');
      }
    } catch (err) {
      this.showToast('Failed to load admin dashboard: ' + err.message, 'error');
    }
  },

  adminQuickAction(key) {
    if (key === 'users_staff') {
      this.switchAdminTab('users');
      const search = document.getElementById('adminUserSearchInput');
      if (search) { search.value = ''; this.filterAdminUsers(); }
    } else if (key === 'users_hod') {
      this.switchAdminTab('users');
      const search = document.getElementById('adminUserSearchInput');
      if (search) { search.value = 'hod'; this.filterAdminUsers(); }
    } else if (key === 'attendance') {
      this.switchAdminTab('overview');
    } else if (key === 'depts') {
      this.switchAdminTab('academics');
    } else if (key === 'duty') {
      this.switchAdminTab('periodlogs');
    } else if (key === 'leaves') {
      this.switchAdminTab('leaves');
    } else if (key === 'reports' || key === 'analytics') {
      this.switchAdminTab('reports');
    } else if (key === 'notifications') {
      this.switchAdminTab('broadcast');
    } else if (key === 'settings') {
      this.switchAdminTab('settings');
    }
  },

  switchAdminTab(tab) {
    this.adminCurrentTab = tab;
    this.hideAllViews();
    const adminView = document.getElementById('adminDashboardView');
    if (adminView) adminView.style.display = 'block';
    this.setActiveNavTab(tab);

    const subViews = ['overview', 'users', 'periodlogs', 'leaves', 'reports', 'academics', 'settings', 'broadcast', 'audit'];
    subViews.forEach(t => {
      const el = document.getElementById('adminTab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });

    if (tab === 'periodlogs') this.loadAdminPeriodLogs();
    else if (tab === 'leaves') this.loadAdminLeaves();
    else if (tab === 'academics') this.loadAdminAcademics();
    else if (tab === 'audit') this.loadAdminAuditLogs();
    else if (tab === 'reports') this.renderAnalyticsCanvas();
  },

  renderAdminTodayStaff(logs) {
    const tbody = document.getElementById('adminStaffCheckInBody');
    if (!tbody) return;

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No faculty check-ins recorded yet today.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const st = l.status || (l.check_in_time ? 'present' : 'not_checked_in');
      const badgeCls = l.check_in_time ? 'status-present' : 'status-pending';
      return `
        <tr>
          <td>
            <strong>${this.escapeHtml(l.full_name)}</strong><br>
            <span style="font-size:11px; color:#64748B;">Staff ID: ${this.escapeHtml(l.username || '-')}</span>
          </td>
          <td><span class="role-tag" style="background:${l.role === 'hod' ? '#B91C1C' : '#475569'};">${this.escapeHtml((l.role || 'staff').toUpperCase())}</span></td>
          <td>${this.escapeHtml(l.department_name || '-')}</td>
          <td>${l.check_in_time ? this.formatTime(l.check_in_time) : '-'}</td>
          <td>${l.check_out_time ? this.formatTime(l.check_out_time) : '-'}</td>
          <td style="font-size:11px; color:${l.check_in_gps_verified ? '#059669' : '#64748B'};">
            ${l.check_in_gps_verified ? '✓ 100m GPS' : 'GPS Pending'} • ${l.check_in_face_verified ? '✓ Face' : 'Face Pending'}
          </td>
          <td><span class="status-badge ${badgeCls}">${this.escapeHtml(st.replace(/_/g, ' ').toUpperCase())}</span></td>
        </tr>
      `;
    }).join('');
  },

  renderAdminRecentActivities(activities) {
    const container = document.getElementById('adminRecentActivitiesTimeline');
    if (!container) return;

    if (!activities || activities.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:12px; color:#64748B;">No recent activities logged today.</div>`;
      return;
    }

    container.innerHTML = activities.map(act => `
      <div class="activity-item">
        <div class="activity-icon-badge">${act.icon || '📌'}</div>
        <div class="activity-content">
          <div class="activity-text">
            <strong>${this.escapeHtml(act.title || act.user_name || 'Activity')}</strong>
            ${act.description ? `<div style="font-weight:400; color:#475569; margin-top:2px;">${this.escapeHtml(act.description)}</div>` : ''}
          </div>
          <div class="activity-time">${this.escapeHtml(act.timestamp || act.time || act.created_at || '')}</div>
        </div>
      </div>
    `).join('');
  },

  async loadAdminUsers() {
    try {
      const res = await API.getAdminUsers();
      this.adminUsersCache = res.users || [];
      this.filterAdminUsers();
    } catch (e) {}
  },

  filterAdminUsers() {
    const search = (document.getElementById('adminUserSearchInput') || {}).value || '';
    const q = search.toLowerCase();
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    const filtered = (this.adminUsersCache || []).filter(u => {
      if (u.role === 'admin' || u.role === 'student') return false;
      return (u.full_name || '').toLowerCase().includes(q) ||
             (u.username || '').toLowerCase().includes(q) ||
             (u.department_name || '').toLowerCase().includes(q) ||
             (u.role || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No matching faculty found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => `
      <tr>
        <td>
          <img src="${u.profile_photo || u.photo_url || '/icons/college-logo.png'}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:1.5px solid #B91C1C;">
        </td>
        <td><strong>${this.escapeHtml(u.username)}</strong></td>
        <td><strong>${this.escapeHtml(u.full_name)}</strong><br><span style="font-size:11px; color:#64748B;">${this.escapeHtml(u.designation || 'Faculty')}</span></td>
        <td><span class="role-tag" style="background:${u.role === 'hod' ? '#B91C1C' : '#475569'};">${this.escapeHtml(u.role.toUpperCase())}</span></td>
        <td>${this.escapeHtml(u.department_name || '-')}</td>
        <td style="font-size:12px;">${this.escapeHtml(u.phone || '-')}</td>
        <td><span class="status-badge status-present">ACTIVE</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline btn-sm" onclick="App.adminPromptResetPassword(${u.id}, '${this.escapeHtml(u.username)}')" title="Reset Password">
              <span>🔑 Reset</span>
            </button>
            <button class="btn btn-danger btn-sm" onclick="App.handleDeleteUser(${u.id}, '${this.escapeHtml(u.full_name)}')" title="Remove Profile">
              <span>🗑️</span>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  adminPromptResetPassword(userId, username) {
    const newPass = prompt(`Enter new password for faculty "${username}" (min 6 chars):`, 'kcas123');
    if (!newPass || !newPass.trim()) return;

    API.adminResetPassword(userId, newPass.trim())
      .then(res => this.showToast(res.message || 'Password reset successfully!', 'success'))
      .catch(err => this.showToast(err.message, 'error'));
  },

  async handleDeleteUser(userId, name) {
    if (!confirm(`Are you sure you want to permanently remove faculty profile: ${name}?`)) return;

    try {
      await API.deleteAdminUser(userId);
      this.showToast(`Faculty profile ${name} removed.`, 'success');
      await this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openCreateUserModal() {
    if (this.departmentsCache.length > 0) {
      const newUserDept = document.getElementById('newUserDept');
      if (newUserDept) {
        newUserDept.innerHTML = this.departmentsCache.map(d => `<option value="${d.id}">${this.escapeHtml(d.name)}</option>`).join('');
      }
    }
    const modal = document.getElementById('createUserModal');
    if (modal) modal.style.display = 'flex';
  },

  closeCreateUserModal() {
    const modal = document.getElementById('createUserModal');
    if (modal) modal.style.display = 'none';
  },

  handleNewUserRoleChange() {
    const role = document.getElementById('newUserRole').value;
    const desigSelect = document.getElementById('newDesignation');
    if (desigSelect) {
      desigSelect.value = role === 'hod' ? 'Head of Department (HOD)' : 'Assistant Professor';
    }
  },

  async handleUserPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const compressed = await this.compressImage(file, 480, 0.72);
      this.newUserPhotoBase64 = compressed;
      const preview = document.getElementById('newUserPhotoPreview');
      const img = document.getElementById('newUserPhotoImg');
      if (img) img.src = compressed;
      if (preview) preview.style.display = 'block';
    } catch (err) {
      this.showToast('Failed to compress profile photo', 'error');
    }
  },

  async handleCreateUser(e) {
    if (e && e.preventDefault) e.preventDefault();

    const role = document.getElementById('newUserRole').value;
    const fullName = document.getElementById('newFullName').value.trim();
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value.trim();
    const phone = document.getElementById('newPhone').value.trim();
    const designation = document.getElementById('newDesignation').value;
    const deptId = document.getElementById('newUserDept').value;
    const email = document.getElementById('newEmail').value.trim();
    const address = document.getElementById('newAddress').value.trim();

    try {
      await API.createAdminUser({
        role,
        fullName,
        username,
        password,
        phone,
        designation,
        departmentId: deptId ? parseInt(deptId, 10) : null,
        email,
        address,
        photoUrl: this.newUserPhotoBase64 || null
      });

      this.showToast(`Faculty profile for ${fullName} registered successfully!`, 'success');
      this.closeCreateUserModal();
      document.getElementById('createUserForm').reset();
      const preview = document.getElementById('newUserPhotoPreview');
      if (preview) preview.style.display = 'none';
      this.newUserPhotoBase64 = null;
      await this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAdminPeriodLogs() {
    try {
      const date = (document.getElementById('adminFilterDutyDate') || {}).value;
      const deptVal = (document.getElementById('adminFilterDutyDept') || {}).value;
      const period = (document.getElementById('adminFilterDutyPeriod') || {}).value;

      const params = {};
      if (date) params.date = date;
      if (deptVal) params.department_id = deptVal;
      if (period) params.period = period;

      const res = await API.getAdminPeriodLogs(params);
      const tbody = document.getElementById('adminPeriodLogsTableBody');
      if (!tbody) return;

      if (!res.logs || res.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:#64748B;">No class duties found matching the filter criteria.</td></tr>`;
        return;
      }

      tbody.innerHTML = res.logs.map(log => {
        const photo = log.photo_proof || log.lesson_photo;
        const cacheKey = photo ? this.cachePhoto(`adm_duty_${log.id}`, photo, 'Classroom Photo Proof', `Staff: ${this.escapeHtml(log.staff_name)} • ${this.escapeHtml(log.subject_name || '')}`) : null;
        return `
          <tr>
            <td>
              <strong>Period ${log.period_number}</strong><br>
              <span style="font-size:11px; color:#64748B;">${log.duty_date || log.date}</span>
            </td>
            <td><strong>${this.escapeHtml(log.staff_name)}</strong></td>
            <td>${this.escapeHtml(log.department_name || '-')}</td>
            <td>${this.escapeHtml(log.class_name || '-')}</td>
            <td><strong>${this.escapeHtml(log.subject_name || '-')}</strong></td>
            <td style="font-size:12px;">
              <strong>${this.escapeHtml(log.lesson_topic || '')}</strong><br>
              <span style="color:#64748B;">${this.escapeHtml(log.lesson_summary || '')}</span>
            </td>
            <td>
              ${cacheKey ? `
                <button class="btn btn-outline btn-sm" onclick="App.openCachedPhoto('${cacheKey}')">
                  <span>📷 View Photo</span>
                </button>
              ` : '<span style="color:#94A3B8; font-size:11px;">No photo</span>'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {}
  },

  async loadAdminLeaves() {
    try {
      const res = await API.getPendingLeaves();
      const tbody = document.getElementById('adminLeavesTableBody');
      if (!tbody) return;

      const leaves = res.leaves || res.pendingLeaves || [];
      if (leaves.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:16px; color:#64748B;">No leave requests pending.</td></tr>`;
        return;
      }

      tbody.innerHTML = leaves.map(l => {
        this._leaveCache[l.id] = l;
        return `
          <tr>
            <td><strong>${this.escapeHtml(l.staff_name)}</strong></td>
            <td><span class="role-tag" style="background:#475569;">${this.escapeHtml((l.role || 'staff').toUpperCase())}</span> ${this.escapeHtml(l.department_name || '')}</td>
            <td><span class="role-tag" style="background:#2563EB; color:#fff;">${this.escapeHtml(l.leave_type.toUpperCase())}</span></td>
            <td>${l.from_date}</td>
            <td>${l.to_date}</td>
            <td style="font-size:12px;">${this.escapeHtml(l.reason)}</td>
            <td><span class="status-badge status-pending">${this.escapeHtml(l.status.toUpperCase())}</span></td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="App.openReviewLeaveById(${l.id})">
                <span>⚖️ Review</span>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {}
  },

  async loadAdminAcademics() {
    try {
      let depts = this.departmentsCache;
      let classes = this.classesCache;
      if (!depts || depts.length === 0) {
        const res = await API.getAcademicStructure();
        depts = res.departments || [];
        classes = res.classes || [];
        this.departmentsCache = depts;
        this.classesCache = classes;
      }
      const tbody = document.getElementById('adminAcademicsClassBody');
      if (!tbody) return;

      tbody.innerHTML = depts.map(d => {
        const classCount = classes.filter(c => c.department_id === d.id).length;
        return `
          <tr>
            <td><strong>#${d.id}</strong></td>
            <td><strong>${this.escapeHtml(d.name)}</strong></td>
            <td><span class="role-tag" style="background:#B91C1C; color:#fff;">${this.escapeHtml(d.code)}</span></td>
            <td><strong>${classCount} Classes Active</strong></td>
          </tr>
        `;
      }).join('');
    } catch (e) {}
  },

  async loadAdminAuditLogs() {
    try {
      const res = await API.getAuditLogs();
      const tbody = document.getElementById('adminAuditLogsTableBody');
      if (!tbody) return;

      tbody.innerHTML = (res.logs || []).map(l => `
        <tr>
          <td style="font-size:11px; white-space:nowrap;">${l.created_at}</td>
          <td><strong>${this.escapeHtml(l.username || 'System')}</strong></td>
          <td><span class="role-tag" style="background:#475569;">${this.escapeHtml(l.action)}</span></td>
          <td>${this.escapeHtml(l.entity_type)} #${this.escapeHtml(l.entity_id)}</td>
          <td style="font-size:12px;">${this.escapeHtml(l.details)}</td>
          <td style="font-size:11px; color:#64748B;">${this.escapeHtml(l.ip_address)}</td>
        </tr>
      `).join('');
    } catch (e) {}
  },

  // -------------------------------------------------------------
  // Leave Management (Apply & Review)
  // -------------------------------------------------------------
  openApplyLeaveModal() {
    const modal = document.getElementById('applyLeaveModal');
    if (modal) modal.style.display = 'flex';
  },

  closeApplyLeaveModal() {
    const modal = document.getElementById('applyLeaveModal');
    if (modal) modal.style.display = 'none';
  },

  async handleApplyLeave(e) {
    if (e && e.preventDefault) e.preventDefault();

    const leaveType = document.getElementById('leaveTypeSelect').value;
    const fromDate = document.getElementById('leaveFromDate').value;
    const toDate = document.getElementById('leaveToDate').value;
    const reason = document.getElementById('leaveReasonInput').value.trim();

    if (!leaveType || !fromDate || !toDate || !reason) {
      this.showToast('Please fill all leave fields', 'error');
      return;
    }

    const d1 = new Date(fromDate);
    const d2 = new Date(toDate);
    if (d2 < d1) {
      this.showToast('To Date must be on or after From Date', 'error');
      return;
    }
    const totalDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);

    try {
      await API.applyLeave({
        leaveType,
        fromDate,
        toDate,
        totalDays,
        reason
      });

      this.showToast('Leave application submitted for approval!', 'success');
      this.closeApplyLeaveModal();
      document.getElementById('applyLeaveForm').reset();
      await this.loadStaffDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openReviewLeaveById(leaveId) {
    const l = this._leaveCache[leaveId];
    if (!l) return;
    this.openReviewLeaveModal(
      l.id,
      l.staff_name,
      l.leave_type.toUpperCase(),
      `${l.from_date} to ${l.to_date}`,
      l.reason,
      l.department_name || l.designation || 'Faculty'
    );
  },

  openReviewLeaveModal(leaveId, staffName, type, dates, reason, roleDept) {
    this.selectedLeaveId = leaveId;
    const modal = document.getElementById('reviewLeaveModal');
    if (!modal) return;

    document.getElementById('reviewLeaveId').value = leaveId;
    document.getElementById('reviewLeaveStaffName').textContent = staffName;
    document.getElementById('reviewLeaveRoleDept').textContent = roleDept;
    document.getElementById('reviewLeaveType').textContent = type;
    document.getElementById('reviewLeaveDates').textContent = dates;
    document.getElementById('reviewLeaveReason').textContent = reason;

    modal.style.display = 'flex';
  },

  closeReviewLeaveModal() {
    const modal = document.getElementById('reviewLeaveModal');
    if (modal) modal.style.display = 'none';
    this.selectedLeaveId = null;
  },

  async handleSubmitLeaveReview(e) {
    if (e && e.preventDefault) e.preventDefault();

    const leaveId = document.getElementById('reviewLeaveId').value;
    const status = document.getElementById('reviewLeaveStatusSelect').value;
    const remarks = document.getElementById('reviewLeaveRemarks').value.trim();

    try {
      await API.reviewLeave(leaveId, status, remarks);
      this.showToast(`Leave application ${status} successfully.`, 'success');
      this.closeReviewLeaveModal();
      document.getElementById('reviewLeaveForm').reset();

      if (this.currentUser.role === 'hod') {
        await this.loadHodDashboard();
      } else if (this.currentUser.role === 'admin') {
        await Promise.all([this.loadAdminLeaves(), this.loadAdminDashboard()]);
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // -------------------------------------------------------------
  // More & Settings Section (10 Structured Sections)
  // -------------------------------------------------------------
  openMoreSettings() {
    this.hideAllViews();
    const moreView = document.getElementById('moreSettingsView');
    if (moreView) moreView.style.display = 'block';
    this.setActiveNavTab('more');

    if (this.currentUser) {
      const nameEl = document.getElementById('settingsProfileName');
      const desigEl = document.getElementById('settingsProfileDesig');
      const deptEl = document.getElementById('settingsProfileDept');
      const photoEl = document.getElementById('settingsProfilePhoto');

      if (nameEl) nameEl.textContent = this.currentUser.full_name || this.currentUser.username;
      if (desigEl) desigEl.textContent = `${this.currentUser.designation || 'Faculty'} • Staff ID: ${this.currentUser.username}`;
      if (deptEl) deptEl.textContent = `${this.currentUser.department_name || 'KCAS Karur'} • PIN 621301`;
      if (photoEl && (this.currentUser.profile_photo || this.currentUser.photo_url)) {
        photoEl.src = this.currentUser.profile_photo || this.currentUser.photo_url;
      }
    }
  },

  openProfileModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.style.display = 'flex';
  },

  closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.style.display = 'none';
  },

  async handleChangePasswordSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const oldPass = document.getElementById('oldPasswordInput').value;
    const newPass = document.getElementById('newPasswordInput').value;
    const confirmPass = document.getElementById('confirmPasswordInput').value;

    if (newPass !== confirmPass) {
      this.showToast('New passwords do not match!', 'error');
      return;
    }

    try {
      const res = await API.changePassword(oldPass, newPass);
      this.showToast(res.message || 'Password updated successfully!', 'success');
      this.closeChangePasswordModal();
      document.getElementById('changePasswordForm').reset();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async openNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;
    modal.style.display = 'flex';

    try {
      const res = await API.getNotifications();
      const listContainer = document.getElementById('notificationsListContainer');
      if (!listContainer) return;

      if (!res.notifications || res.notifications.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:16px; color:#64748B;">No notifications available.</div>`;
        return;
      }

      listContainer.innerHTML = res.notifications.map(n => `
        <div style="background:${n.is_read ? '#FFFFFF' : '#FEF2F2'}; border:1px solid ${n.is_read ? '#E2E8F0' : '#FECDD3'}; border-radius:10px; padding:12px; position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color:#B91C1C; font-size:13px;">${this.escapeHtml(n.title)}</strong>
            <span style="font-size:10px; color:#64748B;">${n.created_at}</span>
          </div>
          <p style="font-size:12px; color:#0F172A; margin:0;">${this.escapeHtml(n.message)}</p>
        </div>
      `).join('');

      await this.loadNotificationsCount();
    } catch (e) {}
  },

  closeNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'none';
  },

  async markAllNotificationsRead() {
    try {
      await API.markNotificationRead(null);
      this.showToast('All notifications marked as read', 'success');
      await this.openNotificationsModal();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openAboutUsModal() {
    const modal = document.getElementById('aboutUsModal');
    if (modal) modal.style.display = 'flex';
  },

  closeAboutUsModal() {
    const modal = document.getElementById('aboutUsModal');
    if (modal) modal.style.display = 'none';
  },

  triggerShareApp() {
    const shareData = {
      title: 'KCAS Attendance Management System',
      text: 'Download official KCAS Faculty Attendance Application (Krishna College of Arts and Science, Karur 621301):',
      url: 'https://kcas-attendance.onrender.com'
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareData.text + ' ' + shareData.url)}`;
      window.open(waUrl, '_blank');
    }
  },

  openRateAppModal() {
    const modal = document.getElementById('rateAppModal');
    if (modal) modal.style.display = 'flex';
  },

  closeRateAppModal() {
    const modal = document.getElementById('rateAppModal');
    if (modal) modal.style.display = 'none';
  },

  setAppRating(num) {
    this.selectedRating = num;
    const stars = document.querySelectorAll('#starRatingBox span');
    stars.forEach((s, idx) => {
      if (idx < num) s.classList.add('active');
      else s.classList.remove('active');
    });
  },

  submitAppRating() {
    this.showToast(`Thank you for rating KCAS Attendance ${this.selectedRating} Stars!`, 'success');
    this.closeRateAppModal();
  },

  openAppInfoModal() {
    const modal = document.getElementById('appInfoModal');
    if (modal) modal.style.display = 'flex';
  },

  closeAppInfoModal() {
    const modal = document.getElementById('appInfoModal');
    if (modal) modal.style.display = 'none';
  },

  openPrivacyPolicyModal() {
    const modal = document.getElementById('privacyPolicyModal');
    if (modal) modal.style.display = 'flex';
  },

  closePrivacyPolicyModal() {
    const modal = document.getElementById('privacyPolicyModal');
    if (modal) modal.style.display = 'none';
  },

  openTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) modal.style.display = 'flex';
  },

  closeTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) modal.style.display = 'none';
  },

  openHelpSupportModal() {
    const modal = document.getElementById('helpSupportModal');
    if (modal) modal.style.display = 'flex';
  },

  closeHelpSupportModal() {
    const modal = document.getElementById('helpSupportModal');
    if (modal) modal.style.display = 'none';
  },

  // -------------------------------------------------------------
  // Reports & Analytics Export (Real Authenticated Server Export)
  // -------------------------------------------------------------
  handleReportTypeChange() {
    this.renderAnalyticsCanvas();
  },

  async exportAttendanceCsv() {
    try {
      const month = (document.getElementById('adminReportMonthInput') || {}).value || '';
      const url = API.getExportReportUrl('csv', month ? { month } : {});
      const token = API.getToken();

      const resp = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!resp.ok) throw new Error('Report export failed');
      const blob = await resp.blob();
      const dlUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = dlUrl;
      link.download = `KCAS_Attendance_Report_${new Date().toISOString().substring(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(dlUrl);
      this.showToast('Attendance report exported to CSV successfully.', 'success');
    } catch (err) {
      this.showToast(err.message || 'Export failed', 'error');
    }
  },

  printAttendanceReport() {
    window.print();
  },

  renderAnalyticsCanvas() {
    const canvas = document.getElementById('adminAnalyticsCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const st = this.adminCheckInsCache || [];
    const total = Math.max(1, st.length);
    const present = st.filter(s => s.check_in_time).length;
    const gpsOk = st.filter(s => s.check_in_gps_verified).length;
    const faceOk = st.filter(s => s.check_in_face_verified).length;
    const checkedOut = st.filter(s => s.check_out_time).length;

    const metrics = [
      { label: 'Total Faculty', val: total, pct: 100 },
      { label: 'Present Today', val: present, pct: Math.round((present / total) * 100) },
      { label: 'GPS Verified', val: gpsOk, pct: Math.round((gpsOk / total) * 100) },
      { label: 'Face Match', val: faceOk, pct: Math.round((faceOk / total) * 100) },
      { label: 'Checked Out', val: checkedOut, pct: Math.round((checkedOut / total) * 100) }
    ];

    const barWidth = 52;
    const gap = 52;
    const startX = 48;
    const baseY = 160;
    ctx.font = '11px sans-serif';

    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      const x = startX + i * (barWidth + gap);
      const h = Math.max(6, m.pct * 1.15);
      const y = baseY - h;

      ctx.fillStyle = '#B91C1C';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barWidth, h, [6, 6, 0, 0]);
      else ctx.rect(x, y, barWidth, h);
      ctx.fill();

      ctx.fillStyle = '#0F172A';
      ctx.fillText(`${m.val} (${m.pct}%)`, x + 2, y - 6);

      ctx.fillStyle = '#64748B';
      ctx.fillText(m.label, x - 4, baseY + 18);
    }
  },

  // -------------------------------------------------------------
  // Lightbox & Modal Helpers
  // -------------------------------------------------------------
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
  },

  openCsvImportModal() {
    const modal = document.getElementById('csvImportModal');
    if (modal) modal.style.display = 'flex';
  },

  closeCsvImportModal() {
    const modal = document.getElementById('csvImportModal');
    if (modal) modal.style.display = 'none';
  },

  handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const textInput = document.getElementById('csvTextInput');
      if (textInput) textInput.value = evt.target.result;
    };
    reader.readAsText(file);
  },

  async submitCsvImport() {
    const textInput = document.getElementById('csvTextInput');
    const csvData = textInput ? textInput.value.trim() : '';

    if (!csvData) {
      this.showToast('Please provide CSV data to import', 'error');
      return;
    }

    try {
      const res = await API.importUsersCsv(csvData, 'staff');
      this.showToast(res.message || 'CSV import processed!', 'success');
      this.closeCsvImportModal();
      await this.loadAdminDashboard();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleSendBroadcast(e) {
    if (e && e.preventDefault) e.preventDefault();

    const title = document.getElementById('broadcastTitleInput').value.trim();
    const message = document.getElementById('broadcastMessageInput').value.trim();
    const targetRole = document.getElementById('broadcastTargetSelect').value;

    if (!title || !message) {
      this.showToast('Please provide broadcast title and message', 'error');
      return;
    }

    try {
      await API.broadcastNotification({
        title,
        message,
        targetRole
      });

      this.showToast('Broadcast notification sent to all recipients!', 'success');
      document.getElementById('adminBroadcastForm').reset();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleSaveSettings(e) {
    if (e && e.preventDefault) e.preventDefault();

    const lat = document.getElementById('settingCampusLat').value;
    const lng = document.getElementById('settingCampusLng').value;
    const radius = document.getElementById('settingCampusRadius').value;

    try {
      await API.updateAdminSettings({
        campus_latitude: lat,
        campus_longitude: lng,
        campus_radius_meters: radius
      });

      this.showToast('Institution settings and campus geofence updated.', 'success');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
