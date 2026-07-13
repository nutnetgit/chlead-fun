-- Event branch ownership (user req 2026-07-13): events become branch-scoped
-- for editing — a manager can only manage events belonging to one of their
-- own branches (fun_user_branch). branch_id NULL = a group-wide/central
-- event (e.g. Motor Show): visible to everyone, editable by admin/gm only.
-- Visibility stays global for all roles — only WRITE access is scoped.
ALTER TABLE fun_campaign
  ADD COLUMN branch_id INT NULL AFTER brand_id;
