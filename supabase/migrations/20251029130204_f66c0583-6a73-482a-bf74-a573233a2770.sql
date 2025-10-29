-- Enable realtime for schematic_lines table
ALTER TABLE schematic_lines REPLICA IDENTITY FULL;

-- Add schematic_lines to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE schematic_lines;