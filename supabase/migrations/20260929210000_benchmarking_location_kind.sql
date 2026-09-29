-- What KIND of location this is. A seasonal pop-up and a permanent main store
-- carry very different square footage for the same sales, so a per-square-foot
-- comparison that cannot tell them apart compares the wrong things.
alter table benchmarking_locations
  add column if not exists kind text,
  add column if not exists kind_other text;

comment on column benchmarking_locations.kind is
  'Permanent | Seasonal | Satellite | Other. Null until the store answers.';
comment on column benchmarking_locations.kind_other is
  'Free text, only meaningful when kind = Other.';
