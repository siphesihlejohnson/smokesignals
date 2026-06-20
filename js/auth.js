'use strict';

const Auth = (() => {
  let _pinBuffer = '';
  let _selectedStaff = null;
  let _watchdogInterval = null;
  let _setupStep = 0;
  let _setupNewPin = '';

  // ─── SHA-256 ──────────────────────────────────────────────────────────────────
  async function hashPIN(pin) {
    const buf = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── Session ──────────────────────────────────────────────────────────────────
  function getSession() {
    return Data.lsGet(CONFIG.KEYS.SESSION);
  }
  function isLoggedIn() {
    const s = getSession();
    if (!s) return false;
    if (Date.now() > s.expiresAt) { logout(); return false; }
    return true;
  }
  function createSession(staff) {
    const settings = Data.getSettings();
    const timeout = (settings.sessionTimeout || CONFIG.SESSION_TIMEOUT_MINUTES) * 60 * 1000;
    const session = {
      staffId:    staff.id,
      staffName:  staff.name,
      role:       staff.role,
      loginTime:  Date.now(),
      lastActivity: Date.now(),
      expiresAt:  Date.now() + timeout,
    };
    Data.lsSet(CONFIG.KEYS.SESSION, session);
    return session;
  }
  function extendSession() {
    const s = getSession();
    if (!s) return;
    const settings = Data.getSettings();
    const timeout = (settings.sessionTimeout || CONFIG.SESSION_TIMEOUT_MINUTES) * 60 * 1000;
    s.lastActivity = Date.now();
    s.expiresAt = Date.now() + timeout;
    Data.lsSet(CONFIG.KEYS.SESSION, s);
  }
  function logout() {
    const s = getSession();
    if (s) Data.addAudit('LOGOUT', `${s.staffName} logged out`, s.staffId);
    Data.lsSet(CONFIG.KEYS.SESSION, null);
    if (_watchdogInterval) { clearInterval(_watchdogInterval); _watchdogInterval = null; }
    showLoginScreen();
  }
  function startWatchdog() {
    if (_watchdogInterval) clearInterval(_watchdogInterval);
    _watchdogInterval = setInterval(() => {
      if (isLoggedIn()) {
        extendSession();
      }
    }, 60000);
    document.addEventListener('click', extendSession, { passive: true });
    document.addEventListener('keydown', extendSession, { passive: true });
    document.addEventListener('touchstart', extendSession, { passive: true });
  }

  // ─── First Run ────────────────────────────────────────────────────────────────
  function isFirstRun() {
    return Data.getStaff().every(s => !s.pinHash);
  }

  // ─── Login Screen ─────────────────────────────────────────────────────────────
  function showLoginScreen() {
    document.getElementById('app-screen').classList.add('hidden');
    const screen = document.getElementById('login-screen');
    screen.classList.remove('hidden');

    if (!isFirstRun()) {
      renderLoginForm(screen);
      return;
    }

    // May be a new device — check Sheets for existing pinHashes before showing setup
    screen.innerHTML = `
      <div class="login-wrap">
        <div class="login-brand">
          <div class="brand-name">SMOKE SIGNALS</div>
          <div class="brand-sub">LOADING...</div>
        </div>
      </div>`;

    Data.fetchStaffFromSheets().then(() => {
      if (isFirstRun()) {
        renderSetupWizard(screen);
      } else {
        renderLoginForm(screen);
      }
    }).catch(() => {
      renderSetupWizard(screen);
    });
  }

  function renderLoginForm(container) {
    _pinBuffer = '';
    _selectedStaff = null;
    const staff = Data.getStaff().filter(s => s.active);

    container.innerHTML = `
      <div class="login-wrap">
        <div class="login-brand">
          <div class="brand-name">SMOKE SIGNALS</div>
          <div class="brand-sub">${Data.getSettings().branch || 'CAPE TOWN'}</div>
        </div>
        <div class="login-box">
          <div class="login-label">SELECT STAFF MEMBER</div>
          <div class="staff-selector" id="staff-selector">
            ${staff.map(s => `
              <button class="staff-btn" data-id="${s.id}">
                <span class="staff-name">${s.name}</span>
                <span class="staff-role">${s.role}</span>
              </button>
            `).join('')}
          </div>
          <div class="pin-label" id="pin-label">ENTER PIN</div>
          <div class="pin-dots" id="pin-dots">
            <span class="dot" id="dot-0">○</span>
            <span class="dot" id="dot-1">○</span>
            <span class="dot" id="dot-2">○</span>
            <span class="dot" id="dot-3">○</span>
          </div>
          <div id="login-msg" class="login-msg"></div>
          <div class="numpad" id="numpad">
            ${[1,2,3,4,5,6,7,8,9,'CLR',0,'DEL'].map(k => `
              <button class="num-btn" data-key="${k}">${k}</button>
            `).join('')}
          </div>
        </div>
        <div class="login-version">v${CONFIG.VERSION}</div>
      </div>
    `;

    container.querySelectorAll('.staff-btn').forEach(btn => {
      btn.addEventListener('click', () => selectStaff(btn.dataset.id));
    });
    container.querySelectorAll('.num-btn').forEach(btn => {
      btn.addEventListener('click', () => handleKey(btn.dataset.key));
    });
    document.addEventListener('keydown', _physicalKeyHandler);
  }

  function _physicalKeyHandler(e) {
    if (document.getElementById('login-screen').classList.contains('hidden')) {
      document.removeEventListener('keydown', _physicalKeyHandler);
      return;
    }
    if (e.key >= '0' && e.key <= '9') handleKey(e.key);
    else if (e.key === 'Backspace') handleKey('DEL');
    else if (e.key === 'Escape') handleKey('CLR');
    else if (e.key === 'Enter' && _pinBuffer.length === 4) submitPIN();
  }

  function selectStaff(id) {
    _selectedStaff = Data.getStaffById(id);
    _pinBuffer = '';
    updateDots();
    document.querySelectorAll('.staff-btn').forEach(b => b.classList.toggle('active', b.dataset.id === id));
    setMsg('');

    if (_selectedStaff && !_selectedStaff.pinHash) {
      setMsg('PIN not set. Contact admin.', 'warn');
    } else if (_selectedStaff && _selectedStaff.lockedUntil && Date.now() < _selectedStaff.lockedUntil) {
      const mins = Math.ceil((_selectedStaff.lockedUntil - Date.now()) / 60000);
      setMsg(`LOCKED. Try again in ${mins} min.`, 'error');
    }
  }

  function handleKey(k) {
    if (!_selectedStaff) { setMsg('Select a staff member first', 'warn'); return; }
    if (_selectedStaff.lockedUntil && Date.now() < _selectedStaff.lockedUntil) {
      const mins = Math.ceil((_selectedStaff.lockedUntil - Date.now()) / 60000);
      setMsg(`LOCKED. Try again in ${mins} min.`, 'error');
      return;
    }
    if (k === 'CLR') { _pinBuffer = ''; updateDots(); return; }
    if (k === 'DEL') { _pinBuffer = _pinBuffer.slice(0, -1); updateDots(); return; }
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += k;
    updateDots();
    if (_pinBuffer.length === 4) submitPIN();
  }

  async function submitPIN() {
    if (!_selectedStaff) return;
    if (_selectedStaff.lockedUntil && Date.now() < _selectedStaff.lockedUntil) return;
    if (!_selectedStaff.pinHash) { setMsg('No PIN set. Contact admin.', 'error'); _pinBuffer = ''; updateDots(); return; }

    const hashed = await hashPIN(_pinBuffer);
    if (hashed === _selectedStaff.pinHash) {
      Data.addAudit('LOGIN_SUCCESS', `${_selectedStaff.name} logged in`, _selectedStaff.id);
      Data.updateStaffMember({ id: _selectedStaff.id, failedAttempts: 0, lockedUntil: null, lastLogin: new Date().toISOString() });
      document.removeEventListener('keydown', _physicalKeyHandler);
      createSession(_selectedStaff);
      startWatchdog();
      UI.showApp();
    } else {
      const fails = (_selectedStaff.failedAttempts || 0) + 1;
      const lockUntil = fails >= CONFIG.MAX_FAILED_ATTEMPTS ? Date.now() + CONFIG.LOCKOUT_MINUTES * 60000 : null;
      Data.updateStaffMember({ id: _selectedStaff.id, failedAttempts: fails, lockedUntil: lockUntil });
      Data.addAudit('LOGIN_FAIL', `Failed PIN attempt for ${_selectedStaff.name} (${fails})`, 'SYSTEM');
      _selectedStaff = Data.getStaffById(_selectedStaff.id);

      _pinBuffer = '';
      updateDots();
      shakeDots();

      if (lockUntil) {
        setMsg(`${CONFIG.MAX_FAILED_ATTEMPTS} failed attempts. Account locked for ${CONFIG.LOCKOUT_MINUTES} minutes.`, 'error');
      } else {
        setMsg(`Wrong PIN. ${CONFIG.MAX_FAILED_ATTEMPTS - fails} attempt(s) remaining.`, 'error');
      }
    }
  }

  function updateDots() {
    for (let i = 0; i < 4; i++) {
      const d = document.getElementById(`dot-${i}`);
      if (d) d.textContent = i < _pinBuffer.length ? '◉' : '○';
    }
  }

  function shakeDots() {
    const dots = document.getElementById('pin-dots');
    if (!dots) return;
    dots.classList.add('shake');
    dots.addEventListener('animationend', () => dots.classList.remove('shake'), { once: true });
  }

  function setMsg(msg, type = '') {
    const el = document.getElementById('login-msg');
    if (el) { el.textContent = msg; el.className = `login-msg ${type}`; }
  }

  // ─── Setup Wizard ─────────────────────────────────────────────────────────────
  function renderSetupWizard(container) {
    _setupStep = 0;
    _setupNewPin = '';

    container.innerHTML = `
      <div class="login-wrap">
        <div class="login-brand">
          <div class="brand-name">SMOKE SIGNALS</div>
          <div class="brand-sub">FIRST RUN SETUP</div>
        </div>
        <div class="login-box setup-wizard">
          <div class="setup-title">[ INITIAL PIN SETUP ]</div>
          <div class="setup-desc">Enter the setup code to initialise this device.</div>
          <div id="setup-code-area">
            <input type="password" id="setup-code-input" placeholder="Setup code"
              style="width:100%;padding:12px;background:#0d1a0d;border:1px solid #1a4a1a;color:#e8f5eb;font-family:monospace;font-size:1rem;letter-spacing:0.1em;outline:none;margin-bottom:10px;">
            <div id="setup-code-msg" class="login-msg"></div>
            <button class="btn btn-primary btn-block" onclick="Auth._verifySetupCode()">VERIFY</button>
          </div>
          <div id="setup-admin-list" class="hidden"></div>
          <div id="setup-pin-area" class="hidden">
            <div class="setup-pin-who" id="setup-pin-who"></div>
            <div class="pin-label" id="setup-pin-label">ENTER NEW PIN</div>
            <div class="pin-dots" id="setup-dots">
              <span class="dot" id="sdot-0">○</span>
              <span class="dot" id="sdot-1">○</span>
              <span class="dot" id="sdot-2">○</span>
              <span class="dot" id="sdot-3">○</span>
            </div>
            <div id="setup-msg" class="login-msg"></div>
            <div class="numpad">
              ${[1,2,3,4,5,6,7,8,9,'CLR',0,'DEL'].map(k => `
                <button class="num-btn" onclick="Auth.handleSetupKey('${k}')">${k}</button>
              `).join('')}
            </div>
            <button class="btn btn-secondary btn-block" onclick="Auth.cancelSetupPIN()">CANCEL</button>
          </div>
          <button class="btn btn-primary btn-block" id="setup-complete-btn" onclick="Auth.completeSetup()" style="display:none;margin-top:16px">
            SETUP COMPLETE. LOG IN
          </button>
        </div>
      </div>
    `;
    _checkSetupComplete();
  }

  function _verifySetupCode() {
    const input = document.getElementById('setup-code-input').value.trim().toUpperCase();
    if (input !== CONFIG.SETUP_CODE) {
      const msg = document.getElementById('setup-code-msg');
      msg.textContent = 'Incorrect setup code.';
      msg.className = 'login-msg error';
      document.getElementById('setup-code-input').value = '';
      return;
    }
    document.getElementById('setup-code-area').style.display = 'none';
    const admins = Data.getStaff().filter(s => s.role === 'admin' && s.active);
    const list = document.getElementById('setup-admin-list');
    list.innerHTML = admins.map(a => `
      <div class="setup-admin-row" id="setup-row-${a.id}">
        <span class="setup-admin-name">${a.name}</span>
        <span class="setup-admin-status" id="setup-status-${a.id}">PENDING</span>
        <button class="btn btn-sm" onclick="Auth.startAdminPINSetup('${a.id}')">SET PIN</button>
      </div>
    `).join('');
    list.classList.remove('hidden');
    _checkSetupComplete();
  }

  function _checkSetupComplete() {
    const staff = Data.getStaff();
    const anyAdminPin = staff.filter(s => s.role === 'admin').some(s => s.pinHash);
    const btn = document.getElementById('setup-complete-btn');
    if (btn) btn.style.display = anyAdminPin ? 'block' : 'none';
  }

  function startAdminPINSetup(id) {
    _selectedStaff = Data.getStaffById(id);
    _pinBuffer = '';
    _setupStep = 1;
    _setupNewPin = '';

    document.getElementById('setup-pin-area').classList.remove('hidden');
    document.getElementById('setup-pin-who').textContent = `SETTING PIN FOR: ${_selectedStaff.name}`;
    document.getElementById('setup-pin-label').textContent = 'ENTER NEW PIN';
    updateSetupDots();
  }

  function handleSetupKey(k) {
    if (k === 'CLR') { _pinBuffer = ''; updateSetupDots(); return; }
    if (k === 'DEL') { _pinBuffer = _pinBuffer.slice(0, -1); updateSetupDots(); return; }
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += String(k);
    updateSetupDots();
    if (_pinBuffer.length === 4) _advanceSetup();
  }

  async function _advanceSetup() {
    if (_setupStep === 1) {
      _setupNewPin = _pinBuffer;
      _pinBuffer = '';
      _setupStep = 2;
      document.getElementById('setup-pin-label').textContent = 'CONFIRM PIN';
      updateSetupDots();
    } else if (_setupStep === 2) {
      if (_pinBuffer !== _setupNewPin) {
        document.getElementById('setup-msg').textContent = 'PINs do not match. Try again.';
        document.getElementById('setup-msg').className = 'login-msg error';
        _pinBuffer = '';
        _setupNewPin = '';
        _setupStep = 1;
        document.getElementById('setup-pin-label').textContent = 'ENTER NEW PIN';
        updateSetupDots();
        return;
      }
      const hashed = await hashPIN(_pinBuffer);
      Data.updateStaffMember({ id: _selectedStaff.id, pinHash: hashed });
      Data.addAudit('PIN_SET', `PIN set for ${_selectedStaff.name}`, _selectedStaff.id);
      Data.syncStaffPIN(Data.getStaffById(_selectedStaff.id));

      const statusEl = document.getElementById(`setup-status-${_selectedStaff.id}`);
      if (statusEl) { statusEl.textContent = 'SET'; statusEl.className = 'setup-admin-status ok'; }

      document.getElementById('setup-pin-area').classList.add('hidden');
      _setupStep = 0;
      _pinBuffer = '';
      _selectedStaff = null;
      _checkSetupComplete();
    }
  }

  function cancelSetupPIN() {
    _setupStep = 0;
    _pinBuffer = '';
    _setupNewPin = '';
    _selectedStaff = null;
    document.getElementById('setup-pin-area').classList.add('hidden');
  }

  function updateSetupDots() {
    for (let i = 0; i < 4; i++) {
      const d = document.getElementById(`sdot-${i}`);
      if (d) d.textContent = i < _pinBuffer.length ? '◉' : '○';
    }
  }

  function completeSetup() {
    showLoginScreen();
  }

  // ─── Admin PIN Confirm ────────────────────────────────────────────────────────
  function confirmAdminPIN(message) {
    return new Promise((resolve) => {
      const s = getSession();
      if (!s || s.role !== 'admin') { resolve(false); return; }

      let buf = '';
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box">
          <div class="modal-title">[ ADMIN CONFIRM ]</div>
          <div class="modal-body">${message}</div>
          <div class="pin-label">Enter your admin PIN to confirm</div>
          <div class="pin-dots" id="cpd-dots">
            <span id="cpd-0">○</span><span id="cpd-1">○</span>
            <span id="cpd-2">○</span><span id="cpd-3">○</span>
          </div>
          <div id="cpd-msg" class="login-msg"></div>
          <div class="numpad">
            ${[1,2,3,4,5,6,7,8,9,'CLR',0,'DEL'].map(k => `
              <button class="num-btn" data-k="${k}">${k}</button>
            `).join('')}
          </div>
          <button class="btn btn-secondary btn-block" id="cpd-cancel" style="margin-top:8px">CANCEL</button>
        </div>
      `;
      document.body.appendChild(overlay);

      function updDots() {
        for (let i = 0; i < 4; i++) {
          const d = document.getElementById(`cpd-${i}`);
          if (d) d.textContent = i < buf.length ? '◉' : '○';
        }
      }

      overlay.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const k = btn.dataset.k;
          if (k === 'CLR') { buf = ''; updDots(); return; }
          if (k === 'DEL') { buf = buf.slice(0,-1); updDots(); return; }
          if (buf.length >= 4) return;
          buf += k;
          updDots();
          if (buf.length === 4) {
            const admin = Data.getStaffById(s.staffId);
            const hashed = await hashPIN(buf);
            overlay.remove();
            resolve(hashed === admin.pinHash);
          }
        });
      });

      document.getElementById('cpd-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
    });
  }

  // ─── PIN Reset (admin action) ─────────────────────────────────────────────────
  async function resetStaffPIN(targetStaffId) {
    const confirmed = await confirmAdminPIN(`Reset PIN for ${Data.getStaffById(targetStaffId)?.name}?`);
    if (!confirmed) return false;

    return new Promise((resolve) => {
      let step = 1, newPin = '', buf = '';

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box">
          <div class="modal-title">[ SET NEW PIN ]</div>
          <div class="modal-body">For: <strong>${Data.getStaffById(targetStaffId)?.name}</strong></div>
          <div class="pin-label" id="rp-label">ENTER NEW PIN</div>
          <div class="pin-dots" id="rp-dots">
            <span id="rp-0">○</span><span id="rp-1">○</span>
            <span id="rp-2">○</span><span id="rp-3">○</span>
          </div>
          <div id="rp-msg" class="login-msg"></div>
          <div class="numpad">
            ${[1,2,3,4,5,6,7,8,9,'CLR',0,'DEL'].map(k => `
              <button class="num-btn" data-k="${k}">${k}</button>
            `).join('')}
          </div>
          <button class="btn btn-secondary btn-block" id="rp-cancel" style="margin-top:8px">CANCEL</button>
        </div>
      `;
      document.body.appendChild(overlay);

      function updDots() {
        for (let i = 0; i < 4; i++) {
          const d = document.getElementById(`rp-${i}`);
          if (d) d.textContent = i < buf.length ? '◉' : '○';
        }
      }

      overlay.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const k = btn.dataset.k;
          if (k === 'CLR') { buf = ''; updDots(); return; }
          if (k === 'DEL') { buf = buf.slice(0,-1); updDots(); return; }
          if (buf.length >= 4) return;
          buf += k;
          updDots();
          if (buf.length === 4) {
            if (step === 1) {
              newPin = buf; buf = ''; step = 2;
              document.getElementById('rp-label').textContent = 'CONFIRM NEW PIN';
              updDots();
            } else {
              if (buf !== newPin) {
                document.getElementById('rp-msg').textContent = 'PINs do not match';
                document.getElementById('rp-msg').className = 'login-msg error';
                buf = ''; newPin = ''; step = 1;
                document.getElementById('rp-label').textContent = 'ENTER NEW PIN';
                updDots();
              } else {
                const hashed = await hashPIN(buf);
                const s = getSession();
                Data.updateStaffMember({ id: targetStaffId, pinHash: hashed, failedAttempts: 0, lockedUntil: null });
                Data.addAudit('PIN_RESET', `PIN reset for ${Data.getStaffById(targetStaffId)?.name}`, s?.staffId);
                Data.syncStaffPIN(Data.getStaffById(targetStaffId));
                overlay.remove();
                resolve(true);
              }
            }
          }
        });
      });

      document.getElementById('rp-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    });
  }

  return {
    showLoginScreen,
    isLoggedIn, getSession, logout, extendSession, startWatchdog,
    isFirstRun,
    _verifySetupCode,
    startAdminPINSetup, handleSetupKey, cancelSetupPIN, completeSetup,
    confirmAdminPIN, resetStaffPIN,
    hashPIN,
  };
})();
