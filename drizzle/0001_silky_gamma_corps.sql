CREATE TABLE `endpoint_prices` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`cost_microusd` integer NOT NULL,
	`refreshed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spend_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`reserved_microusd` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `usage_events` ADD `estimated_cost_microusd` integer DEFAULT 0 NOT NULL;