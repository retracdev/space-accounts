ALTER TABLE `user` ADD `action_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `action_required_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `action_required_url` text;