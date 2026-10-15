CREATE TABLE `provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` text NOT NULL,
	`updated_at` text NOT NULL,
	`verified_at` text NOT NULL
);
