export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Nie znaleziono.') => new HttpError(404, 'not_found', what);
export const forbidden = () => new HttpError(403, 'forbidden', 'Brak uprawnień do tej części studia.');
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
