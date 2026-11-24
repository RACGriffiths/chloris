CREATE TABLE `care_event` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`plant_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`checked_task` text,
	`done_at` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plant_id`) REFERENCES `plant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `care_event_home_id_idx` ON `care_event` (`home_id`,`done_at`);--> statement-breakpoint
CREATE INDEX `care_event_plant_id_idx` ON `care_event` (`plant_id`,`done_at`);--> statement-breakpoint
CREATE INDEX `care_event_plant_type_idx` ON `care_event` (`plant_id`,`type`,`done_at`);--> statement-breakpoint
CREATE TABLE `care_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`plant_id` text NOT NULL,
	`task` text NOT NULL,
	`interval_days` integer NOT NULL,
	`winter_interval_days` integer,
	`recheck_days` integer DEFAULT 2 NOT NULL,
	`snoozed_until` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plant_id`) REFERENCES `plant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `care_schedule_home_id_idx` ON `care_schedule` (`home_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `care_schedule_plant_task_idx` ON `care_schedule` (`plant_id`,`task`);