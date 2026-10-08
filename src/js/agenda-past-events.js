/* Agenda: esconde os eventos que já passaram (data anterior a hoje, no fuso do visitante), sem novo build.
   O build também os remove, mas só quando corre; isto cobre os dias entre builds. */
(function () {
  'use strict';
  var d = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  document.querySelectorAll('#index-80417 [data-event-date]').forEach(function (el) {
    if (el.getAttribute('data-event-date') < today) el.remove();
  });
})();
