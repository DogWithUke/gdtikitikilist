
CREATE TABLE public.level_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  level_name text NOT NULL,
  position integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.level_changelog TO anon, authenticated;
GRANT ALL ON public.level_changelog TO service_role;
ALTER TABLE public.level_changelog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view changelog" ON public.level_changelog FOR SELECT USING (true);
CREATE POLICY "Admins manage changelog" ON public.level_changelog FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.hidden_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  hidden_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hidden_levels TO anon, authenticated;
GRANT ALL ON public.hidden_levels TO service_role;
ALTER TABLE public.hidden_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view hidden levels" ON public.hidden_levels FOR SELECT USING (true);
CREATE POLICY "Admins manage hidden levels" ON public.hidden_levels FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
