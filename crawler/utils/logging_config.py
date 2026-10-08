"""
Universal Crawler Logging System
Provides structured, contextual logging for investigation and debugging.

Features:
- Structured JSON logging for machine parsing
- Human-readable colored console output
- Request correlation IDs for tracing
- Performance tracking with timing
- HTTP request/response logging
- FastAPI middleware for automatic request logging
- Exception tracking with full tracebacks
"""

import logging
import json
import sys
import uuid
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
from pathlib import Path
import traceback
from functools import wraps
import time
from contextvars import ContextVar

# Context variable for request correlation ID
correlation_id_var: ContextVar[Optional[str]] = ContextVar('correlation_id', default=None)

# Try multiple log directories in order of preference
import os
LOG_DIR_CANDIDATES = [
    os.environ.get('LOG_DIR'),  # Environment variable override
    Path(__file__).parent.parent.parent / "logs",  # /app/logs
    Path("/app/logs"),  # Explicit /app/logs
    Path("/tmp/crawler_logs"),  # Fallback to /tmp
    Path.home() / "crawler_logs",  # User home directory
]

LOGS_DIR = None
FILE_LOGGING_AVAILABLE = False

def _test_log_directory(dir_path: Path) -> bool:
    """Test if a directory is writable."""
    try:
        dir_path.mkdir(parents=True, exist_ok=True)
        test_file = dir_path / ".write_test"
        test_file.touch()
        test_file.unlink()
        return True
    except (PermissionError, OSError):
        return False

for candidate in LOG_DIR_CANDIDATES:
    if candidate is None:
        continue
    candidate = Path(candidate)
    if _test_log_directory(candidate):
        LOGS_DIR = candidate
        FILE_LOGGING_AVAILABLE = True
        print(f"Logging to directory: {LOGS_DIR}")
        break

if not FILE_LOGGING_AVAILABLE:
    print("Warning: No writable log directory found. File logging disabled, using console only.")


def get_correlation_id() -> Optional[str]:
    """Get the current correlation ID from context."""
    return correlation_id_var.get()


def set_correlation_id(correlation_id: Optional[str] = None) -> str:
    """Set a correlation ID in context. Generates one if not provided."""
    cid = correlation_id or str(uuid.uuid4())[:8]
    correlation_id_var.set(cid)
    return cid


