export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail at startup, not on the first request, when the environment is misconfigured.
    const { getEnv } = await import("@/lib/env");
    getEnv();
  }
}
