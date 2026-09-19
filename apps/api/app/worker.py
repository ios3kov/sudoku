from celery import Celery
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor

from .config import get_settings
from .observability import configure_structured_logging, configure_telemetry

settings = get_settings()
configure_structured_logging("sudoku-worker")


@worker_process_init.connect(weak=False)
def init_worker_observability(*_args, **_kwargs):
    configure_telemetry("sudoku-worker")
    CeleryInstrumentor().instrument(use_span_links=True)


celery_app = Celery("sudoku", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_transport_options={"visibility_timeout": 300},
    beat_schedule={
        "dispatch-outbox-every-second": {
            "task": "app.tasks.outbox.dispatch_outbox_batch",
            "schedule": 1.0,
        },
        "cleanup-orphan-assets-every-six-hours": {
            "task": "app.tasks.assets.cleanup_orphan_assets",
            "schedule": 6 * 60 * 60,
        },
    },
    imports=("app.tasks.outbox", "app.tasks.push", "app.tasks.assets"),
)
