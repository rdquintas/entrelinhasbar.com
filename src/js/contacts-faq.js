/* Contactos › FAQ: anima a abertura e o fecho dos painéis <details>.
   Sem JS (ou com "reduzir movimento") os painéis continuam a abrir e fechar, só que sem animação. */
(function () {
  'use strict';
  if (!Element.prototype.animate) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var OPTS = { duration: 350, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };

  document.querySelectorAll('.contacts-faq-item').forEach(function (item) {
    var summary = item.querySelector('summary');
    var answer = item.querySelector('.contacts-faq-answer');
    var anim = null;

    function run(from, to, opening) {
      item.style.overflow = 'hidden';
      anim = item.animate({ height: [from + 'px', to + 'px'] }, OPTS);
      answer.animate({ opacity: opening ? [0, 1] : [1, 0] }, OPTS);
      anim.onfinish = function () {
        anim = null;
        if (!opening) item.open = false;
        item.style.overflow = '';
      };
    }

    summary.addEventListener('click', function (e) {
      if (reduce.matches) return;
      e.preventDefault();
      var start = item.offsetHeight;
      // Fechar se está aberto e não a meio de um fecho; senão abrir.
      var closing = item.open && !(anim && item.dataset.state === 'closing');
      // Pára a animação a meio (se houver) antes de medir a altura final.
      if (anim) { anim.onfinish = anim.oncancel = null; anim.cancel(); anim = null; }
      if (closing) {
        item.dataset.state = 'closing';
        run(start, summary.offsetHeight + (item.offsetHeight - item.clientHeight), false);
      } else {
        item.dataset.state = 'opening';
        item.open = true;
        run(start, item.offsetHeight, true);
      }
    });
  });
})();
