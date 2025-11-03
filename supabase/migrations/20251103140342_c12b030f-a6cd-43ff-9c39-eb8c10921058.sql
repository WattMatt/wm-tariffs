-- Add folder support to site_documents table
ALTER TABLE site_documents
ADD COLUMN folder_path text DEFAULT '' NOT NULL,
ADD COLUMN is_folder boolean DEFAULT false NOT NULL,
ADD COLUMN parent_folder_id uuid REFERENCES site_documents(id) ON DELETE CASCADE;

-- Create index for faster folder queries
CREATE INDEX idx_site_documents_folder_path ON site_documents(site_id, folder_path);
CREATE INDEX idx_site_documents_parent_folder ON site_documents(parent_folder_id);

-- Update RLS policies to handle folders
DROP POLICY IF EXISTS "Authenticated users can view site documents" ON site_documents;
CREATE POLICY "Authenticated users can view site documents"
  ON site_documents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can upload documents" ON site_documents;
CREATE POLICY "Authenticated users can upload documents"
  ON site_documents FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins and operators can update documents" ON site_documents;
CREATE POLICY "Admins and operators can update documents"
  ON site_documents FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

DROP POLICY IF EXISTS "Authenticated users can delete documents" ON site_documents;
CREATE POLICY "Authenticated users can delete documents"
  ON site_documents FOR DELETE
  USING (true);