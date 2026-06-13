
CREATE TABLE public.list_editors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  name text NOT NULL,
  link text NOT NULL DEFAULT '#',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.list_editors TO anon, authenticated;
GRANT ALL ON public.list_editors TO service_role;
ALTER TABLE public.list_editors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view editors" ON public.list_editors FOR SELECT USING (true);
CREATE POLICY "Admins manage editors" ON public.list_editors FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
