import type { ActionRequest } from '../types.js';
import { ActionType, RiskLevel, CapabilityType } from '../types.js';
import { createLogger } from '../utils/index.js';

/**
 * Keyword sets used to detect high-risk and critical action targets.
 * Matched against the action's ref, value, url, and metadata fields.
 */
const CRITICAL_KEYWORDS: ReadonlySet<string> = new Set([
  'payment', 'purchase', 'buy', 'checkout', 'pay', 'transfer',
  'wire', 'oauth', 'authorize', 'grant_access', 'delete_account',
  'deactivate_account', 'close_account', 'remove_account',
  'change_password', 'reset_password', 'security', 'mfa',
  '2fa', 'two_factor', 'totp', 'recovery_codes',
  'billing', 'credit_card', 'debit_card', 'bank_account',
  'subscription', 'unsubscribe', 'cancel_plan',
]);

const HIGH_KEYWORDS: ReadonlySet<string> = new Set([
  'submit', 'send', 'post', 'publish', 'update', 'edit',
  'invite', 'share', 'upload', 'bulk', 'batch', 'mass',
  'approve', 'confirm', 'accept', 'reject', 'archive',
  'delete', 'remove', 'revoke', 'assign', 'deploy',
  'export', 'import', 'merge', 'release',
]);

const PROHIBITED_KEYWORDS: ReadonlySet<string> = new Set([
  'captcha', 'recaptcha', 'hcaptcha', 'challenge_bypass',
  'stealth', 'evasion', 'fingerprint_spoof',
  'credential_harvest', 'phishing', 'keylog',
  'spam', 'mass_message', 'rate_limit_bypass',
  'bot_detection_bypass', 'headless_detect',
]);

/** Action types that are inherently low risk. */
const LOW_RISK_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.Navigate,
  ActionType.Scroll,
  ActionType.Screenshot,
]);

/** Action types that are inherently high risk. */
const HIGH_RISK_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.Submit,
  ActionType.Upload,
]);

/** Capability types associated with medium-risk operations. */
const MEDIUM_RISK_CAPABILITIES: ReadonlySet<CapabilityType> = new Set([
  CapabilityType.ActionFill,
  CapabilityType.FileDownload,
  CapabilityType.ReadFormValues,
]);

/**
 * Classifies browser actions into risk levels per PRD §12 Risk Taxonomy.
 *
 * The risk taxonomy defines five levels:
 * - **Low**: Navigate, read, scroll, open menu
 * - **Medium**: Fill draft, filter, download approved report
 * - **High**: Submit, update, upload, send, invite, bulk edit
 * - **Critical**: Payment, purchase, transfer, OAuth, account deletion, security changes
 * - **Prohibited**: CAPTCHA bypass, stealth evasion, credential theft, spam
 *
 * Classification uses a layered approach:
 * 1. Check for prohibited keywords first (always blocked)
 * 2. Check for critical keywords (payment/security surface)
 * 3. Evaluate action type against known risk categories
 * 4. Apply keyword-based escalation from context
 *
 * @example
 * ```ts
 * const classifier = new RiskClassifier();
 * const risk = classifier.classify(actionRequest);
 * // risk === RiskLevel.High for a submit action
 * ```
 */
export class RiskClassifier {
  private readonly logger = createLogger('RiskClassifier');

  /**
   * Classify an action request into a risk level.
   *
   * @param action - The action request to classify.
   * @returns The computed risk level for the action.
   */
  classify(action: ActionRequest): RiskLevel {
    const tokens = this.extractTokens(action);

    // Layer 1: Prohibited — always denied regardless of context
    if (this.matchesAnyKeyword(tokens, PROHIBITED_KEYWORDS)) {
      this.logger.debug('Classified as PROHIBITED', {
        action_id: action.id,
        type: action.type,
      });
      return RiskLevel.Prohibited;
    }

    // Layer 2: Critical — payment, security, account lifecycle
    if (this.matchesAnyKeyword(tokens, CRITICAL_KEYWORDS)) {
      this.logger.debug('Classified as CRITICAL via keyword match', {
        action_id: action.id,
        type: action.type,
      });
      return RiskLevel.Critical;
    }

    // Layer 3: Action-type classification
    const typeRisk = this.classifyByActionType(action.type);

    // Layer 4: Keyword escalation — high keywords can promote medium→high
    if (typeRisk === RiskLevel.Medium || typeRisk === RiskLevel.Low) {
      if (this.matchesAnyKeyword(tokens, HIGH_KEYWORDS)) {
        this.logger.debug('Escalated to HIGH via keyword match', {
          action_id: action.id,
          type: action.type,
        });
        return RiskLevel.High;
      }
    }

    this.logger.debug('Classified action', {
      action_id: action.id,
      type: action.type,
      risk: typeRisk,
    });

    return typeRisk;
  }

  /**
   * Classify solely by action type, ignoring keywords.
   * Used as the base classification layer.
   *
   * @param type - The action type to classify.
   * @returns The base risk level for this action type.
   */
  classifyByActionType(type: ActionType): RiskLevel {
    if (LOW_RISK_ACTIONS.has(type)) {
      return RiskLevel.Low;
    }

    if (HIGH_RISK_ACTIONS.has(type)) {
      return RiskLevel.High;
    }

    // Click and Select start as low but can be escalated by keywords
    if (type === ActionType.Click || type === ActionType.Select) {
      return RiskLevel.Low;
    }

    // Fill and Download are medium (draft/preview context)
    if (type === ActionType.Fill || type === ActionType.Download) {
      return RiskLevel.Medium;
    }

    // HumanTakeover is medium — it relinquishes control
    if (type === ActionType.HumanTakeover) {
      return RiskLevel.Medium;
    }

    // Unknown action types default to high for safety
    return RiskLevel.High;
  }

  /**
   * Check whether a specific capability maps to medium risk.
   *
   * @param capability - The capability type to check.
   * @returns True if the capability is in the medium-risk set.
   */
  isCapabilityMediumRisk(capability: CapabilityType): boolean {
    return MEDIUM_RISK_CAPABILITIES.has(capability);
  }

  /**
   * Extract all searchable tokens from an action request.
   * Combines ref, value, url, and flattened metadata keys/values
   * into a single lowercase token set for keyword matching.
   */
  private extractTokens(action: ActionRequest): Set<string> {
    const raw: string[] = [];

    if (action.ref) raw.push(action.ref);
    if (action.value) raw.push(action.value);
    if (action.url) raw.push(action.url);

    // Flatten metadata into searchable strings
    if (action.metadata) {
      for (const [key, value] of Object.entries(action.metadata)) {
        raw.push(key);
        if (typeof value === 'string') {
          raw.push(value);
        }
      }
    }

    const tokens = new Set<string>();
    for (const text of raw) {
      // Split on common delimiters and normalize
      const parts = text.toLowerCase().split(/[\s_\-./=?&#,;:]+/);
      for (const part of parts) {
        if (part.length > 0) {
          tokens.add(part);
        }
      }
    }

    return tokens;
  }

  /**
   * Check whether any extracted token matches a keyword set.
   */
  private matchesAnyKeyword(
    tokens: Set<string>,
    keywords: ReadonlySet<string>,
  ): boolean {
    for (const token of tokens) {
      if (keywords.has(token)) {
        return true;
      }
      // Also check if a keyword is a substring of the token (e.g. "submit_form" contains "submit")
      for (const keyword of keywords) {
        if (token.includes(keyword)) {
          return true;
        }
      }
    }
    return false;
  }
}
