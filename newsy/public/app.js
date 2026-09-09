(function () {
  const REFRESH_MS = 5 * 60 * 1000;
  const feedEl = document.getElementById('feed');
  const emptyStateEl = document.getElementById('empty-state');
  const statusDotEl = document.getElementById('status-dot');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const autoscrollCheckbox = document.getElementById('autoscroll-checkbox');
  const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const seenKeys = new Set();
  let activeCategory = 'all';
  let consecutiveFailures = 0;

  function keyFor(headline) {
    return headline.url || `${headline.source}|${headline.title}`;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return 'NOW';
    if (minutes < 60) return `${minutes} MIN`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} HR`;
    const days = Math.round(hours / 24);
    return `${days} D`;
  }

  function buildHeadlineEl(headline, isNew) {
    const article = document.createElement('article');
    article.className = 'headline';
    article.dataset.category = headline.category || 'all';
    if (isNew && !prefersReducedMotion) article.classList.add('is-new');

    const link = document.createElement('a');
    link.className = 'headline-link';
    link.href = headline.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const title = document.createElement('div');
    title.className = 'headline-title';
    title.textContent = headline.title;

    const meta = document.createElement('div');
    meta.className = 'headline-meta';
    const parts = [];
    if (headline.source) parts.push(headline.source);
    const rel = relativeTime(headline.publishedAt);
    if (rel) parts.push(rel);
    meta.textContent = parts.join(' · ');

    link.appendChild(title);
    link.appendChild(meta);
    article.appendChild(link);
    applyFilterTo(article);
    return article;
  }

  function applyFilterTo(articleEl) {
    const matches = activeCategory === 'all' || articleEl.dataset.category === activeCategory;
    articleEl.classList.toggle('is-hidden', !matches);
  }

  function render(headlines) {
    feedEl.innerHTML = '';
    seenKeys.clear();
    if (!headlines.length) {
      emptyStateEl.hidden = false;
      return;
    }
    emptyStateEl.hidden = true;
    const fragment = document.createDocumentFragment();
    headlines.forEach((headline) => {
      seenKeys.add(keyFor(headline));
      fragment.appendChild(buildHeadlineEl(headline, false));
    });
    feedEl.appendChild(fragment);
  }

  function mergeIn(headlines) {
    if (!feedEl.children.length) {
      render(headlines);
      return;
    }
    const newOnes = headlines.filter((h) => !seenKeys.has(keyFor(h)));
    if (!newOnes.length) return;
    const fragment = document.createDocumentFragment();
    newOnes.reverse().forEach((headline) => {
      seenKeys.add(keyFor(headline));
      fragment.appendChild(buildHeadlineEl(headline, true));
    });
    feedEl.insertBefore(fragment, feedEl.firstChild);
  }

  function setConnectionOk(ok) {
    if (ok) {
      consecutiveFailures = 0;
      statusDotEl.hidden = true;
    } else {
      consecutiveFailures++;
      statusDotEl.hidden = consecutiveFailures < 2;
    }
  }

  async function loadNews(isInitial) {
    try {
      const res = await fetch('/api/news', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const headlines = Array.isArray(data.headlines) ? data.headlines : [];
      if (isInitial) {
        render(headlines);
      } else {
        mergeIn(headlines);
      }
      setConnectionOk(true);
    } catch (err) {
      setConnectionOk(false);
      // Keep whatever is currently displayed; the next scheduled fetch will retry.
    }
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      filterButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      Array.from(feedEl.children).forEach(applyFilterTo);
    });
  });

  // --- Optional auto-scroll ---
  let autoScrollActive = false;
  let autoScrollRaf = null;

  function autoScrollStep() {
    if (!autoScrollActive) return;
    window.scrollBy(0, prefersReducedMotion ? 0 : 0.6);
    autoScrollRaf = requestAnimationFrame(autoScrollStep);
  }

  function stopAutoScroll(uncheckBox) {
    autoScrollActive = false;
    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
    if (uncheckBox) autoscrollCheckbox.checked = false;
  }

  autoscrollCheckbox.addEventListener('change', () => {
    if (autoscrollCheckbox.checked) {
      autoScrollActive = true;
      autoScrollRaf = requestAnimationFrame(autoScrollStep);
    } else {
      stopAutoScroll(false);
    }
  });

  ['wheel', 'touchstart', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, () => {
      if (autoScrollActive) stopAutoScroll(true);
    }, { passive: true });
  });

  settingsBtn.addEventListener('click', () => {
    const isOpen = !settingsPanel.hidden;
    settingsPanel.hidden = isOpen;
    settingsBtn.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', (e) => {
    if (settingsPanel.hidden) return;
    if (e.target === settingsBtn || settingsPanel.contains(e.target)) return;
    settingsPanel.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  });

  loadNews(true);
  setInterval(() => loadNews(false), REFRESH_MS);
})();
