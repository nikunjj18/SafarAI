import type { RequestHandler, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const route =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  let status = err instanceof HttpError ? err.status : err instanceof ZodError ? 400 : 500;
  if (err.type === 'entity.parse.failed') status = 400;
  if (err.type === 'entity.too.large') status = 413;
  const message =
    err instanceof HttpError
      ? err.message
      : err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ')
        : status === 400
          ? 'Invalid JSON body.'
          : status === 413
            ? 'Request body is too large.'
            : 'The server could not complete this request.';
  if (status === 500)
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: res.locals.requestId,
        error: err.name,
        code: err.code || null,
      }),
    );
  res
    .status(status)
    .json({ error: message, code: err.code || 'REQUEST_FAILED', requestId: res.locals.requestId });
};
