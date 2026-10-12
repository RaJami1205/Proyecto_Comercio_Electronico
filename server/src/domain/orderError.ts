import type { ApiErrorCode } from '../types/apiError.js'

export class OrderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) { super(message); this.name = 'OrderError' }
}
