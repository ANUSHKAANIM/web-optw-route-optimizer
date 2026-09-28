CREATE TABLE "game_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"seed" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"max_time" real NOT NULL,
	"beam_width" integer NOT NULL,
	"reward_decay_min" real NOT NULL,
	"reward_interval_seconds" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"decoder_state" jsonb NOT NULL,
	"recommendation" jsonb NOT NULL,
	"path" jsonb NOT NULL,
	"current_node" integer DEFAULT 0 NOT NULL,
	"current_time" real DEFAULT 0 NOT NULL,
	"total_reward" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"final_time" real,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;