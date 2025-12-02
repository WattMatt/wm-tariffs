-- Enable realtime for meters table
ALTER PUBLICATION supabase_realtime ADD TABLE public.meters;

-- Enable realtime for site_reconciliation_settings table  
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_reconciliation_settings;