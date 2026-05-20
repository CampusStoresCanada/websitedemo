-- Fix: "Admins can manage site content" policy applies to {public} (including anon).
-- When anon queries site_content, PostgreSQL evaluates all permissive policies —
-- including the admin one — and hits `SELECT FROM profiles` which anon cannot read,
-- producing error 42501.
--
-- Fix: add `auth.uid() IS NOT NULL AND` so the EXISTS check short-circuits for anon.
-- This way unauthenticated requests never touch the profiles table during evaluation.

DROP POLICY IF EXISTS "Admins can manage site content" ON public.site_content;

CREATE POLICY "Admins can manage site content"
  ON public.site_content
  FOR ALL
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.global_role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.global_role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    )
  );
