"""
Article Spider Engine
Crawls articles using XPath with intelligent fallback logic.
Enhanced to extract category-specific fields:
- Event details (date, time, location, registration links)
- Pipeline information (products, phases, indications)
- Financial data (revenue, earnings, guidance)
- Contact information
"""

from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
import re
from bs4 import BeautifulSoup
from lxml import html
import hashlib
import json as json_lib

# Try to import trafilatura for content extraction
try:
    import trafilatura
    TRAFILATURA_AVAILABLE = True
except ImportError:
    TRAFILATURA_AVAILABLE = False


class ArticleSpider:
    """
    Spider that extracts article data using XPath with fallback methods.
    """

    # Static page-template headings that show up in an <h1> (or similar)
    # regardless of which article is being viewed - e.g. Q4/Intrado IR
    # platforms render a fixed "Release Details" heading above the actual,
    # non-h1 article title. A primary xpath matching one of these has found
    # the template chrome, not the article - treat it as no match.
    _BOILERPLATE_TITLES = {
        'release details', 'news details', 'event details', 'press release',
        'news release', 'media release', 'article', 'news', 'home', 'homepage',
    }

    # Shared date-like patterns, used to pull a real date out of an
    # over-broad text match instead of trusting it wholesale.
    _DATE_PATTERN = re.compile(
        r'\d{4}-\d{2}-\d{2}'            # 2024-01-15
        r'|\d{1,2}/\d{1,2}/\d{4}'       # 01/15/2024
        r'|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}'  # January 15, 2024 / Sept. 04, 2026
    )

    def __init__(self, html_content: str, url: str):
        """
        Initialize spider with HTML content.

        Args:
            html_content: Raw HTML string
            url: URL of the page
        """
        self.html_content = html_content
        self.url = url
        self.tree = html.fromstring(html_content)
        self.soup = BeautifulSoup(html_content, 'html.parser')

        # Track successful extraction methods for learning
        self.successful_methods = {}  # {field: {'method': 'meta_og_title', 'xpath': '//meta[@property="og:title"]/@content'}}

    def extract_field(self, xpath: str, field_type: str) -> Optional[str]:
        """
        Extract field using XPath with fallback.

        Args:
            xpath: XPath expression to try first
            field_type: Type of field (title, date, content, company)

        Returns:
            Extracted value or None
        """
        # Try XPath first
        if xpath:
            result = self._extract_with_xpath(xpath, field_type)
            if result:
                return result

        # Fallback to automatic detection
        if field_type == "title":
            return self._extract_title_fallback()
        elif field_type == "date":
            return self._extract_date_fallback()
        elif field_type == "content":
            return self._extract_content_fallback()
        elif field_type == "company":
            return self._extract_company_fallback()

        return None

    def _extract_with_xpath(self, xpath: str, field_type: Optional[str] = None) -> Optional[str]:
        """Extract using XPath."""
        try:
            elements = self.tree.xpath(xpath)

            if not elements:
                return None

            if isinstance(elements, list) and len(elements) > 0:
                # Scalar fields (date/title/company): an OR-form xpath can match
                # more than one element on the page (e.g. a "recent news"/related
                # widget reusing the same class as the real field). Never
                # concatenate these - that silently corrupts the value. Prefer a
                # match that isn't inside a sidebar/related/widget container,
                # then take the first non-empty one.
                if field_type in ('date', 'title', 'company'):
                    candidates = [
                        e for e in elements
                        if not (hasattr(e, 'getparent') and self._is_in_excluded_container(e))
                    ] or elements

                    for element in candidates:
                        if isinstance(element, str):
                            text = element.strip()
                        elif hasattr(element, 'text_content'):
                            text = element.text_content().strip()
                        else:
                            text = None
                        if not text:
                            continue
                        # A title match that's just static page-template
                        # chrome (e.g. "Release Details") isn't the
                        # article's real title - skip it so other matches
                        # (or, failing that, fallback strategies) get a
                        # chance instead of locking in the boilerplate.
                        if field_type == 'title' and text.lower() in self._BOILERPLATE_TITLES:
                            continue
                        return text
                    return None

                # Content fields: combine all matched text blocks (e.g. //article//p)
                if len(elements) > 1 and all(hasattr(e, 'text_content') for e in elements):
                    texts = []
                    for elem in elements:
                        text = elem.text_content().strip()
                        if text:  # Only add non-empty paragraphs
                            texts.append(text)
                    return '\n\n'.join(texts) if texts else None

                # For single element, extract as before
                element = elements[0]
                if isinstance(element, str):
                    return element.strip()
                elif hasattr(element, 'text_content'):
                    return element.text_content().strip()

            return None

        except Exception as e:
            print(f"XPath extraction failed: {e}")
            return None

    def _is_in_excluded_container(self, element) -> bool:
        """Check if an element sits inside a sidebar/related/widget container
        that commonly duplicates a page's field markup (e.g. a "recent news"
        rail reusing the same date/title classes as the actual article)."""
        exclude_terms = (
            'sidebar', 'widget', 'related', 'recent', 'more-news',
            'also-read', 'recommended', 'trending', 'promo', 'carousel'
        )
        exclude_tags = {'aside', 'nav'}

        try:
            node = element
            while node is not None:
                tag = getattr(node, 'tag', None)
                if isinstance(tag, str) and tag.lower() in exclude_tags:
                    return True

                get_attr = getattr(node, 'get', None)
                if callable(get_attr):
                    combined = f"{get_attr('class', '')} {get_attr('id', '')}".lower()
                    if any(term in combined for term in exclude_terms):
                        return True

                node = node.getparent() if hasattr(node, 'getparent') else None
        except Exception:
            pass

        return False

    def _extract_title_fallback(self) -> Optional[str]:
        """Fallback method to extract title."""
        # Try multiple strategies - prioritize more specific matches
        # CRITICAL: <title> tag is now LAST priority to avoid extracting site names
        strategies = [
            # Priority 1: structured/authored data - no suffix-stripping
            # heuristics needed, so this beats meta tags when present.
            ('json_ld_headline', "//script[@type='application/ld+json']", lambda: self._get_json_ld_headline()),
            # Priority 1b: Article-specific meta tags
            ('meta_og_title', "//meta[@property='og:title']/@content", lambda: self._get_meta_tag('og:title')),
            ('meta_twitter_title', "//meta[@name='twitter:title']/@content", lambda: self._get_meta_tag('twitter:title')),
            ('meta_headline', "//meta[@itemprop='headline']/@content", lambda: self._get_itemprop_content('headline')),
            # Priority 2: Article-specific selectors
            ('class_article_title', "//h1[contains(@class, 'article-title') or contains(@class, 'entry-title') or contains(@class, 'post-title') or contains(@class, 'headline')]", lambda: self._get_class_text(['article-title', 'entry-title', 'post-title', 'headline'])),
            # Priority 3: Headings within article context
            ('article_h1', "//article//h1[1]", lambda: self._get_first_article_h1()),
            ('h1_with_title_class', "//h1[contains(@class, 'title')]", lambda: self._get_h1_with_title_class()),
            # Priority 4: Any H1 (but validate it's not site name)
            ('h1_validated', "//h1[1]", lambda: self._get_validated_h1()),
            # Priority 5: Broader class searches
            ('class_title', "//*[contains(@class, 'title')]", lambda: self._get_class_text(['title'])),
            ('meta_name', "//meta[@itemprop='name']/@content", lambda: self._get_itemprop_content('name')),
            # LAST RESORT: <title> tag (often contains site name!)
            ('title_tag', "//title", lambda: self._get_tag_text('title')),
        ]

        for method_name, xpath, strategy in strategies:
            try:
                result = strategy()
                if result and len(result) > 5:  # Minimum length check
                    # Skip generic titles and site names
                    lower_result = result.lower()
                    generic_terms = self._BOILERPLATE_TITLES | {
                        'post', 'media', 'press releases', 'news releases'
                    }

                    # Skip exact matches to generic terms
                    if lower_result in generic_terms:
                        continue

                    # Remove site name suffix if present (e.g., "Title - Site Name")
                    result = self._clean_title(result)

                    # Final validation: title should not be just company name
                    # If it's too short after cleaning, skip
                    if len(result) < 10:
                        continue

                    # Check if this looks like a company/site name (all title case, ends with Ltd/Inc/etc)
                    # If so, mark it but still return it as last resort
                    # The duplicate title detection will catch this issue
                    if self._is_likely_site_name(result):
                        # Only skip if we haven't tried all strategies yet
                        # If this is from <title> tag (last strategy), allow it
                        if method_name != 'title_tag':  # Not the last strategy
                            continue

                    # Store the successful method for learning
                    self.successful_methods['title'] = {
                        'method': method_name,
                        'xpath': xpath
                    }

                    return result
            except:
                continue

        return None

    def _extract_date_fallback(self) -> Optional[str]:
        """Fallback method to extract date."""
        strategies = [
            ('meta_article_published', "//meta[@property='article:published_time']/@content", lambda: self._get_meta_tag('article:published_time')),
            ('meta_datePublished', "//meta[@name='datePublished']/@content", lambda: self._get_meta_tag('datePublished')),
            ('meta_publishedDate', "//meta[@name='publishedDate']/@content", lambda: self._get_meta_tag('publishedDate')),
            ('meta_date', "//meta[@name='date']/@content", lambda: self._get_meta_tag('date')),
            ('itemprop_datePublished', "//meta[@itemprop='datePublished']/@content", lambda: self._get_itemprop_content('datePublished')),
            ('itemprop_dateCreated', "//meta[@itemprop='dateCreated']/@content", lambda: self._get_itemprop_content('dateCreated')),
            ('time_tag', "//time/@datetime", lambda: self._get_time_tag()),
            ('json_ld_date', "//script[@type='application/ld+json']", lambda: self._extract_date_from_json_ld()),
            ('class_date', "//*[contains(@class, 'date') or contains(@class, 'published') or contains(@class, 'timestamp')]", lambda: self._get_class_text(['date', 'published', 'post-date', 'publish-date', 'timestamp', 'publication-date', 'article-date', 'entry-date'])),
            ('text_date', "//text()", lambda: self._extract_date_from_text()),
        ]

        for method_name, xpath, strategy in strategies:
            try:
                result = strategy()
                # Skip form field labels and generic words
                if not result or result.lower() in ['changed', 'date', 'published', 'updated']:
                    continue

                # A class-based substring match (e.g. contains(@class,'date'))
                # can land on a large wrapper element instead of the actual
                # date node, returning most of the page's text instead of a
                # date. A real date is short - if it isn't, pull just the
                # date-like substring out of it rather than trusting the
                # whole blob (which downstream fuzzy date parsing can
                # otherwise resolve to an unrelated date buried in the body).
                if len(result) > 40:
                    date_match = self._DATE_PATTERN.search(result)
                    if not date_match:
                        continue
                    result = date_match.group(0)

                # Store the successful method for learning
                self.successful_methods['date'] = {
                    'method': method_name,
                    'xpath': xpath
                }
                return result
            except:
                continue

        return None

    def _extract_content_fallback(self) -> Optional[str]:
        """Fallback method to extract content with universal extraction methods."""
        strategies = [
            # High priority: structured data and specific article content
            ('itemprop_articleBody', "//meta[@itemprop='articleBody']/@content", lambda: self._get_itemprop_content('articleBody')),
            ('press_release', "//*[contains(@class, 'press-release') or contains(@class, 'press_release')]//p", lambda: self._get_press_release_content()),
            ('article_tag', "//article//p", lambda: self._get_article_tag()),
            ('content_class_patterns', "//*[contains(@class, 'content') or contains(@class, 'body') or contains(@class, 'article')]//p", lambda: self._get_content_by_class_patterns()),
            ('class_article_body', "//*[contains(@class, 'article-body') or contains(@class, 'article-content') or contains(@class, 'post-body') or contains(@class, 'post-content')]//p", lambda: self._get_class_text(['article-body', 'article-content', 'post-body', 'post-content', 'entry-content', 'content', 'main-content', 'story-body'])),
            ('main_tag', "//main//p", lambda: self._get_main_tag_content()),
            ('json_ld_enhanced', "//script[@type='application/ld+json']", lambda: self._get_json_ld_content_enhanced()),

            # NEW: Universal content extractors
            ('trafilatura', None, lambda: self._extract_with_trafilatura()),
            ('microdata', None, lambda: self._extract_microdata_content()),
            ('heuristic_longest_block', None, lambda: self._extract_longest_content_block()),

            # Fallback: JSON-LD basic and all paragraphs
            ('json_ld_content', "//script[@type='application/ld+json']", lambda: self._get_json_ld_content()),
            ('all_paragraphs', "//p", lambda: self._get_paragraphs()),
        ]

        for method_name, xpath, strategy in strategies:
            try:
                result = strategy()
                if result and len(result) > 100:  # Minimum content length
                    # Clean up content (remove excessive whitespace)
                    result = self._clean_content(result)
                    # Store the successful method for learning
                    self.successful_methods['content'] = {
                        'method': method_name,
                        'xpath': xpath
                    }
                    return result
            except:
                continue

        return None

    def _extract_company_fallback(self) -> Optional[str]:
        """Fallback method to extract company name."""
        strategies = [
            ('meta_og_site_name', "//meta[@property='og:site_name']/@content", lambda: self._get_meta_tag('og:site_name')),
            ('meta_author', "//meta[@name='author']/@content", lambda: self._get_meta_tag('author')),
            ('class_brand', "//*[contains(@class, 'brand') or contains(@class, 'site-name') or contains(@class, 'company-name')]", lambda: self._get_class_text(['brand', 'site-name', 'company-name'])),
            ('url_extraction', "//meta[@property='og:url']/@content", lambda: self._extract_from_url()),
        ]

        for method_name, xpath, strategy in strategies:
            try:
                result = strategy()
                if result:
                    # Store the successful method for learning
                    self.successful_methods['company'] = {
                        'method': method_name,
                        'xpath': xpath
                    }
                    return result
            except:
                continue

        return None

    # ==================== Helper Methods ====================

    def _get_meta_tag(self, property_name: str) -> Optional[str]:
        """Extract content from meta tag."""
        # Try property attribute
        meta = self.soup.find('meta', property=property_name)
        if meta and meta.get('content'):
            return meta.get('content').strip()

        # Try name attribute
        meta = self.soup.find('meta', attrs={'name': property_name})
        if meta and meta.get('content'):
            return meta.get('content').strip()

        # Try itemprop attribute
        meta = self.soup.find('meta', attrs={'itemprop': property_name})
        if meta and meta.get('content'):
            return meta.get('content').strip()

        return None

    def _get_tag_text(self, tag_name: str) -> Optional[str]:
        """Extract text from HTML tag."""
        tag = self.soup.find(tag_name)
        if tag:
            text = tag.get_text(strip=True)
            return text if text else None
        return None

    def _get_class_text(self, class_names: List[str]) -> Optional[str]:
        """Extract text from element with specific class names."""
        for class_name in class_names:
            # Find by exact class
            element = self.soup.find(class_=class_name)
            if element:
                text = element.get_text(strip=True)
                if text:
                    return text

            # Find by partial class match
            element = self.soup.find(class_=lambda x: x and class_name in x.lower())
            if element:
                text = element.get_text(strip=True)
                if text:
                    return text

        return None

    def _get_h1_with_title_class(self) -> Optional[str]:
        """Extract H1 that has title-related class."""
        h1_tags = self.soup.find_all('h1')
        for h1 in h1_tags:
            classes = h1.get('class', [])
            if classes and any('title' in str(c).lower() for c in classes):
                text = h1.get_text(strip=True)
                if text:
                    return text
        return None

    def _get_validated_h1(self) -> Optional[str]:
        """Extract first H1 but validate it's not a site name."""
        h1_text = self._get_tag_text('h1')
        if not h1_text:
            return None

        # Check if it's NOT in the header/nav (which typically contains site name)
        h1_tag = self.soup.find('h1')
        if h1_tag:
            # Skip if H1 is inside header or nav
            if h1_tag.find_parent(['header', 'nav']):
                return None

            # If H1 is inside main content area, it's likely the article title
            if h1_tag.find_parent(['article', 'main', '[role="main"]']):
                return h1_text

        return h1_text

    def _is_likely_site_name(self, text: str) -> bool:
        """
        Check if text looks like a company/site name rather than an article title.

        Args:
            text: Text to check

        Returns:
            True if it looks like a site name
        """
        if not text:
            return False

        # Company suffixes that indicate site names
        company_suffixes = [
            'ltd.', 'ltd', 'limited', 'inc.', 'inc', 'incorporated',
            'corp.', 'corp', 'corporation', 'co.', 'company',
            'llc', 'llp', 'gmbh', 'sa', 's.a.', 'plc',
            'pharmaceuticals', 'pharma',  # Common in pharma industry
            'group', 'holdings', 'international'
        ]

        text_lower = text.lower()

        # Check if ends with company suffix
        for suffix in company_suffixes:
            if text_lower.endswith(suffix):
                return True

            # Also check with comma (e.g., "Company Name, Ltd.")
            if text_lower.endswith(f', {suffix}'):
                return True

        # Check if it's all title case (common for company names)
        # But exclude if it contains common article words
        article_indicators = [
            'announces', 'reports', 'launches', 'releases', 'unveils',
            'introduces', 'completes', 'receives', 'gains', 'achieves',
            'wins', 'signs', 'expands', 'enters', 'opens', 'closes',
            'appoints', 'names', 'hires', 'promotes', 'partners',
            'collaborates', 'acquires', 'merges', 'invests'
        ]

        if any(indicator in text_lower for indicator in article_indicators):
            return False

        # If text is short and all words are capitalized, likely company name
        words = text.split()
        if len(words) <= 6:  # Short titles
            capitalized_count = sum(1 for word in words if word and word[0].isupper())
            # If 80%+ words are capitalized and no article indicators, likely company name
            if capitalized_count / len(words) >= 0.8:
                return True

        return False

    def _get_time_tag(self) -> Optional[str]:
        """Extract datetime from time tag."""
        time_tag = self.soup.find('time')
        if time_tag:
            # Try datetime attribute
            if time_tag.get('datetime'):
                return time_tag.get('datetime').strip()

            # Try text content
            text = time_tag.get_text(strip=True)
            if text:
                return text

        return None

    def _get_article_tag(self) -> Optional[str]:
        """Extract content from article tag."""
        article = self.soup.find('article')
        if article:
            # Remove unwanted elements (ads, related articles, cookie banners, etc.)
            for unwanted in article.find_all(['script', 'style', 'aside', 'nav']):
                unwanted.decompose()

            # Remove cookie consent containers (by class and ID)
            for cookie_elem in article.find_all(class_=lambda x: x and any(
                term in str(x).lower() for term in ['cookie', 'consent', 'banner', 'popup', 'modal', 'gdpr', 'onetrust', 'privacy']
            )):
                cookie_elem.decompose()

            for cookie_elem in article.find_all(id=lambda x: x and any(
                term in str(x).lower() for term in ['cookie', 'consent', 'onetrust', 'privacy', 'gdpr']
            )):
                cookie_elem.decompose()

            # Try to find specific content divs first
            content_divs = article.find_all(class_=lambda x: x and any(
                term in str(x).lower() for term in ['body', 'content', 'text', 'story']
            ))

            if content_divs:
                paragraphs = []
                for div in content_divs:
                    paragraphs.extend(div.find_all('p'))
            else:
                # Get all paragraphs within article
                paragraphs = article.find_all('p')

            if paragraphs:
                content_parts = []
                for p in paragraphs:
                    text = p.get_text(strip=True)
                    if len(text) > 30 and not self._is_cookie_consent_text(text):
                        content_parts.append(text)
                content = '\n\n'.join(content_parts)
                return content if content else None

        return None

    def _get_paragraphs(self) -> Optional[str]:
        """Extract content from all paragraphs (with smart filtering)."""
        # Exclude paragraphs from navigation, footer, sidebar, ads, cookie banners
        excluded_parents = ['nav', 'footer', 'aside', 'header']
        excluded_classes = ['nav', 'menu', 'footer', 'sidebar', 'advertisement', 'ad', 'comments', 'related',
                           'cookie', 'consent', 'banner', 'popup', 'modal', 'dialog']

        paragraphs = []
        for p in self.soup.find_all('p'):
            # Skip if parent is excluded
            if any(p.find_parent(tag) for tag in excluded_parents):
                continue

            # Check if paragraph is inside cookie consent popup/banner
            parent_with_cookie = p.find_parent(class_=lambda x: x and any(
                term in str(x).lower() for term in ['cookie', 'consent', 'banner', 'popup', 'modal', 'gdpr', 'onetrust', 'privacy']
            ))
            if parent_with_cookie:
                continue

            # Also check by ID (OneTrust and other cookie platforms use specific IDs)
            parent_with_cookie_id = p.find_parent(id=lambda x: x and any(
                term in str(x).lower() for term in ['cookie', 'consent', 'onetrust', 'privacy', 'gdpr']
            ))
            if parent_with_cookie_id:
                continue

            # Skip if has excluded class
            p_classes = p.get('class', [])
            if any(any(exc in str(cls).lower() for exc in excluded_classes) for cls in p_classes):
                continue

            # Get text
            text = p.get_text(strip=True)

            # Skip cookie-related content by checking text
            if self._is_cookie_consent_text(text):
                continue

            # Filter by length (meaningful paragraphs)
            # Reduced from 50 to 30 to catch shorter press release paragraphs
            if len(text) > 30:
                paragraphs.append(text)

        if paragraphs:
            # Take only the most substantial paragraphs (avoid too much junk)
            # Sort by length and take longer ones (likely main content)
            paragraphs.sort(key=len, reverse=True)
            # Increased from 20 to 50 to capture longer articles
            main_paragraphs = paragraphs[:50]  # Take top 50 longest paragraphs
            main_paragraphs.sort(key=lambda p: self.html_content.index(p) if p in self.html_content else 0)  # Re-sort by original order

            content = '\n\n'.join(main_paragraphs)
            return content if content else None

        return None

    def _extract_date_from_text(self) -> Optional[str]:
        """Extract date using regex patterns from entire HTML."""
        text = self.soup.get_text()

        # Common date patterns
        patterns = [
            r'\d{4}-\d{2}-\d{2}',  # 2024-01-15
            r'\d{2}/\d{2}/\d{4}',  # 01/15/2024
            r'[A-Z][a-z]+\s+\d{1,2},\s+\d{4}',  # January 15, 2024
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0)

        return None

    def _extract_from_url(self) -> Optional[str]:
        """Extract company name from URL."""
        from urllib.parse import urlparse

        parsed = urlparse(self.url)
        domain = parsed.netloc

        # Remove www. and TLD
        company = domain.replace('www.', '').split('.')[0]

        # Capitalize first letter
        return company.capitalize() if company else None

    def _get_itemprop_content(self, property_name: str) -> Optional[str]:
        """Extract content from element with itemprop attribute."""
        # Try meta tag with itemprop
        meta = self.soup.find('meta', attrs={'itemprop': property_name})
        if meta and meta.get('content'):
            return meta.get('content').strip()

        # Try any element with itemprop
        element = self.soup.find(attrs={'itemprop': property_name})
        if element:
            # If it's a meta tag, get content attribute
            if element.name == 'meta' and element.get('content'):
                return element.get('content').strip()
            # Otherwise get text content
            text = element.get_text(strip=True)
            return text if text else None

        return None

    def _get_first_article_h1(self) -> Optional[str]:
        """Extract first H1 inside article tag."""
        article = self.soup.find('article')
        if article:
            h1 = article.find('h1')
            if h1:
                text = h1.get_text(strip=True)
                return text if text else None
        return None

    def _get_main_tag_content(self) -> Optional[str]:
        """Extract content from main tag."""
        main = self.soup.find('main')
        if main:
            # Get all paragraphs within main
            paragraphs = main.find_all('p')
            if paragraphs:
                content = '\n\n'.join([p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 50])
                return content if content else None
        return None

    def _get_press_release_content(self) -> Optional[str]:
        """Extract content specifically from press release pages."""
        # Common press release content containers
        content_selectors = [
            # Class-based selectors for press releases
            {'class_': lambda x: x and 'press' in str(x).lower() and 'content' in str(x).lower()},
            {'class_': lambda x: x and 'release' in str(x).lower() and ('body' in str(x).lower() or 'content' in str(x).lower())},
            {'class_': lambda x: x and 'news' in str(x).lower() and ('body' in str(x).lower() or 'content' in str(x).lower())},
            {'class_': 'press-release-body'},
            {'class_': 'press-release-content'},
            {'class_': 'news-release'},
            {'class_': 'release-content'},
            {'class_': 'article__body'},
            {'class_': 'article-body'},
            {'class_': 'body-copy'},
            {'class_': 'rich-text'},
            {'class_': 'text-content'},
            # ID-based selectors
            {'id': 'content'},
            {'id': 'article-content'},
            {'id': 'main-content'},
            {'id': 'press-release'},
        ]

        for selector in content_selectors:
            container = self.soup.find('div', selector) or self.soup.find('section', selector)
            if container:
                # Remove unwanted elements (including cookie consent)
                for unwanted in container.find_all(['script', 'style', 'aside', 'nav', 'form', 'iframe']):
                    unwanted.decompose()

                # Remove cookie consent containers (by class and ID)
                for cookie_elem in container.find_all(class_=lambda x: x and any(
                    term in str(x).lower() for term in ['cookie', 'consent', 'banner', 'popup', 'modal', 'gdpr', 'onetrust', 'privacy']
                )):
                    cookie_elem.decompose()

                for cookie_elem in container.find_all(id=lambda x: x and any(
                    term in str(x).lower() for term in ['cookie', 'consent', 'onetrust', 'privacy', 'gdpr']
                )):
                    cookie_elem.decompose()

                # Get all paragraphs
                paragraphs = container.find_all('p')
                if paragraphs:
                    content_parts = []
                    for p in paragraphs:
                        text = p.get_text(strip=True)
                        # Filter out short paragraphs and cookie consent text
                        if len(text) > 30 and not self._is_cookie_consent_text(text):
                            content_parts.append(text)

                    if content_parts:
                        return '\n\n'.join(content_parts)

        return None

    def _get_content_by_class_patterns(self) -> Optional[str]:
        """Extract content by searching for common content class patterns."""
        # Patterns that often contain article content
        content_patterns = [
            'article', 'content', 'body', 'text', 'story', 'post',
            'entry', 'main', 'copy', 'detail', 'description'
        ]

        # Find all divs/sections that might contain content
        potential_containers = []

        for pattern in content_patterns:
            # Find elements with class containing pattern
            elements = self.soup.find_all(
                ['div', 'section', 'article'],
                class_=lambda x: x and pattern in str(x).lower()
            )
            for el in elements:
                # Score based on number of paragraphs and text length
                paragraphs = el.find_all('p')
                text_len = len(el.get_text(strip=True))
                p_count = len(paragraphs)

                # Skip if too short or no paragraphs
                if text_len > 200 and p_count > 0:
                    potential_containers.append({
                        'element': el,
                        'score': text_len + (p_count * 100),
                        'p_count': p_count
                    })

        if not potential_containers:
            return None

        # Sort by score (highest first)
        potential_containers.sort(key=lambda x: x['score'], reverse=True)

        # Use the highest scoring container
        best = potential_containers[0]
        container = best['element']

        # Remove unwanted elements
        for unwanted in container.find_all(['script', 'style', 'aside', 'nav', 'form', 'iframe', 'noscript']):
            unwanted.decompose()

        # Extract paragraphs
        paragraphs = container.find_all('p')
        content_parts = []

        for p in paragraphs:
            text = p.get_text(strip=True)
            if len(text) > 30:
                content_parts.append(text)

        if content_parts:
            return '\n\n'.join(content_parts)

        return None

    def _iter_json_ld_items(self, data) -> List[dict]:
        """Flatten a parsed JSON-LD document into the objects worth inspecting.

        Handles both a bare object/array and the common @graph wrapper
        (e.g. {"@context": ..., "@graph": [{"@type": "NewsArticle", ...}, ...]})
        which several JSON-LD helpers here previously missed entirely.
        """
        if isinstance(data, dict):
            graph = data.get('@graph')
            if isinstance(graph, list):
                return [item for item in graph if isinstance(item, dict)]
            return [data]
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    def _extract_date_from_json_ld(self) -> Optional[str]:
        """Extract date from JSON-LD structured data."""
        import json

        # Find JSON-LD scripts
        scripts = self.soup.find_all('script', type='application/ld+json')

        for script in scripts:
            try:
                data = json.loads(script.string)
            except Exception:
                continue

            for item in self._iter_json_ld_items(data):
                date = self._extract_date_from_json_obj(item)
                if date:
                    return date

        return None

    def _get_json_ld_headline(self) -> Optional[str]:
        """Extract the article headline from JSON-LD structured data
        (schema.org Article/NewsArticle/BlogPosting/Report). More reliable
        than guessing at page-template headings when present, since it's
        authored data rather than a heuristic DOM match."""
        import json

        scripts = self.soup.find_all('script', type='application/ld+json')
        article_types = ('article', 'newsarticle', 'blogposting', 'scholarlyarticle', 'report')

        for script in scripts:
            try:
                if not script.string:
                    continue
                data = json.loads(script.string)
            except Exception:
                continue

            for item in self._iter_json_ld_items(data):
                item_type = item.get('@type', '')
                item_type = item_type.lower() if isinstance(item_type, str) else ''
                if any(t in item_type for t in article_types) and item.get('headline'):
                    return str(item['headline']).strip()

        return None

    def _extract_date_from_json_obj(self, obj: dict) -> Optional[str]:
        """Extract date from a JSON-LD object."""
        if not isinstance(obj, dict):
            return None

        # Check common date fields
        date_fields = ['datePublished', 'publishDate', 'dateCreated', 'uploadDate']
        for field in date_fields:
            if field in obj:
                return obj[field]

        return None

    def _get_json_ld_content(self) -> Optional[str]:
        """Extract article body from JSON-LD structured data."""
        import json

        scripts = self.soup.find_all('script', type='application/ld+json')

        for script in scripts:
            try:
                data = json.loads(script.string)

                # Handle array
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            # Look for articleBody
                            if 'articleBody' in item:
                                return item['articleBody']
                            if 'description' in item and len(item['description']) > 100:
                                return item['description']
                else:
                    if isinstance(data, dict):
                        if 'articleBody' in data:
                            return data['articleBody']
                        if 'description' in data and len(data['description']) > 100:
                            return data['description']
            except:
                continue

        return None

    def _clean_title(self, title: str) -> str:
        """Clean title by removing site name and extra formatting."""
        import re

        # Remove common separators with site names/timestamps (e.g.
        # "Title - Site Name", "Title | Site", or a template appending both:
        # "Title | Weekday, MM/DD/YYYY - HH:MM"). Apply cumulatively rather
        # than stopping after the first match - a title can carry more than
        # one trailing separator and each pattern only strips the outermost.
        patterns = [
            r'\s*[-|–—]\s*[^-|–—]+$',  # Remove everything after last dash/pipe
            r'\s*\|\s*[^|]+$',
        ]

        for pattern in patterns:
            cleaned = re.sub(pattern, '', title)
            if cleaned and len(cleaned) > 10:  # Make sure we still have meaningful content
                title = cleaned

        return title.strip()

    def _is_cookie_consent_text(self, text: str) -> bool:
        """
        Check if text is cookie consent/privacy policy content.

        Args:
            text: Text to check

        Returns:
            True if text appears to be cookie consent content
        """
        if not text:
            return False

        text_lower = text.lower()

        # Cookie consent indicators (need multiple matches to be sure)
        cookie_indicators = [
            'strictly necessary cookies',
            'cookie consent',
            'cookies are small text files',
            'enable the website to provide enhanced functionality',
            'track our visitors browsing habits',
            'personalized marketing content',
            'what are cookies',
            'how are they managed',
            'placed on your computer or device',
            'letters and numbers and are placed',
            'help us make online services easier',
            'privacy preferences',
            'cookie panel',
            'configure your browser settings',
            'restricting cookies may impact',
            'web browser manufacturers',
            'accept all cookies',
            'reject all cookies',
            'cookie settings',
            'manage cookies',
            'cookies allow us to count visits',
            'perform customer surveys and other web analytics',
            'measure and improve the performance of our site',
            'see how visitors move around the site',
            'third party providers whose services',
            'targeted advertising',
            'browsing history for every visitor',
            'identifiable data may be collected',
        ]

        # Count matches
        matches = sum(1 for indicator in cookie_indicators if indicator in text_lower)

        # If we have 1+ match for very specific phrases, it's cookie consent
        if matches >= 1:
            return True

        # Check if text mentions cookies/consent frequently (high density)
        if len(text) > 100:
            cookie_word_count = text_lower.count('cookie') + text_lower.count('consent')
            # If cookies mentioned 3+ times in text, likely cookie consent
            if cookie_word_count >= 3:
                return True

        # Check for common cookie/privacy keywords density
        privacy_keywords = ['privacy', 'cookies', 'consent', 'tracking', 'analytics', 'personalized', 'browser']
        keyword_count = sum(text_lower.count(kw) for kw in privacy_keywords)
        if len(text) > 50 and keyword_count >= 5:
            return True

        return False

    def _clean_content(self, content: str) -> str:
        """Clean content by removing excessive whitespace and cookie consent text."""
        import re

        # Split into paragraphs and filter out cookie consent
        paragraphs = content.split('\n\n')
        filtered_paragraphs = []

        for para in paragraphs:
            # Skip cookie consent paragraphs
            if not self._is_cookie_consent_text(para):
                filtered_paragraphs.append(para)

        content = '\n\n'.join(filtered_paragraphs)

        # Replace multiple newlines with double newline
        content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)

        # Replace multiple spaces with single space
        content = re.sub(r' +', ' ', content)

        return content.strip()

    # ==================== UNIVERSAL EXTRACTION METHODS ====================

    def _extract_with_trafilatura(self) -> Optional[str]:
        """
        Extract content using Trafilatura library.
        Trafilatura uses advanced heuristics to extract main content.
        """
        if not TRAFILATURA_AVAILABLE:
            return None

        try:
            # Extract main content with Trafilatura
            extracted = trafilatura.extract(
                self.html_content,
                url=self.url,
                include_comments=False,
                include_tables=True,
                include_images=False,
                include_links=False,
                output_format='txt',
                favor_precision=False,  # Favor recall to get more content
                favor_recall=True
            )

            if extracted and len(extracted) > 100:
                return extracted.strip()

        except Exception as e:
            print(f"Trafilatura extraction failed: {e}")

        return None

    def _extract_longest_content_block(self) -> Optional[str]:
        """
        Heuristic method: Find the longest contiguous text block.
        Works when structure is unknown but content is there.
        """
        try:
            # Remove unwanted elements first
            soup_copy = BeautifulSoup(str(self.soup), 'html.parser')

            # Remove script, style, nav, header, footer, aside
            for tag in soup_copy.find_all(['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'iframe']):
                tag.decompose()

            # Find all potential content containers
            potential_blocks = []

            # Check divs, sections, articles, mains
            for tag in soup_copy.find_all(['div', 'section', 'article', 'main']):
                # Get text length and paragraph count
                text = tag.get_text(strip=True)
                paragraphs = tag.find_all('p')

                if len(text) < 200:  # Skip short blocks
                    continue

                # Calculate density score
                # Higher score = more paragraphs relative to total content
                p_text_len = sum(len(p.get_text(strip=True)) for p in paragraphs)
                paragraph_density = p_text_len / len(text) if len(text) > 0 else 0

                # Score based on length and paragraph density
                score = len(text) * (1 + paragraph_density)

                potential_blocks.append({
                    'element': tag,
                    'text': text,
                    'length': len(text),
                    'p_count': len(paragraphs),
                    'density': paragraph_density,
                    'score': score
                })

            if not potential_blocks:
                return None

            # Sort by score (highest first)
            potential_blocks.sort(key=lambda x: x['score'], reverse=True)

            # Get the best block
            best_block = potential_blocks[0]

            # Extract paragraphs from best block
            paragraphs = best_block['element'].find_all('p')

            if paragraphs and len(paragraphs) > 0:
                content_parts = []
                for p in paragraphs:
                    text = p.get_text(strip=True)
                    # Filter out short snippets and cookie consent
                    if len(text) > 30 and not self._is_cookie_consent_text(text):
                        content_parts.append(text)

                if content_parts and len(content_parts) >= 2:  # Need at least 2 paragraphs
                    return '\n\n'.join(content_parts)

            # Fallback: return the text directly if no paragraphs
            if best_block['length'] > 500:
                return best_block['text']

        except Exception as e:
            print(f"Longest block extraction failed: {e}")

        return None

    def _get_json_ld_content_enhanced(self) -> Optional[str]:
        """
        Enhanced JSON-LD extraction with better handling.
        Extracts from NewsArticle, BlogPosting, Article schemas.
        """
        try:
            scripts = self.soup.find_all('script', type='application/ld+json')

            for script in scripts:
                try:
                    if not script.string:
                        continue

                    data = json_lib.loads(script.string)

                    # Handle array of objects
                    items_to_check = []
                    if isinstance(data, list):
                        items_to_check.extend(data)
                    else:
                        items_to_check.append(data)

                    for item in items_to_check:
                        if not isinstance(item, dict):
                            continue

                        # Check @type for article types
                        item_type = item.get('@type', '').lower() if isinstance(item.get('@type'), str) else ''

                        article_types = ['newsarticle', 'article', 'blogposting', 'scholarlyarticle', 'report']
                        is_article = any(atype in item_type for atype in article_types)

                        # Extract articleBody first (most complete)
                        if 'articleBody' in item and len(item['articleBody']) > 100:
                            return item['articleBody']

                        # Try text field
                        if 'text' in item and len(item['text']) > 100:
                            return item['text']

                        # Try description (but only for article types)
                        if is_article and 'description' in item and len(item['description']) > 200:
                            return item['description']

                except json_lib.JSONDecodeError:
                    continue
                except Exception:
                    continue

        except Exception as e:
            print(f"Enhanced JSON-LD extraction failed: {e}")

        return None

    def _extract_microdata_content(self) -> Optional[str]:
        """
        Extract content from HTML5 microdata attributes.
        Looks for itemprop="articleBody" or similar.
        """
        try:
            # Find elements with articleBody itemprop
            article_body = self.soup.find(attrs={'itemprop': 'articleBody'})
            if article_body:
                text = article_body.get_text(strip=True)
                if len(text) > 100:
                    return text

            # Try text itemprop
            text_prop = self.soup.find(attrs={'itemprop': 'text'})
            if text_prop:
                text = text_prop.get_text(strip=True)
                if len(text) > 100:
                    return text

            # Try description itemprop (but check length)
            desc_prop = self.soup.find(attrs={'itemprop': 'description'})
            if desc_prop:
                text = desc_prop.get_text(strip=True)
                if len(text) > 200:  # Higher threshold for description
                    return text

        except Exception as e:
            print(f"Microdata extraction failed: {e}")

        return None

    def validate_extraction(self, result: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Validate extraction quality to prevent empty/low-quality pages.

        Args:
            result: Extraction result dictionary

        Returns:
            Tuple of (is_valid, reason)
        """
        # Hard requirements: must have title and content
        if not result.get('title') or len(result['title']) < 10:
            return False, "Title missing or too short (< 10 chars)"

        if not result.get('content') or len(result['content']) < 200:
            return False, "Content missing or too short (< 200 chars)"

        # Check title is not generic
        generic_titles = [
            'news release', 'press release', 'article', 'news', 'press',
            'home', 'homepage', 'welcome', 'untitled'
        ]
        title_lower = result['title'].lower().strip()
        if title_lower in generic_titles:
            return False, f"Generic title detected: {result['title']}"

        # Check for excessive boilerplate content
        content_lower = result['content'].lower()
        boilerplate_phrases = [
            'cookie policy', 'privacy policy', 'terms of service',
            'subscribe to newsletter', 'follow us on', 'all rights reserved',
            'cookies are small text files', 'accept all cookies',
            'manage cookie preferences', 'strictly necessary cookies'
        ]

        boilerplate_count = sum(1 for phrase in boilerplate_phrases if phrase in content_lower)

        # If more than 4 boilerplate phrases, likely not article content
        if boilerplate_count > 4:
            return False, f"Too much boilerplate content (found {boilerplate_count} indicators)"

        # Check content-to-title ratio (content should be much longer than title)
        content_length = len(result['content'])
        title_length = len(result['title'])

        if content_length < title_length * 3:
            return False, "Content too short relative to title"

        # Check for minimum word count (approximate)
        word_count = len(result['content'].split())
        if word_count < 50:
            return False, f"Content too short (< 50 words, found {word_count})"

        # Check that content is not just repeated text
        # Split into sentences and check for uniqueness
        sentences = result['content'].split('.')
        unique_sentences = set(s.strip() for s in sentences if len(s.strip()) > 20)
        if len(sentences) > 5 and len(unique_sentences) < len(sentences) * 0.7:
            return False, "Content appears to be repetitive"

        # All checks passed
        return True, "Validation passed"

    # ==================== END UNIVERSAL EXTRACTION METHODS ====================

    def scrape(self, xpaths: Dict[str, str], category: str = 'news') -> Dict[str, Any]:
        """
        Scrape article using provided XPaths with fallback.
        Enhanced to extract category-specific fields.

        Args:
            xpaths: Dictionary with XPath expressions for each field
                   e.g., {"title": "//h1", "date": "//time", ...}
            category: Content category (pipeline, investor_update, investor_event, media_event, media_release, news)

        Returns:
            Dictionary with scraped data including category-specific fields
        """
        result = {
            "url": self.url,
            "title": None,
            "date": None,
            "content": None,
            "company": None,
            "category": category,
            "extraction_method": {},
            "extraction_details": {},
            "success": False
        }

        # Extract each field
        for field in ["title", "date", "content", "company"]:
            xpath = xpaths.get(field, "")

            # Try XPath first
            value = None
            method = "xpath"
            detail = None

            if xpath:
                value = self._extract_with_xpath(xpath, field)
                if value:
                    detail = f"XPath: {xpath}"

            # Fallback if XPath failed or not provided
            if not value:
                value = self.extract_field(xpath, field)

                # Check if a fallback method was successful and tracked
                if value and field in self.successful_methods:
                    method_info = self.successful_methods[field]
                    if method_info and isinstance(method_info, dict):
                        method = method_info.get('method', 'universal_fallback')
                        xpath_info = method_info.get('xpath', '')
                        detail = f"Method: {method}, XPath: {xpath_info}"
                    else:
                        method = "universal_fallback"
                        detail = "Auto-detected using fallback strategies"
                else:
                    method = "universal_fallback"
                    # Generic fallback message
                    if value:
                        detail = f"Auto-detected using fallback strategies"

            result[field] = value
            result["extraction_method"][field] = method
            if detail:
                result["extraction_details"][field] = detail

        # Extract category-specific fields
        category_fields = self._extract_category_specific_fields(category)
        result.update(category_fields)

        # Validate extraction quality (enhanced validation)
        is_valid, validation_message = self.validate_extraction(result)
        result["validation_passed"] = is_valid
        result["validation_message"] = validation_message

        # Check if extraction was successful
        # Success = validation passed
        result["success"] = is_valid

        # Add quality score
        quality_score = 0
        if result["title"]:
            quality_score += 25
        if result["content"] and len(result["content"]) > 500:
            quality_score += 50
        elif result["content"]:
            quality_score += 25
        if result["date"]:
            quality_score += 15
        if result["company"]:
            quality_score += 10

        # Bonus points for validation passing
        if is_valid:
            quality_score += 10

        # Bonus for category-specific fields
        if category_fields:
            quality_score += 5

        result["quality_score"] = quality_score

        # Add content hash for deduplication
        if result["content"]:
            result["content_hash"] = hashlib.md5(
                result["content"].encode('utf-8')
            ).hexdigest()

        # Add metadata
        result["scraped_at"] = datetime.now().isoformat()

        # Add learned XPaths for auto-learning system
        result["learned_xpaths"] = {}
        for field, method_info in self.successful_methods.items():
            if method_info and isinstance(method_info, dict) and 'xpath' in method_info:
                result["learned_xpaths"][f"{field}_xpath"] = method_info['xpath']

        return result

    def _extract_category_specific_fields(self, category: str) -> Dict[str, Any]:
        """
        Extract fields specific to the content category.

        Args:
            category: Content category

        Returns:
            Dictionary with category-specific fields
        """
        fields = {}

        if category in ['investor_event', 'media_event']:
            # Extract event-specific information
            event_info = self._extract_event_details()
            fields.update(event_info)

        elif category == 'pipeline':
            # Extract pipeline-specific information
            pipeline_info = self._extract_pipeline_details()
            fields.update(pipeline_info)

        elif category == 'investor_update':
            # Extract financial information
            financial_info = self._extract_financial_details()
            fields.update(financial_info)

        # Extract PDF attachments for all categories
        # NOTE: PDF extraction disabled by default - enable if needed
        # Uncomment the lines below to enable PDF extraction:
        # pdfs = self._extract_pdf_links()
        # if pdfs:
        #     fields['pdf_attachments'] = pdfs
        #     # Download and extract PDF content
        #     pdf_extractions = self._process_pdf_attachments(pdfs)
        #     if pdf_extractions:
        #         fields['pdf_extractions'] = pdf_extractions

        # Extract contact information
        contact_info = self._extract_contact_info()
        if contact_info:
            fields['contact_info'] = contact_info

        return fields

    def _extract_event_details(self) -> Dict[str, Any]:
        """
        Extract event-specific details (date, time, location, registration).

        Returns:
            Dictionary with event details
        """
        details = {}

        # Extract event date/time (in addition to publication date)
        event_date = self._extract_event_date()
        if event_date:
            details['event_date'] = event_date

        # Extract event time
        event_time = self._extract_event_time()
        if event_time:
            details['event_time'] = event_time

        # Extract location
        location = self._extract_event_location()
        if location:
            details['event_location'] = location

        # Extract registration/RSVP link
        registration_link = self._extract_registration_link()
        if registration_link:
            details['registration_link'] = registration_link

        # Extract webcast/webinar link
        webcast_link = self._extract_webcast_link()
        if webcast_link:
            details['webcast_link'] = webcast_link

        return details

    def _extract_pipeline_details(self) -> Dict[str, Any]:
        """
        Extract pipeline-specific details (products, phases, indications).

        Returns:
            Dictionary with pipeline details
        """
        details = {}

        # Extract product/drug names
        products = self._extract_product_names()
        if products:
            details['products'] = products

        # Extract clinical trial phases
        phases = self._extract_clinical_phases()
        if phases:
            details['clinical_phases'] = phases

        # Extract indications/therapeutic areas
        indications = self._extract_indications()
        if indications:
            details['indications'] = indications

        return details

    def _extract_financial_details(self) -> Dict[str, Any]:
        """
        Extract financial details (revenue, earnings, guidance).

        Returns:
            Dictionary with financial details
        """
        details = {}

        # Extract revenue figures
        revenue = self._extract_revenue()
        if revenue:
            details['revenue'] = revenue

        # Extract earnings/profit
        earnings = self._extract_earnings()
        if earnings:
            details['earnings'] = earnings

        # Extract guidance
        guidance = self._extract_guidance()
        if guidance:
            details['guidance'] = guidance

        return details

    def _extract_event_date(self) -> Optional[str]:
        """Extract event date from content."""
        # Look for patterns like "Date: March 15, 2024" or "Event Date:"
        patterns = [
            r'(?:event\s+date|date):\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
            r'(?:when|date):\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
            r'(?:on|scheduled\s+for)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
        ]

        text = self.soup.get_text()
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_event_time(self) -> Optional[str]:
        """Extract event time from content."""
        # Look for time patterns
        patterns = [
            r'(?:time|at):\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)',
            r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)(?:\s*[A-Z]{2,4})?)',
        ]

        text = self.soup.get_text()
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_event_location(self) -> Optional[str]:
        """Extract event location from content."""
        # Look for location patterns
        patterns = [
            r'(?:location|venue|where):\s*([^.\n]{10,100})',
            r'(?:at|in)\s+([A-Z][^.,\n]{10,80}(?:Hotel|Center|Centre|Hall|Building|Room))',
        ]

        text = self.soup.get_text()
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).strip()

        return None

    def _extract_registration_link(self) -> Optional[str]:
        """Extract registration/RSVP link."""
        # Look for links with registration-related text
        for link in self.soup.find_all('a', href=True):
            text = link.get_text().lower()
            if any(keyword in text for keyword in ['register', 'rsvp', 'sign up', 'attendance', 'join us']):
                return link.get('href')

        return None

    def _extract_webcast_link(self) -> Optional[str]:
        """Extract webcast/webinar link."""
        # Look for links with webcast-related text
        for link in self.soup.find_all('a', href=True):
            text = link.get_text().lower()
            href = link.get('href').lower()
            if any(keyword in text or keyword in href for keyword in ['webcast', 'webinar', 'live stream', 'watch']):
                return link.get('href')

        return None

    def _extract_product_names(self) -> List[str]:
        """Extract product/drug names from content."""
        products = []

        # Look for capitalized drug names (often in parentheses or quotes)
        text = self.soup.get_text()
        # Pattern for drug names: Usually capitalized, sometimes followed by ® or ™
        pattern = r'\b([A-Z][a-z]{2,}(?:®|™)?)\b'

        # Also look for text near keywords
        product_contexts = [
            r'(?:product|drug|candidate|therapy|treatment)\s+(?:called|named)?\s*([A-Z][a-z]+(?:-[A-Z][a-z]+)?)',
            r'([A-Z][a-z]+(?:-[A-Z][a-z]+)?)\s+(?:is a|was|has been)'
        ]

        for context_pattern in product_contexts:
            matches = re.findall(context_pattern, text)
            products.extend(matches)

        # Deduplicate and filter common words
        common_words = {'The', 'This', 'These', 'That', 'Those', 'Company', 'Inc', 'Ltd'}
        products = list(set([p for p in products if p not in common_words and len(p) > 3]))

        return products[:10]  # Limit to top 10

    def _extract_clinical_phases(self) -> List[str]:
        """Extract clinical trial phases mentioned."""
        phases = []

        text = self.soup.get_text().lower()

        # Look for phase mentions
        phase_patterns = [
            r'phase\s+(i{1,3}|\d)',
            r'phase\s+(1|2|3)',
            r'preclinical',
            r'clinical\s+trial'
        ]

        for pattern in phase_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            phases.extend(matches)

        return list(set(phases))

    def _extract_indications(self) -> List[str]:
        """Extract therapeutic indications/areas."""
        indications = []

        text = self.soup.get_text()

        # Look for indication patterns
        indication_patterns = [
            r'(?:for the treatment of|indicated for|treating)\s+([^.,]{10,80})',
            r'(?:in|for)\s+([^.,]{10,60})\s+(?:patients|indication)',
        ]

        for pattern in indication_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            indications.extend([m.strip() for m in matches if len(m.strip()) > 10])

        return list(set(indications))[:5]

    def _extract_revenue(self) -> Optional[str]:
        """Extract revenue figures."""
        text = self.soup.get_text()

        # Look for revenue mentions
        patterns = [
            r'revenue[:\s]+(?:of\s+)?(\$[\d.,]+\s*(?:million|billion|M|B))',
            r'(\$[\d.,]+\s*(?:million|billion|M|B))\s+in revenue',
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_earnings(self) -> Optional[str]:
        """Extract earnings figures."""
        text = self.soup.get_text()

        # Look for earnings mentions
        patterns = [
            r'earnings[:\s]+(?:of\s+)?(\$[\d.,]+\s*(?:million|billion|M|B|per share))',
            r'(?:net income|profit)[:\s]+(?:of\s+)?(\$[\d.,]+\s*(?:million|billion|M|B))',
            r'eps[:\s]+(\$[\d.]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_guidance(self) -> Optional[str]:
        """Extract guidance information."""
        text = self.soup.get_text()

        # Look for guidance mentions
        patterns = [
            r'(?:guidance|outlook)[:\s]+([^.\n]{20,150})',
            r'(?:expect|expects|forecasts?)[:\s]+([^.\n]{20,150})',
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                guidance_text = match.group(1).strip()
                if len(guidance_text) > 20:
                    return guidance_text

        return None

    def _extract_pdf_links(self) -> List[str]:
        """Extract PDF attachment links."""
        pdf_links = []

        for link in self.soup.find_all('a', href=True):
            href = link.get('href')
            if href.lower().endswith('.pdf') or 'pdf' in href.lower():
                # Make absolute URL
                from urllib.parse import urljoin
                absolute_url = urljoin(self.url, href)
                pdf_links.append(absolute_url)

        return pdf_links

    def _process_pdf_attachments(self, pdf_urls: List[str], max_pdfs: int = 5) -> List[Dict[str, any]]:
        """
        Download and extract text from PDF attachments.

        Args:
            pdf_urls: List of PDF URLs to process
            max_pdfs: Maximum number of PDFs to process (default: 5)

        Returns:
            List of PDF extraction results
        """
        try:
            from services.pdf_extractor_service import PDFExtractorService

            print(f"[PDF Processing] Found {len(pdf_urls)} PDF(s), processing up to {max_pdfs}")

            # Limit number of PDFs to avoid excessive processing time
            urls_to_process = pdf_urls[:max_pdfs]
            if len(pdf_urls) > max_pdfs:
                print(f"[PDF Processing] ⚠ Found {len(pdf_urls)} PDFs, processing first {max_pdfs}")

            # Initialize PDF extractor
            pdf_service = PDFExtractorService()

            # Process PDFs with referer (article URL) to avoid 403 Forbidden
            extractions = []
            for idx, pdf_url in enumerate(urls_to_process, 1):
                try:
                    print(f"[PDF Processing] Processing PDF {idx}/{len(urls_to_process)}: {pdf_url[:80]}...")
                    # Pass article URL as referer to avoid 403 Forbidden errors
                    result = pdf_service.download_and_extract(pdf_url, save_locally=True, referer=self.url)
                    if result.get('success'):
                        # Store essential info (avoid storing full text in list to save memory)
                        extractions.append({
                            'url': pdf_url,
                            'success': True,
                            'pdf_path': result.get('pdf_path'),
                            'page_count': result.get('page_count'),
                            'character_count': result.get('character_count'),
                            'text_preview': result.get('text', '')[:500],  # First 500 chars
                            'metadata': result.get('metadata', {}),
                            'full_text': result.get('text', '')  # Store full text for SEC filings
                        })
                        print(f"[PDF Processing] ✓ Extracted PDF: {pdf_url[:60]}... ({result.get('page_count')} pages, {result.get('character_count')} chars)")
                    else:
                        extractions.append({
                            'url': pdf_url,
                            'success': False,
                            'error': result.get('error', 'Unknown error')
                        })
                        print(f"[PDF Processing] ✗ Failed to extract PDF: {pdf_url[:60]}... - {result.get('error', 'Unknown error')}")
                except Exception as e:
                    print(f"[PDF Processing] ✗ Error processing PDF {pdf_url[:60]}...: {e}")
                    extractions.append({
                        'url': pdf_url,
                        'success': False,
                        'error': str(e)
                    })

            if extractions:
                successful = sum(1 for e in extractions if e.get('success'))
                print(f"[PDF Processing] Summary: {successful}/{len(extractions)} PDFs extracted successfully")

            return extractions if extractions else None

        except ImportError:
            print("[PDF Processing] ✗ PDF extraction service not available (ImportError)")
            return None
        except Exception as e:
            print(f"[PDF Processing] ✗ Error in PDF processing: {e}")
            return None

    def _extract_contact_info(self) -> Dict[str, Any]:
        """Extract contact information."""
        contact = {}

        text = self.soup.get_text()

        # Extract email
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        emails = re.findall(email_pattern, text)
        if emails:
            contact['emails'] = list(set(emails))[:3]

        # Extract phone numbers
        phone_pattern = r'(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'
        phones = re.findall(phone_pattern, text)
        if phones:
            contact['phones'] = list(set(phones))[:3]

        return contact if contact else {}


def scrape_article(html_content: str, url: str, xpaths: Dict[str, str], category: str = 'news') -> Dict[str, Any]:
    """
    Convenience function to scrape an article.

    Args:
        html_content: Raw HTML string
        url: URL of the article
        xpaths: Dictionary with XPath expressions
        category: Content category (pipeline, investor_update, investor_event, media_event, media_release, news)

    Returns:
        Scraped article data with category-specific fields
    """
    spider = ArticleSpider(html_content, url)
    return spider.scrape(xpaths, category)
