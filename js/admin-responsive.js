(() => {
  const dashboard = document.getElementById('dashboard');
  const sidebar = document.getElementById('admin-sidebar');
  const toggle = document.querySelector('.admin-menu-toggle');
  const backdrop = document.querySelector('.admin-sidebar-backdrop');
  const closeButton = document.querySelector('.admin-sidebar__close');

  if (!dashboard || !sidebar || !toggle || !backdrop) return;

  const mobileQuery = window.matchMedia('(max-width: 760px)');

  function setMenuOpen(isOpen) {
    const shouldOpen = Boolean(isOpen && mobileQuery.matches);
    document.body.classList.toggle('admin-menu-open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    toggle.setAttribute('aria-label', shouldOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação');
    sidebar.setAttribute('aria-hidden', String(mobileQuery.matches && !shouldOpen));
    backdrop.setAttribute('aria-hidden', String(!shouldOpen));
  }

  toggle.addEventListener('click', () => {
    setMenuOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  backdrop.addEventListener('click', () => setMenuOpen(false));
  closeButton?.addEventListener('click', () => setMenuOpen(false));

  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('[data-admin-nav]')) setMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('admin-menu-open')) {
      setMenuOpen(false);
      toggle.focus();
    }
  });

  mobileQuery.addEventListener('change', () => setMenuOpen(false));
  setMenuOpen(false);
})();
