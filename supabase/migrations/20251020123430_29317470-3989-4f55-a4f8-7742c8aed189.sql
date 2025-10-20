-- Remove test policy
DROP POLICY IF EXISTS "Test - Allow all reads" ON meter_readings;

-- Check and fix all other tables with similar RLS issues
-- Fix clients table
DROP POLICY IF EXISTS "Authenticated users can view clients" ON clients;
CREATE POLICY "Authenticated users can view clients" ON clients FOR SELECT TO authenticated USING (true);

-- Fix meter_connections
DROP POLICY IF EXISTS "Authenticated users can view meter connections" ON meter_connections;
CREATE POLICY "Authenticated users can view meter connections" ON meter_connections FOR SELECT TO authenticated USING (true);

-- Fix meter_positions  
DROP POLICY IF EXISTS "Authenticated users can view meter positions" ON meter_positions;
CREATE POLICY "Authenticated users can view meter positions" ON meter_positions FOR SELECT TO authenticated USING (true);

-- Fix schematics
DROP POLICY IF EXISTS "Authenticated users can view schematics" ON schematics;
CREATE POLICY "Authenticated users can view schematics" ON schematics FOR SELECT TO authenticated USING (true);

-- Fix schematic_lines
DROP POLICY IF EXISTS "Authenticated users can view schematic lines" ON schematic_lines;
CREATE POLICY "Authenticated users can view schematic lines" ON schematic_lines FOR SELECT TO authenticated USING (true);

-- Fix sites
DROP POLICY IF EXISTS "Authenticated users can view sites" ON sites;
CREATE POLICY "Authenticated users can view sites" ON sites FOR SELECT TO authenticated USING (true);

-- Fix supply_authorities
DROP POLICY IF EXISTS "Authenticated users can view supply authorities" ON supply_authorities;
CREATE POLICY "Authenticated users can view supply authorities" ON supply_authorities FOR SELECT TO authenticated USING (true);

-- Fix tariff tables
DROP POLICY IF EXISTS "Authenticated users can view tariff structures" ON tariff_structures;
CREATE POLICY "Authenticated users can view tariff structures" ON tariff_structures FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view tariff blocks" ON tariff_blocks;
CREATE POLICY "Authenticated users can view tariff blocks" ON tariff_blocks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view tariff charges" ON tariff_charges;
CREATE POLICY "Authenticated users can view tariff charges" ON tariff_charges FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view TOU periods" ON tariff_time_periods;
CREATE POLICY "Authenticated users can view TOU periods" ON tariff_time_periods FOR SELECT TO authenticated USING (true);