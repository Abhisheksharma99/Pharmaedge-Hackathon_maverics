"""
Publisher Classification System

Classifies publishers into categories based on test observations:
- Primary publishers: Original news sources (Reuters, Politico, Nature, etc.)
- Aggregators: News aggregators that repost content (MSN, Yahoo, AOL, etc.)
- Paywalled: Publishers with paywalls (WSJ, NYT, FT, etc.)
- Unknown: Publishers not yet classified

Based on real-world testing evidence.
"""

from typing import Dict, Any, Optional
from enum import Enum
from urllib.parse import urlparse


class PublisherType(Enum):
    """Publisher type classification."""
    PRIMARY = "primary"           # Original news sources
    AGGREGATOR = "aggregator"     # News aggregators (skip early)
    PAYWALLED = "paywalled"       # Paywalled publishers (partial content)
    UNKNOWN = "unknown"           # Unclassified publishers


class PublisherClassifier:
    """
    Classifies publishers based on domain patterns and known lists.

    Based on testing observations:
    - Aggregators consistently fail resolution/extraction → skip early
    - Primary publishers can be resolved and extracted successfully
    - Paywalled publishers may provide partial content
    """

    # Known aggregators (from test observations)
    AGGREGATOR_DOMAINS = {
        'msn.com',
        'yahoo.com',
        'aol.com',
        'fool.com',           # Motley Fool
        'finviz.com',
        'nasdaq.com',
        'marketwatch.com',
        'investing.com',
        'benzinga.com',
        'seeking alpha.com',
        'businessinsider.com',  # Mostly aggregated content
        'finance.yahoo.com',
        'money.yahoo.com',
        'news.yahoo.com',
        'msn.com/news',
        'msn.com/money',
    }

    # General news sites that should be skipped for pharma/medical crawlers
    # These sites return unrelated content when searching for medical keywords
    GENERAL_NEWS_DOMAINS = {
        'lokmattimes.com',    # Indian general news
        'hindustantimes.com', # Indian general news
        'indiatimes.com',     # Indian general news
        'timesofindia.com',   # Indian general news
        'ndtv.com',           # Indian general news
        'news18.com',         # Indian general news
        'dnaindia.com',       # Indian general news
        'freepressjournal.in', # Indian general news
        'mid-day.com',        # Indian general news
    }

    # Known paywalled publishers
    PAYWALLED_DOMAINS = {
        'wsj.com',            # Wall Street Journal
        'nytimes.com',        # New York Times
        'ft.com',             # Financial Times
        'economist.com',      # The Economist
        'bloomberg.com',      # Bloomberg
        'barrons.com',        # Barron's
        'telegraph.co.uk',    # The Telegraph
        'thetimes.co.uk',     # The Times
        'washingtonpost.com', # Washington Post
        'latimes.com',        # LA Times
    }

    # Known primary publishers (from test observations)
    PRIMARY_DOMAINS = {
        'reuters.com',
        'apnews.com',        # Associated Press
        'politico.com',
        'nature.com',
        'science.org',
        'euronews.com',
        'bbc.com',
        'bbc.co.uk',
        'theguardian.com',
        'cnn.com',
        'cnbc.com',
        'forbes.com',
        'techcrunch.com',
        'theverge.com',
        'arstechnica.com',
        'wired.com',
    }

    def __init__(self):
        """Initialize publisher classifier."""
        pass

    def classify(self, publisher_name: str, publisher_domain: str) -> Dict[str, Any]:
        """
        Classify a publisher based on name and domain.

        Args:
            publisher_name: Publisher name (e.g., "Reuters")
            publisher_domain: Publisher domain (e.g., "reuters.com")

        Returns:
            Dictionary with:
            - type: PublisherType enum
            - confidence: Confidence score (0.0-1.0)
            - reason: Classification reason
            - should_skip: Whether to skip this publisher early
            - allow_partial: Whether partial content is acceptable
        """
        # Normalize domain
        domain = publisher_domain.lower().strip()

        # Remove www. prefix
        if domain.startswith('www.'):
            domain = domain[4:]

        # Check general news domains first (skip these for pharma/medical crawlers)
        if self._is_general_news(domain, publisher_name):
            return {
                'type': PublisherType.AGGREGATOR,  # Treat as aggregator
                'confidence': 0.95,
                'reason': 'general_news_domain',
                'should_skip': True,  # Skip general news sites
                'allow_partial': False
            }

        # Check aggregators (still classify but don't skip - process them)
        if self._is_aggregator(domain, publisher_name):
            return {
                'type': PublisherType.AGGREGATOR,
                'confidence': 0.95,
                'reason': 'known_aggregator_domain',
                'should_skip': False,  # Process aggregators instead of skipping
                'allow_partial': True  # Allow partial content from aggregators
            }

        # Check paywalled publishers
        if self._is_paywalled(domain, publisher_name):
            return {
                'type': PublisherType.PAYWALLED,
                'confidence': 0.90,
                'reason': 'known_paywalled_domain',
                'should_skip': False,
                'allow_partial': True  # Allow partial content extraction
            }

        # Check primary publishers
        if self._is_primary(domain, publisher_name):
            return {
                'type': PublisherType.PRIMARY,
                'confidence': 0.85,
                'reason': 'known_primary_domain',
                'should_skip': False,
                'allow_partial': False
            }

        # Unknown publisher - attempt resolution with caution
        return {
            'type': PublisherType.UNKNOWN,
            'confidence': 0.5,
            'reason': 'unclassified_publisher',
            'should_skip': False,
            'allow_partial': True  # Be flexible with unknown publishers
        }

    def _is_aggregator(self, domain: str, publisher_name: str) -> bool:
        """Check if publisher is an aggregator."""
        # Direct domain match
        if domain in self.AGGREGATOR_DOMAINS:
            return True

        # Check if domain contains aggregator patterns
        aggregator_patterns = ['msn.', 'yahoo.', 'aol.', 'fool.com', 'finviz.', 'nasdaq.']
        for pattern in aggregator_patterns:
            if pattern in domain:
                return True

        # Check publisher name
        if publisher_name:
            name_lower = publisher_name.lower()
            aggregator_names = ['msn', 'yahoo', 'aol', 'motley fool', 'finviz', 'nasdaq']
            for name in aggregator_names:
                if name in name_lower:
                    return True

        return False

    def _is_general_news(self, domain: str, publisher_name: str) -> bool:
        """Check if publisher is a general news site (not pharma/medical relevant)."""
        # Direct domain match
        if domain in self.GENERAL_NEWS_DOMAINS:
            return True

        # Check if domain contains general news patterns
        general_patterns = ['lokmattimes.', 'hindustantimes.', 'indiatimes.', 'timesofindia.',
                          'ndtv.', 'news18.', 'dnaindia.', 'freepressjournal.', 'mid-day.']
        for pattern in general_patterns:
            if pattern in domain:
                return True

        return False

    def _is_paywalled(self, domain: str, publisher_name: str) -> bool:
        """Check if publisher has a paywall."""
        # Direct domain match
        if domain in self.PAYWALLED_DOMAINS:
            return True

        # Check for common paywall indicators in domain
        paywall_patterns = ['wsj.', 'nytimes.', 'ft.com', 'economist.', 'bloomberg.']
        for pattern in paywall_patterns:
            if pattern in domain:
                return True

        return False

    def _is_primary(self, domain: str, publisher_name: str) -> bool:
        """Check if publisher is a primary news source."""
        # Direct domain match
        if domain in self.PRIMARY_DOMAINS:
            return True

        # Check for common primary publisher patterns
        primary_patterns = ['reuters.', 'ap.', 'politico.', 'bbc.', 'cnn.', 'theguardian.']
        for pattern in primary_patterns:
            if pattern in domain:
                return True

        return False

    def should_attempt_resolution(self, classification: Dict[str, Any]) -> bool:
        """
        Determine if URL resolution should be attempted for this publisher.

        Args:
            classification: Publisher classification result

        Returns:
            True if resolution should be attempted
        """
        # Skip aggregators early (test evidence shows they consistently fail)
        if classification['should_skip']:
            return False

        return True

    def get_resolution_confidence_threshold(self, classification: Dict[str, Any]) -> float:
        """
        Get minimum confidence threshold for URL resolution based on publisher type.

        Args:
            classification: Publisher classification result

        Returns:
            Minimum confidence threshold (0.0-1.0)
        """
        publisher_type = classification['type']

        if publisher_type == PublisherType.PRIMARY:
            # Primary publishers: lower threshold (more lenient)
            return 0.6

        elif publisher_type == PublisherType.PAYWALLED:
            # Paywalled publishers: medium threshold
            return 0.7

        elif publisher_type == PublisherType.UNKNOWN:
            # Unknown publishers: higher threshold (more strict)
            return 0.75

        else:
            # Aggregators: very high threshold (should not reach here)
            return 0.9
