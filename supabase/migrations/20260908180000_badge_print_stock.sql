-- Blank stock held back for the on-site desk.
--
-- ⛔ Distinct from the blanks for outstanding SEATS. Those belong to a known
-- company that has not named somebody yet and carry that company's name, logo
-- and map. Reprint spares belong to nobody: stock for the desk to write on when
-- a badge is damaged, lost, or somebody walks up unregistered. They carry no
-- organisation and map the conference hotel.
--
-- The two are counted from different bases because the risk differs: exhibitor
-- spares are a percentage of what the FLOOR could hold (60 booths x 4 = 240),
-- not of what sold, because booth staff turn over late and the desk cannot ring
-- a store to confirm a name. Member spares are a percentage of the roster on
-- print day with a FLOOR, because 20% of a 13-person roster is 3 and would not
-- cover a desk for four days.
--
-- NULL means nobody has configured it, and no spares are printed. Adding a
-- hundred blank cards to somebody's print bill is not a sensible default.

alter table public.conference_instances
  add column if not exists badge_print_stock jsonb;

comment on column public.conference_instances.badge_print_stock is
  'Blank stock held back for the on-site desk: exhibitorSparePercent, memberSparePercent, memberSpareMinimum, enabled. Distinct from blanks for outstanding seats, which belong to a known company. NULL means nobody has configured it and no spares are printed.';
