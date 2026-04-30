alter table workbench_profile_updates
  add column if not exists source_signal text,
  add column if not exists confidence numeric check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  add column if not exists previous_value text,
  add column if not exists new_value text,
  add column if not exists user_decision text check (
    user_decision in ('accepted', 'edited', 'rejected', 'undone')
  );

create index if not exists workbench_profile_updates_user_decision_idx
  on workbench_profile_updates (user_id, user_decision, created_at desc)
  where user_decision is not null;
