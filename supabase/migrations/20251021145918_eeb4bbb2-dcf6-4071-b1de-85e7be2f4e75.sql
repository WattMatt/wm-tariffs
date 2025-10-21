-- Add scale fields to meter_positions for resizable meter cards
ALTER TABLE meter_positions
ADD COLUMN IF NOT EXISTS scale_x numeric DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS scale_y numeric DEFAULT 1.0;