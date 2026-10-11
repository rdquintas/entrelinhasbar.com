/* Homepage "A Equipa": the theme only marks the team row as .section-appeared-once when it is
   already halfway up the screen; trigger the photos' entrance as soon as the title starts to show */
(function () {
	var row = document.querySelector('.elementor-2 .elementor-element-3bcb9d8');
	if (!row) return;
	var trigger = document.querySelector('.elementor-2 .elementor-element-0c990e4') || row;

	function reveal() {
		row.classList.add('section-appeared-once');
		row.querySelectorAll('img[loading="lazy"]').forEach(function (img) { img.loading = 'eager'; });
	}

	if (!('IntersectionObserver' in window)) { reveal(); return; }
	var io = new IntersectionObserver(function (entries) {
		if (entries.some(function (e) { return e.isIntersecting; })) { reveal(); io.disconnect(); }
	}, { rootMargin: '0px 0px 15% 0px' });
	io.observe(trigger);
})();
