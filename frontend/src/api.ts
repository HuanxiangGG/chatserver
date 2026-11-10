import { localizeApiError } from './i18n';
import { translate as tr } from './i18n';
let csrfToken = "";
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken)
    headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(tr('screen408'), 0);
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === "string"
        ? localizeApiError(data.error)
        : (response.status >= 500 ? tr('screen409') : tr('screen410', {v0: response.status})),
      response.status,
      data?.code,
    );
  return data as T;
}
export function json(method: string, data?: unknown): RequestInit {
  return {
    method,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  };
}

// XHR exposes real upload byte progress while preserving the same cookie/CSRF policy.
export function uploadFile<T>(file: File, onProgress: (percent: number) => void, conversationId?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads' + (conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''));
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total)); };
    xhr.onerror = () => reject(new ApiError(tr('screen411'), 0));
    xhr.ontimeout = () => reject(new ApiError(tr('screen412'), 0));
    xhr.onload = () => {
      let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new ApiError(tr('screen413'), xhr.status)); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError((data.error ? localizeApiError(data.error) : null) || tr('screen414'), xhr.status, data.code));
    };
    const form = new FormData(); form.append('file', file); xhr.send(form);
  });
}
