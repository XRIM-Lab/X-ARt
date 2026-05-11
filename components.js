// =============================================================================
// Shared Web Components for ARtrio / X-ARt site
// Usage: <script src="/components.js"></script>  (add to every page <head>)
//
// Components:
//   <site-header page="home|tty2|efv"></site-header>
//   <site-footer year="2026" name="「ARtrio」"></site-footer>
//
// Canonical <head> block to include on every page:
//   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>
//   <link rel="preconnect" href="https://fonts.googleapis.com">
//   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
//   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
//   <link rel="stylesheet" href="../style.css">   <!-- adjust depth as needed -->
//   <script src="/components.js"></script>
// =============================================================================

// ---------------------------------------------------------------------------
// <site-header page="home|tty2|efv">
// ---------------------------------------------------------------------------
class SiteHeader extends HTMLElement {
  connectedCallback() {
    const page = this.getAttribute('page') || 'home';

    // Resolve paths relative to the current page's depth
    const depth = this._depth();
    const root  = depth === 0 ? '.' : '..';

    const logoSrc   = `${root}/images/ARtrio_logo_white-01.png`;
    const homeHref  = depth === 0
      ? 'https://xrim-lab.github.io/X-ARt/'
      : `${root}/`;

    // Nav link hrefs
    const links = {
      tty2: depth === 0 ? 'TTY2/' : (depth === 1 ? (page === 'tty2' ? '#' : '../TTY2/') : '../../TTY2/'),
      efv:  depth === 0 ? 'EFV/'  : (depth === 1 ? (page === 'efv'  ? '#' : '../EFV/')  : '../../EFV/'),
    };

    this.innerHTML = `
<header id="siteHeader" class="site-header${page === 'efv' ? ' is-visible' : ''}">
  <div class="header-container site-container">
    <a href="${homeHref}" class="header-brand">
      <img src="${logoSrc}" alt="ARtrio Logo"
           style="width:150px;height:auto;clip-path:inset(20% 0);">
    </a>
    <button class="menu-toggle"
            aria-label="Open navigation menu"
            aria-expanded="false"
            aria-controls="main-nav">
      <span class="hamburger"></span>
    </button>
  </div>
  <nav id="main-nav" class="main-navigation site-container">
    <ul>
      <li class="has-dropdown">
        <a class="dropdown-toggle" role="button">Projects</a>
        <ul class="dropdown-menu">
          <li><a href="${links.tty2}"${page === 'tty2' ? ' aria-current="page"' : ''}>Through The Years, To Touch You</a></li>
          <li><a href="${links.efv}"${page  === 'efv'  ? ' aria-current="page"' : ''}>EQUUS: FORM + VOID</a></li>
        </ul>
      </li>
      <li><a href="#contact">Contact</a></li>
    </ul>
  </nav>
</header>`;

    this._initMenu();
  }

  // Returns the folder depth of the current page (0 = root, 1 = TTY2/ or EFV/, …)
  _depth() {
    const path = window.location.pathname;
    // Count non-empty segments minus the filename
    const segments = path.split('/').filter(Boolean);
    // If last segment looks like a file, don't count it
    const last = segments[segments.length - 1] || '';
    const fileDepth = last.includes('.') ? segments.length - 1 : segments.length;
    return fileDepth;
  }

  _initMenu() {
    const header      = this.querySelector('#siteHeader');
    const menuToggle  = this.querySelector('.menu-toggle');
    const mainNav     = this.querySelector('#main-nav');
    const navLinks    = mainNav ? mainNav.querySelectorAll('a:not(.dropdown-toggle)') : [];
    let autoCloseTimer = null;

    function closeMobileNav() {
      if (document.body.classList.contains('nav-open')) {
        document.body.classList.remove('nav-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
      }
    }

    // Show/hide header on scroll (pages that start hidden use is-visible class)
    function onScrollMenu() {
      if (!header) return;
      if (window.scrollY > window.innerHeight * 0.5) {
        header.classList.add('is-visible');
      } else {
        header.classList.remove('is-visible');
      }
    }

    // Expose so page-level scroll handlers can call it
    window._onScrollMenu = onScrollMenu;

    menuToggle.addEventListener('click', () => {
      const isNavOpen = document.body.classList.contains('nav-open');
      if (isNavOpen) {
        closeMobileNav();
      } else {
        document.body.classList.add('nav-open');
        menuToggle.setAttribute('aria-expanded', 'true');
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = setTimeout(closeMobileNav, 5000);
      }
    });

    navLinks.forEach(link => link.addEventListener('click', closeMobileNav));

    const dropdownToggles = this.querySelectorAll('.dropdown-toggle');
    dropdownToggles.forEach(toggle => {
      toggle.addEventListener('click', event => {
        if (window.innerWidth < 768) {
          event.preventDefault();
          toggle.parentElement.classList.toggle('is-open');
        }
      });
    });
  }
}

customElements.define('site-header', SiteHeader);


// ---------------------------------------------------------------------------
// <site-footer year="2026" name="「ARtrio」">
// ---------------------------------------------------------------------------
class SiteFooter extends HTMLElement {
  connectedCallback() {
    const year = this.getAttribute('year') || new Date().getFullYear();
    const name = this.getAttribute('name') || '「ARtrio」';

    this.innerHTML = `
<footer id="contact" class="site-footer">
  <h2>Contact</h2>
  <p>For enquiries, please contact <a href="mailto:braudt@ust.hk">braudt@ust.hk</a></p>
  <small>&copy; ${year} ${name}</small>
</footer>`;
  }
}

customElements.define('site-footer', SiteFooter);
