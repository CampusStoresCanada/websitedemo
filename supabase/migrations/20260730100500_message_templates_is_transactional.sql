alter table message_templates add column is_transactional boolean not null default false;

-- Clear-cut cases only — the safe default for anything ambiguous is
-- commercial (false), since that respects unsubscribe preferences.
-- Review the rest per-template in the admin UI.
update message_templates set is_transactional = true
where category in ('renewal', 'user_mgmt');

update message_templates set is_transactional = true
where key in (
  'conference_registration_confirmation',
  'conference_payment_confirmation'
);

update message_templates set is_transactional = true
where key in (
  'event_submitted',
  'event_approved',
  'event_changes_requested',
  'event_registration_confirmation',
  'event_cancelled',
  'event_waitlist_promoted'
);
