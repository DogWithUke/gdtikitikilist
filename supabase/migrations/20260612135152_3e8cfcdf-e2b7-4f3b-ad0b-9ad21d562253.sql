CREATE TABLE public.custom_levels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  position integer NOT NULL,
  name text NOT NULL,
  level_id text NOT NULL,
  password text,
  creators text[] NOT NULL DEFAULT '{}',
  verifier text NOT NULL,
  publisher text,
  points numeric NOT NULL DEFAULT 0,
  verification text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.custom_levels TO anon, authenticated;
GRANT ALL ON public.custom_levels TO service_role;

ALTER TABLE public.custom_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view custom levels"
ON public.custom_levels FOR SELECT
USING (true);

CREATE POLICY "Admins manage custom levels"
ON public.custom_levels FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));