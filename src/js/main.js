/* JavaScript simples (sem bibliotecas). Cada módulo só corre se os seus elementos existirem. */
(function () {
  'use strict';

  /* ------------------------------ Carrossel de destaques ------------------------------ */
  function initCarousel() {
    document.querySelectorAll('[data-carousel]').forEach(function (root) {
      var slides = Array.prototype.slice.call(root.querySelectorAll('[data-slide]'));
      var bullets = Array.prototype.slice.call(root.querySelectorAll('[data-bullet]'));
      if (slides.length < 2) return; // com 1 só destaque não há rotação nem bullets

      var interval = Number(root.getAttribute('data-interval')) || 6000;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var current = 0;
      var timer = null;

      function show(i) {
        current = (i + slides.length) % slides.length;
        slides.forEach(function (s, n) {
          s.classList.toggle('is-active', n === current);
        });
        bullets.forEach(function (b, n) {
          if (n === current) b.setAttribute('aria-current', 'true');
          else b.removeAttribute('aria-current');
        });
      }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      function start() {
        if (reduce || timer) return;
        timer = setInterval(function () { show(current + 1); }, interval);
      }

      bullets.forEach(function (b, n) {
        b.addEventListener('click', function () { show(n); });
      });
      root.addEventListener('mouseenter', stop);
      root.addEventListener('mouseleave', start);
      root.addEventListener('focusin', stop);
      root.addEventListener('focusout', start);
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });

      root.classList.add('is-ready');
      show(0);
      start();
    });
  }

  /* ------------------------------ Mural (Masonry + lazy + lightbox) ------------------------------ */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function initMural() {
    var root = document.querySelector('[data-mural]');
    var dataEl = document.getElementById('mural-data');
    if (!root || !dataEl) return;

    var items;
    try { items = JSON.parse(dataEl.textContent); } catch (e) { return; }
    if (!items.length) return;
    shuffle(items); // ordem nova a cada visita/refresh

    var grid = root.querySelector('[data-mural-grid]');
    var sentinel = root.querySelector('[data-mural-sentinel]');
    var lightbox = document.querySelector('[data-lightbox]');
    var lightboxContent = document.querySelector('[data-lightbox-content]');
    var batch = Number(root.getAttribute('data-batch')) || 12;
    var labelOpen = root.getAttribute('data-label-ampliar') || '';
    var labelPlay = root.getAttribute('data-label-reproduzir') || '';
    var labelVideo = root.getAttribute('data-label-video') || 'Video';
    var position = 0;
    var msnry = null;

    var sizer = document.createElement('div');
    sizer.className = 'mural__sizer';
    grid.appendChild(sizer);

    function openLightbox(pictureOrImg) {
      if (!lightbox || !lightbox.showModal) return;
      var clone = pictureOrImg.cloneNode(true);
      clone.querySelectorAll('source, img').forEach(function (el) {
        el.setAttribute('sizes', '100vw'); // pede a versão maior
        el.removeAttribute('loading');
      });
      if (clone.tagName === 'IMG') { clone.setAttribute('sizes', '100vw'); clone.removeAttribute('loading'); }
      lightboxContent.textContent = '';
      lightboxContent.appendChild(clone);
      lightbox.showModal();
    }

    function buildItem(it) {
      var fig = document.createElement('figure');
      fig.className = 'mural__item mural__item--' + it.k;

      if (it.k === 'img') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mural__abrir';
        if (labelOpen) btn.setAttribute('aria-label', labelOpen + (it.legenda ? ': ' + it.legenda : ''));
        btn.innerHTML = it.html; // HTML gerado e escapado pelo build
        btn.addEventListener('click', function () {
          openLightbox(btn.querySelector('picture') || btn.querySelector('img'));
        });
        fig.appendChild(btn);
      } else {
        var yt = document.createElement('button');
        yt.type = 'button';
        yt.className = 'mural__yt';
        yt.setAttribute('aria-label', (labelPlay || 'Play') + (it.legenda ? ': ' + it.legenda : ''));
        var thumb = document.createElement('img');
        thumb.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(it.id) + '/hqdefault.jpg';
        thumb.alt = '';
        thumb.width = 480;
        thumb.height = 360;
        thumb.loading = 'lazy';
        var play = document.createElement('span');
        play.className = 'mural__play';
        play.setAttribute('aria-hidden', 'true');
        play.textContent = '▶';
        yt.appendChild(thumb);
        yt.appendChild(play);
        yt.addEventListener('click', function () {
          var iframe = document.createElement('iframe');
          iframe.className = 'mural__iframe';
          iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(it.id) + '?autoplay=1&rel=0';
          iframe.title = it.legenda || labelVideo;
          iframe.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
          iframe.setAttribute('allowfullscreen', '');
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          fig.replaceChild(iframe, yt);
          if (msnry) msnry.layout();
        });
        fig.appendChild(yt);
      }

      if (it.legenda) {
        var cap = document.createElement('figcaption');
        cap.textContent = it.legenda;
        fig.appendChild(cap);
      }
      return fig;
    }

    function loadBatch() {
      if (position >= items.length) return false;
      var els = [];
      var end = Math.min(position + batch, items.length);
      for (; position < end; position++) {
        var el = buildItem(items[position]);
        grid.appendChild(el);
        els.push(el);
      }
      if (window.Masonry) {
        if (!msnry) {
          msnry = new window.Masonry(grid, {
            itemSelector: '.mural__item',
            columnWidth: '.mural__sizer',
            percentPosition: true,
            transitionDuration: 0
          });
        } else {
          msnry.appended(els);
        }
      }
      return position < items.length;
    }

    var observer = null;
    function next() {
      var more = loadBatch();
      if (!more && observer) { observer.disconnect(); return; }
      // Volta a observar para disparar de novo se o sentinela ainda estiver à vista.
      if (observer) { observer.unobserve(sentinel); observer.observe(sentinel); }
    }

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) next();
      }, { rootMargin: '600px 0px' });
      observer.observe(sentinel);
    } else {
      while (loadBatch()) { /* sem IntersectionObserver: carrega tudo */ }
    }

    window.addEventListener('load', function () { if (msnry) msnry.layout(); });
    window.addEventListener('resize', function () { if (msnry) msnry.layout(); });

    if (lightbox) {
      var closeBtn = lightbox.querySelector('[data-lightbox-close]');
      if (closeBtn) closeBtn.addEventListener('click', function () { lightbox.close(); });
      lightbox.addEventListener('click', function (e) { if (e.target === lightbox) lightbox.close(); });
      lightbox.addEventListener('close', function () { lightboxContent.textContent = ''; });
    }
  }

  initCarousel();
  initMural();
})();
