import { useMemo } from "react";
import { useAuth } from "react-oidc-context";

import { createApiClient, type ApiClient } from "./client";

export function useApi(): ApiClient {
  const auth = useAuth();
  return useMemo(
    () =>
      createApiClient({
        baseUrl: import.meta.env.VITE_API_BASE,
        getUser: () => auth.user,
      }),
    [auth.user],
  );
}
