/* Lares contact form: sends form[data-lares-lead] to /_lares/lead without reloading the page.
   Without JavaScript the form still works: the server answers with a redirect back to the page
   ending in #lares-sent or #lares-error, and CSS (:target) shows the matching message. */
(function () {
  if (!window.fetch || !window.FormData || !window.URLSearchParams) return;
  var forms = document.querySelectorAll('form[data-lares-lead]');
  Array.prototype.forEach.call(forms, function (form) {
    var ok = form.querySelector('[data-lares-ok]');
    var err = form.querySelector('[data-lares-error]');
    var errText = err && (err.querySelector('[data-lares-error-text]') || err);
    var defaultError = errText ? errText.textContent : '';
    function show(el, on) {
      if (el) el.classList[on ? 'add' : 'remove']('is-visible');
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('[type="submit"]');
      var data = new URLSearchParams();
      new FormData(form).forEach(function (value, key) {
        if (typeof value === 'string') data.append(key, value);
      });
      if (!data.get('page')) data.set('page', location.pathname + location.search);
      // a message left visible by an earlier plain post (#lares-sent) must not linger
      if (/^#lares-(sent|error)$/.test(location.hash) && window.history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      show(ok, false);
      show(err, false);
      if (button) button.disabled = true;
      fetch(form.getAttribute('action') || '/_lares/lead', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Accept-Language': document.documentElement.lang || 'vi' },
        body: data,
        credentials: 'same-origin'
      })
        .then(function (res) {
          return res.json().then(
            function (json) {
              return { ok: res.ok && !!json && json.ok === true, error: json && json.error };
            },
            function () {
              return { ok: false };
            }
          );
        })
        .then(
          function (result) {
            if (result.ok) {
              form.reset();
              show(ok, true);
            } else {
              if (errText) errText.textContent = result.error || defaultError;
              show(err, true);
            }
          },
          function () {
            if (errText) errText.textContent = defaultError;
            show(err, true);
          }
        )
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  });
})();
