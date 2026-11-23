// charts.js - Lightweight Pure SVG Visualizations for KCAS Attendance System
const KCASCharts = {
  /**
   * Render an interactive circular attendance percentage ring
   */
  renderAttendanceRing(containerId, percentage, size = 150, strokeWidth = 12, threshold = 75) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const validPct = Math.min(100, Math.max(0, percentage));
    const offset = circumference - (validPct / 100) * circumference;

    const isLow = validPct < threshold;
    const strokeColor = isLow ? '#DC2626' : '#059669';
    const bgTrackColor = '#FEE2E2';

    const svg = `
      <div style="position:relative; width:${size}px; height:${size}px; margin:0 auto;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle
            cx="${size/2}" cy="${size/2}" r="${radius}"
            fill="transparent"
            stroke="${bgTrackColor}"
            stroke-width="${strokeWidth}"
          />
          <circle
            cx="${size/2}" cy="${size/2}" r="${radius}"
            fill="transparent"
            stroke="${strokeColor}"
            stroke-width="${strokeWidth}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            transform="rotate(-90 ${size/2} ${size/2})"
            style="transition: stroke-dashoffset 1s ease-in-out;"
          />
        </svg>
        <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <span style="font-size:32px; font-weight:900; color:${strokeColor}; line-height:1;">${validPct}%</span>
          <span style="font-size:11px; font-weight:700; color:#64748B; text-transform:uppercase; margin-top:4px;">
            ${isLow ? '⚠️ Low Alert' : '✅ Good'}
          </span>
        </div>
      </div>
    `;
    el.innerHTML = svg;
  },

  /**
   * Render Subject Breakdown Progress Bars
   */
  renderSubjectBars(containerId, subjects, threshold = 75) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!subjects || subjects.length === 0) {
      el.innerHTML = '<p style="color:#64748B; font-size:13px; text-align:center;">No subject classes recorded yet.</p>';
      return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:14px;">';

    subjects.forEach(sub => {
      const isLow = sub.percentage < threshold;
      const barColor = isLow ? '#DC2626' : '#B91C1C';
      const badgeClass = isLow ? 'status-absent' : 'status-present';

      html += `
        <div style="background:#FFFFFF; border:1px solid #FECDD3; border-radius:10px; padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <strong style="font-size:13px; color:#0F172A;">${sub.subject_code}</strong>
              <span style="font-size:12px; color:#475569; margin-left:6px;">${sub.subject_name}</span>
            </div>
            <span class="status-badge ${badgeClass}">${sub.percentage}%</span>
          </div>
          <div style="width:100%; height:8px; background:#FEE2E2; border-radius:999px; overflow:hidden;">
            <div style="width:${sub.percentage}%; height:100%; background:${barColor}; border-radius:999px; transition:width 0.8s ease;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748B; margin-top:6px;">
            <span>Attended: <strong>${sub.attended_classes}</strong> / ${sub.total_classes}</span>
            <span>Missed: <strong>${sub.total_classes - sub.attended_classes}</strong></span>
          </div>
        </div>
      `;
    });

    html += '</div>';
    el.innerHTML = html;
  }
};

window.KCASCharts = KCASCharts;
