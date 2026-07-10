/* signin.js — Align PM sign-in page for the new SPA router
 * Renders email + password form, validates, submits to /api/auth/login
 */

(function () {
  'use strict';

  var _inFlight = false;

  function mount(container) {
    if (!container) return;
    container.innerHTML = _html();
    _wire();
    // Focus email field
    setTimeout(function () {
      var el = document.getElementById('si-email');
      if (el) el.focus();
    }, 100);
  }

  function unmount() {
    _inFlight = false;
  }

  function _html() {
    return '<div class="signin-page">' +
      '<div class="signin-card">' +
        '<div class="signin-logo" id="si-logo"></div>' +
        '<h1 class="signin-title">Sign In</h1>' +
        '<form id="signin-form" novalidate>' +
          '<div class="si-field">' +
            '<input type="text" id="si-email" class="si-input" placeholder="Username" autocomplete="username" />' +
            '<p class="si-error" id="si-email-error"></p>' +
          '</div>' +
          '<div class="si-field">' +
            '<input type="password" id="si-password" class="si-input" placeholder="Password" autocomplete="current-password" />' +
            '<p class="si-error" id="si-pass-error"></p>' +
          '</div>' +
          '<p class="si-form-error" id="si-form-error"></p>' +
          '<button type="submit" class="si-btn" id="si-btn">' +
            '<span class="si-btn-label">Sign In</span>' +
            '<span class="si-btn-spinner" id="si-spinner" style="display:none"></span>' +
          '</button>' +
        '</form>' +
      '</div>' +
    '</div>';
  }

  function _wire() {
    var form = document.getElementById('signin-form');
    if (form) {
      form.addEventListener('submit', _handleSubmit);
    }
    // Clear errors on input
    var emailEl = document.getElementById('si-email');
    var passEl = document.getElementById('si-password');
    if (emailEl) emailEl.addEventListener('input', _clearErrors);
    if (passEl) passEl.addEventListener('input', _clearErrors);
  }

  function _clearErrors() {
    var els = document.querySelectorAll('.si-error, .si-form-error');
    for (var i = 0; i < els.length; i++) els[i].textContent = '';
    var inputs = document.querySelectorAll('.si-input');
    for (var j = 0; j < inputs.length; j++) inputs[j].classList.remove('si-input-invalid');
  }

  function _showFieldError(field, msg) {
    var el = document.getElementById('si-' + field + '-error');
    var input = document.getElementById('si-' + field);
    if (el) el.textContent = msg;
    if (input) input.classList.add('si-input-invalid');
  }

  function _showFormError(msg) {
    var el = document.getElementById('si-form-error');
    if (el) el.textContent = msg;
  }

  function _setLoading(loading) {
    _inFlight = loading;
    var btn = document.getElementById('si-btn');
    var spinner = document.getElementById('si-spinner');
    var label = btn ? btn.querySelector('.si-btn-label') : null;
    var email = document.getElementById('si-email');
    var pass = document.getElementById('si-password');
    if (btn) btn.disabled = loading;
    if (email) email.disabled = loading;
    if (pass) pass.disabled = loading;
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
    if (label) label.style.display = loading ? 'none' : '';
  }

  function _validate() {
    var email = (document.getElementById('si-email') || {}).value || '';
    var pass = (document.getElementById('si-password') || {}).value || '';
    var valid = true;
    if (!email.trim()) { _showFieldError('email', 'Username is required'); valid = false; }
    if (!pass) { _showFieldError('pass', 'Password is required'); valid = false; }
    return valid;
  }

  function _handleSubmit(e) {
    e.preventDefault();
    if (_inFlight) return;
    _clearErrors();
    if (!_validate()) return;

    _setLoading(true);

    var email = document.getElementById('si-email').value.trim();
    var password = document.getElementById('si-password').value;

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Sign in failed');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      // Store token securely (iOS Keychain + localStorage mirror)
      if (window.TokenStore) {
        window.TokenStore.save(data.token);
      } else if (window.Store) {
        window.Store.persistToken(data.token);
      }
      if (window.Store) window.Store.hydrate(data);
      // Navigate to project select
      if (window.Router) window.Router.navigate('projects');
    }).catch(function (err) {
      _setLoading(false);
      if (err.status === 401) {
        _showFieldError('pass', 'Incorrect email or password');
      } else if (err.data && err.data.field) {
        _showFieldError(err.data.field, err.data.error);
      } else if (err.status === 423) {
        _showFormError(err.data.error || 'Account locked. Try again later.');
      } else {
        _showFormError('Connection failed. Check your network and try again.');
      }
    });
  }

  window.SignIn = {
    mount: mount,
    unmount: unmount
  };
})();
