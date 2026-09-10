/* LiveFolio theme bootstrap — runs before paint (next/script beforeInteractive,
   external file so React never renders an inline <script> in its tree).
   Applies a stored theme choice, else the OS preference; no flash. */
(function () {
  try {
    var t = localStorage.getItem('livefolio-theme');
    var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {}
})();
