CREATE INDEX `agent_runs_session_id_idx` ON `agent_runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_parent_run_id_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE INDEX `approvals_run_id_idx` ON `approvals` (`run_id`);--> statement-breakpoint
CREATE INDEX `approvals_session_id_idx` ON `approvals` (`session_id`);--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);--> statement-breakpoint
CREATE INDEX `artifacts_session_id_idx` ON `artifacts` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_session_id_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_run_id_idx` ON `messages` (`run_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_id_idx` ON `tool_executions` (`run_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_session_id_idx` ON `tool_executions` (`session_id`);--> statement-breakpoint
CREATE INDEX `vector_metadata_source_idx` ON `vector_metadata` (`source`);