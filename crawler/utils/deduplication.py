"""
Deduplication Utilities

Provides URL hash and title similarity-based deduplication.
"""

import hashlib
from typing import Dict, Any, List, Set
from difflib import SequenceMatcher


class Deduplicator:
    """
    Deduplicates articles using URL hash and title similarity.
    """

    def __init__(self, similarity_threshold: float = 0.85):
        """
        Initialize deduplicator.

        Args:
            similarity_threshold: Title similarity threshold (0.0 to 1.0)
        """
        self.similarity_threshold = similarity_threshold
        self.seen_url_hashes: Set[str] = set()
        self.seen_titles: List[str] = []

    def is_duplicate(self, url: str, title: str) -> bool:
        """
        Check if article is a duplicate.

        Args:
            url: Article URL
            title: Article title

        Returns:
            True if duplicate
        """
        # Check URL hash
        url_hash = self.get_url_hash(url)
        if url_hash in self.seen_url_hashes:
            return True

        # Check title similarity
        if self.has_similar_title(title):
            return True

        # Not a duplicate - add to seen
        self.seen_url_hashes.add(url_hash)
        self.seen_titles.append(title.lower().strip())

        return False

    def has_similar_title(self, title: str) -> bool:
        """
        Check if a similar title has been seen.

        Args:
            title: Article title

        Returns:
            True if similar title exists
        """
        title_normalized = title.lower().strip()

        for seen_title in self.seen_titles:
            similarity = SequenceMatcher(None, title_normalized, seen_title).ratio()

            if similarity >= self.similarity_threshold:
                return True

        return False

    @staticmethod
    def get_url_hash(url: str) -> str:
        """
        Generate URL hash.

        Args:
            url: Article URL

        Returns:
            MD5 hash of URL
        """
        return hashlib.md5(url.encode('utf-8')).hexdigest()

    def reset(self):
        """Reset deduplicator state."""
        self.seen_url_hashes.clear()
        self.seen_titles.clear()
