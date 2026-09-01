(function () {
  'use strict';

  var config = window.MANJAM_LEGACY_ADMIN_CONFIG || {};
  var apiBase = String(config.apiBase || '').replace(/\/$/, '');
  var overlay = null;
  var challengeToken = null;
  var challengeExpiresAt = 0;
  var returnRoute = '/page/home';

  function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
  }

  function readSession() {
    var token = localStorage.getItem('token');
    var rawProfile = localStorage.getItem('currentUser');
    if (!token || !rawProfile || token === 'undefined' || rawProfile === 'undefined' || rawProfile === 'null') {
      if (token || rawProfile) clearSession();
      return null;
    }
    try {
      var profile = JSON.parse(rawProfile);
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        clearSession();
        return null;
      }
      return { token: token, profile: profile };
    } catch (_error) {
      clearSession();
      return null;
    }
  }

  function hasSession() {
    return Boolean(readSession());
  }

  function isLoginRoute() {
    return /^#\/login(?:\?|$)/.test(window.location.hash || '');
  }

  function safeReturnRoute() {
    var hash = window.location.hash || '';
    var queryAt = hash.indexOf('?');
    if (queryAt < 0) return '/page/home';
    var candidate = new URLSearchParams(hash.slice(queryAt + 1)).get('returnUrl') || '';
    if (!/^\/[A-Za-z0-9/_?=&.%-]*$/.test(candidate) || candidate.indexOf('//') === 0) {
      return '/page/home';
    }
    return candidate;
  }

  function responseData(payload) {
    if (payload && payload.data && typeof payload.data === 'object') return payload.data;
    return payload && typeof payload === 'object' ? payload : {};
  }

  function friendlyError(payload, status) {
    var raw = String((payload && payload.message) || '').toLowerCase();
    if (status === 429 || raw.indexOf('too many') >= 0 || raw.indexOf('rate') >= 0) {
      return 'Bạn đã thử quá nhiều lần. Vui lòng chờ một lát rồi thử lại.';
    }
    if (raw.indexOf('verification code') >= 0 && raw.indexOf('deliver') >= 0) {
      return 'Hiện chưa gửi được mã xác minh. Vui lòng thử lại sau.';
    }
    if (raw.indexOf('mfa') >= 0 || raw.indexOf('code') >= 0 || raw.indexOf('otp') >= 0) {
      return 'Mã xác minh không đúng hoặc đã hết hạn.';
    }
    if (status === 401 || status === 403) {
      return 'Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được phép truy cập.';
    }
    return 'Không thể đăng nhập lúc này. Vui lòng thử lại.';
  }

  async function post(path, body) {
    var response;
    var payload = {};
    try {
      response = await fetch(apiBase + path, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      payload = await response.json().catch(function () { return {}; });
    } catch (_error) {
      throw new Error('Không thể kết nối hệ thống quản trị.');
    }
    if (!response.ok) throw new Error(friendlyError(payload, response.status));
    return responseData(payload);
  }

  function setStatus(message, state) {
    var target = overlay && overlay.querySelector('[data-auth-status]');
    if (!target) return;
    target.textContent = message || '';
    target.dataset.state = state || 'error';
  }

  function setBusy(form, busy) {
    Array.prototype.forEach.call(form.elements, function (control) {
      control.disabled = Boolean(busy);
    });
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showStage(stage) {
    var passwordStage = overlay.querySelector('[data-password-stage]');
    var otpStage = overlay.querySelector('[data-otp-stage]');
    passwordStage.hidden = stage !== 'password';
    otpStage.hidden = stage !== 'otp';
    setStatus('', 'error');
    window.setTimeout(function () {
      var target = overlay.querySelector(stage === 'otp' ? '#manjam-admin-otp' : '#manjam-admin-email');
      if (target) target.focus();
    }, 0);
  }

  function completeSession(result) {
    if (!result || !result.token || !result.profile) {
      throw new Error('Phiên đăng nhập không hợp lệ. Vui lòng thử lại.');
    }
    localStorage.setItem('currentUser', JSON.stringify(result.profile));
    localStorage.setItem('token', String(result.token));
    challengeToken = null;
    var appRoot = document.querySelector('app-root');
    if (appRoot) {
      appRoot.removeAttribute('aria-hidden');
      appRoot.removeAttribute('inert');
    }
    if (overlay) overlay.remove();
    overlay = null;
    window.location.hash = '#' + returnRoute;
    window.location.reload();
  }

  async function submitPassword(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var email = form.elements.email.value.trim();
    var password = form.elements.password.value;
    if (!email || !password) return;
    setBusy(form, true);
    setStatus('Đang xác minh…', 'success');
    try {
      var result = await post('/auth/login', { email: email, password: password });
      form.elements.password.value = '';
      if (result.mfaRequired) {
        var expiresInSeconds = Number(result.expiresInSeconds || 300);
        if (!result.challengeToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) {
          throw new Error('Không nhận được yêu cầu xác minh hợp lệ.');
        }
        challengeToken = String(result.challengeToken);
        challengeExpiresAt = Date.now() + expiresInSeconds * 1000;
        showStage('otp');
        setStatus('Mở app xác thực trên điện thoại để lấy mã 6 số.', 'success');
        return;
      }
      completeSession(result);
    } catch (error) {
      form.elements.password.value = '';
      setStatus(error.message || 'Không thể đăng nhập lúc này.');
    } finally {
      setBusy(form, false);
    }
  }

  async function submitOtp(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var otp = form.elements.otp.value.trim();
    if (!challengeToken || Date.now() >= challengeExpiresAt) {
      challengeToken = null;
      challengeExpiresAt = 0;
      showStage('password');
      setStatus('Mã xác minh đã hết hạn. Vui lòng đăng nhập lại để nhận mã mới.');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setStatus('Vui lòng nhập đủ mã xác minh gồm 6 chữ số.');
      return;
    }
    setBusy(form, true);
    setStatus('Đang xác minh mã…', 'success');
    try {
      var result = await post('/auth/mfa/verify', {
        challengeToken: challengeToken,
        otp: otp
      });
      form.elements.otp.value = '';
      completeSession(result);
    } catch (error) {
      form.elements.otp.value = '';
      setStatus(error.message || 'Không thể xác minh mã lúc này.');
    } finally {
      setBusy(form, false);
    }
  }

  function mount() {
    if (overlay || hasSession() || !isLoginRoute()) return;
    if (!apiBase || apiBase.indexOf('https://') !== 0) return;
    returnRoute = safeReturnRoute();
    var appRoot = document.querySelector('app-root');
    if (appRoot) {
      appRoot.setAttribute('aria-hidden', 'true');
      appRoot.setAttribute('inert', '');
    }

    overlay = document.createElement('main');
    overlay.className = 'manjam-auth-gateway';
    overlay.setAttribute('aria-labelledby', 'manjam-admin-auth-title');
    overlay.innerHTML = [
      '<section class="manjam-auth-card">',
      '<img class="manjam-auth-logo" src="/assets/icons/logo.png" alt="MANJAM" />',
      '<div data-password-stage>',
      '<h1 class="manjam-auth-title" id="manjam-admin-auth-title">Đăng nhập quản trị</h1>',
      '<p class="manjam-auth-intro">Dùng tài khoản MANJAM được cấp quyền.</p>',
      '<form class="manjam-auth-form" data-password-form novalidate>',
      '<div class="manjam-auth-field"><label for="manjam-admin-email">Email</label><input id="manjam-admin-email" name="email" type="email" autocomplete="username" maxlength="200" required /></div>',
      '<div class="manjam-auth-field"><label for="manjam-admin-password">Mật khẩu</label><input id="manjam-admin-password" name="password" type="password" autocomplete="current-password" maxlength="200" required /></div>',
      '<button class="manjam-auth-button" type="submit">Tiếp tục</button>',
      '</form>',
      '</div>',
      '<div data-otp-stage hidden>',
      '<h1 class="manjam-auth-title">Xác minh đăng nhập</h1>',
      '<p class="manjam-auth-intro">Mở app xác thực trên điện thoại và nhập mã 6 chữ số.</p>',
      '<form class="manjam-auth-form" data-otp-form novalidate>',
      '<div class="manjam-auth-field"><label for="manjam-admin-otp">Mã xác minh</label><input id="manjam-admin-otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></div>',
      '<button class="manjam-auth-button" type="submit">Xác minh</button>',
      '<button class="manjam-auth-link" type="button" data-back>Quay lại đăng nhập</button>',
      '</form>',
      '</div>',
      '<p class="manjam-auth-status" role="status" aria-live="polite" data-auth-status></p>',
      '<p class="manjam-auth-security">Không chia sẻ mật khẩu hoặc mã xác minh. MANJAM không bao giờ yêu cầu mã qua chat hoặc điện thoại.</p>',
      '</section>'
    ].join('');
    document.body.appendChild(overlay);
    overlay.querySelector('[data-password-form]').addEventListener('submit', submitPassword);
    overlay.querySelector('[data-otp-form]').addEventListener('submit', submitOtp);
    overlay.querySelector('[data-back]').addEventListener('click', function () {
      challengeToken = null;
      challengeExpiresAt = 0;
      overlay.querySelector('[data-otp-form]').reset();
      showStage('password');
    });
    showStage('password');
  }

  function routeChanged() {
    if (hasSession() || !isLoginRoute()) {
      if (overlay) overlay.remove();
      overlay = null;
      return;
    }
    mount();
  }

  window.addEventListener('hashchange', routeChanged);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
