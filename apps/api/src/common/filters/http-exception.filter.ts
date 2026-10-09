import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

/** Body of every error response. */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

/** Fallback codes when an exception doesn't carry its own `code`. */
const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    reply.status(body.statusCode).send(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
    }
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const fallback = STATUS_CODES[statusCode] ?? HttpStatus[statusCode] ?? 'ERROR';
    if (typeof response === 'string') {
      return { statusCode, code: fallback, message: response };
    }
    const r = response as { code?: string; message?: string | string[] };
    // ValidationPipe reports an array of messages
    if (Array.isArray(r.message)) {
      return { statusCode, code: r.code ?? 'VALIDATION_FAILED', message: r.message.join('; ') };
    }
    return { statusCode, code: r.code ?? fallback, message: r.message ?? exception.message };
  }
}
