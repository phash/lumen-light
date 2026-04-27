import { useMemo } from "react";
import { useAuth } from "react-oidc-context";

import { RUNTIME_CONFIG } from "../runtime-config";
import { createApiClient, type ApiClient } from "./client";

export function useApi(): ApiClient {
  const auth = useAuth();
  return useMemo(
    () =>
      createApiClient({
        baseUrl: RUNTIME_CONFIG.API_BASE,
        getUser: () => auth.user,
      }),
    [auth.user],
  );
}
