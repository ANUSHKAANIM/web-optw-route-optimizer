CREATE TABLE "run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"node" integer NOT NULL,
	"reward" real NOT NULL,
	"cumulative_reward" real NOT NULL,
	"current_time" real NOT NULL,
	"forecast_updated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"num_nodes" integer NOT NULL,
	"max_time" real NOT NULL,
	"beam_width" integer NOT NULL,
	"reward_decay_min" real NOT NULL,
	"forecast_enabled" boolean NOT NULL,
	"seed" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"env_state" jsonb NOT NULL,
	"decoder_state" jsonb NOT NULL,
	"recommendation" jsonb NOT NULL,
	"path" jsonb NOT NULL,
	"current_node" integer DEFAULT 0 NOT NULL,
	"current_time" real DEFAULT 0 NOT NULL,
	"total_reward" real DEFAULT 0 NOT NULL,
	"final_time" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;