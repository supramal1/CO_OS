ALTER TABLE tool_approvals DROP CONSTRAINT tool_approvals_state_check;

ALTER TABLE tool_approvals ADD CONSTRAINT tool_approvals_state_check
  CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled'));
