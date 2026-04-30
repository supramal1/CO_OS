alter table user_workbench_config
  alter column notion_parent_page_id drop not null,
  alter column drive_folder_id drop not null,
  alter column drive_folder_url drop not null;
