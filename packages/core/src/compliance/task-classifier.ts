import { TaskAccessPattern } from '../types.js';
import { createLogger } from '../utils/index.js';

// ─── Local types ─────────────────────────────────────────────────────────────

/** Result of classifying a task's access pattern. */
export interface TaskClassification {
  /** The identified access pattern. */
  pattern: TaskAccessPattern;
  /** Confidence score from 0 to 1. */
  confidence: number;
  /** Human-readable reasoning for the classification. */
  reasoning: string;
}

/** Optional context supplied alongside the task objective. */
export interface ClassificationContext {
  /** The agent's declared intent. */
  agentIntent?: string;
  /** Whether the task touches the user's own infrastructure. */
  isInternalDomain?: boolean;
  /** Whether the task was initiated interactively by the user. */
  isUserInitiated?: boolean;
}

// ─── Keyword patterns ────────────────────────────────────────────────────────

interface PatternRule {
  pattern: TaskAccessPattern;
  /** Keywords in the objective that trigger this rule. */
  keywords: string[];
  /** Weight of each keyword match (before normalisation). */
  baseConfidence: number;
  /** Human label used in the reasoning string. */
  label: string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    pattern: TaskAccessPattern.CrawlLike,
    keywords: [
      'scrape', 'crawl', 'extract all', 'harvest', 'spider',
      'fetch all pages', 'index all', 'enumerate', 'mass download',
    ],
    baseConfidence: 0.85,
    label: 'crawl-like access',
  },
  {
    pattern: TaskAccessPattern.Bulk,
    keywords: [
      'bulk', 'mass', 'batch', 'all records', 'export all',
      'dump', 'iterate all', 'process all',
    ],
    baseConfidence: 0.80,
    label: 'bulk data access',
  },
  {
    pattern: TaskAccessPattern.Transactional,
    keywords: [
      'payment', 'purchase', 'order', 'checkout', 'buy', 'subscribe',
      'transfer funds', 'pay invoice', 'complete transaction',
    ],
    baseConfidence: 0.90,
    label: 'transactional operation',
  },
  {
    pattern: TaskAccessPattern.Regulated,
    keywords: [
      'medical', 'legal', 'tax', 'financial', 'hipaa', 'gdpr',
      'compliance', 'audit', 'regulated', 'healthcare', 'insurance claim',
    ],
    baseConfidence: 0.85,
    label: 'regulated domain',
  },
  {
    pattern: TaskAccessPattern.DeveloperTest,
    keywords: [
      'test', 'qa', 'staging', 'localhost', 'dev environment',
      'sandbox', 'debug', 'integration test', 'e2e test', 'canary',
    ],
    baseConfidence: 0.90,
    label: 'developer / test activity',
  },
];

/** Origins that strongly indicate developer-test context. */
const DEV_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?/i,
  /^https?:\/\/\[::1\](:\d+)?/i,
  /\.local(:\d+)?$/i,
  /\.test(:\d+)?$/i,
  /\.staging\./i,
  /\.dev\./i,
];

// ─── Classifier ──────────────────────────────────────────────────────────────

const logger = createLogger('TaskClassifier');

/**
 * Classifies a task's access pattern based on its objective text,
 * target origins, and optional context signals.
 *
 * The classifier applies keyword analysis and origin heuristics
 * to determine the most likely {@link TaskAccessPattern}, together
 * with a confidence score and human-readable reasoning.
 */
export class TaskClassifier {
  /**
   * Analyse a task and return the best-fit access pattern.
   *
   * @param objective - Free-text description of what the task does.
   * @param origins   - Target origins the task will touch.
   * @param context   - Optional contextual hints.
   * @returns The classification result.
   */
  classify(
    objective: string,
    origins: string[],
    context?: ClassificationContext,
  ): TaskClassification {
    const lowerObjective = objective.toLowerCase();

    // Score every pattern rule
    const scored = PATTERN_RULES.map((rule) => {
      const matchedKeywords = rule.keywords.filter((kw) =>
        lowerObjective.includes(kw),
      );
      if (matchedKeywords.length === 0) {
        return { rule, score: 0, matchedKeywords };
      }
      // Multiple keyword hits increase confidence
      const multiBoost = Math.min(matchedKeywords.length * 0.05, 0.15);
      const score = Math.min(rule.baseConfidence + multiBoost, 1);
      return { rule, score, matchedKeywords };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // Check for developer-origin boost
    const hasDevOrigin = origins.some((origin) =>
      DEV_ORIGIN_PATTERNS.some((re) => re.test(origin)),
    );

    // If the best pattern is DeveloperTest or origin is dev-like, boost
    if (hasDevOrigin && best.rule.pattern !== TaskAccessPattern.DeveloperTest) {
      const devEntry = scored.find(
        (s) => s.rule.pattern === TaskAccessPattern.DeveloperTest,
      );
      if (devEntry) {
        devEntry.score = Math.max(devEntry.score + 0.3, 0.75);
      }
      // Re-sort after boost
      scored.sort((a, b) => b.score - a.score);
    }

    const winner = scored[0];

    // If no keywords matched at all, fall back
    if (winner.score === 0) {
      return this.buildDefault(origins, context);
    }

    let confidence = winner.score;
    let reasoning = `Objective contains keywords [${winner.matchedKeywords.join(', ')}] indicating ${winner.rule.label}.`;

    // Contextual adjustments
    if (context?.isInternalDomain) {
      if (winner.rule.pattern === TaskAccessPattern.CrawlLike ||
          winner.rule.pattern === TaskAccessPattern.Bulk) {
        // Internal domains are often fine for bulk/crawl
        confidence = Math.min(confidence + 0.05, 1);
        reasoning += ' Origin is internal — confidence adjusted upward.';
      }
    }

    if (context?.isUserInitiated) {
      confidence = Math.min(confidence + 0.05, 1);
      reasoning += ' Task is user-initiated.';
    }

    if (hasDevOrigin && winner.rule.pattern === TaskAccessPattern.DeveloperTest) {
      confidence = Math.min(confidence + 0.05, 1);
      reasoning += ' Origin matches a developer/test domain pattern.';
    }

    logger.debug('Task classified', {
      pattern: winner.rule.pattern,
      confidence: String(confidence),
    });

    return {
      pattern: winner.rule.pattern,
      confidence: Math.round(confidence * 100) / 100,
      reasoning,
    };
  }

  /**
   * Build a default classification when no keywords match.
   */
  private buildDefault(
    origins: string[],
    context?: ClassificationContext,
  ): TaskClassification {
    const hasDevOrigin = origins.some((origin) =>
      DEV_ORIGIN_PATTERNS.some((re) => re.test(origin)),
    );

    if (hasDevOrigin) {
      return {
        pattern: TaskAccessPattern.DeveloperTest,
        confidence: 0.70,
        reasoning: 'No keyword matches, but origin matches a developer/test domain pattern.',
      };
    }

    if (context?.isInternalDomain) {
      return {
        pattern: TaskAccessPattern.InternalOwned,
        confidence: 0.65,
        reasoning: 'No keyword matches, but origin is flagged as internal/owned.',
      };
    }

    if (context?.isUserInitiated) {
      return {
        pattern: TaskAccessPattern.UserDelegated,
        confidence: 0.60,
        reasoning: 'No keyword matches. User-initiated task defaults to user-delegated.',
      };
    }

    return {
      pattern: TaskAccessPattern.UserDelegated,
      confidence: 0.50,
      reasoning: 'No keyword or context signals matched. Defaulting to user-delegated with low confidence.',
    };
  }
}