class StructuredFormatter(logging.Formatter):
    """
    Custom formatter that outputs JSON-structured logs for easy parsing.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add correlation ID if available
        cid = get_correlation_id()
        if cid:
            log_data["correlation_id"] = cid

        # Add extra context if available
        if hasattr(record, 'context'):
            log_data['context'] = record.context

        # Add exception info if present
        if record.exc_info and record.exc_info[0] is not None:
            log_data['exception'] = {
                'type': record.exc_info[0].__name__,
                'message': str(record.exc_info[1]),
                'traceback': traceback.format_exception(*record.exc_info)
            }

        # Add any custom fields from extra parameter
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'created', 'filename', 'funcName',
                          'levelname', 'levelno', 'lineno', 'module', 'msecs',
                          'message', 'pathname', 'process', 'processName',
                          'relativeCreated', 'thread', 'threadName', 'exc_info',
                          'exc_text', 'stack_info', 'context']:
                log_data[key] = value

        return json.dumps(log_data, default=str)


class HumanReadableFormatter(logging.Formatter):
    """
    Human-readable formatter for console output with colors.
    """

    # Color codes
    COLORS = {
        'DEBUG': '\033[36m',      # Cyan
        'INFO': '\033[32m',       # Green
        'WARNING': '\033[33m',    # Yellow
        'ERROR': '\033[31m',      # Red
        'CRITICAL': '\033[35m',   # Magenta
        'RESET': '\033[0m'        # Reset
    }

    def format(self, record: logging.LogRecord) -> str:
        """Format log record for human reading with colors."""
        color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']

        # Build basic log line
        timestamp = datetime.fromtimestamp(record.created).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

        # Add correlation ID if available
        cid = get_correlation_id()
        cid_str = f"[{cid}] " if cid else ""

        base_msg = f"{color}[{record.levelname}]{reset} {timestamp} {cid_str}- {record.name} - {record.getMessage()}"

        # Add context if available
        if hasattr(record, 'context'):
            context_str = json.dumps(record.context, indent=2, default=str)
            base_msg += f"\n  Context: {context_str}"

        # Add exception if present
        if record.exc_info:
            exc_text = ''.join(traceback.format_exception(*record.exc_info))
            base_msg += f"\n{exc_text}"

        return base_msg


class CrawlerLogger:
    """
    Enhanced logger with context support for crawler operations.
    """

    def __init__(self, name: str, context: Optional[Dict[str, Any]] = None):
        """
        Initialize logger with context.

        Args:
            name: Logger name (usually module name)
            context: Default context to include in all logs
        """
        self.logger = logging.getLogger(name)
        self.context = context or {}

    def _log_with_context(self, level: int, message: str,
                         context: Optional[Dict[str, Any]] = None,
                         exc_info: bool = False,
                         **kwargs):
        """Internal method to log with merged context."""
        # Merge default context with message-specific context
        full_context = {**self.context, **(context or {})}

        # Add context to the log record (but not exc_info as that's a special param)
        extra = {'context': full_context}
        for key, value in kwargs.items():
            if key not in ['exc_info', 'stack_info', 'stacklevel']:
                extra[key] = value

        self.logger.log(level, message, extra=extra, exc_info=exc_info)

    def debug(self, message: str, context: Optional[Dict[str, Any]] = None,
             exc_info: bool = False, **kwargs):
        """Log debug message."""
        self._log_with_context(logging.DEBUG, message, context, exc_info=exc_info, **kwargs)

    def info(self, message: str, context: Optional[Dict[str, Any]] = None,
            exc_info: bool = False, **kwargs):
        """Log info message."""
        self._log_with_context(logging.INFO, message, context, exc_info=exc_info, **kwargs)

    def warning(self, message: str, context: Optional[Dict[str, Any]] = None,
               exc_info: bool = False, **kwargs):
        """Log warning message."""
        self._log_with_context(logging.WARNING, message, context, exc_info=exc_info, **kwargs)

    def error(self, message: str, context: Optional[Dict[str, Any]] = None,
              exc_info: bool = True, **kwargs):
        """Log error message with exception info."""
        self._log_with_context(logging.ERROR, message, context, exc_info=exc_info, **kwargs)

    def critical(self, message: str, context: Optional[Dict[str, Any]] = None,
                 exc_info: bool = True, **kwargs):
        """Log critical message."""
        self._log_with_context(logging.CRITICAL, message, context, exc_info=exc_info, **kwargs)

    def success(self, message: str, context: Optional[Dict[str, Any]] = None, **kwargs):
        """Log success message (INFO level but marked as success)."""
        full_context = {**self.context, **(context or {}), 'success': True}
        extra = {'context': full_context, **kwargs}
        self.logger.info(message, extra=extra)

    def update_context(self, context: Dict[str, Any]):
        """Update the default context for this logger."""
        self.context.update(context)

    def with_context(self, **context) -> 'CrawlerLogger':
        """
        Create a new logger instance with additional context.

        Returns:
            New CrawlerLogger with merged context
        """
        new_context = {**self.context, **context}
        return CrawlerLogger(self.logger.name, new_context)


class PerformanceLogger:
    """
    Logger for tracking performance metrics.
    """

    def __init__(self, logger: CrawlerLogger, operation: str,
                 context: Optional[Dict[str, Any]] = None):
        """
        Initialize performance logger.

        Args:
            logger: CrawlerLogger instance
            operation: Name of the operation being tracked
            context: Additional context
        """
        self.logger = logger
        self.operation = operation
        self.context = context or {}
        self.start_time = None
        self.end_time = None

    def __enter__(self):
        """Start timing."""
        self.start_time = time.time()
        self.logger.debug(
            f"Starting operation: {self.operation}",
            context={**self.context, 'operation': self.operation, 'phase': 'start'}
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """End timing and log results."""
        self.end_time = time.time()
        duration = self.end_time - self.start_time

        log_context = {
            **self.context,
            'operation': self.operation,
            'phase': 'complete',
            'duration_seconds': round(duration, 3),
            'duration_ms': round(duration * 1000, 2)
        }

        if exc_type:
            log_context['error'] = str(exc_val)
            self.logger.error(
                f"Operation failed: {self.operation} ({duration:.3f}s)",
                context=log_context,
                exc_info=(exc_type, exc_val, exc_tb)
            )
        else:
            self.logger.info(
                f"Operation completed: {self.operation} ({duration:.3f}s)",
                context=log_context
            )


class RequestLogger:
    """
    Specialized logger for HTTP requests and responses.
    """

    def __init__(self, logger: CrawlerLogger):
        """Initialize request logger."""
        self.logger = logger

    def log_request(self, method: str, url: str, headers: Optional[Dict] = None,
                   context: Optional[Dict[str, Any]] = None):
        """
        Log HTTP request details.

        Args:
            method: HTTP method
            url: Request URL
            headers: Request headers
            context: Additional context
        """
        log_context = {
            **(context or {}),
            'request': {
                'method': method,
                'url': url,
                'headers': self._sanitize_headers(headers) if headers else None
            }
        }

        self.logger.debug(f"HTTP Request: {method} {url}", context=log_context)

    def log_response(self, url: str, status_code: int,
                    response_time: float, size: Optional[int] = None,
                    headers: Optional[Dict] = None,
                    context: Optional[Dict[str, Any]] = None):
        """
        Log HTTP response details.

        Args:
            url: Request URL
            status_code: HTTP status code
            response_time: Response time in seconds
            size: Response size in bytes
            headers: Response headers
            context: Additional context
        """
        log_context = {
            **(context or {}),
            'response': {
                'url': url,
                'status_code': status_code,
                'response_time_ms': round(response_time * 1000, 2),
                'size_bytes': size,
                'headers': self._sanitize_headers(headers) if headers else None
            }
        }

        level = 'info' if 200 <= status_code < 300 else 'warning'
        getattr(self.logger, level)(
            f"HTTP Response: {status_code} for {url} ({response_time:.3f}s)",
            context=log_context
        )

    def log_error(self, url: str, error: Exception,
                 context: Optional[Dict[str, Any]] = None):
        """
        Log HTTP request error.

        Args:
            url: Request URL
            error: Exception that occurred
            context: Additional context
        """
        log_context = {
            **(context or {}),
            'request_error': {
                'url': url,
                'error_type': type(error).__name__,
                'error_message': str(error)
            }
        }

        self.logger.error(f"HTTP Request failed: {url}", context=log_context)

    def _sanitize_headers(self, headers: Dict) -> Dict:
        """Remove sensitive information from headers."""
        sensitive_keys = ['authorization', 'cookie', 'set-cookie', 'api-key', 'token']
        return {
            k: '***REDACTED***' if k.lower() in sensitive_keys else v
            for k, v in headers.items()
        }


def setup_logging(level: str = "INFO", log_to_file: bool = True,
                 log_to_console: bool = True) -> None:
    """
    Setup logging configuration for the entire application.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_to_file: Whether to log to file
        log_to_console: Whether to log to console
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler with human-readable format
    if log_to_console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG)
        console_handler.setFormatter(HumanReadableFormatter())
        root_logger.addHandler(console_handler)

    # File handler with JSON format for structured logs
    # Only attempt if file logging is available and requested
    if log_to_file and FILE_LOGGING_AVAILABLE and LOGS_DIR is not None:
        try:
            # General log file
            general_log = LOGS_DIR / f"crawler_{datetime.now().strftime('%Y%m%d')}.jsonl"
            file_handler = logging.FileHandler(general_log, encoding='utf-8')
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(StructuredFormatter())
            root_logger.addHandler(file_handler)

            # Error log file (only errors and above)
            error_log = LOGS_DIR / f"crawler_errors_{datetime.now().strftime('%Y%m%d')}.jsonl"
            error_handler = logging.FileHandler(error_log, encoding='utf-8')
            error_handler.setLevel(logging.ERROR)
            error_handler.setFormatter(StructuredFormatter())
            root_logger.addHandler(error_handler)

            print(f"Log files: {general_log}, {error_log}")
        except (PermissionError, OSError) as e:
            print(f"Warning: Cannot create log files: {e}. Continuing with console logging only.")


