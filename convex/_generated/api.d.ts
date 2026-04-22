/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as authHelpers from "../authHelpers.js";
import type * as devices from "../devices.js";
import type * as encryptedKeys from "../encryptedKeys.js";
import type * as http from "../http.js";
import type * as httpRateLimits from "../httpRateLimits.js";
import type * as keys from "../keys.js";
import type * as keysMutations from "../keysMutations.js";
import type * as keysPublic from "../keysPublic.js";
import type * as linkCodes from "../linkCodes.js";
import type * as preferences from "../preferences.js";
import type * as remoteSync from "../remoteSync.js";
import type * as sessionConfig from "../sessionConfig.js";
import type * as sessionPublicJwks from "../sessionPublicJwks.js";
import type * as sessionStatus from "../sessionStatus.js";
import type * as sessionTokens from "../sessionTokens.js";
import type * as snapshotValidator from "../snapshotValidator.js";
import type * as snapshots from "../snapshots.js";
import type * as webAiArtifacts from "../webAiArtifacts.js";
import type * as webAiThreads from "../webAiThreads.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  authHelpers: typeof authHelpers;
  devices: typeof devices;
  encryptedKeys: typeof encryptedKeys;
  http: typeof http;
  httpRateLimits: typeof httpRateLimits;
  keys: typeof keys;
  keysMutations: typeof keysMutations;
  keysPublic: typeof keysPublic;
  linkCodes: typeof linkCodes;
  preferences: typeof preferences;
  remoteSync: typeof remoteSync;
  sessionConfig: typeof sessionConfig;
  sessionPublicJwks: typeof sessionPublicJwks;
  sessionStatus: typeof sessionStatus;
  sessionTokens: typeof sessionTokens;
  snapshotValidator: typeof snapshotValidator;
  snapshots: typeof snapshots;
  webAiArtifacts: typeof webAiArtifacts;
  webAiThreads: typeof webAiThreads;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
