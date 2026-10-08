"""
Failure Classification and Tracking System

Tracks and classifies failures into categories:
- Infrastructure failures (DNS, SSL, timeout)
- Resolution failures (could not find publisher URL)
- Extraction failures (could not extract content)
- Publisher type failures (aggregators skipped)
- Paywall failures (content behind paywall)

Based on test observations for better debugging and monitoring.
"""

from typing import Dict, Any, List
from collections import defaultdict
from enum import Enum


class FailureCategory(Enum):
    """Failure category classification."""
    INFRASTRUCTURE = "infrastructure"       # DNS, SSL, timeout, HTTP errors
    RESOLUTION_FAILED = "resolution_failed" # Could not resolve publisher URL
    EXTRACTION_FAILED = "extraction_failed" # Could not extract content
    AGGREGATOR_SKIPPED = "aggregator_skipped" # Aggregator skipped early
    PAYWALL_BLOCKED = "paywall_blocked"    # Paywalled content (partial or blocked)
    LOW_CONFIDENCE = "low_confidence"      # Resolution confidence too low
    FILTERED = "filtered"                   # Filtered by keywords/URLs
    DUPLICATE = "duplicate"                 # Duplicate article


class FailureTracker:
    """
    Tracks and classifies failures for better monitoring and debugging.
    """

    def __init__(self):
        self.failures: List[Dict[str, Any]] = []
        self.failure_counts = defaultdict(int)
        self.infrastructure_errors = defaultdict(int)

    def record_failure(
        self,
        category: FailureCategory,
        title: str,
        publisher: str = "",
        reason: str = "",
        details: Dict[str, Any] = None
    ):
        """
        Record a failure event.

        Args:
            category: Failure category
            title: Article title
            publisher: Publisher name/domain
            reason: Failure reason
            details: Additional details
        """
        failure = {
            'category': category.value,
            'title': title,
            'publisher': publisher,
            'reason': reason,
            'details': details or {}
        }

        self.failures.append(failure)
        self.failure_counts[category.value] += 1

        # Track infrastructure error types
        if category == FailureCategory.INFRASTRUCTURE:
            error_type = details.get('error_type', 'unknown') if details else 'unknown'
            self.infrastructure_errors[error_type] += 1

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get failure statistics.

        Returns:
            Dictionary with failure counts by category
        """
        return {
            'total_failures': len(self.failures),
            'by_category': dict(self.failure_counts),
            'infrastructure_breakdown': dict(self.infrastructure_errors),
            'failure_rate_by_category': self._calculate_failure_rates()
        }

    def get_failures_by_category(self, category: FailureCategory) -> List[Dict[str, Any]]:
        """
        Get all failures for a specific category.

        Args:
            category: Failure category

        Returns:
            List of failure records
        """
        return [f for f in self.failures if f['category'] == category.value]

    def should_retry(self, category: FailureCategory) -> bool:
        """
        Determine if failure category should be retried.

        Based on test observations:
        - Infrastructure failures: might be temporary, but don't retry against Google
        - Resolution failures: don't retry (unlikely to succeed)
        - Extraction failures: don't retry (unlikely to succeed)
        - Aggregators: never retry (test evidence shows consistent failure)

        Args:
            category: Failure category

        Returns:
            True if retry might be worthwhile
        """
        # Based on test observations, we should NOT retry:
        # - Aggregators consistently fail
        # - Resolution/extraction failures unlikely to succeed on retry
        # - Infrastructure failures against Google should not be retried

        # In general, don't retry within same crawl session
        return False

    def _calculate_failure_rates(self) -> Dict[str, float]:
        """Calculate failure rate for each category."""
        if not self.failures:
            return {}

        total = len(self.failures)
        rates = {}

        for category, count in self.failure_counts.items():
            rates[category] = round(count / total * 100, 2)

        return rates

    def get_summary(self) -> str:
        """
        Get human-readable summary of failures.

        Returns:
            Summary string
        """
        if not self.failures:
            return "No failures recorded"

        stats = self.get_statistics()
        summary_lines = [
            f"Total failures: {stats['total_failures']}",
            "",
            "By category:"
        ]

        for category, count in sorted(stats['by_category'].items(), key=lambda x: x[1], reverse=True):
            rate = stats['failure_rate_by_category'].get(category, 0)
            summary_lines.append(f"  - {category}: {count} ({rate}%)")

        if stats['infrastructure_breakdown']:
            summary_lines.append("")
            summary_lines.append("Infrastructure errors:")
            for error_type, count in sorted(stats['infrastructure_breakdown'].items(), key=lambda x: x[1], reverse=True):
                summary_lines.append(f"  - {error_type}: {count}")

        return "\n".join(summary_lines)

    def get_actionable_insights(self) -> List[str]:
        """
        Get actionable insights based on failure patterns.

        Returns:
            List of insight strings
        """
        insights = []
        stats = self.get_statistics()

        # Check aggregator skip rate
        aggregator_count = self.failure_counts.get(FailureCategory.AGGREGATOR_SKIPPED.value, 0)
        if aggregator_count > 0:
            insights.append(
                f"✓ Skipped {aggregator_count} aggregators early (good - test evidence shows they fail)"
            )

        # Check infrastructure failures
        infra_count = self.failure_counts.get(FailureCategory.INFRASTRUCTURE.value, 0)
        total = len(self.failures)
        if infra_count > 0 and total > 0:
            rate = (infra_count / total) * 100
            if rate > 30:
                insights.append(
                    f"⚠ High infrastructure failure rate ({rate:.1f}%) - check network/DNS"
                )

        # Check resolution failures
        resolution_count = self.failure_counts.get(FailureCategory.RESOLUTION_FAILED.value, 0)
        if resolution_count > 0 and total > 0:
            rate = (resolution_count / total) * 100
            if rate > 50:
                insights.append(
                    f"⚠ High resolution failure rate ({rate:.1f}%) - consider improving resolution strategies"
                )

        # Check paywall blocking
        paywall_count = self.failure_counts.get(FailureCategory.PAYWALL_BLOCKED.value, 0)
        if paywall_count > 0:
            insights.append(
                f"ℹ {paywall_count} articles behind paywalls (partial content may be available)"
            )

        # Check low confidence rejections
        low_conf_count = self.failure_counts.get(FailureCategory.LOW_CONFIDENCE.value, 0)
        if low_conf_count > 0:
            insights.append(
                f"✓ Rejected {low_conf_count} low-confidence matches (good - avoids false positives)"
            )

        return insights
