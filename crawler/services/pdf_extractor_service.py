"""
PDF Extractor Service
Downloads and extracts text from PDF files
"""

import os
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse
import requests
from pypdf import PdfReader
from utils.logging_config import get_logger, PerformanceLogger

# Configure logging using CrawlerLogger
logger = get_logger("services.pdf_extractor")


class PDFExtractorService:
    """Service for downloading and extracting text from PDF files."""

    def __init__(self):
        """Initialize PDF extractor service."""
        self.pdf_storage_dir = Path("backend/storage/pdfs")
        self.pdf_storage_dir.mkdir(parents=True, exist_ok=True)
        self.timeout = 30  # seconds
        self.max_size_mb = 50  # Maximum PDF size to download
        self.max_retries = 3  # Maximum retry attempts
        self.retry_delay = 2  # Initial retry delay in seconds

        # Create session for connection reuse and cookie handling
        self.session = requests.Session()

        # Browser-like headers to avoid 403 Forbidden
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,application/octet-stream,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
        }

    def download_pdf(self, url: str, save_locally: bool = True, referer: Optional[str] = None) -> Optional[str]:
        """
        Download a PDF from URL with retry logic and browser-like headers.

        Args:
            url: PDF URL
            save_locally: Whether to save PDF to disk (default: True)
            referer: Optional referer URL to include in headers

        Returns:
            Path to downloaded PDF file, or None if failed
        """
        print(f"[PDF Extractor] Downloading PDF from: {url}")

        # Add referer to headers if provided
        headers = self.headers.copy()
        if referer:
            headers['Referer'] = referer
            print(f"[PDF Extractor] Using Referer: {referer}")

        # Retry loop with exponential backoff
        for attempt in range(1, self.max_retries + 1):
            try:
                if attempt > 1:
                    delay = self.retry_delay * (2 ** (attempt - 2))
                    print(f"[PDF Extractor] Retry {attempt}/{self.max_retries} after {delay}s delay...")
                    time.sleep(delay)

                # Try to get size check first (optional, skip if it fails)
                try:
                    head_response = self.session.head(
                        url,
                        timeout=self.timeout,
                        allow_redirects=True,
                        headers=headers
                    )
                    content_length = head_response.headers.get('content-length')

                    if content_length:
                        size_mb = int(content_length) / (1024 * 1024)
                        if size_mb > self.max_size_mb:
                            print(f"[PDF Extractor] ✗ PDF too large ({size_mb:.1f}MB), skipping. Max: {self.max_size_mb}MB")
                            return None
                        print(f"[PDF Extractor] PDF size: {size_mb:.1f}MB")
                except Exception as e:
                    # HEAD request failed, continue with GET anyway
                    print(f"[PDF Extractor] HEAD request failed (will try GET): {e}")

                # Download PDF with full browser-like headers
                print(f"[PDF Extractor] Attempting download (attempt {attempt}/{self.max_retries})...")
                response = self.session.get(
                    url,
                    timeout=self.timeout,
                    headers=headers,
                    stream=True,
                    allow_redirects=True
                )

                # Check for specific error codes
                if response.status_code == 403:
                    print(f"[PDF Extractor] ✗ 403 Forbidden (attempt {attempt}/{self.max_retries})")
                    if attempt < self.max_retries:
                        continue  # Retry
                    else:
                        print(f"[PDF Extractor] ✗ Failed after {self.max_retries} attempts: 403 Forbidden")
                        print(f"[PDF Extractor] This site may require cookies or a logged-in session")
                        return None

                response.raise_for_status()

                # Verify content type
                content_type = response.headers.get('content-type', '').lower()
                print(f"[PDF Extractor] Content-Type: {content_type}")

                if 'pdf' not in content_type and not url.lower().endswith('.pdf'):
                    # Check if it's HTML (might be a login page or error page)
                    if 'html' in content_type:
                        print(f"[PDF Extractor] ✗ Got HTML instead of PDF (possibly login/error page)")
                        return None
                    print(f"[PDF Extractor] ⚠ Warning: URL may not be a PDF, but will try to process")

                # Download successful, save the file
                if save_locally:
                    # Generate filename from URL
                    parsed_url = urlparse(url)
                    filename = Path(parsed_url.path).name
                    if not filename or not filename.endswith('.pdf'):
                        filename = f"pdf_{hash(url)}.pdf"

                    # Save to storage directory
                    pdf_path = self.pdf_storage_dir / filename

                    # Avoid overwriting - add counter if file exists
                    counter = 1
                    original_path = pdf_path
                    while pdf_path.exists():
                        pdf_path = original_path.parent / f"{original_path.stem}_{counter}{original_path.suffix}"
                        counter += 1

                    bytes_downloaded = 0
                    with open(pdf_path, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            f.write(chunk)
                            bytes_downloaded += len(chunk)

                    print(f"[PDF Extractor] ✓ PDF downloaded: {pdf_path} ({bytes_downloaded / 1024:.1f}KB)")
                    return str(pdf_path)
                else:
                    # Save to temporary file
                    bytes_downloaded = 0
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
                        for chunk in response.iter_content(chunk_size=8192):
                            tmp_file.write(chunk)
                            bytes_downloaded += len(chunk)
                        print(f"[PDF Extractor] ✓ PDF downloaded to temp: {tmp_file.name} ({bytes_downloaded / 1024:.1f}KB)")
                        return tmp_file.name

            except requests.Timeout:
                print(f"[PDF Extractor] ✗ Timeout (attempt {attempt}/{self.max_retries})")
                if attempt >= self.max_retries:
                    print(f"[PDF Extractor] ✗ Failed after {self.max_retries} timeout attempts")
                    return None
                continue

            except requests.RequestException as e:
                print(f"[PDF Extractor] ✗ Request error (attempt {attempt}/{self.max_retries}): {e}")
                if attempt >= self.max_retries:
                    print(f"[PDF Extractor] ✗ Failed after {self.max_retries} attempts: {e}")
                    return None
                continue

            except Exception as e:
                print(f"[PDF Extractor] ✗ Unexpected error: {e}")
                return None

        # Should not reach here, but just in case
        print(f"[PDF Extractor] ✗ Download failed after all retry attempts")
        return None

    def extract_text_from_pdf(self, pdf_path: str) -> Dict[str, any]:
        """
        Extract text from a PDF file.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Dictionary with extraction results:
            - success: bool
            - text: str (full text)
            - pages: List[str] (text per page)
            - page_count: int
            - metadata: Dict (PDF metadata)
            - error: str (if failed)
        """
        try:
            print(f"[PDF Extractor] Extracting text from PDF: {pdf_path}")

            if not os.path.exists(pdf_path):
                print(f"[PDF Extractor] ✗ PDF file not found: {pdf_path}")
                return {
                    'success': False,
                    'error': f'PDF file not found: {pdf_path}'
                }

            # Read PDF
            reader = PdfReader(pdf_path)
            page_count = len(reader.pages)
            print(f"[PDF Extractor] PDF has {page_count} pages")

            # Extract text from each page
            pages_text = []
            for page_num, page in enumerate(reader.pages, 1):
                try:
                    text = page.extract_text()
                    pages_text.append(text)
                    if page_num <= 3 or page_num == page_count:  # Show first 3 and last page
                        print(f"[PDF Extractor] Page {page_num}: {len(text)} characters")
                except Exception as e:
                    print(f"[PDF Extractor] ⚠ Error extracting text from page {page_num}: {e}")
                    pages_text.append("")

            # Combine all text
            full_text = "\n\n".join(pages_text)

            # Extract metadata
            metadata = {}
            if reader.metadata:
                try:
                    metadata = {
                        'title': reader.metadata.get('/Title', ''),
                        'author': reader.metadata.get('/Author', ''),
                        'subject': reader.metadata.get('/Subject', ''),
                        'creator': reader.metadata.get('/Creator', ''),
                        'producer': reader.metadata.get('/Producer', ''),
                        'creation_date': reader.metadata.get('/CreationDate', ''),
                    }
                    if metadata.get('title'):
                        print(f"[PDF Extractor] PDF Title: {metadata['title']}")
                except Exception as e:
                    print(f"[PDF Extractor] ⚠ Error extracting metadata: {e}")

            print(f"[PDF Extractor] ✓ Extracted {len(full_text)} characters from {page_count} pages")

            return {
                'success': True,
                'text': full_text,
                'pages': pages_text,
                'page_count': page_count,
                'metadata': metadata,
                'character_count': len(full_text)
            }

        except Exception as e:
            print(f"[PDF Extractor] ✗ Error extracting text from PDF: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def download_and_extract(self, url: str, save_locally: bool = True, referer: Optional[str] = None) -> Dict[str, any]:
        """
        Download a PDF and extract its text in one operation.

        Args:
            url: PDF URL
            save_locally: Whether to save PDF to disk
            referer: Optional referer URL to include in headers

        Returns:
            Dictionary with:
            - success: bool
            - url: str (original URL)
            - pdf_path: str (path to downloaded PDF)
            - text: str (extracted text)
            - pages: List[str] (text per page)
            - page_count: int
            - metadata: Dict
            - error: str (if failed)
        """
        print(f"[PDF Extractor] Starting download and extract for: {url[:100]}...")

        result = {
            'success': False,
            'url': url
        }

        # Download PDF
        pdf_path = self.download_pdf(url, save_locally=save_locally, referer=referer)
        if not pdf_path:
            result['error'] = 'Failed to download PDF'
            print(f"[PDF Extractor] ✗ Failed to download PDF from {url[:80]}...")
            return result

        result['pdf_path'] = pdf_path

        # Extract text
        extraction_result = self.extract_text_from_pdf(pdf_path)
        result.update(extraction_result)

        # Cleanup temp file if not saving locally
        if not save_locally and pdf_path and os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
                print(f"[PDF Extractor] Cleaned up temp PDF: {pdf_path}")
            except Exception as e:
                print(f"[PDF Extractor] ⚠ Could not clean up temp file: {e}")

        if result.get('success'):
            print(f"[PDF Extractor] ✓ Successfully extracted {result.get('character_count', 0)} characters from PDF")
        else:
            print(f"[PDF Extractor] ✗ Failed to extract text: {result.get('error', 'Unknown error')}")

        return result

    def extract_from_multiple_pdfs(
        self,
        urls: List[str],
        save_locally: bool = True
    ) -> List[Dict[str, any]]:
        """
        Download and extract text from multiple PDFs.

        Args:
            urls: List of PDF URLs
            save_locally: Whether to save PDFs to disk

        Returns:
            List of extraction results
        """
        print(f"[PDF Extractor] Processing {len(urls)} PDFs...")
        results = []

        for idx, url in enumerate(urls, 1):
            print(f"[PDF Extractor] ═══ Processing PDF {idx}/{len(urls)} ═══")
            result = self.download_and_extract(url, save_locally=save_locally)
            results.append(result)

        # Summary
        successful = sum(1 for r in results if r.get('success'))
        failed = len(urls) - successful
        print(f"[PDF Extractor] ═══════════════════════════════════════")
        print(f"[PDF Extractor] ✓ Processed {len(urls)} PDFs")
        print(f"[PDF Extractor] ✓ Successful: {successful}")
        print(f"[PDF Extractor] ✗ Failed: {failed}")
        print(f"[PDF Extractor] ═══════════════════════════════════════")

        return results


# Utility function for backward compatibility
def download_and_extract_pdf(url: str, save_locally: bool = True) -> Dict[str, any]:
    """
    Convenience function to download and extract a PDF.

    Args:
        url: PDF URL
        save_locally: Whether to save PDF to disk

    Returns:
        Extraction result dictionary
    """
    service = PDFExtractorService()
    return service.download_and_extract(url, save_locally=save_locally)
