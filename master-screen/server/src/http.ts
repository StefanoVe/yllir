// Helper for async route handlers: Express 4 does not forward rejected promises,
// so failures go to the error middleware. Owner: server skeleton.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
