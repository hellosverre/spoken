import { IS_MOCK } from "./config.ts";
import { httpApi } from "./http.ts";
import { mockApi } from "./mock.ts";
import type { Api } from "./types.ts";

export const api: Api = IS_MOCK ? mockApi : httpApi;
export { IS_MOCK };
export { ApiError } from "./types.ts";
export type { LiveState } from "./types.ts";