def get_logger(name: str, **context) -> CrawlerLogger:
    """
    Get a logger instance with context.

    Args:
        name: Logger name (usually __name__)
        **context: Default context to include in all logs

    Returns:
        CrawlerLogger instance
    """
    return CrawlerLogger(name, context)


def log_function_call(logger: Optional[CrawlerLogger] = None):
    """
    Decorator to automatically log function calls with arguments and timing.

    Args:
        logger: CrawlerLogger to use (if None, creates one with function name)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            func_logger = logger or get_logger(func.__module__)

            # Log function entry
            context = {
                'function': func.__name__,
                'args_count': len(args),
                'kwargs': list(kwargs.keys())
            }

            func_logger.debug(f"Calling function: {func.__name__}", context=context)

            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start_time

                # Log success
                func_logger.debug(
                    f"Function completed: {func.__name__}",
                    context={**context, 'duration_seconds': round(duration, 3)}
                )

                return result

            except Exception as e:
                duration = time.time() - start_time

                # Log error
                func_logger.error(
                    f"Function failed: {func.__name__}",
                    context={
                        **context,
                        'duration_seconds': round(duration, 3),
                        'error': str(e)
                    }
                )
                raise

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            func_logger = logger or get_logger(func.__module__)

            # Log function entry
            context = {
                'function': func.__name__,
                'args_count': len(args),
                'kwargs': list(kwargs.keys()),
                'async': True
            }

            func_logger.debug(f"Calling async function: {func.__name__}", context=context)

            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                duration = time.time() - start_time

                # Log success
                func_logger.debug(
                    f"Async function completed: {func.__name__}",
                    context={**context, 'duration_seconds': round(duration, 3)}
                )

                return result

            except Exception as e:
                duration = time.time() - start_time

                # Log error
                func_logger.error(
                    f"Async function failed: {func.__name__}",
                    context={
                        **context,
                        'duration_seconds': round(duration, 3),
                        'error': str(e)
                    }
                )
                raise

        # Return appropriate wrapper based on function type
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator


class LoggingMiddleware:
    """
    FastAPI/Starlette middleware for automatic request logging.

    Logs:
    - Request start with method, path, client IP
    - Request completion with status code and duration
    - Request errors with exception details
    """

    def __init__(self, app, logger: Optional[CrawlerLogger] = None):
        """Initialize middleware with FastAPI app."""
        self.app = app
        self.logger = logger or get_logger("api.requests")

    async def __call__(self, scope, receive, send):
        """Process request and log details."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Generate correlation ID for this request
        correlation_id = set_correlation_id()

        # Extract request details
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "/")
        query_string = scope.get("query_string", b"").decode("utf-8")
        full_path = f"{path}?{query_string}" if query_string else path

        # Get client IP
        client = scope.get("client")
        client_ip = client[0] if client else "unknown"

        # Log request start
        start_time = time.time()
        self.logger.info(
            f"Request started: {method} {full_path}",
            context={
                "event": "request_start",
                "method": method,
                "path": path,
                "query_string": query_string,
                "client_ip": client_ip,
                "correlation_id": correlation_id
            }
        )

        # Track response status
        status_code = 500  # Default to error

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as e:
            duration = time.time() - start_time
            self.logger.error(
                f"Request failed: {method} {full_path}",
                context={
                    "event": "request_error",
                    "method": method,
                    "path": path,
                    "client_ip": client_ip,
                    "duration_ms": round(duration * 1000, 2),
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "correlation_id": correlation_id
                },
                exc_info=True
            )
            raise
        finally:
            # Log request completion
            duration = time.time() - start_time
            log_level = "info" if status_code < 400 else "warning" if status_code < 500 else "error"

            getattr(self.logger, log_level)(
                f"Request completed: {method} {full_path} -> {status_code}",
                context={
                    "event": "request_complete",
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "client_ip": client_ip,
                    "duration_ms": round(duration * 1000, 2),
                    "correlation_id": correlation_id
                }
            )


