ALTER TABLE public.waiting_queue SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_limit = 500
);

ANALYZE public.waiting_queue;