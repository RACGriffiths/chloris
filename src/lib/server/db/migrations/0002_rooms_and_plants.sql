CREATE TABLE `plant` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`room_id` text NOT NULL,
	`nickname` text NOT NULL,
	`species` text,
	`acquired_on` text,
	`source` text,
	`pot` text,
	`soil` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`status_on` text,
	`status_note` text,
	`parent_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `plant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plant_home_id_idx` ON `plant` (`home_id`);--> statement-breakpoint
CREATE INDEX `plant_room_id_idx` ON `plant` (`room_id`);--> statement-breakpoint
CREATE INDEX `plant_parent_id_idx` ON `plant` (`parent_id`);--> statement-breakpoint
CREATE TABLE `room` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`name` text NOT NULL,
	`setting` text DEFAULT 'indoor' NOT NULL,
	`light` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_home_id_idx` ON `room` (`home_id`);