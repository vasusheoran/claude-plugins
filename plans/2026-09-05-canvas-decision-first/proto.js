// Prototype budget meter. Counts words visible by default: everything inside
// <main> except <details> bodies (summaries count), scripts, styles.
// Real version moves into comments.js and renders in the nav.
(function () {
  function visibleWords() {
    var main = document.querySelector('main');
    if (!main) return 0;
    var clone = main.cloneNode(true);
    clone.querySelectorAll('script,style').forEach(function (el) { el.remove(); });
    clone.querySelectorAll('details').forEach(function (el) {
      var s = el.querySelector('summary');
      el.innerHTML = '';
      if (s) el.appendChild(s);
    });
    return clone.textContent.trim().split(/\s+/).filter(Boolean).length;
  }
  function render() {
    var budget = parseInt(document.body.dataset.budgetWords || '200', 10);
    var words = visibleWords();
    var screens = Math.max(1, Math.round(document.documentElement.scrollHeight / window.innerHeight * 10) / 10);
    var el = document.querySelector('.meter');
    if (!el) {
      el = document.createElement('div');
      el.className = 'meter';
      document.body.appendChild(el);
    }
    el.textContent = words + ' / ' + budget + 'w · ~' + screens + ' screens';
    el.classList.toggle('over', words > budget);
    el.title = 'Words visible by default (collapsed content is free). Prototype of the proposed budget meter.';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
