/**
 * AgentBridge Content Script — Page Observer
 * 
 * Injected into approved pages to:
 * - Detect challenges (CAPTCHA, MFA, security prompts)
 * - Monitor page changes for snapshot invalidation
 * - Detect prompt injection attempts in page content
 * - Report page signals back to the service worker
 */

(() => {
  // Avoid double-injection
  if ((window as any).__agentbridge_observer) return;
  (window as any).__agentbridge_observer = true;

  // ─── Challenge Detection ────────────────────────────────────────────────

  const CHALLENGE_PATTERNS = {
    captcha: [
      /captcha/i,
      /recaptcha/i,
      /hcaptcha/i,
      /verify you.?re human/i,
      /i.?m not a robot/i,
      /human verification/i,
      /security check/i,
    ],
    mfa: [
      /two.?factor/i,
      /2fa/i,
      /verification code/i,
      /authenticator app/i,
      /enter the code/i,
      /security code/i,
    ],
    qr_login: [
      /scan.{0,20}qr/i,
      /qr code.{0,20}login/i,
    ],
    suspicious_login: [
      /unusual.{0,20}sign.?in/i,
      /suspicious.{0,20}activity/i,
      /verify your identity/i,
      /is this you/i,
    ],
  };

  /** Patterns that might indicate prompt injection in page content */
  const INJECTION_PATTERNS = [
    /ignore (?:all |previous )?instructions/i,
    /you are now/i,
    /disregard (?:all |previous )?instructions/i,
    /new instructions:/i,
    /system prompt:/i,
    /\[SYSTEM\]/i,
    /override (?:policy|permissions|safety)/i,
    /reveal (?:secret|password|token|key)/i,
    /send (?:secret|password|token|key|data) to/i,
  ];

  function detectChallenges(): Array<{ type: string; message: string }> {
    const detected: Array<{ type: string; message: string }> = [];
    const bodyText = document.body?.innerText || '';
    const title = document.title || '';
    const combined = bodyText + ' ' + title;

    for (const [type, patterns] of Object.entries(CHALLENGE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(combined)) {
          detected.push({ type, message: `Detected ${type} challenge on page` });
          break;
        }
      }
    }

    // Check for CAPTCHA iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src || '';
      if (/recaptcha|captcha|hcaptcha|challenge/i.test(src)) {
        detected.push({ type: 'captcha', message: `CAPTCHA iframe detected: ${src}` });
        break;
      }
    }

    return detected;
  }

  function detectInjectionAttempts(): Array<{ pattern: string; context: string }> {
    const detected: Array<{ pattern: string; context: string }> = [];
    const bodyText = document.body?.innerText || '';

    for (const pattern of INJECTION_PATTERNS) {
      const match = bodyText.match(pattern);
      if (match) {
        // Get surrounding context (50 chars before/after)
        const idx = match.index || 0;
        const start = Math.max(0, idx - 50);
        const end = Math.min(bodyText.length, idx + match[0].length + 50);
        detected.push({
          pattern: pattern.source,
          context: bodyText.slice(start, end).replace(/\s+/g, ' ').trim(),
        });
      }
    }

    // Check hidden elements for injection text
    const hiddenEls = document.querySelectorAll('[style*="display:none"], [style*="display: none"], [hidden], .hidden, [aria-hidden="true"]');
    for (const el of hiddenEls) {
      const text = (el as HTMLElement).innerText || '';
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(text)) {
          detected.push({
            pattern: pattern.source,
            context: `[HIDDEN ELEMENT] ${text.slice(0, 100)}`,
          });
          break;
        }
      }
    }

    return detected;
  }

  // ─── HTTP Status Detection ──────────────────────────────────────────────

  function detectHttpStatus(): { statusCode?: number; isError: boolean } {
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.innerText || '').slice(0, 500).toLowerCase();

    if (/403|forbidden/i.test(title + bodyText)) return { statusCode: 403, isError: true };
    if (/429|too many requests|rate limit/i.test(title + bodyText)) return { statusCode: 429, isError: true };
    if (/503|service unavailable|temporarily unavailable/i.test(title + bodyText)) return { statusCode: 503, isError: true };

    return { isError: false };
  }

  // ─── Page Change Observer ───────────────────────────────────────────────

  let lastReportedUrl = location.href;
  let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    // Debounce change reports
    if (changeDebounceTimer) clearTimeout(changeDebounceTimer);
    changeDebounceTimer = setTimeout(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastReportedUrl) {
        lastReportedUrl = currentUrl;
        reportPageChange('url_changed');
      } else {
        reportPageChange('content_changed');
      }
    }, 500);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled'],
  });

  function reportPageChange(reason: string) {
    chrome.runtime.sendMessage({
      type: 'page.changed',
      payload: {
        url: location.href,
        title: document.title,
        reason,
        timestamp: new Date().toISOString(),
      },
    }).catch(() => { /* Extension context may be invalidated */ });
  }

  // ─── Initial Report ─────────────────────────────────────────────────────

  function sendInitialReport() {
    const challenges = detectChallenges();
    const injections = detectInjectionAttempts();
    const httpStatus = detectHttpStatus();

    chrome.runtime.sendMessage({
      type: 'page.observed',
      payload: {
        url: location.href,
        title: document.title,
        origin: location.origin,
        timestamp: new Date().toISOString(),
        challenges,
        injections,
        httpStatus,
        hasForms: document.forms.length > 0,
        hasPasswordFields: document.querySelectorAll('input[type="password"]').length > 0,
      },
    }).catch(() => { /* Extension context may be invalidated */ });
  }

  // Run initial report when page is ready
  if (document.readyState === 'complete') {
    sendInitialReport();
  } else {
    window.addEventListener('load', sendInitialReport, { once: true });
  }
})();
