import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Timeout wrapper to prevent hanging
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function updateSession(
  request: NextRequest,
  /**
   * Extra request headers to hand downstream, for callers that need a server
   * component to see something only the proxy knows (see lib/auth/request-path.ts).
   *
   * ⛔ Applied by re-snapshotting request.headers at each NextResponse.next()
   * below rather than once up front. request.cookies.set() rewrites the
   * `cookie` request header in place, so a snapshot taken before the refresh
   * would hand downstream the *stale* cookies and log people out at random —
   * exactly the failure the comments below warn about.
   */
  extraRequestHeaders?: Record<string, string>,
) {
  const nextWithExtras = () => {
    if (!extraRequestHeaders) return NextResponse.next({ request });
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(extraRequestHeaders)) {
      headers.set(name, value);
    }
    return NextResponse.next({ request: { headers } });
  };

  let supabaseResponse = nextWithExtras();

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = nextWithExtras();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: Use getClaims() instead of getUser() - getClaims() validates the JWT
  // signature against the project's published public keys every time, making it safe
  // to trust in server code. getUser() can hang or cause issues.
  // If you remove getClaims() and you use server-side rendering with the Supabase
  // client, your users may be randomly logged out.
  // Wrap in timeout to prevent site-wide hangs if Supabase is slow
  await withTimeout(supabase.auth.getClaims(), 3000);

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
