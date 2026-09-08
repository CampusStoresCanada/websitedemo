/**
 * Stub for the `server-only` package, used ONLY by the scripts tsconfig.
 *
 * ⚠️ `server-only` is not a dependency and never has been — Next resolves it
 * internally, so `next build` is happy while plain `tsx` dies with
 * MODULE_NOT_FOUND. That is why the scheduler CLI broke without any gate
 * noticing: the break is only on a path no build exercises.
 *
 * ⛔ This shim is deliberately NOT wired into tsconfig.json. That file is read
 * by Next, and pointing "server-only" at an empty module there would disable
 * the client-bundling guard in every one of the ~10 files that import it —
 * turning a compile-time error into contact details reaching a client bundle.
 * It belongs to tsconfig.scripts.json alone.
 *
 * The guard exists to stop a module reaching a CLIENT bundle. A Node CLI is
 * not a client, so satisfying the import with nothing is correct here.
 */
export {};
