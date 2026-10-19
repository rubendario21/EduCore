/**
 * Cliente HTTP único de EduCore. Todas las llamadas a la API pasan por aquí:
 * base URL, credenciales, formato de errores, token de acceso y renovación de
 * la sesión.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

/** Encabezado anti-CSRF que exige la API en /auth/refresh y /auth/logout. */
export const CSRF_HEADERS = { 'X-EduCore-CSRF': '1' } as const;

/** Forma de los errores que devuelve la API (`{ error: { ... } }`). */
interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const INVALID_RESPONSE = 'INVALID_RESPONSE';

export interface FieldErrorDetail {
  field: string;
  messages: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores de validación por campo (`VALIDATION_ERROR`), si los hay. */
  get fieldErrors(): FieldErrorDetail[] {
    return this.code === 'VALIDATION_ERROR' && Array.isArray(this.details)
      ? (this.details as FieldErrorDetail[])
      : [];
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as ApiErrorBody).error;
  return typeof error?.code === 'string' && typeof error?.message === 'string';
}

// --- Sesión -------------------------------------------------------------------
// El token de acceso vive solo en memoria (nunca en localStorage): un script
// inyectado no puede robarlo de almacenamiento persistente. Al recargar la
// página, la sesión se recupera con la cookie httpOnly de renovación.

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Registra la función que renueva la sesión (la define el proveedor de autenticación). */
export function setRefreshHandler(handler: (() => Promise<string | null>) | null): void {
  refreshHandler = handler;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** No adjuntar token ni intentar renovar la sesión (login, refresh, recuperación). */
  anonymous?: boolean;
}

async function send(method: HttpMethod, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  // FormData (archivos): el navegador fija el Content-Type multipart con su delimitador.
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken && !options.anonymous) headers.Authorization = `Bearer ${accessToken}`;

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      NETWORK_ERROR,
      'No fue posible conectar con el servidor. Revisa tu conexión.',
    );
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      const { code, message, details, requestId } = payload.error;
      throw new ApiError(response.status, code, message, details, requestId);
    }
    throw new ApiError(
      response.status,
      INVALID_RESPONSE,
      'El servidor respondió de forma inesperada. Intenta de nuevo más tarde.',
    );
  }
  if (payload === undefined) {
    throw new ApiError(
      response.status,
      INVALID_RESPONSE,
      'El servidor devolvió una respuesta vacía.',
    );
  }
  return payload as T;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await parse<T>(await send(method, path, options));
  } catch (error) {
    // Token de acceso vencido: se renueva la sesión una vez y se reintenta.
    const expired = error instanceof ApiError && error.code === 'ACCESS_TOKEN_EXPIRED';
    if (!expired || options.anonymous || !refreshHandler) throw error;
    const renewed = await refreshHandler();
    if (!renewed) throw error;
    return parse<T>(await send(method, path, options));
  }
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

/** Mensaje apto para mostrar al usuario a partir de cualquier error. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Ocurrió un error inesperado.';
}

/** Convierte un objeto en query string, omitiendo valores vacíos. */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
