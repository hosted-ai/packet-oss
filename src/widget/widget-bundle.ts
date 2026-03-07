/**
 * Self-contained vanilla JavaScript bundle for the embeddable widget system.
 *
 * This module exports the full widget JS as a string. The route handler at
 * /widget.js serves this string with Content-Type: application/javascript.
 *
 * The bundle is intentionally written as a plain JS string (no React, no
 * framework dependencies). It runs in an IIFE to avoid polluting the global
 * scope except for the intentional window.PacketWidget API.
 *
 * Size target: < 10KB uncompressed.
 */

export const WIDGET_BUNDLE_VERSION = '1.0.0';

export const widgetBundle = /* javascript */ `(function() {
  'use strict';

  var VERSION = '${WIDGET_BUNDLE_VERSION}';
  var VALID_TYPES = ['pricing', 'checkout', 'auth', 'gpu-status'];

  // ── Origin Detection ──────────────────────────────────────────────────
  function detectOrigin() {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src.indexOf('widget.js') !== -1) {
        try {
          var url = new URL(src);
          return url.origin;
        } catch (e) {
          // Fallback for environments where URL constructor is unavailable
        }
      }
    }
    return window.location.origin;
  }

  // ── Fetch Helpers ─────────────────────────────────────────────────────
  function fetchJSON(url) {
    return fetch(url).then(function(res) {
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return res.json();
    });
  }

  // ── Theme Resolution ──────────────────────────────────────────────────
  function resolveTheme(theme) {
    if (theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme || 'light';
  }

  // ── Style Generation ──────────────────────────────────────────────────
  function createBaseStyles(config, theme) {
    var isLight = theme === 'light';
    return [
      ':host {',
      '  display: block;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
      '  line-height: 1.5;',
      '  -webkit-font-smoothing: antialiased;',
      '}',
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
      '.pw-root {',
      '  --pw-primary: ' + config.primaryColor + ';',
      '  --pw-accent: ' + config.accentColor + ';',
      '  --pw-bg: ' + (isLight ? '#ffffff' : '#0f1117') + ';',
      '  --pw-surface: ' + (isLight ? '#f7f8fb' : '#1a1d27') + ';',
      '  --pw-border: ' + (isLight ? '#e2e5ea' : '#2a2d37') + ';',
      '  --pw-text: ' + (isLight ? '#0b0f1c' : '#e8eaed') + ';',
      '  --pw-text-muted: ' + (isLight ? '#5b6476' : '#8b92a5') + ';',
      '  --pw-radius: 8px;',
      '  --pw-radius-lg: 12px;',
      '  --pw-shadow: ' + (isLight
        ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)'
        : '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)') + ';',
      '  background: var(--pw-bg);',
      '  color: var(--pw-text);',
      '  padding: 16px;',
      '  border-radius: var(--pw-radius-lg);',
      '  border: 1px solid var(--pw-border);',
      '}',
      '.pw-loading {',
      '  display: flex; align-items: center; justify-content: center;',
      '  padding: 32px 16px; color: var(--pw-text-muted); font-size: 14px; gap: 8px;',
      '}',
      '.pw-spinner {',
      '  width: 16px; height: 16px;',
      '  border: 2px solid var(--pw-border);',
      '  border-top-color: var(--pw-primary);',
      '  border-radius: 50%;',
      '  animation: pw-spin 0.6s linear infinite;',
      '}',
      '@keyframes pw-spin { to { transform: rotate(360deg); } }',
      '.pw-error {',
      '  padding: 16px; color: #dc2626; font-size: 14px; text-align: center;',
      '  background: ' + (isLight ? '#fef2f2' : '#1c0f0f') + '; border-radius: var(--pw-radius);',
      '}',
      '.pw-header {',
      '  display: flex; align-items: center; gap: 8px;',
      '  margin-bottom: 16px; padding-bottom: 12px;',
      '  border-bottom: 1px solid var(--pw-border);',
      '}',
      '.pw-header-logo { height: 24px; width: auto; }',
      '.pw-header-title { font-size: 16px; font-weight: 600; color: var(--pw-text); }',
      '.pw-powered-by {',
      '  font-size: 11px; color: var(--pw-text-muted); text-align: center;',
      '  margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pw-border);',
      '}',
      '.pw-powered-by a { color: var(--pw-primary); text-decoration: none; }',
      '.pw-powered-by a:hover { text-decoration: underline; }',
      '',
      '/* Pricing widget */',
      '.pw-pricing-toggle-wrap {',
      '  display: flex; align-items: center; justify-content: center; gap: 8px;',
      '  margin-bottom: 16px; font-size: 13px; color: var(--pw-text-muted);',
      '}',
      '.pw-pricing-toggle-label { cursor: pointer; user-select: none; }',
      '.pw-pricing-toggle-label--active { color: var(--pw-text); font-weight: 600; }',
      '.pw-pricing-toggle {',
      '  position: relative; width: 36px; height: 20px; background: var(--pw-border);',
      '  border-radius: 10px; cursor: pointer; border: none; padding: 0;',
      '  transition: background 0.2s;',
      '}',
      '.pw-pricing-toggle--monthly { background: var(--pw-primary); }',
      '.pw-pricing-toggle-knob {',
      '  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;',
      '  background: #fff; border-radius: 50%; transition: transform 0.2s;',
      '}',
      '.pw-pricing-toggle--monthly .pw-pricing-toggle-knob { transform: translateX(16px); }',
      '.pw-pricing-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }',
      '.pw-pricing-card {',
      '  background: var(--pw-surface); border: 1px solid var(--pw-border);',
      '  border-radius: var(--pw-radius); padding: 16px;',
      '  transition: transform 0.15s ease, box-shadow 0.15s ease;',
      '}',
      '.pw-pricing-card:hover {',
      '  transform: translateY(-2px); box-shadow: var(--pw-shadow);',
      '}',
      '.pw-pricing-card--highlight {',
      '  border-color: var(--pw-primary); box-shadow: 0 0 0 1px var(--pw-primary);',
      '}',
      '.pw-pricing-card-name { font-size: 15px; font-weight: 600; margin-bottom: 4px; }',
      '.pw-pricing-card-specs { font-size: 12px; color: var(--pw-text-muted); margin-bottom: 12px; }',
      '.pw-pricing-card-price { font-size: 20px; font-weight: 700; color: var(--pw-primary); }',
      '.pw-pricing-card-unit { font-size: 12px; color: var(--pw-text-muted); font-weight: 400; }',
      '.pw-pricing-card-monthly-note {',
      '  font-size: 12px; color: var(--pw-text-muted); margin-top: 2px;',
      '}',
      '.pw-pricing-card-btn {',
      '  display: block; width: 100%; margin-top: 12px; padding: 8px 16px;',
      '  background: var(--pw-primary); color: #fff; border: none; border-radius: var(--pw-radius);',
      '  font-size: 13px; font-weight: 500; cursor: pointer; text-align: center; text-decoration: none;',
      '}',
      '.pw-pricing-card-btn:hover { opacity: 0.9; }',
      '',
      '/* Skeleton loading */',
      '@keyframes pw-pulse {',
      '  0%, 100% { opacity: 1; }',
      '  50% { opacity: 0.4; }',
      '}',
      '.pw-skeleton-card {',
      '  background: var(--pw-surface); border: 1px solid var(--pw-border);',
      '  border-radius: var(--pw-radius); padding: 16px;',
      '  animation: pw-pulse 1.5s ease-in-out infinite;',
      '}',
      '.pw-skeleton-line {',
      '  background: var(--pw-border); border-radius: 4px;',
      '}',
      '.pw-skeleton-line--title { width: 60%; height: 16px; margin-bottom: 8px; }',
      '.pw-skeleton-line--specs { width: 80%; height: 12px; margin-bottom: 16px; }',
      '.pw-skeleton-line--price { width: 40%; height: 22px; margin-bottom: 12px; }',
      '.pw-skeleton-line--btn { width: 100%; height: 34px; border-radius: var(--pw-radius); }',
      '',
      '/* GPU status widget */',
      '.pw-status-list { display: flex; flex-direction: column; gap: 8px; }',
      '.pw-status-item {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  padding: 12px; background: var(--pw-surface); border: 1px solid var(--pw-border);',
      '  border-radius: var(--pw-radius); transition: background 0.2s;',
      '}',
      '.pw-status-info { display: flex; align-items: center; gap: 8px; }',
      '.pw-status-name { font-size: 14px; font-weight: 500; }',
      '.pw-status-indicator { display: flex; align-items: center; gap: 6px; }',
      '.pw-status-dot {',
      '  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;',
      '}',
      '.pw-status-dot--available { background: #22c55e; }',
      '.pw-status-dot--limited { background: #eab308; }',
      '.pw-status-dot--sold-out { background: #ef4444; }',
      '@keyframes pw-dot-pulse {',
      '  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }',
      '  50% { opacity: 0.85; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }',
      '}',
      '.pw-status-dot--available { animation: pw-dot-pulse 2s ease-in-out infinite; }',
      '.pw-status-label { font-size: 12px; font-weight: 500; color: var(--pw-text-muted); }',
      '.pw-last-updated {',
      '  font-size: 11px; color: var(--pw-text-muted); text-align: center;',
      '  margin-top: 8px; padding-top: 8px;',
      '}',
      '',
      '/* Compact mode */',
      '.pw-compact { padding: 8px; }',
      '.pw-compact .pw-header { display: none; }',
      '.pw-compact .pw-status-item { padding: 8px; }',
      '.pw-compact .pw-status-name { font-size: 12px; }',
      '.pw-compact .pw-status-label { font-size: 11px; }',
      '.pw-compact .pw-status-list { gap: 4px; }',
      '.pw-compact .pw-last-updated { font-size: 10px; margin-top: 4px; padding-top: 4px; }',
      '.pw-compact .pw-powered-by { margin-top: 4px; padding-top: 4px; font-size: 10px; }',
      '',
      '/* Auth widget */',
      '.pw-auth-form { display: flex; flex-direction: column; gap: 12px; }',
      '.pw-auth-input {',
      '  width: 100%; padding: 10px 12px; border: 1px solid var(--pw-border);',
      '  border-radius: var(--pw-radius); font-size: 14px; background: var(--pw-surface);',
      '  color: var(--pw-text); outline: none; transition: border-color 0.2s;',
      '}',
      '.pw-auth-input:focus { border-color: var(--pw-primary); }',
      '.pw-auth-input--error { border-color: #dc2626; }',
      '.pw-auth-btn {',
      '  display: flex; align-items: center; justify-content: center; gap: 8px;',
      '  padding: 10px 16px; background: var(--pw-primary); color: #fff; border: none;',
      '  border-radius: var(--pw-radius); font-size: 14px; font-weight: 500; cursor: pointer;',
      '  transition: opacity 0.2s;',
      '}',
      '.pw-auth-btn:hover { opacity: 0.9; }',
      '.pw-auth-btn:disabled { opacity: 0.6; cursor: not-allowed; }',
      '.pw-auth-btn .pw-spinner { width: 14px; height: 14px; border-width: 2px; }',
      '.pw-auth-error-msg {',
      '  font-size: 13px; color: #dc2626; display: none;',
      '}',
      '.pw-auth-error-msg--visible { display: block; }',
      '.pw-auth-toggle { font-size: 13px; color: var(--pw-text-muted); text-align: center; }',
      '.pw-auth-toggle a { color: var(--pw-primary); cursor: pointer; text-decoration: none; }',
      '.pw-auth-toggle a:hover { text-decoration: underline; }',
      '.pw-auth-success {',
      '  display: flex; flex-direction: column; align-items: center;',
      '  padding: 24px 16px; text-align: center; gap: 12px;',
      '}',
      '.pw-auth-success-icon {',
      '  width: 48px; height: 48px; border-radius: 50%;',
      '  background: #22c55e; display: flex; align-items: center; justify-content: center;',
      '}',
      '.pw-auth-success-icon svg { width: 24px; height: 24px; }',
      '.pw-auth-success-title { font-size: 16px; font-weight: 600; color: var(--pw-text); }',
      '.pw-auth-success-text { font-size: 14px; color: var(--pw-text-muted); line-height: 1.5; }',
      '',
      '/* Checkout widget */',
      '.pw-checkout-card {',
      '  background: var(--pw-surface); border: 1px solid var(--pw-border);',
      '  border-radius: var(--pw-radius); padding: 20px; margin-bottom: 16px;',
      '}',
      '.pw-checkout-gpu-name { font-size: 18px; font-weight: 700; color: var(--pw-text); margin-bottom: 4px; }',
      '.pw-checkout-gpu-specs { font-size: 13px; color: var(--pw-text-muted); margin-bottom: 12px; }',
      '.pw-checkout-gpu-price { font-size: 28px; font-weight: 700; color: var(--pw-primary); }',
      '.pw-checkout-gpu-unit { font-size: 14px; font-weight: 400; color: var(--pw-text-muted); }',
      '.pw-checkout-btn {',
      '  display: block; width: 100%; padding: 12px 16px;',
      '  background: var(--pw-primary); color: #fff; border: none; border-radius: var(--pw-radius);',
      '  font-size: 15px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none;',
      '  transition: opacity 0.2s;',
      '}',
      '.pw-checkout-btn:hover { opacity: 0.9; }',
      '.pw-checkout-note {',
      '  font-size: 12px; color: var(--pw-text-muted); text-align: center; margin-top: 12px;',
      '}',
      '.pw-checkout-empty {',
      '  display: flex; flex-direction: column; align-items: center;',
      '  padding: 24px 16px; text-align: center; gap: 12px;',
      '}',
      '.pw-checkout-empty-icon { color: var(--pw-text-muted); }',
      '.pw-checkout-empty-text { font-size: 14px; color: var(--pw-text-muted); line-height: 1.5; }',
      '.pw-checkout-iframe-wrap { width: 100%; }',
      '.pw-checkout-iframe {',
      '  width: 100%; border: none; min-height: 280px;',
      '  background: transparent; display: block;',
      '}',
    ].join('\\n');
  }

  // ── Shadow DOM Setup ──────────────────────────────────────────────────
  function createShadow(host) {
    host.innerHTML = '';
    return host.attachShadow({ mode: 'open' });
  }

  function injectStyles(shadow, css) {
    var style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
    return style;
  }

  // ── Widget Title Map ──────────────────────────────────────────────────
  var WIDGET_TITLES = {
    'pricing': 'GPU Pricing',
    'checkout': 'Checkout',
    'auth': 'Sign In',
    'gpu-status': 'GPU Availability'
  };

  // ── Widget Renderers ─────────────────────────────────────────────────

  function renderPricing(root, config, origin, options) {
    options = options || {};
    var SKELETON_COUNT = 3;

    // ── Skeleton Loading ──
    var skeletonGrid = document.createElement('div');
    skeletonGrid.className = 'pw-pricing-grid';
    for (var s = 0; s < SKELETON_COUNT; s++) {
      var sk = document.createElement('div');
      sk.className = 'pw-skeleton-card';
      sk.style.animationDelay = (s * 0.15) + 's';
      sk.innerHTML =
        '<div class="pw-skeleton-line pw-skeleton-line--title"></div>' +
        '<div class="pw-skeleton-line pw-skeleton-line--specs"></div>' +
        '<div class="pw-skeleton-line pw-skeleton-line--price"></div>' +
        '<div class="pw-skeleton-line pw-skeleton-line--btn"></div>';
      skeletonGrid.appendChild(sk);
    }
    root.appendChild(skeletonGrid);

    // ── Fetch & Render ──
    fetchJSON(origin + '/api/widget/pricing').then(function(gpus) {
      skeletonGrid.remove();

      // ── Hourly / Monthly Toggle ──
      var isMonthly = false;
      var hasAnyMonthly = gpus.some(function(g) { return !!g.monthlyRateCents; });

      var toggleWrap = document.createElement('div');
      toggleWrap.className = 'pw-pricing-toggle-wrap';

      if (hasAnyMonthly) {
        var lblHourly = document.createElement('span');
        lblHourly.className = 'pw-pricing-toggle-label pw-pricing-toggle-label--active';
        lblHourly.textContent = 'Hourly';

        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'pw-pricing-toggle';
        toggleBtn.setAttribute('aria-label', 'Toggle monthly pricing');
        toggleBtn.innerHTML = '<div class="pw-pricing-toggle-knob"></div>';

        var lblMonthly = document.createElement('span');
        lblMonthly.className = 'pw-pricing-toggle-label';
        lblMonthly.textContent = 'Monthly';

        toggleWrap.appendChild(lblHourly);
        toggleWrap.appendChild(toggleBtn);
        toggleWrap.appendChild(lblMonthly);
        root.appendChild(toggleWrap);
      }

      // ── Card Grid ──
      var grid = document.createElement('div');
      grid.className = 'pw-pricing-grid';

      // Find cheapest hourly GPU
      var cheapestType = '';
      var cheapestRate = Infinity;
      gpus.forEach(function(gpu) {
        if (gpu.hourlyRateCents < cheapestRate) {
          cheapestRate = gpu.hourlyRateCents;
          cheapestType = gpu.gpuType;
        }
      });

      gpus.forEach(function(gpu) {
        var card = document.createElement('div');
        var highlight = options.gpu
          ? gpu.gpuType === options.gpu
          : gpu.gpuType === cheapestType;
        card.className = 'pw-pricing-card' + (highlight ? ' pw-pricing-card--highlight' : '');

        var hourly = (gpu.hourlyRateCents / 100).toFixed(2);
        var monthly = gpu.monthlyRateCents ? (gpu.monthlyRateCents / 100).toFixed(0) : null;

        // Build card content
        var nameEl = '<div class="pw-pricing-card-name">' + escapeHtml(gpu.name) + '</div>';
        var specsEl = gpu.specs
          ? '<div class="pw-pricing-card-specs">' + escapeHtml(gpu.specs.vram) + ' \\u00B7 ' + escapeHtml(gpu.specs.architecture) + '</div>'
          : '';
        var priceEl = '<div class="pw-pricing-card-price" data-hourly="' + escapeAttr(hourly) + '" data-monthly="' + escapeAttr(monthly || '') + '">' +
          '$' + hourly + '<span class="pw-pricing-card-unit">/hr</span></div>';
        var monthlyNote = monthly
          ? '<div class="pw-pricing-card-monthly-note">or $' + monthly + '/mo</div>'
          : '';

        card.innerHTML = nameEl + specsEl + priceEl + monthlyNote;

        // Button
        var btn;
        if (options.onSelect) {
          btn = document.createElement('button');
          btn.className = 'pw-pricing-card-btn';
          btn.textContent = 'Get Started';
          btn.addEventListener('click', function() {
            options.onSelect({
              gpuType: gpu.gpuType,
              name: gpu.name,
              hourlyRateCents: gpu.hourlyRateCents,
              monthlyRateCents: gpu.monthlyRateCents || null
            });
          });
        } else {
          btn = document.createElement('a');
          btn.className = 'pw-pricing-card-btn';
          btn.textContent = 'Get Started';
          btn.href = config.dashboardUrl;
          btn.target = '_blank';
          btn.rel = 'noopener';
        }
        card.appendChild(btn);

        grid.appendChild(card);
      });

      root.appendChild(grid);

      // ── Toggle Wiring ──
      if (hasAnyMonthly) {
        var toggleEl = toggleWrap.querySelector('.pw-pricing-toggle');
        var hourlyLabel = toggleWrap.querySelector('.pw-pricing-toggle-label');
        var monthlyLabel = toggleWrap.querySelectorAll('.pw-pricing-toggle-label')[1];

        function updatePrices() {
          var cards = grid.querySelectorAll('.pw-pricing-card-price');
          var notes = grid.querySelectorAll('.pw-pricing-card-monthly-note');

          for (var i = 0; i < cards.length; i++) {
            var priceDiv = cards[i];
            var h = priceDiv.getAttribute('data-hourly');
            var m = priceDiv.getAttribute('data-monthly');
            if (isMonthly && m) {
              priceDiv.innerHTML = '$' + m + '<span class="pw-pricing-card-unit">/mo</span>';
            } else if (isMonthly && !m) {
              priceDiv.innerHTML = '<span style="font-size:14px">Contact us</span>';
            } else {
              priceDiv.innerHTML = '$' + h + '<span class="pw-pricing-card-unit">/hr</span>';
            }
          }

          for (var j = 0; j < notes.length; j++) {
            notes[j].style.display = isMonthly ? 'none' : '';
          }

          if (isMonthly) {
            toggleEl.classList.add('pw-pricing-toggle--monthly');
            monthlyLabel.classList.add('pw-pricing-toggle-label--active');
            hourlyLabel.classList.remove('pw-pricing-toggle-label--active');
          } else {
            toggleEl.classList.remove('pw-pricing-toggle--monthly');
            hourlyLabel.classList.add('pw-pricing-toggle-label--active');
            monthlyLabel.classList.remove('pw-pricing-toggle-label--active');
          }
        }

        toggleEl.addEventListener('click', function() {
          isMonthly = !isMonthly;
          updatePrices();
        });

        // Also allow clicking the labels to toggle
        hourlyLabel.addEventListener('click', function() {
          if (isMonthly) { isMonthly = false; updatePrices(); }
        });
        monthlyLabel.addEventListener('click', function() {
          if (!isMonthly) { isMonthly = true; updatePrices(); }
        });
      }

    }).catch(function(err) {
      skeletonGrid.remove();
      var errorEl = document.createElement('div');
      errorEl.className = 'pw-error';
      errorEl.textContent = 'Failed to load pricing data.';
      root.appendChild(errorEl);
      console.error('[PacketWidget] Pricing fetch error:', err);
    });
  }

  function renderGpuStatus(root, config, origin, options) {
    options = options || {};
    var pollInterval = options.pollInterval || 30000;
    var pollTimerId = null;
    var tickTimerId = null;
    var lastFetchTime = null;
    var listEl = null;
    var updatedEl = null;
    var destroyed = false;

    // Apply compact mode
    if (options.compact) {
      root.classList.add('pw-compact');
    }

    // Loading state
    var content = document.createElement('div');
    content.className = 'pw-loading';
    content.innerHTML = '<div class="pw-spinner"></div><span>Loading GPU status...</span>';
    root.appendChild(content);

    function statusDotClass(status) {
      if (status === 'available') return 'pw-status-dot pw-status-dot--available';
      if (status === 'limited') return 'pw-status-dot pw-status-dot--limited';
      return 'pw-status-dot pw-status-dot--sold-out';
    }

    function statusLabel(status) {
      if (status === 'available') return 'Available';
      if (status === 'limited') return 'Limited';
      return 'Sold Out';
    }

    function updateLastUpdatedText() {
      if (!updatedEl || !lastFetchTime) return;
      var seconds = Math.floor((Date.now() - lastFetchTime) / 1000);
      if (seconds < 5) {
        updatedEl.textContent = 'Updated just now';
      } else {
        updatedEl.textContent = 'Updated ' + seconds + 's ago';
      }
    }

    function updateListInPlace(gpus) {
      if (!listEl) return;
      gpus.forEach(function(gpu) {
        var item = listEl.querySelector('[data-gpu-type="' + gpu.gpuType + '"]');
        if (item) {
          var dot = item.querySelector('.pw-status-dot');
          if (dot) { dot.className = statusDotClass(gpu.status); }
          var label = item.querySelector('.pw-status-label');
          if (label) { label.textContent = statusLabel(gpu.status); }
        } else {
          // New GPU appeared — append it
          listEl.appendChild(createStatusItem(gpu));
        }
      });
    }

    function createStatusItem(gpu) {
      var item = document.createElement('div');
      item.className = 'pw-status-item';
      item.setAttribute('data-gpu-type', gpu.gpuType);
      item.innerHTML =
        '<div class="pw-status-info">' +
          '<span class="pw-status-name">' + escapeHtml(gpu.name) + '</span>' +
        '</div>' +
        '<div class="pw-status-indicator">' +
          '<span class="' + statusDotClass(gpu.status) + '"></span>' +
          '<span class="pw-status-label">' + escapeHtml(statusLabel(gpu.status)) + '</span>' +
        '</div>';
      return item;
    }

    function doFetch() {
      return fetchJSON(origin + '/api/widget/gpu-status').then(function(gpus) {
        lastFetchTime = Date.now();
        return gpus;
      });
    }

    function poll() {
      doFetch().then(function(gpus) {
        if (destroyed) return;
        updateListInPlace(gpus);
        updateLastUpdatedText();
      }).catch(function(err) {
        console.error('[PacketWidget] GPU status poll error:', err);
      });
    }

    function startPolling() {
      // Poll for new data
      pollTimerId = setInterval(function() {
        if (destroyed) return;
        poll();
      }, pollInterval);

      // Tick the "updated X seconds ago" text every second
      tickTimerId = setInterval(function() {
        if (destroyed) return;
        updateLastUpdatedText();
      }, 1000);
    }

    // Initial fetch
    doFetch().then(function(gpus) {
      if (destroyed) return;
      content.remove();

      listEl = document.createElement('div');
      listEl.className = 'pw-status-list';

      gpus.forEach(function(gpu) {
        listEl.appendChild(createStatusItem(gpu));
      });

      root.appendChild(listEl);

      // Last updated text
      updatedEl = document.createElement('div');
      updatedEl.className = 'pw-last-updated';
      updatedEl.textContent = 'Updated just now';
      root.appendChild(updatedEl);

      // Start polling
      startPolling();
    }).catch(function(err) {
      if (destroyed) return;
      content.remove();
      var errorEl = document.createElement('div');
      errorEl.className = 'pw-error';
      errorEl.textContent = 'Failed to load GPU status.';
      root.appendChild(errorEl);
      console.error('[PacketWidget] GPU status fetch error:', err);
    });

    // Return cleanup function
    return function destroy() {
      destroyed = true;
      if (pollTimerId) { clearInterval(pollTimerId); pollTimerId = null; }
      if (tickTimerId) { clearInterval(tickTimerId); tickTimerId = null; }
    };
  }

  function renderAuth(root, config, origin, options) {
    options = options || {};
    var isLogin = (options.mode === 'login');

    function buildForm(loginMode) {
      var form = document.createElement('div');
      form.className = 'pw-auth-form';

      // Email input
      var emailInput = document.createElement('input');
      emailInput.className = 'pw-auth-input';
      emailInput.type = 'email';
      emailInput.placeholder = 'Email address';
      emailInput.autocomplete = 'email';
      emailInput.setAttribute('aria-label', 'Email address');
      form.appendChild(emailInput);

      // Error message (hidden by default)
      var errorMsg = document.createElement('div');
      errorMsg.className = 'pw-auth-error-msg';
      form.appendChild(errorMsg);

      // Submit button
      var btn = document.createElement('button');
      btn.className = 'pw-auth-btn';
      btn.type = 'button';
      var btnLabel = document.createElement('span');
      btnLabel.textContent = loginMode ? 'Send Login Link' : 'Create Account';
      btn.appendChild(btnLabel);
      form.appendChild(btn);

      // Toggle between sign-in and sign-up
      var toggleDiv = document.createElement('div');
      toggleDiv.className = 'pw-auth-toggle';
      toggleDiv.innerHTML = loginMode
        ? 'Don\\u2019t have an account? <a data-pw-toggle>Sign up</a>'
        : 'Already have an account? <a data-pw-toggle>Sign in</a>';
      form.appendChild(toggleDiv);

      // --- State helpers ---
      function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.add('pw-auth-error-msg--visible');
        emailInput.classList.add('pw-auth-input--error');
        if (options.onError) {
          try { options.onError({ message: msg }); } catch (e) { console.error(e); }
        }
      }

      function clearError() {
        errorMsg.textContent = '';
        errorMsg.classList.remove('pw-auth-error-msg--visible');
        emailInput.classList.remove('pw-auth-input--error');
      }

      function setLoading(loading) {
        btn.disabled = loading;
        emailInput.disabled = loading;
        if (loading) {
          btn.innerHTML = '<div class="pw-spinner"></div><span>Sending...</span>';
        } else {
          btn.innerHTML = '';
          var lbl = document.createElement('span');
          lbl.textContent = loginMode ? 'Send Login Link' : 'Create Account';
          btn.appendChild(lbl);
        }
      }

      function showSuccess(email, message) {
        form.remove();
        var success = document.createElement('div');
        success.className = 'pw-auth-success';
        success.innerHTML =
          '<div class="pw-auth-success-icon">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
              '<polyline points="20 6 9 17 4 12"></polyline>' +
            '</svg>' +
          '</div>' +
          '<div class="pw-auth-success-title">Check your email</div>' +
          '<div class="pw-auth-success-text">' +
            'We sent a login link to <strong>' + escapeHtml(email) + '</strong>. ' +
            'Click the link in the email to access your account.' +
          '</div>';
        root.appendChild(success);

        if (options.onSuccess) {
          try { options.onSuccess({ email: email, message: message }); } catch (e) { console.error(e); }
        }
      }

      // --- Email validation ---
      function isValidEmail(val) {
        return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val);
      }

      // --- Submit handler ---
      function handleSubmit() {
        clearError();
        var email = emailInput.value.trim().toLowerCase();

        if (!email) {
          showError('Please enter your email address.');
          emailInput.focus();
          return;
        }

        if (!isValidEmail(email)) {
          showError('Please enter a valid email address.');
          emailInput.focus();
          return;
        }

        setLoading(true);

        fetch(origin + '/api/widget/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        }).then(function(res) {
          return res.json().then(function(data) {
            if (!res.ok) {
              throw new Error(data.error || 'Request failed');
            }
            return data;
          });
        }).then(function(data) {
          showSuccess(email, data.message || 'Check your email for a login link');
        }).catch(function(err) {
          setLoading(false);
          showError(err.message || 'Something went wrong. Please try again.');
        });
      }

      // Bind events
      btn.addEventListener('click', handleSubmit);
      emailInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { handleSubmit(); }
      });
      emailInput.addEventListener('input', function() {
        if (errorMsg.classList.contains('pw-auth-error-msg--visible')) {
          clearError();
        }
      });

      // Toggle link
      var toggleLink = toggleDiv.querySelector('[data-pw-toggle]');
      if (toggleLink) {
        toggleLink.addEventListener('click', function() {
          form.remove();
          root.appendChild(buildForm(!loginMode));
        });
      }

      return form;
    }

    root.appendChild(buildForm(isLogin));
  }

  // ── GPU Catalog (for checkout display) ───────────────────────────────
  var GPU_CATALOG = {
    'rtx-pro-6000': { name: 'RTX PRO 6000', vram: '96GB GDDR7', arch: 'Blackwell', hourly: 66 },
    'b200': { name: 'NVIDIA B200', vram: '180GB HBM3e', arch: 'Blackwell', hourly: 225 },
    'h200': { name: 'NVIDIA H200', vram: '141GB HBM3e', arch: 'Hopper', hourly: 150 },
    'h100': { name: 'NVIDIA H100', vram: '80GB HBM3', arch: 'Hopper', hourly: 249 }
  };

  function renderCheckout(root, config, origin, options) {
    options = options || {};
    var checkoutMode = options.checkoutMode || options.mode || 'redirect';
    var gpuType = options.gpu || '';
    var gpu = gpuType ? GPU_CATALOG[gpuType] : null;

    if (!gpuType || !gpu) {
      // No GPU selected — prompt to pick one
      var empty = document.createElement('div');
      empty.className = 'pw-checkout-empty';
      empty.innerHTML =
        '<div class="pw-checkout-empty-icon">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--pw-text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>' +
            '<line x1="8" y1="21" x2="16" y2="21"></line>' +
            '<line x1="12" y1="17" x2="12" y2="21"></line>' +
          '</svg>' +
        '</div>' +
        '<div class="pw-checkout-empty-text">Select a GPU from the pricing widget to proceed with checkout.</div>';
      root.appendChild(empty);
      return;
    }

    if (checkoutMode === 'embedded') {
      // ── Embedded mode: iframe ──
      var wrap = document.createElement('div');
      wrap.className = 'pw-checkout-iframe-wrap';

      var iframe = document.createElement('iframe');
      iframe.className = 'pw-checkout-iframe';
      iframe.src = origin + '/widget/checkout?gpu=' + encodeURIComponent(gpuType);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('scrolling', 'no');
      iframe.setAttribute('allowtransparency', 'true');
      iframe.setAttribute('title', 'Checkout');
      wrap.appendChild(iframe);
      root.appendChild(wrap);

      // Listen for postMessage from iframe
      function handleMessage(event) {
        // Only accept messages from our origin
        if (event.origin !== origin) return;
        var data = event.data;
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'checkout-resize' && typeof data.height === 'number') {
          iframe.style.height = data.height + 'px';
        } else if (data.type === 'checkout-complete') {
          if (options.onCheckoutComplete) {
            try {
              options.onCheckoutComplete({
                orderId: data.orderId || null,
                redirectUrl: data.redirectUrl || config.dashboardUrl
              });
            } catch (e) { console.error(e); }
          }
        } else if (data.type === 'checkout-error') {
          if (options.onError) {
            try {
              options.onError({ message: data.message || 'Checkout failed' });
            } catch (e) { console.error(e); }
          }
        }
      }

      window.addEventListener('message', handleMessage);

      // Return cleanup function
      return function() {
        window.removeEventListener('message', handleMessage);
      };

    } else {
      // ── Redirect mode (default) ──
      var hourly = (gpu.hourly / 100).toFixed(2);
      var redirectUrl = config.dashboardUrl + '/dashboard?gpu=' + encodeURIComponent(gpuType);

      var card = document.createElement('div');
      card.className = 'pw-checkout-card';
      card.innerHTML =
        '<div class="pw-checkout-gpu-name">' + escapeHtml(gpu.name) + '</div>' +
        '<div class="pw-checkout-gpu-specs">' + escapeHtml(gpu.vram) + ' \\u00B7 ' + escapeHtml(gpu.arch) + '</div>' +
        '<div class="pw-checkout-gpu-price">$' + hourly + '<span class="pw-checkout-gpu-unit">/hr</span></div>';
      root.appendChild(card);

      var btn = document.createElement('a');
      btn.className = 'pw-checkout-btn';
      btn.href = redirectUrl;
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.textContent = 'Deploy ' + gpu.name;
      btn.addEventListener('click', function() {
        if (options.onCheckoutComplete) {
          try {
            options.onCheckoutComplete({ redirectUrl: redirectUrl });
          } catch (e) { console.error(e); }
        }
      });
      root.appendChild(btn);

      var note = document.createElement('div');
      note.className = 'pw-checkout-note';
      note.textContent = 'You\\u2019ll be redirected to the ' + config.brandName + ' dashboard to complete setup.';
      root.appendChild(note);
    }
  }

  // ── HTML Escaping ─────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // ── Widget Mounting ───────────────────────────────────────────────────
  var _instances = [];

  function mountWidget(host, type, config, options, origin) {
    var theme = resolveTheme(options.theme);
    var shadow = createShadow(host);
    injectStyles(shadow, createBaseStyles(config, theme));

    var root = document.createElement('div');
    root.className = 'pw-root';

    // Header
    var header = document.createElement('div');
    header.className = 'pw-header';
    if (config.logoUrl) {
      header.innerHTML = '<img class="pw-header-logo" src="' + escapeAttr(config.logoUrl) + '" alt="' + escapeAttr(config.brandName) + '" />';
    }
    var title = document.createElement('span');
    title.className = 'pw-header-title';
    title.textContent = WIDGET_TITLES[type] || type;
    header.appendChild(title);
    root.appendChild(header);

    // Body — delegate to type-specific renderer
    var widgetCleanup = null;
    if (type === 'pricing') {
      renderPricing(root, config, origin, options);
    } else if (type === 'gpu-status') {
      widgetCleanup = renderGpuStatus(root, config, origin, options);
    } else if (type === 'auth') {
      renderAuth(root, config, origin, options);
    } else if (type === 'checkout') {
      widgetCleanup = renderCheckout(root, config, origin, options) || null;
    }

    // Footer
    var footer = document.createElement('div');
    footer.className = 'pw-powered-by';
    footer.innerHTML = 'Powered by <a href="' + escapeAttr(config.dashboardUrl) + '" target="_blank" rel="noopener">' + escapeHtml(config.brandName) + '</a>';
    root.appendChild(footer);

    shadow.appendChild(root);

    var id = 'pw-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    var instance = {
      id: id,
      type: type,
      host: host,
      shadow: shadow,
      options: options,
      destroy: function() {
        if (widgetCleanup) { widgetCleanup(); }
        shadow.innerHTML = '';
        host.innerHTML = '';
        _instances = _instances.filter(function(inst) { return inst.id !== id; });
      }
    };

    _instances.push(instance);
    return instance;
  }

  // ── Auto-Discovery ────────────────────────────────────────────────────
  function autoDiscover(config, origin) {
    var elements = document.querySelectorAll('[data-packet-widget]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var type = el.getAttribute('data-packet-widget');
      if (VALID_TYPES.indexOf(type) === -1) {
        console.warn('[PacketWidget] Unknown widget type: "' + type + '"');
        continue;
      }

      // Skip if already initialized
      if (el.shadowRoot) continue;

      var rawPollInterval = el.getAttribute('data-poll-interval');
      var options = {
        theme: el.getAttribute('data-theme') || 'light',
        gpu: el.getAttribute('data-gpu') || undefined,
        mode: el.getAttribute('data-mode') || undefined,
        checkoutMode: el.getAttribute('data-checkout-mode') || undefined,
        compact: el.getAttribute('data-compact') === 'true',
        pollInterval: rawPollInterval ? parseInt(rawPollInterval, 10) : undefined
      };

      try {
        mountWidget(el, type, config, options, origin);
      } catch (err) {
        console.error('[PacketWidget] Failed to mount ' + type + ' widget:', err);
      }
    }
  }

  // ── Initialization ────────────────────────────────────────────────────
  var _config = null;
  var _origin = null;
  var _ready = false;
  var _readyCallbacks = [];

  function init() {
    _origin = detectOrigin();

    fetchJSON(_origin + '/api/widget/config').then(function(config) {
      _config = config;
      _ready = true;

      // Auto-discover declarative widgets
      autoDiscover(config, _origin);

      // Fire queued callbacks
      _readyCallbacks.forEach(function(cb) { try { cb(config); } catch(e) { console.error(e); } });
      _readyCallbacks = [];

    }).catch(function(err) {
      console.error('[PacketWidget] Initialization failed:', err);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.PacketWidget = {
    version: VERSION,

    /** Render a widget into a container. */
    render: function(type, opts) {
      opts = opts || {};

      if (VALID_TYPES.indexOf(type) === -1) {
        throw new Error('[PacketWidget] Unknown widget type: "' + type + '"');
      }

      var doRender = function(config) {
        var host;
        if (typeof opts.container === 'string') {
          host = document.querySelector(opts.container);
          if (!host) throw new Error('[PacketWidget] Container not found: ' + opts.container);
        } else if (opts.container instanceof HTMLElement) {
          host = opts.container;
        } else {
          throw new Error('[PacketWidget] A container (CSS selector or HTMLElement) is required');
        }

        return mountWidget(host, type, config, opts, _origin);
      };

      if (_ready && _config) {
        return doRender(_config);
      }

      // If not ready yet, queue the render
      return new Promise(function(resolve, reject) {
        _readyCallbacks.push(function(config) {
          try { resolve(doRender(config)); }
          catch (e) { reject(e); }
        });
      });
    },

    /** Register a callback for when the widget system is ready. */
    onReady: function(callback) {
      if (_ready && _config) {
        callback(_config);
      } else {
        _readyCallbacks.push(callback);
      }
    },

    /** Get all active widget instances. */
    getInstances: function() {
      return _instances.slice();
    },

    /** Destroy all widget instances. */
    destroyAll: function() {
      _instances.slice().forEach(function(inst) { inst.destroy(); });
    },

    /** Get the loaded tenant configuration. */
    getConfig: function() {
      return _config;
    }
  };

  // ── Boot ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();`;
