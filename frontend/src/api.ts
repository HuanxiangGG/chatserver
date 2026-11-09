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
    throw new ApiError("连接失败，请检查网络后重试。", 0);
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === "string"
        ? data.error
        : (response.status >= 500 ? "服务器暂时不可用，请稍后重试或联系管理员" : `请求失败（${response.status}）`),
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
export function uploadFile<T>(file: File, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total)); };
    xhr.onerror = () => reject(new ApiError('上传网络中断，请检查连接后重试', 0));
    xhr.ontimeout = () => reject(new ApiError('上传超时，请重试', 0));
    xhr.onload = () => {
      let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new ApiError('上传服务返回异常，请稍后重试', xhr.status)); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || '上传失败，请稍后重试', xhr.status, data.code));
    };
    const form = new FormData(); form.append('file', file); xhr.send(form);
  });
}
