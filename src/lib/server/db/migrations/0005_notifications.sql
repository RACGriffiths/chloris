CREATE TABLE `digest_log` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`channel` text NOT NULL,
	`task_count` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_id`,`user_id`) REFERENCES `membership`(`home_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digest_log_home_user_date_idx` ON `digest_log` (`home_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text,
	`digest_time` text NOT NULL,
	`quiet_start` text,
	`quiet_end` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_id`,`user_id`) REFERENCES `membership`(`home_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_settings_home_user_idx` ON `notification_settings` (`home_id`,`user_id`);