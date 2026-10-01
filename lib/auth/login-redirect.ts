/**
 * Where to send someone who is not signed in, so they get back to where they
 * were going.
 *
 * ⛔ `redirect("/login")` on its own loses the destination. LoginForm has read
 * a `next` param from the start, and nothing was passing one, so every gated
 * page sent you to the login screen and then to the homepage. The beta
 * invitation is where that stops being a papercut: a tester clicks "Open the
 * survey" in their email, is not signed in, logs in, lands on the front page,
 * and has no way to tell whether the link was broken or the survey was not
 * really open for them yet.
 *
 * Returns a relative path only. LoginForm accepts `next` only when it starts
 * with "/", which is what keeps this from becoming an open redirect, and this
 * builder stays inside that rule rather than relying on it.
 */
export function loginWithNext(
  path: string,
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  // Defensive: a caller that passes something absolute or protocol-relative
  // would otherwise hand LoginForm a value it silently drops, which looks
  // exactly like this bug rather than like a mistake.
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    // Repeated params keep every value; a single string keeps its own.
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else query.set(key, value);
  }

  const qs = query.toString();
  const next = qs ? `${safePath}?${qs}` : safePath;

  /*
    One encode, of the whole thing. `next` is itself a query value, so a
    destination that carries its own query has to arrive as one parameter
    rather than as several siblings of `next`.
  */
  return `/login?next=${encodeURIComponent(next)}`;
}
