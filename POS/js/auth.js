'use strict';

const Auth = (() => {
  let _pinBuffer = '';
  let _selectedStaff = null;
  let _watchdogInterval = null;
  let _setupStep = 0;
  let _setupNewPin = '';
  let _warningOverlay = null;
  const SESSION_WARNING_MS = 2 * 60 * 1000;

  // ─── PIN hashing ──────────────────────────────────────────────────────────────
  // PBKDF2 with a random per-staff salt and a high iteration count — a 4-digit
  // PIN is only a 10,000-value keyspace, so a single unsalted SHA-256 round
  // (the old scheme) lets anyone who ever obtains a pinHash recover the PIN
  // instantly. PBKDF2 makes each guess computationally expensive instead.
  const PBKDF2_ITERATIONS = 100000;

  function genSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPIN(pin, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Old unsalted single-round SHA-256 — kept only to verify PINs set before
  // the PBKDF2 upgrade above, and to transparently upgrade them on next login.
  async function hashPINLegacy(pin) {
    const buf = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function _verifyAndMaybeUpgradePin(staff, pin) {
    if (staff.pinSalt) {
      return (await hashPIN(pin, staff.pinSalt)) === staff.pinHash;
    }
    const legacyOk = (await hashPINLegacy(pin)) === staff.pinHash;
    if (legacyOk) {
      const salt = genSalt();
      const upgraded = await hashPIN(pin, salt);
      Data.updateStaffMember({ id: staff.id, pinHash: upgraded, pinSalt: salt });
    }
    return legacyOk;
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
    if (_warningOverlay) { _warningOverlay.remove(); _warningOverlay = null; }
    showLoginScreen();
  }
  function startWatchdog() {
    if (_watchdogInterval) clearInterval(_watchdogInterval);
    // Ticks every second to check real time-to-expiry and surface a warning —
    // it must NOT extend the session itself, or idle timeout never fires.
    _watchdogInterval = setInterval(_checkSessionExpiry, 1000);
    document.addEventListener('click', extendSession, { passive: true });
    document.addEventListener('keydown', extendSession, { passive: true });
    document.addEventListener('touchstart', extendSession, { passive: true });
  }

  function _checkSessionExpiry() {
    const s = getSession();
    if (!s) return;
    const remaining = s.expiresAt - Date.now();

    if (remaining <= 0) {
      logout();
      return;
    }

    if (remaining <= SESSION_WARNING_MS) {
      _showSessionWarning(remaining);
    } else if (_warningOverlay) {
      _warningOverlay.remove();
      _warningOverlay = null;
    }
  }

  function _showSessionWarning(remaining) {
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const label = `${mins}:${String(secs).padStart(2, '0')}`;

    if (_warningOverlay) {
      const timeEl = document.getElementById('session-warning-time');
      if (timeEl) timeEl.textContent = label;
      return;
    }

    _warningOverlay = UI.modal(`
      <div class="modal-title">[ SESSION ENDING ]</div>
      <div class="modal-body">You've been idle a while. Logging out in <strong id="session-warning-time">${label}</strong>.</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="session-stay-btn">STAY LOGGED IN</button>
      </div>
    `, () => { _warningOverlay = null; });

    _warningOverlay.querySelector('#session-stay-btn').addEventListener('click', () => {
      extendSession();
      if (_warningOverlay) { _warningOverlay.remove(); _warningOverlay = null; }
    });
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
          <div id="login-setup-pin" style="display:none;text-align:center;margin-top:8px;">
            <button class="btn btn-primary btn-sm" onclick="Auth.showFirstPinSetup()">SET UP MY PIN</button>
          </div>
          <div id="login-forgot" style="display:none;text-align:center;margin-top:8px;">
            <button class="btn-link" onclick="Auth.showForgotPIN()">Forgot PIN?</button>
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
    const forgotEl = document.getElementById('login-forgot');
    const setupEl  = document.getElementById('login-setup-pin');
    if (forgotEl) forgotEl.style.display = 'none';
    if (setupEl)  setupEl.style.display  = 'none';

    if (_selectedStaff && !_selectedStaff.pinHash) {
      setMsg("No PIN set yet — that's you? Set one up below.", 'warn');
      if (setupEl) setupEl.style.display = 'block';
    } else if (_selectedStaff && _selectedStaff.lockedUntil && Date.now() < _selectedStaff.lockedUntil) {
      const mins = Math.ceil((_selectedStaff.lockedUntil - Date.now()) / 60000);
      setMsg(`LOCKED. Try again in ${mins} min.`, 'error');
      if (forgotEl) forgotEl.style.display = 'block';
    } else if (_selectedStaff) {
      if (forgotEl) forgotEl.style.display = 'block';
    }
  }

  function showFirstPinSetup() {
    if (!_selectedStaff || _selectedStaff.pinHash) return;
    _startEmailVerifiedPin(_selectedStaff, {
      title: 'SET UP YOUR PIN',
      auditAction: 'PIN_SET',
      auditDetail: (name) => `${name} set their own PIN on first login (email-verified)`,
      onSuccess: (staff) => {
        document.removeEventListener('keydown', _physicalKeyHandler);
        _selectedStaff = staff;
        createSession(staff);
        startWatchdog();
        UI.showApp();
        UI.toast(`Welcome, ${staff.name}!`, 'success');
      },
    });
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

    const ok = await _verifyAndMaybeUpgradePin(_selectedStaff, _pinBuffer);

    if (ok) {
      Data.addAudit('LOGIN_SUCCESS', `${_selectedStaff.name} logged in`, _selectedStaff.id);
      Data.updateStaffMember({ id: _selectedStaff.id, failedAttempts: 0, lockedUntil: null, lastLogin: new Date().toISOString() });
      document.removeEventListener('keydown', _physicalKeyHandler);
      createSession(Data.getStaffById(_selectedStaff.id));
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

  async function _verifyCodeRemote(code) {
    const settings = Data.getSettings();
    if (!settings.appsScriptUrl) return false;
    try {
      const resp = await fetch(settings.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'VERIFY_CODE', code }),
      });
      const data = await resp.json();
      return !!data.valid;
    } catch {
      return false;
    }
  }

  function _maskEmail(email) {
    const parts = String(email).split('@');
    if (parts.length !== 2) return email;
    const visible = parts[0].slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(1, parts[0].length - 2))}@${parts[1]}`;
  }

  // Returns true only if the server actually accepted the request. A plain
  // fetch() doesn't throw on a 5xx — MailApp failures, a misaligned Staff
  // sheet, etc. — so without checking resp.ok the UI would silently move on
  // to "enter your code" even though no email was ever sent.
  async function _requestLoginCode(staffId) {
    const settings = Data.getSettings();
    if (!settings.appsScriptUrl) return false;
    try {
      const resp = await fetch(settings.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'REQUEST_LOGIN_CODE', data: { staffId } }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return !data.error;
    } catch {
      return false; // network/offline — code never arrives, user can retry/resend
    }
  }

  async function _verifyLoginCode(staffId, code) {
    const settings = Data.getSettings();
    if (!settings.appsScriptUrl) return false;
    try {
      const resp = await fetch(settings.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'VERIFY_LOGIN_CODE', data: { staffId, code } }),
      });
      const data = await resp.json();
      return !!data.valid;
    } catch {
      return false;
    }
  }

  // Shared by showFirstPinSetup and showForgotPIN: email a one-time code to
  // the staff member's on-file address, verify it, then let them choose a
  // PIN. Ties "set/reset my PIN" to proof of access to that specific
  // person's own inbox, rather than a shared master code or no check at all.
  function _startEmailVerifiedPin(target, { title, auditAction, auditDetail, onSuccess }) {
    if (!target.email) {
      const overlay = UI.modal(`
        <div class="modal-title">[ ${title} ]</div>
        <div class="modal-body">No email on file for ${UI.esc(target.name)}. Ask an admin to add one
          (Admin → Staff Management → Edit), or have an admin set your PIN directly
          (Admin → Staff Management → Reset PIN).</div>
        <div class="modal-actions"><button class="btn btn-secondary" id="evp-close">CLOSE</button></div>
      `);
      overlay.querySelector('#evp-close').addEventListener('click', () => overlay.remove());
      return;
    }

    const masked = _maskEmail(target.email);
    let pinStep = 1, newPin = '', buf = '';

    const overlay = UI.modal(`
      <div class="modal-title">[ ${title} — ${UI.esc(target.name)} ]</div>
      <div class="modal-body">We'll email a 6-digit code to <strong>${UI.esc(masked)}</strong>.</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="evp-send">SEND CODE</button>
        <button class="btn btn-secondary" id="evp-cancel">CANCEL</button>
      </div>
    `);

    overlay.querySelector('#evp-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#evp-send').addEventListener('click', async () => {
      const btn = overlay.querySelector('#evp-send');
      btn.disabled = true;
      btn.textContent = 'SENDING...';
      const sent = await _requestLoginCode(target.id);
      if (!sent) {
        btn.disabled = false;
        btn.textContent = 'SEND CODE';
        UI.toast('Could not send the code — check your connection and try again', 'error');
        return;
      }
      renderCodeStep();
    });

    function renderCodeStep() {
      const box = overlay.querySelector('.modal-box');
      box.innerHTML = `
        <div class="modal-title">[ ${title} — ${UI.esc(target.name)} ]</div>
        <div class="modal-body">Enter the code sent to <strong>${UI.esc(masked)}</strong>. It expires in 10 minutes.</div>
        <input type="text" id="evp-code" maxlength="6" inputmode="numeric" autocomplete="one-time-code"
          placeholder="123456" class="w-full" style="text-align:center;letter-spacing:0.3em;font-size:1.2rem;margin-bottom:8px;">
        <div id="evp-msg" class="login-msg"></div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="evp-verify">VERIFY</button>
          <button class="btn btn-secondary" id="evp-cancel">CANCEL</button>
        </div>
        <div style="text-align:center;margin-top:8px;"><button class="btn-link" id="evp-resend">Resend code</button></div>
      `;
      box.querySelector('#evp-cancel').addEventListener('click', () => overlay.remove());
      box.querySelector('#evp-code').focus();
      box.querySelector('#evp-resend').addEventListener('click', async (e) => {
        e.preventDefault();
        const sent = await _requestLoginCode(target.id);
        UI.toast(sent ? 'Code re-sent' : 'Could not resend the code — try again shortly', sent ? 'info' : 'error');
      });
      const doVerify = async () => {
        const code = box.querySelector('#evp-code').value.trim();
        const btn = box.querySelector('#evp-verify');
        btn.disabled = true;
        const valid = await _verifyLoginCode(target.id, code);
        btn.disabled = false;
        if (!valid) {
          const msg = box.querySelector('#evp-msg');
          msg.textContent = 'Incorrect or expired code.';
          msg.className = 'login-msg error';
          return;
        }
        renderPinStep();
      };
      box.querySelector('#evp-verify').addEventListener('click', doVerify);
      box.querySelector('#evp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doVerify(); });
    }

    function renderPinStep() {
      pinStep = 1; newPin = ''; buf = '';
      const box = overlay.querySelector('.modal-box');
      box.innerHTML = `
        <div class="modal-title">[ SET YOUR PIN — ${UI.esc(target.name)} ]</div>
        <div class="pin-label" id="evp-pin-label">ENTER PIN</div>
        <div class="pin-dots" id="evp-dots">
          <span id="evpd-0">○</span><span id="evpd-1">○</span>
          <span id="evpd-2">○</span><span id="evpd-3">○</span>
        </div>
        <div id="evp-pin-msg" class="login-msg"></div>
        <div class="numpad">
          ${[1,2,3,4,5,6,7,8,9,'CLR',0,'DEL'].map(k => `<button class="num-btn" data-k="${k}">${k}</button>`).join('')}
        </div>
      `;
      const updDots = () => {
        for (let i = 0; i < 4; i++) {
          const d = box.querySelector(`#evpd-${i}`);
          if (d) d.textContent = i < buf.length ? '◉' : '○';
        }
      };
      box.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const k = btn.dataset.k;
          if (k === 'CLR') { buf = ''; updDots(); return; }
          if (k === 'DEL') { buf = buf.slice(0, -1); updDots(); return; }
          if (buf.length >= 4) return;
          buf += k;
          updDots();
          if (buf.length !== 4) return;

          if (pinStep === 1) {
            newPin = buf; buf = ''; pinStep = 2;
            box.querySelector('#evp-pin-label').textContent = 'CONFIRM PIN';
            updDots();
            return;
          }
          if (buf !== newPin) {
            box.querySelector('#evp-pin-msg').textContent = 'PINs do not match. Try again.';
            box.querySelector('#evp-pin-msg').className = 'login-msg error';
            buf = ''; newPin = ''; pinStep = 1;
            box.querySelector('#evp-pin-label').textContent = 'ENTER PIN';
            updDots();
            return;
          }

          const salt = genSalt();
          const hashed = await hashPIN(buf, salt);
          Data.updateStaffMember({ id: target.id, pinHash: hashed, pinSalt: salt, failedAttempts: 0, lockedUntil: null });
          Data.addAudit(auditAction, auditDetail(target.name), target.id);
          overlay.remove();
          onSuccess(Data.getStaffById(target.id));
        });
      });
    }
  }

  async function _verifySetupCode() {
    const input = document.getElementById('setup-code-input').value.trim().toUpperCase();
    const btn = document.querySelector('#setup-code-area button');
    if (btn) btn.disabled = true;
    const valid = await _verifyCodeRemote(input);
    if (btn) btn.disabled = false;
    if (!valid) {
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
      const salt = genSalt();
      const hashed = await hashPIN(_pinBuffer, salt);
      Data.updateStaffMember({ id: _selectedStaff.id, pinHash: hashed, pinSalt: salt });
      Data.addAudit('PIN_SET', `PIN set for ${_selectedStaff.name}`, _selectedStaff.id);

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

  // ─── Forgot PIN (pre-login reset via emailed one-time code) ──────────────────
  function showForgotPIN() {
    if (!_selectedStaff) return;
    _startEmailVerifiedPin(_selectedStaff, {
      title: 'RESET YOUR PIN',
      auditAction: 'PIN_RESET',
      auditDetail: (name) => `${name} reset their own PIN via emailed code`,
      onSuccess: (staff) => {
        document.removeEventListener('keydown', _physicalKeyHandler);
        _selectedStaff = staff;
        createSession(staff);
        startWatchdog();
        UI.showApp();
        UI.toast(`PIN reset. Welcome back, ${staff.name}!`, 'success');
      },
    });
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
            const ok = await _verifyAndMaybeUpgradePin(admin, buf);
            overlay.remove();
            resolve(ok);
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
                const salt = genSalt();
                const hashed = await hashPIN(buf, salt);
                const s = getSession();
                Data.updateStaffMember({ id: targetStaffId, pinHash: hashed, pinSalt: salt, failedAttempts: 0, lockedUntil: null });
                Data.addAudit('PIN_RESET', `PIN reset for ${Data.getStaffById(targetStaffId)?.name}`, s?.staffId);
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
    showForgotPIN, showFirstPinSetup,
    confirmAdminPIN, resetStaffPIN,
    hashPIN,
  };
})();
