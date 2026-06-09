import { ChallengeType } from '../types.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('ChallengeDetector');

// ─── Local types ─────────────────────────────────────────────────────────────

/** Signals extracted from a page that the detector inspects. */
export interface PageSignals {
  /** HTTP status code of the page response. */
  statusCode: number;
  /** Visible body text of the page (may be truncated). */
  bodyText: string;
  /** Page title. */
  title: string;
  /** Names/types of form elements present on the page. */
  formElements: string[];
  /** Origins of iframes embedded in the page. */
  iframeOrigins: string[];
}

/** Result of challenge detection. */
export interface ChallengeDetectionResult {
  /** Whether any challenge was detected. */
  detected: boolean;
  /** The type of challenge, if detected. */
  type?: ChallengeType;
  /** Descriptive message about the finding. */
  message: string;
}

// ─── Pattern constants ───────────────────────────────────────────────────────

const CAPTCHA_BODY_PATTERNS: RegExp[] = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /g-recaptcha/i,
  /cf-challenge/i,
  /challenge-form/i,
  /verify you are human/i,
  /prove you're not a robot/i,
  /i'm not a robot/i,
  /please complete the security check/i,
];

const RECAPTCHA_IFRAME_PATTERNS: RegExp[] = [
  /google\.com\/recaptcha/i,
  /recaptcha\.net/i,
  /hcaptcha\.com/i,
  /challenges\.cloudflare\.com/i,
];

const MFA_PATTERNS: RegExp[] = [
  /two-factor/i,
  /2fa/i,
  /multi-factor/i,
  /mfa/i,
  /verification code/i,
  /authenticator app/i,
  /enter the code/i,
  /one-time password/i,
  /otp/i,
  /security code/i,
  /enter your 6-digit code/i,
];

const QR_PATTERNS: RegExp[] = [
  /scan.*qr/i,
  /qr.*code/i,
  /scan.*with.*app/i,
  /scan.*to.*log\s?in/i,
  /qr.*login/i,
];

const SUSPICIOUS_LOGIN_PATTERNS: RegExp[] = [
  /suspicious.*sign.?in/i,
  /unusual.*activity/i,
  /we.*detected.*unusual/i,
  /verify your identity/i,
  /confirm.*your.*identity/i,
  /secure.*your.*account/i,
  /someone.*tried.*to.*sign/i,
  /sign.?in.*was.*blocked/i,
  /account.*recovery/i,
];

const HARDWARE_KEY_PATTERNS: RegExp[] = [
  /security key/i,
  /hardware key/i,
  /yubikey/i,
  /fido/i,
  /webauthn/i,
  /touch your security key/i,
  /insert.*security.*key/i,
];

const ACCOUNT_RECOVERY_PATTERNS: RegExp[] = [
  /account.*recover/i,
  /reset.*password/i,
  /forgot.*password/i,
  /recover.*access/i,
  /locked.*out/i,
];

// ─── Detector ────────────────────────────────────────────────────────────────

/**
 * Inspects page signals to detect human-verification challenges
 * that an AI agent must not attempt to bypass.
 *
 * Detection is purely heuristic and errs on the side of caution:
 * a false-positive causes a human hand-off, which is always safe.
 */
export class ChallengeDetector {
  /**
   * Analyse page signals for the presence of a challenge.
   *
   * @param signals - Structured signals from the current page.
   * @returns A {@link ChallengeDetectionResult}.
   */
  detect(signals: PageSignals): ChallengeDetectionResult {
    // 1. HTTP status-code checks (cheapest, first)
    const statusResult = this.checkStatusCode(signals.statusCode);
    if (statusResult.detected) return statusResult;

    // 2. reCAPTCHA / CAPTCHA iframe check
    const iframeResult = this.checkIframes(signals.iframeOrigins);
    if (iframeResult.detected) return iframeResult;

    // 3. Text-based pattern checks (body + title combined)
    const text = `${signals.title} ${signals.bodyText}`;
    const textResult = this.checkTextPatterns(text);
    if (textResult.detected) return textResult;

    // 4. Form element heuristics
    const formResult = this.checkFormElements(signals.formElements);
    if (formResult.detected) return formResult;

    logger.debug('No challenge detected');
    return { detected: false, message: 'No challenge detected.' };
  }

  // ── Status code checks ─────────────────────────────────────────────────

  private checkStatusCode(code: number): ChallengeDetectionResult {
    if (code === 429) {
      return {
        detected: true,
        type: ChallengeType.RateLimit429,
        message: 'HTTP 429 Too Many Requests — rate limit enforced by server.',
      };
    }
    if (code === 403) {
      return {
        detected: true,
        type: ChallengeType.Forbidden403,
        message: 'HTTP 403 Forbidden — access denied by server.',
      };
    }
    if (code === 503) {
      return {
        detected: true,
        type: ChallengeType.ServerError503,
        message: 'HTTP 503 Service Unavailable — possible anti-bot interstitial.',
      };
    }
    return { detected: false, message: '' };
  }

  // ── Iframe checks ─────────────────────────────────────────────────────

  private checkIframes(iframeOrigins: string[]): ChallengeDetectionResult {
    for (const origin of iframeOrigins) {
      for (const pattern of RECAPTCHA_IFRAME_PATTERNS) {
        if (pattern.test(origin)) {
          return {
            detected: true,
            type: ChallengeType.ReCaptcha,
            message: `reCAPTCHA / challenge iframe detected from '${origin}'.`,
          };
        }
      }
    }
    return { detected: false, message: '' };
  }

  // ── Text pattern checks ───────────────────────────────────────────────

  private checkTextPatterns(text: string): ChallengeDetectionResult {
    // Priority order: CAPTCHA → MFA → QR → HardwareKey → Suspicious → Recovery
    if (this.matchesAny(text, CAPTCHA_BODY_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.Captcha,
        message: 'CAPTCHA challenge detected in page content.',
      };
    }

    if (this.matchesAny(text, MFA_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.MFA,
        message: 'Multi-factor authentication prompt detected.',
      };
    }

    if (this.matchesAny(text, QR_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.QRLogin,
        message: 'QR-code login prompt detected.',
      };
    }

    if (this.matchesAny(text, HARDWARE_KEY_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.HardwareKey,
        message: 'Hardware security key prompt detected.',
      };
    }

    if (this.matchesAny(text, SUSPICIOUS_LOGIN_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.SuspiciousLogin,
        message: 'Suspicious login / identity verification warning detected.',
      };
    }

    if (this.matchesAny(text, ACCOUNT_RECOVERY_PATTERNS)) {
      return {
        detected: true,
        type: ChallengeType.AccountRecovery,
        message: 'Account recovery flow detected.',
      };
    }

    return { detected: false, message: '' };
  }

  // ── Form element checks ───────────────────────────────────────────────

  private checkFormElements(elements: string[]): ChallengeDetectionResult {
    const lower = elements.map((e) => e.toLowerCase());

    // reCAPTCHA widgets often appear as elements with specific names
    if (lower.some((e) => e.includes('g-recaptcha') || e.includes('h-captcha'))) {
      return {
        detected: true,
        type: ChallengeType.ReCaptcha,
        message: 'reCAPTCHA form element detected.',
      };
    }

    // OTP / verification-code input fields
    if (lower.some((e) => e.includes('otp') || e.includes('verification-code') || e.includes('totp'))) {
      return {
        detected: true,
        type: ChallengeType.MFA,
        message: 'OTP / verification code input field detected.',
      };
    }

    return { detected: false, message: '' };
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  private matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
  }
}
