alter table platform_config
  add column host_org_slug text;

update platform_config
  set host_org_slug = 'campus-stores-canada'
  where client_name = 'Campus Stores Canada';
