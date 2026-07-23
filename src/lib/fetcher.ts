export class ApiRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiRequestError(body?.error ?? `リクエストに失敗しました (${res.status})`, res.status)
  }
  return body as T
}

export async function apiMutate<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  data?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiRequestError(body?.error ?? `リクエストに失敗しました (${res.status})`, res.status)
  }
  return body as T
}
