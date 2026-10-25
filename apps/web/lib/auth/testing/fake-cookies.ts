// A cookie jar shaped like `await cookies()` from next/headers, for tests.
//
//   const jar = vi.hoisted(() => ({ current: undefined as FakeCookieJar | undefined }));
//   vi.mock("next/headers", async () => {
//     const { createCookieJar } = await import("@/lib/auth/testing/fake-cookies");
//     jar.current = createCookieJar();
//     return { cookies: async () => jar.current };
//   });

export interface CookieSetOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: unknown;
  path?: string;
  maxAge?: number;
  expires?: unknown;
}

export function createCookieJar() {
  const values = new Map<string, string>();
  const lastOptions = new Map<string, CookieSetOptions>();
  return {
    values,
    lastOptions,
    get(name: string) {
      const value = values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll() {
      return [...values].map(([name, value]) => ({ name, value }));
    },
    has(name: string) {
      return values.has(name);
    },
    set(name: string, value: string, options: CookieSetOptions = {}) {
      lastOptions.set(name, options);
      if (value === "" || options.maxAge === 0) values.delete(name);
      else values.set(name, value);
      return this;
    },
    delete(name: string) {
      values.delete(name);
      return this;
    },
    clear() {
      values.clear();
      lastOptions.clear();
    },
  };
}

export type FakeCookieJar = ReturnType<typeof createCookieJar>;
