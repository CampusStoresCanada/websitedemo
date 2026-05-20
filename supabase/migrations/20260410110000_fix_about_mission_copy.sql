-- Remove "shared purchasing power" from the about_mission body — CSC does not offer shared purchasing.
UPDATE public.site_content
SET body = 'Campus Stores Canada (CSC) advocates for and supports campus retail operations at post-secondary institutions across the country. We provide a forum for collaboration, professional development, and benchmarking — ensuring campus stores can deliver exceptional service to students, faculty, and staff.'
WHERE section = 'about_mission'
  AND content_type = 'text';
