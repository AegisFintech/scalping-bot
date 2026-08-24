ALTER TABLE symbols
  ADD COLUMN volume_scale numeric(30,10);

UPDATE symbols SET volume_scale = 0.01 WHERE volume_scale IS NULL;

ALTER TABLE symbols
  ALTER COLUMN volume_scale SET NOT NULL,
  ADD CONSTRAINT symbols_volume_scale_positive CHECK (volume_scale > 0);
