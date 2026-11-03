-- Allow the CANCOLL Information Sharing consent as a conference legal document.
--
-- The CSC/CANCOLL MOU (2027, section 12) has CSC share a funded delegate's name,
-- institution, position title and attendance with CANCOLL, with that delegate's
-- consent. The consent is its own document, asked only on that delegate's
-- conference checklist, so it needs its own document_type.
--
-- The constraint is restated in full rather than appended to: the live list had
-- already been widened outside the migrations (member_code_of_conduct,
-- exhibitor_agreement and speaker_agreement all exist on live rows while the
-- original 20260302090000 constraint names only four types). This list matches
-- LEGAL_DOCUMENT_TYPES in lib/constants/conference.ts, which is what the admin
-- form offers. Check the live definition before applying, so a type added there
-- since is not dropped.

alter table public.conference_legal_versions
  drop constraint if exists conference_legal_versions_document_type_check;

alter table public.conference_legal_versions
  add constraint conference_legal_versions_document_type_check
  check (document_type in (
    'code_of_conduct',
    'member_code_of_conduct',
    'terms_and_conditions',
    'refund_policy',
    'privacy_notice',
    'exhibitor_agreement',
    'speaker_agreement',
    'cancoll_information_sharing'
  ));
