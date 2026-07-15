import { cache } from "react";

import { serverFetch } from "./client";
import { publicConfigSchema, type PublicConfig } from "./schemas";

export const getPublicConfig = cache((): Promise<PublicConfig> =>
  serverFetch("/config", { schema: publicConfigSchema, skipAuth: true }),
);
