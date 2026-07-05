import { query } from "./_generated/server";
import { requireSessionIdentity } from "./authHelpers";

export const validate = query({
  args: {},
  handler: async (ctx) => {
    await requireSessionIdentity(ctx);
    return { valid: true };
  },
});
