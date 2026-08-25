-- Benchmarking email: the survey could not be announced.
--
-- Everything needed to run the 2026 cycle existed except a way to tell anyone
-- it was open. There was no member-facing benchmarking email of any kind —
-- the recipient queue recorded who should receive the invitation and had no
-- send path at all.
--
-- These four are TRANSACTIONAL under CASL and flagged as such, so they bypass
-- `comms_suppressions`, on the same reasoning as election mail: the benchmarking
-- survey is a membership obligation and a member benefit, not a commercial
-- electronic message. Someone who unsubscribed from conference marketing must
-- still be told their store's survey is open. Being unable to receive your own
-- survey is exclusion by mailing-list preference.
--
-- Send state lives on the recipient row, for the same reason is_beta does: the
-- row already exists for every store in the cycle, so a second table could only
-- disagree with it.

alter table public.benchmarking_recipients
  add column if not exists invited_at timestamptz,
  add column if not exists reminded_at timestamptz,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_send_error text;

comment on column public.benchmarking_recipients.invited_at is
  'When the invitation was actually accepted by Resend — not when we tried.';
comment on column public.benchmarking_recipients.last_send_error is
  'Why the last attempt failed. Delivery events do not reach the webhook, so this records what we attempted, never what landed.';

create index if not exists benchmarking_recipients_uninvited_idx
  on public.benchmarking_recipients (survey_id)
  where invited_at is null;

insert into public.message_templates
  (key, category, name, description, subject, body_html, variable_keys, is_system, is_transactional)
values
(
  'benchmarking_invitation',
  'benchmarking',
  'Benchmarking: survey is open',
  'Sent to each store''s designated respondent when the survey opens to all members.',
  'The {{fiscal_year}} CSC Benchmarking Survey is open',
  $html$<h2>The {{fiscal_year}} benchmarking survey is open</h2>
  <p>Hi {{contact_name}},</p>
  <p>The Campus Stores Canada benchmarking survey is now open for {{organization_name}}. It closes on <strong>{{closes_date}}</strong>.</p>
  <p style="margin:24px 0">
    <a href="{{survey_url}}" style="background:#163D6D;font-weight:600;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open the survey</a>
  </p>
  <p>It takes most stores 45 to 90 minutes, depending on how quickly you can pull your figures. You can save and come back — nothing is submitted until you say so.</p>
  <p><strong>What is different this year.</strong> Every question now carries an explanation of what it means and what to include, written and corrected by people who run stores like yours. In-store and online sales are separate questions. Inclusive Access revenue has its own field instead of distorting your retail numbers. If you filed last year, your answers appear beside each question so you can sanity-check yourself as you go.</p>
  <p><strong>Who sees your numbers.</strong> Your figures are seen by the review committee and by CSC staff, and are published to members only as comparisons — never as a named row without your agreement. If something in your data needs explaining, we ask you before that explanation goes anywhere.</p>
  <p>If you are not the right person at {{organization_name}} to fill this in, reply and tell me who is. That is genuinely useful and takes you thirty seconds.</p>
  <p>Steve Thomas<br>Campus Stores Canada</p>$html$,
  array['contact_name','organization_name','fiscal_year','closes_date','survey_url'],
  true, true
),
(
  'benchmarking_beta_invitation',
  'benchmarking',
  'Benchmarking: beta store, going first',
  'Sent to the 5-8 stores filing a week before everyone else. Their submission is real.',
  'You are first into the {{fiscal_year}} benchmarking survey',
  $html$<h2>You are going first</h2>
  <p>Hi {{contact_name}},</p>
  <p>Thank you for agreeing to fill the benchmarking survey a week before everyone else. It is open now for {{organization_name}}, and the rest of the membership follows on <strong>{{opens_date}}</strong>.</p>
  <p style="margin:24px 0">
    <a href="{{survey_url}}" style="background:#163D6D;font-weight:600;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open the survey</a>
  </p>
  <p><strong>Your submission is real.</strong> You are not testing with fake numbers and you will not be asked to do this twice. You are just going first, while we can still fix what you find.</p>
  <p>Afterwards I would like fifteen minutes, or an email if you would rather. Three questions: which question made you stop and think, which number was hardest to find, and what did you have to guess at. The third one matters most — every guess is a question we have written badly.</p>
  <p>Steve Thomas<br>Campus Stores Canada</p>$html$,
  array['contact_name','organization_name','fiscal_year','opens_date','survey_url'],
  true, true
),
(
  'benchmarking_reminder',
  'benchmarking',
  'Benchmarking: reminder',
  'Chase during collection. Only ever sent to stores that have not submitted.',
  '{{days_remaining}} days left for the {{fiscal_year}} benchmarking survey',
  $html$<h2>Still time to file</h2>
  <p>Hi {{contact_name}},</p>
  <p>The {{fiscal_year}} benchmarking survey closes on <strong>{{closes_date}}</strong> — {{days_remaining}} days from now — and I do not yet have a submission from {{organization_name}}.</p>
  <p style="margin:24px 0">
    <a href="{{survey_url}}" style="background:#163D6D;font-weight:600;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open the survey</a>
  </p>
  <p>If you have started and saved a draft, it is still there waiting for you.</p>
  <p>If the reason you have not filed is that a number is hard to produce, or a question does not fit how your store reports, tell me. I would much rather hear that than have you skip the year — and it is usually something I can answer in one reply.</p>
  <p>Steve Thomas<br>Campus Stores Canada</p>$html$,
  array['contact_name','organization_name','fiscal_year','closes_date','days_remaining','survey_url'],
  true, true
),
(
  'benchmarking_submission_received',
  'benchmarking',
  'Benchmarking: submission received',
  'Confirmation that a store''s figures are in, and what happens to them next.',
  'Received — {{organization_name}} {{fiscal_year}} benchmarking',
  $html$<h2>Your figures are in</h2>
  <p>Hi {{contact_name}},</p>
  <p>{{organization_name}}''s {{fiscal_year}} benchmarking submission arrived on {{submitted_date}}. Thank you — that is the hard part done.</p>
  <p><strong>What happens next.</strong> A reviewer checks the figures for anything that looks unusual against last year or against stores of a similar size. If something needs explaining, they will contact you — and any note written about your store is shown to you before it is published anywhere. If you disagree with it, it does not run.</p>
  <p>Results go out to participating members in the winter.</p>
  <p>You can still change your answers until the survey closes on {{closes_date}}. After that they are locked for the year.</p>
  <p>Steve Thomas<br>Campus Stores Canada</p>$html$,
  array['contact_name','organization_name','fiscal_year','submitted_date','closes_date'],
  true, true
)
on conflict (key) do update set
  subject = excluded.subject,
  body_html = excluded.body_html,
  variable_keys = excluded.variable_keys,
  description = excluded.description,
  is_transactional = excluded.is_transactional,
  updated_at = now();
