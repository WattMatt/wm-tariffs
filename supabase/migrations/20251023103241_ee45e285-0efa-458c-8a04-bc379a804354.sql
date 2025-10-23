-- Add source document tracking to tariff structures
ALTER TABLE tariff_structures 
ADD COLUMN source_document_id uuid REFERENCES site_documents(id) ON DELETE SET NULL;

CREATE INDEX idx_tariff_structures_source_document ON tariff_structures(source_document_id);

COMMENT ON COLUMN tariff_structures.source_document_id IS 'References the document from which this tariff was extracted';