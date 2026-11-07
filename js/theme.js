(() => {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  const getTheme = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
  const applyTheme = (theme, persist = false) => {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = normalized;
    if (persist) {
      try { localStorage.setItem('jogos-theme', normalized); } catch (_) { /* Storage can be disabled. */ }
    }
    if (metaTheme) metaTheme.setAttribute('content', normalized === 'dark' ? '#171612' : '#fffefa');
    buttons.forEach((button) => {
      const dark = normalized === 'dark';
      const label = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(dark));
      const text = button.querySelector('.theme-toggle__label');
      if (text) text.textContent = dark ? 'Modo claro' : 'Modo escuro';
    });
  };

  applyTheme(getTheme());
  buttons.forEach((button) => button.addEventListener('click', () => {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark', true);
  }));

  // Honor system changes until the visitor explicitly chooses a mode.
  try {
    const stored = localStorage.getItem('jogos-theme');
    if (!stored && window.matchMedia) {
      const preference = window.matchMedia('(prefers-color-scheme: dark)');
      const onPreferenceChange = (event) => applyTheme(event.matches ? 'dark' : 'light');
      if (preference.addEventListener) preference.addEventListener('change', onPreferenceChange);
      else if (preference.addListener) preference.addListener(onPreferenceChange);
    }
  } catch (_) { /* Keep the current visual mode. */ }
})();
