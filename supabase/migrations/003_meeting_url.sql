-- The bot.joined webhook needs the original meeting URL to spawn the
-- Pipecat sidecar bot, so persist it at scheduling time.
ALTER TABLE meetings ADD COLUMN meeting_url TEXT;
