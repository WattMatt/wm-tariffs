-- Enable realtime for meter_csv_files table to trigger UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.meter_csv_files;