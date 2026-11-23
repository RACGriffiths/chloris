CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`home_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`home_id`) REFERENCES `home`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_hash_unique` ON `invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invite_home_id_idx` ON `invite` (`home_id`);