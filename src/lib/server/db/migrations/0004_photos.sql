CREATE TABLE `photo` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`plant_id` text NOT NULL,
	`user_id` text,
	`file_key` text NOT NULL,
	`taken_at` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`caption` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plant_id`) REFERENCES `plant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_file_key_unique` ON `photo` (`file_key`);--> statement-breakpoint
CREATE INDEX `photo_home_id_idx` ON `photo` (`home_id`);--> statement-breakpoint
CREATE INDEX `photo_plant_id_idx` ON `photo` (`plant_id`,`taken_at`);--> statement-breakpoint
ALTER TABLE `care_event` ADD `photo_id` text REFERENCES photo(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `plant` ADD `cover_photo_id` text REFERENCES photo(id) ON DELETE set null;