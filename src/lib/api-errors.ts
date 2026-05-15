import { NextResponse } from 'next/server';

// Error code constants
export const ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// Core error response function
export function apiError(message: string, code: string, statusCode: number): NextResponse {
  return NextResponse.json({ error: message, code }, { status: statusCode });
}

// Convenience functions
export function badRequest(message = 'Bad request'): NextResponse {
  return apiError(message, ERROR_CODES.INVALID_REQUEST, 400);
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return apiError(message, ERROR_CODES.UNAUTHORIZED, 401);
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return apiError(message, ERROR_CODES.FORBIDDEN, 403);
}

export function notFound(message = 'Resource not found'): NextResponse {
  return apiError(message, ERROR_CODES.NOT_FOUND, 404);
}

export function rateLimited(message = 'Rate limit exceeded'): NextResponse {
  return apiError(message, ERROR_CODES.RATE_LIMITED, 429);
}

export function internalError(message = 'Internal server error'): NextResponse {
  return apiError(message, ERROR_CODES.INTERNAL_ERROR, 500);
}
