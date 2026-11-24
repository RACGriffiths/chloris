CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_id` text,
	`detail` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_event_home_id_created_at_idx` ON `audit_event` (`home_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `server_event` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`user_id` text,
	`target_id` text,
	`detail` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `server_event_created_at_idx` ON `server_event` (`created_at`);