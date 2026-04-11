"use client";

import { useEffect, useRef } from "react";
import { deleteCookie } from "cookies-next";
import { API } from "@/lib/config";

function getHeaderValue(headers: HeadersInit | undefined, key: string): string | null {
  if (!headers) return null;

  if (headers instanceof Headers) {
    return headers.get(key);
  }

  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === key.toLowerCase());
    return found?.[1] ?? null;
  }

  const record = headers as Record<string, string>;
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === key.toLowerCase()) return v;
  }
  return null;
}

function isApiUrl(url: string): boolean {
  if (!url) return false;
  return url.startsWith(API);
}

export default function SessionExpiryGuard() {
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const reqUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      const requestHeaders = input instanceof Request ? input.headers : undefined;
      const authHeader = getHeaderValue(init?.headers, "x-session-token")
        ?? getHeaderValue(requestHeaders, "x-session-token");

      const res = await nativeFetch(input, init);

      const shouldRedirect = (
        !redirectedRef.current
        && !!authHeader
        && isApiUrl(reqUrl)
        && res.status === 401
      );

      if (shouldRedirect) {
        redirectedRef.current = true;
        deleteCookie("wfl-session");
        deleteCookie("wfl-user");

        const from = `${window.location.pathname}${window.location.search}`;
        const target = `/login?expired=1&from=${encodeURIComponent(from)}`;
        window.location.replace(target);
      }

      return res;
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
