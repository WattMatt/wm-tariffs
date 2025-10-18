-- Allow operators to manage tariff-related data
-- Update supply_authorities policy
DROP POLICY IF EXISTS "Admins can manage supply authorities" ON public.supply_authorities;
CREATE POLICY "Admins and operators can manage supply authorities" 
ON public.supply_authorities 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Update tariff_structures policy
DROP POLICY IF EXISTS "Admins can manage tariff structures" ON public.tariff_structures;
CREATE POLICY "Admins and operators can manage tariff structures" 
ON public.tariff_structures 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Update tariff_blocks policy
DROP POLICY IF EXISTS "Admins can manage tariff blocks" ON public.tariff_blocks;
CREATE POLICY "Admins and operators can manage tariff blocks" 
ON public.tariff_blocks 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Update tariff_charges policy
DROP POLICY IF EXISTS "Admins can manage tariff charges" ON public.tariff_charges;
CREATE POLICY "Admins and operators can manage tariff charges" 
ON public.tariff_charges 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Update tariff_time_periods policy
DROP POLICY IF EXISTS "Admins can manage TOU periods" ON public.tariff_time_periods;
CREATE POLICY "Admins and operators can manage TOU periods" 
ON public.tariff_time_periods 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));