/* Homepage hero carousel: crossfades background images + text, autoplay with dot navigation */
(function () {
	var slider = document.querySelector('.hero-slider');
	if (!slider) return;

	var slides = slider.querySelectorAll('.hero-slide');
	var dots = slider.querySelectorAll('.hero-dot');
	var bgs = document.querySelectorAll('.hero-slides-bg .hero-bg');
	var interval = 6000;
	var current = 0;
	var timer;

	// Background images come from the build without state: activate the first one
	if (bgs[0]) bgs[0].classList.add('is-active');

	function show(index) {
		index = (index + slides.length) % slides.length;
		if (index === current) return;
		// Keep the outgoing image fully visible underneath while the new one fades in
		bgs.forEach(function (el, i) {
			el.classList.toggle('is-prev', i === current);
		});
		current = index;
		[slides, dots, bgs].forEach(function (list) {
			list.forEach(function (el, i) {
				el.classList.toggle('is-active', i === current);
			});
		});
		slides.forEach(function (el, i) {
			if (i === current) el.removeAttribute('aria-hidden');
			else el.setAttribute('aria-hidden', 'true');
		});
		dots.forEach(function (el, i) {
			if (i === current) el.setAttribute('aria-current', 'true');
			else el.removeAttribute('aria-current');
		});
	}

	function start() {
		clearInterval(timer);
		timer = setInterval(function () {
			show(current + 1);
		}, interval);
	}

	dots.forEach(function (dot, i) {
		dot.addEventListener('click', function () {
			show(i);
			start();
		});
	});

	document.addEventListener('visibilitychange', function () {
		if (document.hidden) clearInterval(timer);
		else start();
	});

	start();
})();