class OperationLogger:
    """
    Context manager for logging multi-step operations.

    Tracks operation phases and sub-operations with timing.
    Useful for debugging complex pipeline operations.
    """

    def __init__(self, logger: CrawlerLogger, operation: str, **context):
        """
        Initialize operation logger.

        Args:
            logger: CrawlerLogger instance
            operation: Name of the operation
            **context: Additional context for all logs
        """
        self.logger = logger
        self.operation = operation
        self.context = context
        self.start_time = None
        self.steps: List[Dict[str, Any]] = []
        self.current_step = None

    def __enter__(self):
        """Start the operation."""
        self.start_time = time.time()
        self.logger.info(
            f"Operation started: {self.operation}",
            context={
                **self.context,
                "event": "operation_start",
                "operation": self.operation
            }
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Complete the operation."""
        duration = time.time() - self.start_time

        if exc_type:
            self.logger.error(
                f"Operation failed: {self.operation}",
                context={
                    **self.context,
                    "event": "operation_failed",
                    "operation": self.operation,
                    "duration_ms": round(duration * 1000, 2),
                    "steps_completed": len([s for s in self.steps if s.get("success")]),
                    "steps_total": len(self.steps),
                    "error": str(exc_val),
                    "error_type": exc_type.__name__
                },
                exc_info=(exc_type, exc_val, exc_tb)
            )
        else:
            self.logger.info(
                f"Operation completed: {self.operation}",
                context={
                    **self.context,
                    "event": "operation_complete",
                    "operation": self.operation,
                    "duration_ms": round(duration * 1000, 2),
                    "steps_completed": len(self.steps)
                }
            )

    def step(self, name: str, **step_context) -> 'StepLogger':
        """
        Start a new step within the operation.

        Args:
            name: Step name
            **step_context: Additional context for this step
        """
        return StepLogger(self, name, step_context)

    def log_step_result(self, name: str, success: bool, duration: float, **details):
        """Record a step result."""
        self.steps.append({
            "name": name,
            "success": success,
            "duration_ms": round(duration * 1000, 2),
            **details
        })


class StepLogger:
    """Context manager for individual steps within an operation."""

    def __init__(self, operation: OperationLogger, name: str, context: Dict[str, Any]):
        self.operation = operation
        self.name = name
        self.context = context
        self.start_time = None

    def __enter__(self):
        self.start_time = time.time()
        self.operation.logger.debug(
            f"Step started: {self.name}",
            context={
                **self.operation.context,
                **self.context,
                "event": "step_start",
                "operation": self.operation.operation,
                "step": self.name
            }
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = time.time() - self.start_time
        success = exc_type is None

        if success:
            self.operation.logger.debug(
                f"Step completed: {self.name}",
                context={
                    **self.operation.context,
                    **self.context,
                    "event": "step_complete",
                    "operation": self.operation.operation,
                    "step": self.name,
                    "duration_ms": round(duration * 1000, 2)
                }
            )
        else:
            self.operation.logger.warning(
                f"Step failed: {self.name}",
                context={
                    **self.operation.context,
                    **self.context,
                    "event": "step_failed",
                    "operation": self.operation.operation,
                    "step": self.name,
                    "duration_ms": round(duration * 1000, 2),
                    "error": str(exc_val)
                }
            )

        self.operation.log_step_result(self.name, success, duration)


class ExtractionLogger:
    """
    Specialized logger for content extraction operations.

    Tracks extraction attempts, fallbacks, and success rates.
    """

    def __init__(self, logger: CrawlerLogger):
        self.logger = logger
        self.stats = {
            "total_attempts": 0,
            "successful": 0,
            "failed": 0,
            "fallbacks_used": 0
        }

    def log_extraction_attempt(self, url: str, method: str, **context):
        """Log start of an extraction attempt."""
        self.stats["total_attempts"] += 1
        self.logger.debug(
            f"Extraction attempt: {method}",
            context={
                "event": "extraction_attempt",
                "url": url,
                "method": method,
                "attempt_number": self.stats["total_attempts"],
                **context
            }
        )

    def log_extraction_success(self, url: str, method: str, content_length: int, **context):
        """Log successful extraction."""
        self.stats["successful"] += 1
        self.logger.info(
            f"Extraction successful: {method} ({content_length} chars)",
            context={
                "event": "extraction_success",
                "url": url,
                "method": method,
                "content_length": content_length,
                **context
            }
        )

    def log_extraction_failure(self, url: str, method: str, error: str, **context):
        """Log failed extraction."""
        self.stats["failed"] += 1
        self.logger.warning(
            f"Extraction failed: {method} - {error}",
            context={
                "event": "extraction_failure",
                "url": url,
                "method": method,
                "error": error,
                **context
            }
        )

    def log_fallback(self, url: str, from_method: str, to_method: str, **context):
        """Log fallback to another extraction method."""
        self.stats["fallbacks_used"] += 1
        self.logger.info(
            f"Extraction fallback: {from_method} -> {to_method}",
            context={
                "event": "extraction_fallback",
                "url": url,
                "from_method": from_method,
                "to_method": to_method,
                **context
            }
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get extraction statistics."""
        total = self.stats["total_attempts"]
        return {
            **self.stats,
            "success_rate": round(self.stats["successful"] / total * 100, 2) if total > 0 else 0
        }


class CrawlerRunLogger:
    """
    Specialized logger for crawler runs.

    Tracks URLs processed, records saved, and errors.
    """

    def __init__(self, logger: CrawlerLogger, crawler_id: str, run_id: str, crawler_name: str = ""):
        self.logger = logger.with_context(
            crawler_id=crawler_id,
            run_id=run_id,
            crawler_name=crawler_name
        )
        self.crawler_id = crawler_id
        self.run_id = run_id
        self.crawler_name = crawler_name
        self.stats = {
            "urls_discovered": 0,
            "urls_processed": 0,
            "urls_skipped": 0,
            "records_saved": 0,
            "errors": 0
        }

    def log_run_start(self, config: Dict[str, Any]):
        """Log crawler run start."""
        self.logger.info(
            f"Crawler run started: {self.crawler_name}",
            context={
                "event": "run_start",
                "config": {k: v for k, v in config.items() if k not in ['fields']}
            }
        )

    def log_run_complete(self, duration_seconds: float):
        """Log crawler run completion."""
        self.logger.info(
            f"Crawler run completed: {self.crawler_name}",
            context={
                "event": "run_complete",
                "duration_seconds": round(duration_seconds, 2),
                "stats": self.stats
            }
        )

    def log_run_error(self, error: str, exc_info=None):
        """Log crawler run error."""
        self.stats["errors"] += 1
        self.logger.error(
            f"Crawler run error: {self.crawler_name}",
            context={
                "event": "run_error",
                "error": error,
                "stats": self.stats
            },
            exc_info=exc_info is not None
        )

    def log_url_discovered(self, url: str):
        """Log URL discovery."""
        self.stats["urls_discovered"] += 1
        self.logger.debug(
            f"URL discovered: {url[:80]}...",
            context={"event": "url_discovered", "url": url}
        )

    def log_url_processed(self, url: str, success: bool, **details):
        """Log URL processing result."""
        self.stats["urls_processed"] += 1
        if success:
            self.logger.debug(
                f"URL processed: {url[:80]}...",
                context={"event": "url_processed", "url": url, "success": True, **details}
            )
        else:
            self.stats["errors"] += 1
            self.logger.warning(
                f"URL processing failed: {url[:80]}...",
                context={"event": "url_processed", "url": url, "success": False, **details}
            )

    def log_url_skipped(self, url: str, reason: str):
        """Log skipped URL."""
        self.stats["urls_skipped"] += 1
        self.logger.debug(
            f"URL skipped: {reason}",
            context={"event": "url_skipped", "url": url, "reason": reason}
        )

    def log_record_saved(self, url: str, record_id: str):
        """Log record save."""
        self.stats["records_saved"] += 1
        self.logger.info(
            f"Record saved: {record_id}",
            context={"event": "record_saved", "url": url, "record_id": record_id}
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get run statistics."""
        return self.stats.copy()


def get_log_file_paths() -> Dict[str, Optional[Path]]:
    """Return paths to current log files for debugging."""
    if not FILE_LOGGING_AVAILABLE or LOGS_DIR is None:
        return {"general": None, "errors": None, "logs_dir": None}

    date_str = datetime.now().strftime('%Y%m%d')
    return {
        "logs_dir": LOGS_DIR,
        "general": LOGS_DIR / f"crawler_{date_str}.jsonl",
        "errors": LOGS_DIR / f"crawler_errors_{date_str}.jsonl"
    }


# Initialize logging on module import
setup_logging()
