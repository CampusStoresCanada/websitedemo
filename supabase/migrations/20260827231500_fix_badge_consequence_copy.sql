-- "A badge in the box" was mine, and it implied a contrast that does not exist.
--
-- Steve, 2026-08-27: "Badge in what box?" — and earlier, "badge pickup is
-- always at the conference." So there is no box-versus-desk difference for the
-- reader; everyone collects on site either way. I had invented a consequence,
-- then written copy that leaned on it, then used registration-desk jargon to
-- describe it.
--
-- What is actually true: the pre-print run takes whoever is named by the
-- deadline. Being named later means your badge is printed on site rather than
-- in advance. That is a real difference in how the badge gets made, without
-- claiming anything about where you pick it up.
update conference_checklist_tasks set
  hardens_because = 'badges are printed from whoever is named by then — anyone added later has theirs printed on site instead'
where name in ('Assign your booth staff', 'Assign your social event tickets');

update conference_checklist_tasks set
  hardens_because = 'this is when badges are printed — corrections after that are made on site'
where name = 'Check your badge details are right';
