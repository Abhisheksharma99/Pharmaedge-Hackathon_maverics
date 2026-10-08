"""
Google Alerts RSS Feed Generator Service

Creates Google Alerts and extracts RSS feed URLs for use with the news crawler.
"""

import re
import json
from typing import Dict, Any, Optional
from curl_cffi import requests
from utils.logging_config import get_logger

logger = get_logger("services.google_alerts")


class GoogleAlertsService:
    """
    Service for creating Google Alerts and extracting RSS feed URLs.
    """

    BASE_URL = "https://www.google.co.in"
    ALERTS_CREATE_URL = "https://www.google.co.in/alerts/create"

    def __init__(self, cookies: Dict[str, str], headers: Dict[str, str] = None):
        """
        Initialize GoogleAlertsService with authentication cookies.

        Args:
            cookies: Google authentication cookies (required for creating alerts)
            headers: Optional custom headers
        """
        self.cookies = cookies
        self.headers = headers or self._get_default_headers()
        self.session = requests.Session(impersonate="chrome110")

    def close(self) -> None:
        """Explicitly release the curl_cffi Session's native handle.

        Must be called (try/finally) rather than left to GC - see
        GoogleNewsDiscovery.close() for why GC-driven cleanup from an
        arbitrary thread corrupts the heap.
        """
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def _get_default_headers(self) -> Dict[str, str]:
        """Get default headers for Google Alerts requests."""
        return {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'origin': 'https://www.google.co.in',
            'priority': 'u=1, i',
            'referer': 'https://www.google.co.in/alerts',
            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'x-browser-channel': 'stable',
            'x-browser-copyright': 'Copyright 2025 Google LLC. All Rights reserved.',
            'x-browser-validation': 'lWZoCd/Ihv9Aa32HuKZ6rlDBoto=',
            'x-browser-year': '2025',
            'x-client-data': 'CKCIywE=',
        }

    def create_alert_and_get_rss(
        self,
        keyword: str,
        region: str = "co.in",
        language: str = "en",
        country_code: str = "IN",
        x_param: str = None
    ) -> Dict[str, Any]:
        """
        Create a Google Alert for the given keyword and extract the RSS feed URL.

        Args:
            keyword: The search keyword/phrase for the alert (e.g., "ulcerative colitis OR fibrostenotic")
            region: Google region (default: "co.in")
            language: Language code (default: "en")
            country_code: Country code (default: "IN")
            x_param: Optional x parameter for the request timestamp

        Returns:
            Dict with:
                - success: bool
                - rss_url: Full RSS feed URL (if successful)
                - rss_path: The relative path extracted from response
                - error: Error message (if failed)
        """
        try:
            logger.info(f"[GoogleAlerts] Creating alert for keyword: {keyword}")

            # Build the params data structure
            # Format: [null,[null,null,null,[null,"KEYWORD","REGION",[null,"LANG","COUNTRY"],null,null,null,0,1],null,3,[[null,2,"",[],1,"LANG-COUNTRY",null,null,null,null,null,"0",null,null,"TOKEN"]]]]
            params_data = self._build_params(keyword, region, language, country_code)

            # Build request parameters
            import time
            timestamp = x_param or f"AMJHsmW0kXthm5qTWfkZJz9Qi_btUV7oLg:{int(time.time() * 1000)}"
            params = {'x': timestamp}

            data = {'params': json.dumps(params_data)}

            # Make the request
            response = self.session.post(
                self.ALERTS_CREATE_URL,
                params=params,
                headers=self.headers,
                cookies=self.cookies,
                data=data,
                timeout=30
            )

            logger.info(f"[GoogleAlerts] Response status: {response.status_code}")
            logger.debug(f"[GoogleAlerts] Response text: {response.text[:500]}...")

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text[:200]}"
                }

            # Extract RSS feed URL from response
            rss_result = self._extract_rss_url(response.text)

            if rss_result["success"]:
                logger.info(f"[GoogleAlerts] Successfully extracted RSS URL: {rss_result['rss_url']}")
            else:
                logger.error(f"[GoogleAlerts] Failed to extract RSS URL: {rss_result.get('error')}")

            return rss_result

        except Exception as e:
            logger.error(f"[GoogleAlerts] Error creating alert: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def _build_params(
        self,
        keyword: str,
        region: str,
        language: str,
        country_code: str
    ) -> list:
        """
        Build the params data structure for the alert creation request.

        Args:
            keyword: Search keyword
            region: Google region
            language: Language code
            country_code: Country code

        Returns:
            Nested list structure for the params
        """
        # The token appears to be static or session-based
        token = "AB2Xq4hcilCERh73EFWJVHXx-io2lhh1EhC8UD8"

        return [
            None,
            [
                None,
                None,
                None,
                [
                    None,
                    keyword,
                    region,
                    [None, language, country_code],
                    None,
                    None,
                    None,
                    0,
                    1
                ],
                None,
                3,
                [
                    [
                        None,
                        2,
                        "",
                        [],
                        1,
                        f"{language}-{country_code}",
                        None,
                        None,
                        None,
                        None,
                        None,
                        "0",
                        None,
                        None,
                        token
                    ]
                ]
            ]
        ]

    def _extract_rss_url(self, response_text: str) -> Dict[str, Any]:
        """
        Extract RSS feed URL from the Google Alerts response.

        Looks for patterns like: <a href="/alerts/feeds/00991979114874839407/485817302013021837"

        Args:
            response_text: HTML/JSON response from Google Alerts

        Returns:
            Dict with success status and RSS URL or error
        """
        # Pattern to match the RSS feed path in href attribute
        # Example: <a href="/alerts/feeds/00991979114874839407/485817302013021837"
        patterns = [
            r'<a\s+href="(/alerts/feeds/[^"]+)"',
            r'href="(/alerts/feeds/[^"]+)"',
            r'/alerts/feeds/(\d+/\d+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, response_text)
            if match:
                rss_path = match.group(1)
                # Ensure the path starts with /
                if not rss_path.startswith('/'):
                    rss_path = f"/alerts/feeds/{rss_path}"

                # Build the full URL
                full_url = f"{self.BASE_URL}{rss_path}"

                return {
                    "success": True,
                    "rss_url": full_url,
                    "rss_path": rss_path
                }

        # If no pattern matched, return error with response snippet for debugging
        return {
            "success": False,
            "error": "Could not find RSS feed URL in response",
            "response_preview": response_text[:500] if response_text else "Empty response"
        }

    def get_rss_feed_content(self, rss_url: str) -> Dict[str, Any]:
        """
        Fetch the RSS feed content from the generated URL.

        Args:
            rss_url: Full RSS feed URL

        Returns:
            Dict with success status and RSS content or error
        """
        try:
            logger.info(f"[GoogleAlerts] Fetching RSS feed: {rss_url}")

            response = self.session.get(
                rss_url,
                headers=self.headers,
                cookies=self.cookies,
                timeout=30
            )

            if response.status_code == 200:
                return {
                    "success": True,
                    "content": response.text,
                    "status_code": 200
                }
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}",
                    "status_code": response.status_code
                }

        except Exception as e:
            logger.error(f"[GoogleAlerts] Error fetching RSS feed: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }


def create_alert_rss(keyword: str, cookies: Dict[str, str]) -> Optional[str]:
    """
    Convenience function to create a Google Alert and return the RSS feed URL.

    Args:
        keyword: Search keyword for the alert
        cookies: Google authentication cookies

    Returns:
        RSS feed URL string if successful, None otherwise
    """
    with GoogleAlertsService(cookies=cookies) as service:
        result = service.create_alert_and_get_rss(keyword)

    if result["success"]:
        return result["rss_url"]
    else:
        logger.error(f"Failed to create alert: {result.get('error')}")
        return None


# Example usage
if __name__ == "__main__":
    # Example cookies (you need to provide your own valid cookies)
    example_cookies = {
        'HSID': 'your_hsid',
        'SSID': 'your_ssid',
        'SID': 'your_sid',
        # ... other required cookies
    }

    keyword = "ulcerative colitis OR fibrostenotic"
    rss_url = create_alert_rss(keyword, example_cookies)

    if rss_url:
        print(f"RSS Feed URL: {rss_url}")
    else:
        print("Failed to create alert")
