-- Create document types enum
CREATE TYPE document_type AS ENUM ('municipal_account', 'tenant_bill', 'other');

-- Create site_documents table
CREATE TABLE public.site_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  document_type document_type NOT NULL,
  upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id),
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create document_extractions table
CREATE TABLE public.document_extractions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.site_documents(id) ON DELETE CASCADE,
  period_start DATE,
  period_end DATE,
  total_amount NUMERIC,
  currency TEXT DEFAULT 'ZAR',
  extracted_data JSONB,
  confidence_score NUMERIC,
  extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.site_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;

-- RLS policies for site_documents
CREATE POLICY "Authenticated users can view site documents"
  ON public.site_documents
  FOR SELECT
  USING (true);

CREATE POLICY "Admins and operators can upload documents"
  ON public.site_documents
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

CREATE POLICY "Admins and operators can update documents"
  ON public.site_documents
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

CREATE POLICY "Admins can delete documents"
  ON public.site_documents
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for document_extractions
CREATE POLICY "Authenticated users can view extractions"
  ON public.document_extractions
  FOR SELECT
  USING (true);

CREATE POLICY "System can insert extractions"
  ON public.document_extractions
  FOR INSERT
  WITH CHECK (true);

-- Create indexes
CREATE INDEX idx_site_documents_site_id ON public.site_documents(site_id);
CREATE INDEX idx_site_documents_document_type ON public.site_documents(document_type);
CREATE INDEX idx_document_extractions_document_id ON public.document_extractions(document_id);
CREATE INDEX idx_document_extractions_period ON public.document_extractions(period_start, period_end);

-- Add trigger for updated_at
CREATE TRIGGER update_site_documents_updated_at
  BEFORE UPDATE ON public.site_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for site documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-documents', 'site-documents', false);

-- Storage policies
CREATE POLICY "Authenticated users can view site documents"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'site-documents');

CREATE POLICY "Admins and operators can upload site documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'site-documents' AND
    (SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role))
  );

CREATE POLICY "Admins can delete site documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'site-documents' AND
    (SELECT has_role(auth.uid(), 'admin'::app_role))
  );