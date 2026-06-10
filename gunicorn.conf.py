# Gunicorn configuration for the backend API.
#
# Rationale: the previous bare invocation ran a single sync worker, so one
# request blocked on a slow/unreachable ArangoDB would stall the whole
# process -- including the lightweight ALB health check at /health/ -- which
# made the ECS task flap and surfaced as 504s to the client. Threaded workers
# let the health check (and other requests) be served while a thread is parked
# on a blocking ArangoDB socket. Values are env-tunable so we don't need an
# image rebuild to adjust them.
#
# NOTE: this is necessary but not sufficient. Without a connect/read timeout on
# the ArangoDB client, threads still eventually exhaust under a dead DB -- this
# just keeps /health/ alive far longer and prevents needless task cycling.

import os

bind = "0.0.0.0:8000"

# gthread: each worker runs a thread pool; threads blocked on I/O release the
# GIL, so the health-check thread keeps running during a slow DB call.
worker_class = "gthread"

# Keep small on the 0.25 vCPU / 512 MB Fargate task. WEB_CONCURRENCY is the
# gunicorn-standard override; bump it (and the task memory) together.
workers = int(os.getenv("WEB_CONCURRENCY", "1"))
threads = int(os.getenv("GUNICORN_THREADS", "4"))

# Worker silence timeout before the master kills/replaces it.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "30"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))

# Recycle workers periodically to bound memory creep on the tight 512 MB task;
# jitter staggers restarts so they don't all recycle at once.
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "100"))

# Logs to stdout/stderr -> CloudWatch.
accesslog = "-"
errorlog = "-"
