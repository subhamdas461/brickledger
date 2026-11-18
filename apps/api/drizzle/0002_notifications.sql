ALTER TABLE "users" ADD COLUMN "notifications_seen_id" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing accounts start caught up, not with their projects' whole history as unread.
UPDATE "users" SET "notifications_seen_id" = (SELECT COALESCE(MAX("id"), 0) FROM "activities");
