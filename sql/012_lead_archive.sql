-- Lead archive (soft-archive, CATS candidate parity): leads are never
-- hard-deleted when they go inactive — archived_at just hides them from the
-- default working views (Lead Center, /leads workspace, Kanban) while keeping
-- the row for historical/compliance lookup. NULL = active/visible.
ALTER TABLE fun_lead ADD COLUMN archived_at DATETIME NULL DEFAULT NULL AFTER next_action_at;
ALTER TABLE fun_lead ADD INDEX idx_lead_archived (archived_at);
