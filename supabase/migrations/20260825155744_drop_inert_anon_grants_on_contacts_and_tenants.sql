-- contacts and tenants each hold an anon SELECT grant with no policy admitting
-- anon, so both return zero rows and no error today. Nothing reads either
-- anonymously. Left in place they are a loaded gun: one permissive read policy
-- added later opens the whole PII table without anyone touching a GRANT.
revoke select on public.contacts from anon;
revoke select on public.tenants from anon;
